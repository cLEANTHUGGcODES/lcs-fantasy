create table if not exists public.fantasy_match_snapshots (
  id bigint generated always as identity primary key,
  source_page text not null,
  games jsonb not null, -- stores full fantasy snapshot payload
  stored_at timestamptz not null default timezone('utc', now()),
  created_by text null
);

create index if not exists fantasy_match_snapshots_source_page_stored_at_idx
  on public.fantasy_match_snapshots (source_page, stored_at desc);

create table if not exists public.fantasy_app_admin (
  id integer primary key check (id = 1),
  admin_user_id uuid not null unique,
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.fantasy_scoring_settings (
  id integer primary key check (id = 1),
  scoring jsonb not null,
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by_user_id uuid null
);

create table if not exists public.fantasy_global_chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  sender_label text not null,
  sender_avatar_url text null,
  sender_avatar_border_color text null,
  message text not null check (char_length(message) <= 320),
  image_url text null,
  idempotency_key text null,
  created_at timestamptz not null default timezone('utc', now())
);

alter table if exists public.fantasy_global_chat_messages
  add column if not exists sender_avatar_url text null;

alter table if exists public.fantasy_global_chat_messages
  add column if not exists sender_avatar_border_color text null;

alter table if exists public.fantasy_global_chat_messages
  add column if not exists idempotency_key text null;

alter table if exists public.fantasy_global_chat_messages
  add column if not exists image_url text null;

alter table if exists public.fantasy_global_chat_messages
  drop constraint if exists fantasy_global_chat_messages_message_check;

alter table if exists public.fantasy_global_chat_messages
  drop constraint if exists fantasy_global_chat_messages_message_or_image_check;

alter table if exists public.fantasy_global_chat_messages
  add constraint fantasy_global_chat_messages_message_or_image_check
  check (
    char_length(message) <= 320
    and (char_length(btrim(message)) > 0 or image_url is not null)
    and (image_url is null or char_length(image_url) <= 2048)
  );

create index if not exists fantasy_global_chat_messages_created_at_idx
  on public.fantasy_global_chat_messages (created_at desc, id desc);

create index if not exists fantasy_global_chat_messages_user_created_at_idx
  on public.fantasy_global_chat_messages (user_id, created_at desc, id desc);

create unique index if not exists fantasy_global_chat_messages_user_idempotency_key_idx
  on public.fantasy_global_chat_messages (user_id, idempotency_key)
  where idempotency_key is not null;

create table if not exists public.fantasy_global_chat_reactions (
  id bigint generated always as identity primary key,
  message_id bigint not null references public.fantasy_global_chat_messages (id) on delete cascade,
  user_id uuid not null,
  reactor_label text not null,
  emoji text not null check (
    char_length(btrim(emoji)) > 0
    and char_length(emoji) <= 16
    and btrim(emoji) !~ '\s'
  ),
  created_at timestamptz not null default timezone('utc', now())
);

create unique index if not exists fantasy_global_chat_reactions_message_user_emoji_idx
  on public.fantasy_global_chat_reactions (message_id, user_id, emoji);

create index if not exists fantasy_global_chat_reactions_message_created_idx
  on public.fantasy_global_chat_reactions (message_id, created_at desc, id desc);

create index if not exists fantasy_global_chat_reactions_user_created_idx
  on public.fantasy_global_chat_reactions (user_id, created_at desc, id desc);

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

