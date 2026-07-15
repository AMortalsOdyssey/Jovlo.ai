-- JourneyWave concurrency, owner-state and echo hardening.

alter table public.jw_daily_usage
  add column if not exists echoes integer not null default 0 check (echoes >= 0);
alter table public.jw_daily_ip_usage
  add column if not exists echoes integer not null default 0 check (echoes >= 0);
create or replace function public.jw_internal_assert_usage(
  p_actor_id uuid,
  p_ip_hash text,
  p_kind text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_count integer;
  v_ip_count integer;
  v_limit integer;
begin
  if p_actor_id is null or p_ip_hash is null or char_length(p_ip_hash) < 16 then
    raise exception 'invalid_identity' using errcode = '22023';
  end if;

  if p_kind = 'wishes' then v_limit := 5;
  elsif p_kind = 'ripples' then v_limit := 100;
  elsif p_kind = 'reports' then v_limit := 20;
  elsif p_kind = 'draws' then v_limit := 300;
  elsif p_kind = 'events' then v_limit := 500;
  elsif p_kind = 'echoes' then v_limit := 20;
  else raise exception 'invalid_usage_kind' using errcode = '22023';
  end if;

  insert into public.jw_daily_usage (usage_date, actor_id, ip_hash)
  values (current_date, p_actor_id, p_ip_hash)
  on conflict (usage_date, actor_id) do nothing;

  execute format(
    'select %I from public.jw_daily_usage where usage_date = current_date and actor_id = $1 for update',
    p_kind
  ) into v_actor_count using p_actor_id;

  insert into public.jw_daily_ip_usage (usage_date, ip_hash)
  values (current_date, p_ip_hash)
  on conflict (usage_date, ip_hash) do nothing;

  execute format(
    'select %I from public.jw_daily_ip_usage where usage_date = current_date and ip_hash = $1 for update',
    p_kind
  ) into v_ip_count using p_ip_hash;

  if v_actor_count >= v_limit or v_ip_count >= v_limit then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;

  execute format(
    'update public.jw_daily_usage set %I = %I + 1, updated_at = now() where usage_date = current_date and actor_id = $1',
    p_kind,
    p_kind
  ) using p_actor_id;

  execute format(
    'update public.jw_daily_ip_usage set %I = %I + 1, updated_at = now() where usage_date = current_date and ip_hash = $1',
    p_kind,
    p_kind
  ) using p_ip_hash;
end;
$$;
create or replace function public.jw_internal_ripple(
  p_actor_id uuid,
  p_ip_hash text,
  p_wish_id uuid,
  p_ripple_type text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old_type text;
  v_old_note text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_wish public.jw_wishes;
begin
  if p_ripple_type not in ('together', 'been', 'reef', 'bless') then
    raise exception 'invalid_ripple_type' using errcode = '22023';
  end if;
  if p_ripple_type <> 'reef' then v_note := null; end if;
  if v_note is not null and char_length(v_note) > 40 then
    raise exception 'invalid_reef_note' using errcode = '22023';
  end if;

  -- Serialize only one actor's response to one wish. Different actors still
  -- proceed concurrently, while first-write races remain exactly-once.
  perform pg_advisory_xact_lock(
    hashtextextended(p_wish_id::text || ':' || p_actor_id::text, 0)
  );

  select ripple_type, note into v_old_type, v_old_note
  from public.jw_ripples
  where wish_id = p_wish_id and actor_id = p_actor_id
  for update;

  if found and v_old_type = p_ripple_type and v_old_note is not distinct from v_note then
    select * into v_wish from public.jw_wishes where id = p_wish_id and status = 'published';
    if not found then raise exception 'wish_not_found' using errcode = 'P0002'; end if;
    return jsonb_build_object('changed', false, 'wish', to_jsonb(v_wish));
  end if;

  perform public.jw_internal_assert_usage(p_actor_id, p_ip_hash, 'ripples');

  select * into v_wish
  from public.jw_wishes
  where id = p_wish_id and status = 'published'
  for update;
  if not found then raise exception 'wish_not_found' using errcode = 'P0002'; end if;

  insert into public.jw_ripples (
    wish_id, actor_id, ripple_type, note, moderation_status
  ) values (
    p_wish_id,
    p_actor_id,
    p_ripple_type,
    v_note,
    case when v_note is null then 'approved' else 'pending' end
  )
  on conflict (wish_id, actor_id) do update set
    ripple_type = excluded.ripple_type,
    note = excluded.note,
    moderation_status = excluded.moderation_status,
    updated_at = now();

  update public.jw_wishes set
    together_count = greatest(
      legacy_together_count,
      together_count
        - case when v_old_type = 'together' then 1 else 0 end
        + case when p_ripple_type = 'together' then 1 else 0 end
    ),
    been_count = greatest(
      0,
      been_count
        - case when v_old_type = 'been' then 1 else 0 end
        + case when p_ripple_type = 'been' then 1 else 0 end
    ),
    reef_count = greatest(
      0,
      reef_count
        - case when v_old_type = 'reef' then 1 else 0 end
        + case when p_ripple_type = 'reef' then 1 else 0 end
    ),
    bless_count = greatest(
      0,
      bless_count
        - case when v_old_type = 'bless' then 1 else 0 end
        + case when p_ripple_type = 'bless' then 1 else 0 end
    )
  where id = p_wish_id
  returning * into v_wish;

  return jsonb_build_object('changed', true, 'wish', to_jsonb(v_wish));
end;
$$;
create or replace function public.jw_internal_owner_state(
  p_actor_id uuid,
  p_wish_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'rippleType', (
      select r.ripple_type
      from public.jw_ripples r
      where r.actor_id = p_actor_id and r.wish_id = p_wish_id
    ),
    'anchored', exists (
      select 1
      from public.jw_anchors a
      where a.actor_id = p_actor_id and a.wish_id = p_wish_id
    )
  );
$$;
create or replace function public.jw_internal_create_echo(
  p_actor_id uuid,
  p_ip_hash text,
  p_wish_id uuid,
  p_permission text,
  p_body text default null
)
returns public.jw_echoes
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_echo public.jw_echoes;
begin
  if p_permission not in ('together', 'been', 'reef', 'bless') then
    raise exception 'invalid_echo_permission' using errcode = '22023';
  end if;
  if p_body is not null and char_length(p_body) > 160 then
    raise exception 'invalid_echo_body' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('echo:' || p_wish_id::text || ':' || p_actor_id::text, 0)
  );

  if not exists (select 1 from public.jw_wishes where id = p_wish_id and status = 'published') then
    raise exception 'wish_not_found' using errcode = 'P0002';
  end if;

  select e.* into v_echo
  from public.jw_echoes e
  join public.jw_echo_owners o on o.echo_id = e.id
  where o.owner_id = p_actor_id and e.wish_id = p_wish_id
  order by e.created_at desc
  limit 1;
  if found then return v_echo; end if;

  if not exists (
    select 1 from public.jw_ripples r
    where r.actor_id = p_actor_id
      and r.wish_id = p_wish_id
      and r.ripple_type = p_permission
  ) then
    raise exception 'matching_ripple_required' using errcode = 'P0001';
  end if;

  perform public.jw_internal_assert_usage(p_actor_id, p_ip_hash, 'echoes');

  insert into public.jw_echoes (slug, wish_id, permission, body)
  values (
    lower(encode(gen_random_bytes(6), 'hex')),
    p_wish_id,
    p_permission,
    nullif(btrim(coalesce(p_body, '')), '')
  ) returning * into v_echo;

  insert into public.jw_echo_owners (echo_id, owner_id)
  values (v_echo.id, p_actor_id);
  return v_echo;
end;
$$;
revoke all on function public.jw_internal_owner_state(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.jw_internal_create_echo(uuid, text, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.jw_internal_owner_state(uuid, uuid) to service_role;
grant execute on function public.jw_internal_create_echo(uuid, text, uuid, text, text) to service_role;
