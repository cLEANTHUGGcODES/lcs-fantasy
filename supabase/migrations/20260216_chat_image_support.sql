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

drop function if exists public.fantasy_chat_post_message(text, text, text, text, text);

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

grant execute on function public.fantasy_chat_post_message(text, text, text, text, text, text) to authenticated;

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
