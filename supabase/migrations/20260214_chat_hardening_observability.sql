alter table if exists public.fantasy_global_chat_messages
  add column if not exists sender_avatar_url text null;

alter table if exists public.fantasy_global_chat_messages
  add column if not exists sender_avatar_border_color text null;

alter table if exists public.fantasy_global_chat_messages
  add column if not exists idempotency_key text null;

create index if not exists fantasy_global_chat_messages_user_created_at_idx
  on public.fantasy_global_chat_messages (user_id, created_at desc, id desc);

create unique index if not exists fantasy_global_chat_messages_user_idempotency_key_idx
  on public.fantasy_global_chat_messages (user_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.fantasy_chat_observability_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  source text not null check (source in ('client', 'server')),
  metric_name text not null check (
    metric_name in (
      'fetch_latency_ms',
      'send_latency_ms',
      'realtime_disconnect',
      'fallback_sync',
      'duplicate_drop'
    )
  ),
  metric_value integer not null check (metric_value >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists fantasy_chat_observability_events_created_at_idx
  on public.fantasy_chat_observability_events (created_at desc, id desc);

create index if not exists fantasy_chat_observability_events_metric_created_idx
  on public.fantasy_chat_observability_events (metric_name, created_at desc);

create or replace function public.fantasy_chat_post_message(
  p_sender_label text,
  p_message text,
  p_sender_avatar_url text default null,
  p_sender_avatar_border_color text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_sender_label text := btrim(coalesce(p_sender_label, ''));
  v_message text := btrim(regexp_replace(coalesce(p_message, ''), '\s+', ' ', 'g'));
  v_sender_avatar_url text := nullif(btrim(coalesce(p_sender_avatar_url, '')), '');
  v_sender_avatar_border_color text := nullif(btrim(coalesce(p_sender_avatar_border_color, '')), '');
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_rate_count_10s integer := 0;
  v_rate_count_60s integer := 0;
  v_message_row public.fantasy_global_chat_messages%rowtype;
begin
  if v_user_id is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Authentication required.',
      'code', 'UNAUTHORIZED'
    );
  end if;

  if v_sender_label = '' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Chat sender label is required.',
      'code', 'INVALID_SENDER_LABEL'
    );
  end if;

  if v_message = '' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Message cannot be empty.',
      'code', 'EMPTY_MESSAGE'
    );
  end if;

  if char_length(v_message) > 320 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Message must be 320 characters or fewer.',
      'code', 'MESSAGE_TOO_LONG'
    );
  end if;

  if v_idempotency_key is not null and char_length(v_idempotency_key) > 128 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Idempotency key must be 128 characters or fewer.',
      'code', 'INVALID_IDEMPOTENCY_KEY'
    );
  end if;

  if v_idempotency_key is not null then
    select *
    into v_message_row
    from public.fantasy_global_chat_messages messages
    where messages.user_id = v_user_id
      and messages.idempotency_key = v_idempotency_key
    order by messages.id desc
    limit 1;

    if found then
      return jsonb_build_object(
        'ok', true,
        'duplicate', true,
        'message', jsonb_build_object(
          'id', v_message_row.id,
          'user_id', v_message_row.user_id,
          'sender_label', v_message_row.sender_label,
          'sender_avatar_url', v_message_row.sender_avatar_url,
          'sender_avatar_border_color', v_message_row.sender_avatar_border_color,
          'message', v_message_row.message,
          'created_at', v_message_row.created_at
        )
      );
    end if;
  end if;

  select count(*)
  into v_rate_count_10s
  from public.fantasy_global_chat_messages messages
  where messages.user_id = v_user_id
    and messages.created_at >= timezone('utc', now()) - interval '10 seconds';

  if v_rate_count_10s >= 5 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Rate limit reached. Wait a few seconds before sending again.',
      'code', 'RATE_LIMIT_SHORT'
    );
  end if;

  select count(*)
  into v_rate_count_60s
  from public.fantasy_global_chat_messages messages
  where messages.user_id = v_user_id
    and messages.created_at >= timezone('utc', now()) - interval '60 seconds';

  if v_rate_count_60s >= 30 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Rate limit reached. Slow down and try again shortly.',
      'code', 'RATE_LIMIT_MINUTE'
    );
  end if;

  begin
    insert into public.fantasy_global_chat_messages (
      user_id,
      sender_label,
      sender_avatar_url,
      sender_avatar_border_color,
      message,
      idempotency_key
    )
    values (
      v_user_id,
      v_sender_label,
      v_sender_avatar_url,
      v_sender_avatar_border_color,
      v_message,
      v_idempotency_key
    )
    returning *
    into v_message_row;
  exception
    when unique_violation then
      if v_idempotency_key is not null then
        select *
        into v_message_row
        from public.fantasy_global_chat_messages messages
        where messages.user_id = v_user_id
          and messages.idempotency_key = v_idempotency_key
        order by messages.id desc
        limit 1;

        if found then
          return jsonb_build_object(
            'ok', true,
            'duplicate', true,
            'message', jsonb_build_object(
              'id', v_message_row.id,
              'user_id', v_message_row.user_id,
              'sender_label', v_message_row.sender_label,
              'sender_avatar_url', v_message_row.sender_avatar_url,
              'sender_avatar_border_color', v_message_row.sender_avatar_border_color,
              'message', v_message_row.message,
              'created_at', v_message_row.created_at
            )
          );
        end if;
      end if;
      raise;
  end;

  return jsonb_build_object(
    'ok', true,
    'duplicate', false,
    'message', jsonb_build_object(
      'id', v_message_row.id,
      'user_id', v_message_row.user_id,
      'sender_label', v_message_row.sender_label,
      'sender_avatar_url', v_message_row.sender_avatar_url,
      'sender_avatar_border_color', v_message_row.sender_avatar_border_color,
      'message', v_message_row.message,
      'created_at', v_message_row.created_at
    )
  );
