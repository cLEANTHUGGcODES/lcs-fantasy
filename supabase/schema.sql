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
  message text not null check (char_length(message) > 0 and char_length(message) <= 320),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists fantasy_global_chat_messages_created_at_idx
  on public.fantasy_global_chat_messages (created_at desc, id desc);

create table if not exists public.fantasy_drafts (
  id bigint generated always as identity primary key,
  name text not null,
  league_slug text not null,
  season_year integer not null,
  source_page text not null,
  scheduled_at timestamptz not null,
  started_at timestamptz null,
  round_count integer not null check (round_count > 0 and round_count <= 20),
  pick_seconds integer not null check (pick_seconds >= 10 and pick_seconds <= 900),
  status text not null default 'scheduled' check (status in ('scheduled', 'live', 'paused', 'completed')),
  created_by_user_id uuid not null,
  created_by_label text null,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists fantasy_drafts_scheduled_at_idx
  on public.fantasy_drafts (scheduled_at desc);

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
  source_page text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (draft_id, team_name)
);

alter table if exists public.fantasy_draft_team_pool
  add column if not exists player_team text null;

alter table if exists public.fantasy_draft_team_pool
  add column if not exists player_role text null;

create index if not exists fantasy_draft_team_pool_draft_idx
  on public.fantasy_draft_team_pool (draft_id, team_name);

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

create index if not exists fantasy_draft_picks_draft_idx
  on public.fantasy_draft_picks (draft_id, overall_pick);

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

    v_total_picks := v_participant_count * v_draft.round_count;

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
        and not exists (
          select 1
          from public.fantasy_draft_picks picks
          where picks.draft_id = v_draft.id
            and picks.team_name = team_pool.team_name
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

  v_total_picks := v_participant_count * v_draft.round_count;

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

grant select on public.fantasy_global_chat_messages to authenticated;
grant select on public.fantasy_drafts to authenticated;
grant select on public.fantasy_draft_picks to authenticated;
grant select on public.fantasy_draft_presence to authenticated;

alter table public.fantasy_global_chat_messages enable row level security;
alter table public.fantasy_drafts enable row level security;
alter table public.fantasy_draft_picks enable row level security;
alter table public.fantasy_draft_presence enable row level security;

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