create table if not exists public.fantasy_draft_observability_events (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  source text not null check (source in ('client', 'server')),
  metric_name text not null check (
    metric_name in (
      'server_draft_detail_latency_ms',
      'server_draft_presence_latency_ms',
      'server_draft_pick_latency_ms',
      'server_draft_status_latency_ms',
      'client_draft_refresh_latency_ms',
      'client_draft_presence_latency_ms',
      'client_draft_pick_latency_ms',
      'client_draft_status_latency_ms',
      'client_realtime_disconnect',
      'client_refresh_retry'
    )
  ),
  metric_value integer not null check (metric_value >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists fantasy_draft_observability_events_created_at_idx
  on public.fantasy_draft_observability_events (created_at desc, id desc);

create index if not exists fantasy_draft_observability_events_metric_created_idx
  on public.fantasy_draft_observability_events (metric_name, created_at desc);

create table if not exists public.fantasy_drafts (
  id bigint generated always as identity primary key,
  name text not null,
  league_slug text not null,
  season_year integer not null,
  source_page text not null,
  scheduled_at timestamptz not null,
  started_at timestamptz null,
  round_count integer not null check (round_count > 0 and round_count <= 20),
  pick_seconds integer not null check (pick_seconds >= 1 and pick_seconds <= 900),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'paused', 'completed')),
  created_by_user_id uuid not null,
  created_by_label text null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists fantasy_drafts_scheduled_at_idx
  on public.fantasy_drafts (scheduled_at desc);

-- Keep this check aligned for existing installations where the table already exists.
alter table if exists public.fantasy_drafts
  drop constraint if exists fantasy_drafts_pick_seconds_check;

alter table if exists public.fantasy_drafts
  add constraint fantasy_drafts_pick_seconds_check
  check (pick_seconds >= 1 and pick_seconds <= 900);

create table if not exists public.fantasy_draft_participants (
  id bigint generated always as identity primary key,
  draft_id bigint not null references public.fantasy_drafts(id) on delete cascade,
  user_id uuid not null,
  email text null,
  display_name text not null,
  first_name text null,
  last_name text null,
  team_name text null,
  draft_position integer not null check (draft_position > 0),
  created_at timestamptz not null default timezone('utc', now()),
  unique (draft_id, user_id),
  unique (draft_id, draft_position)
);

create index if not exists fantasy_draft_participants_draft_idx
  on public.fantasy_draft_participants (draft_id, draft_position);

alter table if exists public.fantasy_draft_participants
  add column if not exists team_name text null;

alter table if exists public.fantasy_draft_participants
  add column if not exists first_name text null;

alter table if exists public.fantasy_draft_participants
  add column if not exists last_name text null;

create table if not exists public.fantasy_draft_team_pool (
  id bigint generated always as identity primary key,
  draft_id bigint not null references public.fantasy_drafts(id) on delete cascade,
  team_name text not null,
  player_team text null,
  player_role text null,
  team_icon_url text null,
  player_image_url text null,
  projected_avg_fantasy_points numeric null,
  source_page text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (draft_id, team_name)
);

alter table if exists public.fantasy_draft_team_pool
  add column if not exists player_team text null;

alter table if exists public.fantasy_draft_team_pool
  add column if not exists player_role text null;

alter table if exists public.fantasy_draft_team_pool
  add column if not exists player_image_url text null;

alter table if exists public.fantasy_draft_team_pool
  add column if not exists projected_avg_fantasy_points numeric null;

create index if not exists fantasy_draft_team_pool_draft_idx
  on public.fantasy_draft_team_pool (draft_id, team_name);

create index if not exists fantasy_draft_team_pool_draft_role_projection_idx
  on public.fantasy_draft_team_pool (draft_id, player_role, projected_avg_fantasy_points desc, team_name);

create table if not exists public.fantasy_draft_picks (
  id bigint generated always as identity primary key,
  draft_id bigint not null references public.fantasy_drafts(id) on delete cascade,
  overall_pick integer not null check (overall_pick > 0),
  round_number integer not null check (round_number > 0),
  round_pick integer not null check (round_pick > 0),
  participant_user_id uuid not null,
  participant_display_name text not null,
  team_name text not null,
  player_team text null,
  player_role text null,
  team_icon_url text null,
  player_image_url text null,
  picked_by_user_id uuid not null,
  picked_by_label text null,
  picked_at timestamptz not null default timezone('utc', now()),
  unique (draft_id, overall_pick),
  unique (draft_id, round_number, round_pick),
  unique (draft_id, team_name)
);

alter table if exists public.fantasy_draft_picks
  add column if not exists player_team text null;

alter table if exists public.fantasy_draft_picks
  add column if not exists player_role text null;

alter table if exists public.fantasy_draft_picks
  add column if not exists player_image_url text null;

create index if not exists fantasy_draft_picks_draft_idx
  on public.fantasy_draft_picks (draft_id, overall_pick);

create index if not exists fantasy_draft_picks_draft_participant_idx
  on public.fantasy_draft_picks (draft_id, participant_user_id);

create index if not exists fantasy_draft_picks_draft_participant_role_idx
  on public.fantasy_draft_picks (draft_id, participant_user_id, upper(btrim(coalesce(player_role, ''))));

create table if not exists public.fantasy_draft_timeout_events (
  id bigint generated always as identity primary key,
  draft_id bigint not null references public.fantasy_drafts(id) on delete cascade,
  overall_pick integer not null check (overall_pick > 0),
  round_number integer not null check (round_number > 0),
  round_pick integer not null check (round_pick > 0),
  participant_user_id uuid not null,
  participant_display_name text not null,
  outcome text not null check (outcome in ('autopicked', 'skipped')),
  picked_team_name text null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (draft_id, overall_pick)
);

create index if not exists fantasy_draft_timeout_events_draft_idx
  on public.fantasy_draft_timeout_events (draft_id, overall_pick desc);

create index if not exists fantasy_draft_timeout_events_draft_participant_idx
  on public.fantasy_draft_timeout_events (draft_id, participant_user_id, overall_pick desc);

create table if not exists public.fantasy_draft_presence (
  draft_id bigint not null references public.fantasy_drafts(id) on delete cascade,
  user_id uuid not null,
  is_ready boolean not null default false,
  last_seen_at timestamptz null,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (draft_id, user_id)
);

create index if not exists fantasy_draft_presence_seen_idx
  on public.fantasy_draft_presence (draft_id, last_seen_at desc);

create or replace function public.fantasy_process_due_drafts(p_draft_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_started_drafts integer := 0;
  v_auto_picks integer := 0;
  v_completed_drafts integer := 0;
  v_draft record;
  v_participant_count integer;
  v_pick_count integer;
  v_total_picks integer;
  v_last_pick_at timestamptz;
  v_anchor timestamptz;
  v_deadline timestamptz;
  v_round_number integer;
  v_offset integer;
  v_participant_position integer;
  v_on_clock record;
  v_team record;
begin
  for v_draft in
    select *
    from public.fantasy_drafts draft_row
    where (p_draft_id is null or draft_row.id = p_draft_id)
    order by draft_row.id
    for update
  loop
    select count(*)
    into v_participant_count
    from public.fantasy_draft_participants participants
    where participants.draft_id = v_draft.id;

    if v_participant_count < 2 then
      continue;
    end if;

    v_total_picks := v_participant_count * least(v_draft.round_count, 5);

    if v_draft.status = 'scheduled' and v_draft.scheduled_at <= v_now then
      if exists (
        select 1
        from public.fantasy_draft_participants participants
        left join public.fantasy_draft_presence presence
          on presence.draft_id = participants.draft_id
         and presence.user_id = participants.user_id
        where participants.draft_id = v_draft.id
          and (
            presence.last_seen_at is null
            or presence.last_seen_at < (v_now - interval '45 seconds')
            or presence.is_ready is not true
          )
      ) then
        null;
      else
        update public.fantasy_drafts
        set
          status = 'live',
          started_at = coalesce(v_draft.started_at, v_now)
        where id = v_draft.id;
        v_started_drafts := v_started_drafts + 1;
        v_draft.status := 'live';
        v_draft.started_at := coalesce(v_draft.started_at, v_now);
      end if;
    end if;

    if v_draft.status <> 'live' then
      continue;
    end if;

    loop
      select count(*)
      into v_pick_count
      from public.fantasy_draft_picks picks
      where picks.draft_id = v_draft.id;

      if v_pick_count >= v_total_picks then
        update public.fantasy_drafts
        set status = 'completed'
        where id = v_draft.id
          and status <> 'completed';
        if found then
          v_completed_drafts := v_completed_drafts + 1;
        end if;
        exit;
      end if;

      select picks.picked_at
      into v_last_pick_at
      from public.fantasy_draft_picks picks
      where picks.draft_id = v_draft.id
      order by picks.overall_pick desc
      limit 1;

      v_anchor := coalesce(v_last_pick_at, v_draft.started_at);
      if v_anchor is null then
        update public.fantasy_drafts
        set started_at = v_now
        where id = v_draft.id
          and started_at is null;
        v_anchor := v_now;
        v_draft.started_at := v_now;
      end if;

      v_deadline := v_anchor + make_interval(secs => greatest(v_draft.pick_seconds, 1));
      if v_deadline > v_now then
        exit;
      end if;

      v_round_number := (v_pick_count / v_participant_count) + 1;
      v_offset := mod(v_pick_count, v_participant_count);
      if v_round_number <> 1 and (v_round_number <= 3 or mod(v_round_number, 2) = 1) then
        v_participant_position := v_participant_count - v_offset;
      else
        v_participant_position := v_offset + 1;
      end if;

      select
        participants.user_id,
        participants.display_name
      into v_on_clock
      from public.fantasy_draft_participants participants
      where participants.draft_id = v_draft.id
        and participants.draft_position = v_participant_position
      limit 1;

      if v_on_clock.user_id is null then
        exit;
      end if;

      select
        team_pool.team_name,
        team_pool.player_team,
        team_pool.player_role,
        team_pool.team_icon_url,
        team_pool.player_image_url
      into v_team
      from public.fantasy_draft_team_pool team_pool
      where team_pool.draft_id = v_draft.id
        and team_pool.player_role is not null
        and btrim(team_pool.player_role) <> ''
        and (
          select count(*)
          from public.fantasy_draft_picks picks_by_user
          where picks_by_user.draft_id = v_draft.id
            and picks_by_user.participant_user_id = v_on_clock.user_id
        ) < 5
        and not exists (
          select 1
          from public.fantasy_draft_picks picks
          where picks.draft_id = v_draft.id
            and picks.team_name = team_pool.team_name
        )
        and not exists (
          select 1
          from public.fantasy_draft_picks picks
          where picks.draft_id = v_draft.id
            and picks.participant_user_id = v_on_clock.user_id
            and upper(btrim(coalesce(picks.player_role, ''))) = upper(btrim(team_pool.player_role))
        )
      order by team_pool.projected_avg_fantasy_points desc nulls last, team_pool.team_name
      limit 1;

      if v_team.team_name is null then
        insert into public.fantasy_draft_timeout_events (
          draft_id,
          overall_pick,
          round_number,
          round_pick,
          participant_user_id,
          participant_display_name,
          outcome,
          picked_team_name,
          created_at
        )
        values (
          v_draft.id,
          v_pick_count + 1,
          v_round_number,
          v_offset + 1,
          v_on_clock.user_id,
          v_on_clock.display_name,
          'skipped',
          null,
          v_now
        )
        on conflict (draft_id, overall_pick)
        do nothing;

        update public.fantasy_drafts
        set status = 'completed'
        where id = v_draft.id
          and status <> 'completed';
        if found then
          v_completed_drafts := v_completed_drafts + 1;
        end if;
        exit;
      end if;

      insert into public.fantasy_draft_picks (
        draft_id,
        overall_pick,
        round_number,
        round_pick,
        participant_user_id,
        participant_display_name,
        team_name,
        player_team,
        player_role,
        team_icon_url,
        player_image_url,
        picked_by_user_id,
        picked_by_label,
        picked_at
      )
      values (
        v_draft.id,
        v_pick_count + 1,
        v_round_number,
        v_offset + 1,
        v_on_clock.user_id,
        v_on_clock.display_name,
        v_team.team_name,
        v_team.player_team,
        v_team.player_role,
        v_team.team_icon_url,
        v_team.player_image_url,
        v_on_clock.user_id,
        'Auto Pick (Timeout)',
        v_now
      )
      on conflict (draft_id, overall_pick)
      do nothing;

      if not found then
        exit;
      end if;

      insert into public.fantasy_draft_timeout_events (
        draft_id,
        overall_pick,
        round_number,
        round_pick,
        participant_user_id,
        participant_display_name,
        outcome,
        picked_team_name,
        created_at
      )
      values (
        v_draft.id,
        v_pick_count + 1,
        v_round_number,
        v_offset + 1,
        v_on_clock.user_id,
        v_on_clock.display_name,
        'autopicked',
        v_team.team_name,
        v_now
      )
      on conflict (draft_id, overall_pick)
      do nothing;

      v_auto_picks := v_auto_picks + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'started_drafts', v_started_drafts,
    'auto_picks', v_auto_picks,
    'completed_drafts', v_completed_drafts
  );
end;
$$;

create or replace function public.fantasy_submit_draft_pick(
  p_draft_id bigint,
  p_user_id uuid,
  p_user_label text,
  p_team_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := timezone('utc', now());
  v_draft public.fantasy_drafts%rowtype;
  v_pick_count integer;
  v_participant_count integer;
  v_total_picks integer;
  v_is_commissioner boolean;
  v_is_participant boolean;
  v_last_pick_at timestamptz;
  v_anchor timestamptz;
  v_deadline timestamptz;
  v_round_number integer;
  v_offset integer;
  v_participant_position integer;
  v_on_clock public.fantasy_draft_participants%rowtype;
  v_team_icon_url text;
  v_player_image_url text;
  v_player_team text;
  v_player_role text;
  v_clean_player_name text := nullif(trim(p_team_name), '');
  v_clean_user_label text := coalesce(nullif(trim(p_user_label), ''), p_user_id::text);
  v_on_clock_pick_count integer;
begin
  if v_clean_player_name is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'playerName is required.',
      'code', 'PLAYER_REQUIRED'
    );
  end if;

  select *
  into v_draft
  from public.fantasy_drafts drafts
  where drafts.id = p_draft_id
  for update;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'Draft not found.',
      'code', 'NOT_FOUND'
    );
  end if;

  if v_draft.status <> 'live' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Draft is not live. Start the draft first.',
      'code', 'NOT_LIVE'
    );
  end if;

  select count(*)
  into v_participant_count
  from public.fantasy_draft_participants participants
  where participants.draft_id = p_draft_id;

  if v_participant_count < 2 then
    return jsonb_build_object(
      'ok', false,
      'error', 'At least two participants are required.',
      'code', 'INSUFFICIENT_PARTICIPANTS'
    );
  end if;

  v_total_picks := v_participant_count * least(v_draft.round_count, 5);

  select count(*)
  into v_pick_count
  from public.fantasy_draft_picks picks
  where picks.draft_id = p_draft_id;

  if v_pick_count >= v_total_picks then
    update public.fantasy_drafts
    set status = 'completed'
    where id = p_draft_id
      and status <> 'completed';

    return jsonb_build_object(
      'ok', false,
      'error', 'Draft is already complete.',
      'code', 'DRAFT_COMPLETE'
    );
  end if;

  select picks.picked_at
  into v_last_pick_at
  from public.fantasy_draft_picks picks
  where picks.draft_id = p_draft_id
  order by picks.overall_pick desc
  limit 1;

  v_anchor := coalesce(v_last_pick_at, v_draft.started_at);
  if v_anchor is null then
    update public.fantasy_drafts
    set started_at = v_now
    where id = p_draft_id
      and started_at is null;
    v_anchor := v_now;
  end if;

  v_deadline := v_anchor + make_interval(secs => greatest(v_draft.pick_seconds, 1));
  if v_deadline <= v_now then
    return jsonb_build_object(
      'ok', false,
      'error', 'Pick deadline has passed. Wait for automation to process the timeout.',
      'code', 'PICK_DEADLINE_EXPIRED'
    );
  end if;

  v_round_number := (v_pick_count / v_participant_count) + 1;
  v_offset := mod(v_pick_count, v_participant_count);
  if v_round_number <> 1 and (v_round_number <= 3 or mod(v_round_number, 2) = 1) then
    v_participant_position := v_participant_count - v_offset;
  else
    v_participant_position := v_offset + 1;
  end if;

  select *
  into v_on_clock
  from public.fantasy_draft_participants participants
  where participants.draft_id = p_draft_id
    and participants.draft_position = v_participant_position
  limit 1;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'Unable to resolve the on-clock participant.',
      'code', 'ON_CLOCK_MISSING'
    );
  end if;

  select count(*)
  into v_on_clock_pick_count
  from public.fantasy_draft_picks picks
  where picks.draft_id = p_draft_id
    and picks.participant_user_id = v_on_clock.user_id;

  if v_on_clock_pick_count >= 5 then
    return jsonb_build_object(
      'ok', false,
      'error', format('%s already has 5 players.', v_on_clock.display_name),
      'code', 'ROSTER_FULL'
    );
  end if;

  v_is_commissioner := v_draft.created_by_user_id = p_user_id;

  select exists (
    select 1
    from public.fantasy_draft_participants participants
    where participants.draft_id = p_draft_id
      and participants.user_id = p_user_id
  )
  into v_is_participant;

  if not v_is_participant and not v_is_commissioner then
    return jsonb_build_object(
      'ok', false,
      'error', 'You are not a participant in this draft.',
      'code', 'NOT_PARTICIPANT'
    );
  end if;

  if not v_is_commissioner and v_on_clock.user_id <> p_user_id then
    return jsonb_build_object(
      'ok', false,
      'error', format('It is currently %s''s turn to pick.', v_on_clock.display_name),
      'code', 'OUT_OF_TURN'
    );
  end if;

  if not exists (
    select 1
    from public.fantasy_draft_team_pool team_pool
    where team_pool.draft_id = p_draft_id
      and team_pool.team_name = v_clean_player_name
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Selected player is unavailable or already drafted.',
      'code', 'PLAYER_UNAVAILABLE'
    );
  end if;

  if exists (
    select 1
    from public.fantasy_draft_picks picks
    where picks.draft_id = p_draft_id
      and picks.team_name = v_clean_player_name
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', 'Selected player is unavailable or already drafted.',
      'code', 'PLAYER_UNAVAILABLE'
    );
  end if;

  select
    team_pool.team_icon_url,
    team_pool.player_image_url,
    team_pool.player_team,
    team_pool.player_role
  into v_team_icon_url, v_player_image_url, v_player_team, v_player_role
  from public.fantasy_draft_team_pool team_pool
  where team_pool.draft_id = p_draft_id
    and team_pool.team_name = v_clean_player_name
  limit 1;

  if v_player_role is null or btrim(v_player_role) = '' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Selected player is missing a position and cannot be drafted.',
      'code', 'PLAYER_ROLE_REQUIRED'
    );
  end if;

  if exists (
    select 1
    from public.fantasy_draft_picks picks
    where picks.draft_id = p_draft_id
      and picks.participant_user_id = v_on_clock.user_id
      and upper(btrim(coalesce(picks.player_role, ''))) = upper(btrim(v_player_role))
  ) then
    return jsonb_build_object(
      'ok', false,
      'error', format('%s already drafted a %s player.', v_on_clock.display_name, upper(btrim(v_player_role))),
      'code', 'POSITION_TAKEN'
    );
  end if;

  insert into public.fantasy_draft_picks (
    draft_id,
    overall_pick,
    round_number,
    round_pick,
    participant_user_id,
    participant_display_name,
    team_name,
    player_team,
    player_role,
    team_icon_url,
    player_image_url,
    picked_by_user_id,
    picked_by_label,
    picked_at
  )
  values (
    p_draft_id,
    v_pick_count + 1,
    v_round_number,
    v_offset + 1,
    v_on_clock.user_id,
    v_on_clock.display_name,
    v_clean_player_name,
    v_player_team,
    v_player_role,
    v_team_icon_url,
    v_player_image_url,
    p_user_id,
    v_clean_user_label,
    v_now
  )
  on conflict (draft_id, overall_pick)
  do nothing;

  if not found then
    return jsonb_build_object(
      'ok', false,
      'error', 'Selected player is unavailable or already drafted.',
      'code', 'PLAYER_UNAVAILABLE'
    );
  end if;

  if (v_pick_count + 1) >= v_total_picks then
    update public.fantasy_drafts
    set status = 'completed'
    where id = p_draft_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.fantasy_chat_post_message(
  p_sender_label text,
  p_message text,
  p_image_url text default null,
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
  v_image_url text := nullif(btrim(coalesce(p_image_url, '')), '');
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

  if v_message = '' and v_image_url is null then
    return jsonb_build_object(
      'ok', false,
      'error', 'Message or image is required.',
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

  if v_image_url is not null and char_length(v_image_url) > 2048 then
    return jsonb_build_object(
      'ok', false,
      'error', 'Image URL must be 2048 characters or fewer.',
      'code', 'INVALID_IMAGE_URL'
    );
  end if;

  if v_image_url is not null and v_image_url !~* '^https?://' then
    return jsonb_build_object(
      'ok', false,
      'error', 'Image URL must be a valid HTTP(S) URL.',
      'code', 'INVALID_IMAGE_URL'
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
          'image_url', v_message_row.image_url,
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
      image_url,
      idempotency_key
    )
    values (
      v_user_id,
      v_sender_label,
      v_sender_avatar_url,
      v_sender_avatar_border_color,
      v_message,
      v_image_url,
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
              'image_url', v_message_row.image_url,
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
      'image_url', v_message_row.image_url,
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

create or replace function public.fantasy_draft_observability_summary(
  p_window_minutes integer default 1440
)
returns jsonb
language sql
set search_path = public
as $$
  with filtered as (
    select
      metric_name,
      source,
      metric_value::double precision as metric_value
    from public.fantasy_draft_observability_events events
    where events.created_at >= timezone('utc', now()) - make_interval(mins => greatest(1, p_window_minutes))
  ),
  by_metric as (
    select
      metric_name,
      count(*)::bigint as event_count,
      round(avg(metric_value)::numeric, 2) as avg_ms,
      percentile_cont(0.5) within group (order by metric_value) as p50_ms,
      percentile_cont(0.95) within group (order by metric_value) as p95_ms,
      max(metric_value) as max_ms
    from filtered
    group by metric_name
  )
  select jsonb_build_object(
    'window_minutes', greatest(1, p_window_minutes),
    'total_events', coalesce((select count(*)::bigint from filtered), 0),
    'source_counts', jsonb_build_object(
      'server', coalesce((select count(*)::bigint from filtered where source = 'server'), 0),
      'client', coalesce((select count(*)::bigint from filtered where source = 'client'), 0)
    ),
    'realtime_disconnect_count', coalesce((
      select sum(metric_value)::bigint
      from filtered
      where metric_name = 'client_realtime_disconnect'
    ), 0),
    'refresh_retry_count', coalesce((
      select sum(metric_value)::bigint
      from filtered
      where metric_name = 'client_refresh_retry'
    ), 0),
    'metrics', coalesce((
      select jsonb_object_agg(
        metric_name,
        jsonb_build_object(
          'count', event_count,
          'avg_ms', avg_ms,
          'p50_ms', p50_ms,
          'p95_ms', p95_ms,
          'max_ms', max_ms
        )
      )
      from by_metric
    ), '{}'::jsonb)
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

grant select on public.fantasy_global_chat_messages to authenticated;
grant insert on public.fantasy_global_chat_messages to authenticated;
grant usage, select on sequence public.fantasy_global_chat_messages_id_seq to authenticated;
grant select, insert, delete on public.fantasy_global_chat_reactions to authenticated;
grant usage, select on sequence public.fantasy_global_chat_reactions_id_seq to authenticated;
grant execute on function public.fantasy_chat_post_message(text, text, text, text, text, text) to authenticated;
grant insert on public.fantasy_chat_observability_events to authenticated;
grant usage, select on sequence public.fantasy_chat_observability_events_id_seq to authenticated;
grant insert on public.fantasy_draft_observability_events to authenticated;
grant usage, select on sequence public.fantasy_draft_observability_events_id_seq to authenticated;
grant select on public.fantasy_drafts to authenticated;
grant select on public.fantasy_draft_picks to authenticated;
grant select on public.fantasy_draft_presence to authenticated;

alter table public.fantasy_global_chat_messages enable row level security;
alter table public.fantasy_global_chat_reactions enable row level security;
alter table public.fantasy_chat_observability_events enable row level security;
alter table public.fantasy_draft_observability_events enable row level security;
alter table public.fantasy_drafts enable row level security;
alter table public.fantasy_draft_picks enable row level security;
alter table public.fantasy_draft_presence enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fantasy_draft_observability_events'
      and policyname = 'Draft observability insert own metrics'
  ) then
    create policy "Draft observability insert own metrics"
      on public.fantasy_draft_observability_events
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
      and tablename = 'fantasy_global_chat_reactions'
      and policyname = 'Global chat reactions visible to authenticated users'
  ) then
    create policy "Global chat reactions visible to authenticated users"
      on public.fantasy_global_chat_reactions
      for select
      to authenticated
      using (true);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fantasy_global_chat_reactions'
      and policyname = 'Global chat reactions insert own rows'
  ) then
    create policy "Global chat reactions insert own rows"
      on public.fantasy_global_chat_reactions
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
      and tablename = 'fantasy_global_chat_reactions'
      and policyname = 'Global chat reactions delete own rows'
  ) then
    create policy "Global chat reactions delete own rows"
      on public.fantasy_global_chat_reactions
      for delete
      to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fantasy_global_chat_messages'
      and policyname = 'Global chat visible to authenticated users'
  ) then
    create policy "Global chat visible to authenticated users"
      on public.fantasy_global_chat_messages
      for select
      to authenticated
      using (true);
  end if;
