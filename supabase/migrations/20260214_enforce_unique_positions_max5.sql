-- Enforce draft roster rules:
-- 1) max 5 picks per participant
-- 2) one drafted player per position (TOP/JNG/MID/ADC/SUP)
-- Applies to both manual picks and timeout auto-picks.

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
      if mod(v_round_number, 2) = 1 then
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
        team_pool.team_icon_url
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
      order by team_pool.team_name
      limit 1;

      if v_team.team_name is null then
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
        v_on_clock.user_id,
        'Auto Pick (Timeout)',
        v_now
      )
      on conflict (draft_id, overall_pick)
      do nothing;

      if not found then
        exit;
      end if;

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
  if mod(v_round_number, 2) = 1 then
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
    team_pool.player_team,
    team_pool.player_role
  into v_team_icon_url, v_player_team, v_player_role
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
