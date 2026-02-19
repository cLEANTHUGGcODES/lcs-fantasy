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

grant select, insert, delete on public.fantasy_global_chat_reactions to authenticated;
grant usage, select on sequence public.fantasy_global_chat_reactions_id_seq to authenticated;

alter table public.fantasy_global_chat_reactions enable row level security;

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
        and tablename = 'fantasy_global_chat_reactions'
    ) then
      alter publication supabase_realtime add table public.fantasy_global_chat_reactions;
    end if;
  end if;
end $$;