end $$;

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

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fantasy_drafts'
      and policyname = 'Drafts visible to participants'
  ) then
    create policy "Drafts visible to participants"
      on public.fantasy_drafts
      for select
      to authenticated
      using (
        created_by_user_id = auth.uid()
        or exists (
          select 1
          from public.fantasy_draft_participants participants
          where participants.draft_id = fantasy_drafts.id
            and participants.user_id = auth.uid()
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fantasy_draft_picks'
      and policyname = 'Draft picks visible to participants'
  ) then
    create policy "Draft picks visible to participants"
      on public.fantasy_draft_picks
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.fantasy_drafts drafts
          where drafts.id = fantasy_draft_picks.draft_id
            and (
              drafts.created_by_user_id = auth.uid()
              or exists (
                select 1
                from public.fantasy_draft_participants participants
                where participants.draft_id = fantasy_draft_picks.draft_id
                  and participants.user_id = auth.uid()
              )
            )
        )
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'fantasy_draft_presence'
      and policyname = 'Draft presence visible to participants'
  ) then
    create policy "Draft presence visible to participants"
      on public.fantasy_draft_presence
      for select
      to authenticated
      using (
        exists (
          select 1
          from public.fantasy_drafts drafts
          where drafts.id = fantasy_draft_presence.draft_id
            and (
              drafts.created_by_user_id = auth.uid()
              or exists (
                select 1
                from public.fantasy_draft_participants participants
                where participants.draft_id = fantasy_draft_presence.draft_id
                  and participants.user_id = auth.uid()
              )
            )
        )
      );
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'fantasy_global_chat_messages'
    ) then
      alter publication supabase_realtime add table public.fantasy_global_chat_messages;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'fantasy_global_chat_reactions'
    ) then
      alter publication supabase_realtime add table public.fantasy_global_chat_reactions;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'fantasy_drafts'
    ) then
      alter publication supabase_realtime add table public.fantasy_drafts;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'fantasy_draft_picks'
    ) then
      alter publication supabase_realtime add table public.fantasy_draft_picks;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'fantasy_draft_presence'
    ) then
      alter publication supabase_realtime add table public.fantasy_draft_presence;
    end if;
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'profile-images',
  'profile-images',
  true,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id)