end;
$$;

create or replace function public.fantasy_chat_observability_summary(
  p_window_minutes integer default 1440
)
returns jsonb
language sql
set search_path = public
as $$
  with filtered as (
    select
      metric_name,
      metric_value::double precision as metric_value
    from public.fantasy_chat_observability_events events
    where events.created_at >= timezone('utc', now()) - make_interval(mins => greatest(1, p_window_minutes))
  )
  select jsonb_build_object(
    'window_minutes', greatest(1, p_window_minutes),
    'fetch_p95_ms', coalesce((
      select percentile_cont(0.95) within group (order by metric_value)
      from filtered
      where metric_name = 'fetch_latency_ms'
    ), 0),
    'send_p95_ms', coalesce((
      select percentile_cont(0.95) within group (order by metric_value)
      from filtered
      where metric_name = 'send_latency_ms'
    ), 0),
    'realtime_disconnect_count', coalesce((
      select sum(metric_value)::bigint
      from filtered
      where metric_name = 'realtime_disconnect'
    ), 0),
    'fallback_sync_count', coalesce((
      select sum(metric_value)::bigint
      from filtered
      where metric_name = 'fallback_sync'
    ), 0),
    'duplicate_drop_count', coalesce((
      select sum(metric_value)::bigint
      from filtered
      where metric_name = 'duplicate_drop'
    ), 0)
  );
$$;

create or replace function public.fantasy_cleanup_chat_data(
  p_retain_days integer default 45,
  p_keep_recent integer default 5000,
  p_metric_retain_days integer default 14
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_retain_days integer := greatest(1, p_retain_days);
  v_keep_recent integer := greatest(0, p_keep_recent);
  v_metric_retain_days integer := greatest(1, p_metric_retain_days);
  v_chat_cutoff timestamptz := timezone('utc', now()) - make_interval(days => v_retain_days);
  v_metrics_cutoff timestamptz := timezone('utc', now()) - make_interval(days => v_metric_retain_days);
  v_deleted_messages integer := 0;
  v_deleted_observability_events integer := 0;
begin
  with recent_messages as (
    select id
    from public.fantasy_global_chat_messages
    order by id desc
    limit v_keep_recent
  )
  delete from public.fantasy_global_chat_messages messages
  where messages.created_at < v_chat_cutoff
    and not exists (
      select 1
      from recent_messages recent
      where recent.id = messages.id
    );

  get diagnostics v_deleted_messages = row_count;

  delete from public.fantasy_chat_observability_events events
  where events.created_at < v_metrics_cutoff;

  get diagnostics v_deleted_observability_events = row_count;

  return jsonb_build_object(
    'deleted_messages', v_deleted_messages,
    'deleted_observability_events', v_deleted_observability_events
  );
end;
$$;

grant insert on public.fantasy_global_chat_messages to authenticated;
grant usage, select on sequence public.fantasy_global_chat_messages_id_seq to authenticated;
grant execute on function public.fantasy_chat_post_message(text, text, text, text, text) to authenticated;

grant insert on public.fantasy_chat_observability_events to authenticated;
grant usage, select on sequence public.fantasy_chat_observability_events_id_seq to authenticated;

alter table public.fantasy_chat_observability_events enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fantasy_global_chat_messages'
      and policyname = 'Global chat insert own messages'
  ) then
    create policy "Global chat insert own messages"
      on public.fantasy_global_chat_messages
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fantasy_chat_observability_events'
      and policyname = 'Chat observability insert own metrics'
  ) then
    create policy "Chat observability insert own metrics"
      on public.fantasy_chat_observability_events
      for insert
      to authenticated
      with check (auth.uid() = user_id);
  end if;
end $$;
