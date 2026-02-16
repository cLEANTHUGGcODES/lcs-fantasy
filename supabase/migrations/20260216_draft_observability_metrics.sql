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

grant insert on public.fantasy_draft_observability_events to authenticated;
grant usage, select on sequence public.fantasy_draft_observability_events_id_seq to authenticated;

alter table public.fantasy_draft_observability_events enable row level security;

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