do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Profile images are public'
  ) then
    create policy "Profile images are public"
      on storage.objects
      for select
      using (bucket_id = 'profile-images');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users upload own profile images'
  ) then
    create policy "Users upload own profile images"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'profile-images'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users update own profile images'
  ) then
    create policy "Users update own profile images"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'profile-images'
        and auth.uid()::text = (storage.foldername(name))[1]
      )
      with check (
        bucket_id = 'profile-images'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users delete own profile images'
  ) then
    create policy "Users delete own profile images"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'profile-images'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end $$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-images',
  'chat-images',
  true,
  3145728,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id)
do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Chat images are public'
  ) then
    create policy "Chat images are public"
      on storage.objects
      for select
      using (bucket_id = 'chat-images');
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users upload own chat images'
  ) then
    create policy "Users upload own chat images"
      on storage.objects
      for insert
      to authenticated
      with check (
        bucket_id = 'chat-images'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users update own chat images'
  ) then
    create policy "Users update own chat images"
      on storage.objects
      for update
      to authenticated
      using (
        bucket_id = 'chat-images'
        and auth.uid()::text = (storage.foldername(name))[1]
      )
      with check (
        bucket_id = 'chat-images'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users delete own chat images'
  ) then
    create policy "Users delete own chat images"
      on storage.objects
      for delete
      to authenticated
      using (
        bucket_id = 'chat-images'
        and auth.uid()::text = (storage.foldername(name))[1]
      );
  end if;
end $$;
