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
