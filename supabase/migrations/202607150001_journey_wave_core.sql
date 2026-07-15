-- JourneyWave / 许愿海
-- All objects are prefixed with jw_ so this app can safely share the jovlo-ai project.

create extension if not exists pgcrypto with schema extensions;
create or replace function public.jw_set_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
create table if not exists public.jw_wishes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  source_key text unique,
  destination text not null check (char_length(destination) between 1 and 15),
  wish_text text check (wish_text is null or char_length(wish_text) between 1 and 60),
  sea text not null check (sea in ('snow', 'island', 'ridge', 'fireworks', 'olddream', 'faraway', 'gonow')),
  is_china boolean not null default true,
  is_seed boolean not null default false,
  status text not null default 'published' check (status in ('published', 'quarantined', 'hidden')),
  legacy_together_count integer not null default 0 check (legacy_together_count >= 0),
  together_count integer not null default 0 check (together_count >= 0),
  been_count integer not null default 0 check (been_count >= 0),
  reef_count integer not null default 0 check (reef_count >= 0),
  bless_count integer not null default 0 check (bless_count >= 0),
  report_count integer not null default 0 check (report_count >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists jw_wishes_status_created_idx
  on public.jw_wishes (status, created_at desc);
create index if not exists jw_wishes_sea_idx
  on public.jw_wishes (sea, status);
drop trigger if exists jw_wishes_set_updated_at on public.jw_wishes;
create trigger jw_wishes_set_updated_at
before update on public.jw_wishes
for each row execute function public.jw_set_updated_at();
create table if not exists public.jw_wish_owners (
  wish_id uuid primary key references public.jw_wishes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists jw_wish_owners_owner_idx
  on public.jw_wish_owners (owner_id, created_at desc);
create table if not exists public.jw_ripples (
  id uuid primary key default gen_random_uuid(),
  wish_id uuid not null references public.jw_wishes(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  ripple_type text not null check (ripple_type in ('together', 'been', 'reef', 'bless')),
  note text check (
    note is null or (
      ripple_type = 'reef'
      and char_length(note) between 1 and 40
    )
  ),
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (wish_id, actor_id)
);
create index if not exists jw_ripples_actor_created_idx
  on public.jw_ripples (actor_id, created_at desc);
drop trigger if exists jw_ripples_set_updated_at on public.jw_ripples;
create trigger jw_ripples_set_updated_at
before update on public.jw_ripples
for each row execute function public.jw_set_updated_at();
create table if not exists public.jw_draw_exposures (
  id bigint generated always as identity primary key,
  actor_id uuid not null references auth.users(id) on delete cascade,
  wish_id uuid not null references public.jw_wishes(id) on delete cascade,
  source text not null default 'sea' check (source in ('sea', 'share', 'theme')),
  created_at timestamptz not null default now()
);
create index if not exists jw_draw_exposures_actor_idx
  on public.jw_draw_exposures (actor_id, created_at desc);
create table if not exists public.jw_reports (
  id uuid primary key default gen_random_uuid(),
  wish_id uuid not null references public.jw_wishes(id) on delete cascade,
  actor_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('spam', 'abuse', 'privacy', 'other')),
  details text check (details is null or char_length(details) <= 160),
  created_at timestamptz not null default now(),
  unique (wish_id, actor_id)
);
create table if not exists public.jw_anchors (
  actor_id uuid not null references auth.users(id) on delete cascade,
  wish_id uuid not null references public.jw_wishes(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (actor_id, wish_id)
);
create table if not exists public.jw_echoes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  wish_id uuid not null references public.jw_wishes(id) on delete cascade,
  permission text not null check (permission in ('together', 'been', 'reef', 'bless')),
  body text check (body is null or char_length(body) <= 160),
  status text not null default 'published' check (status in ('published', 'quarantined', 'hidden')),
  created_at timestamptz not null default now()
);
create table if not exists public.jw_echo_owners (
  echo_id uuid primary key references public.jw_echoes(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.jw_themes (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null check (char_length(title) between 1 and 30),
  summary text not null check (char_length(summary) between 1 and 120),
  cover_sea text not null check (cover_sea in ('snow', 'island', 'ridge', 'fireworks', 'olddream', 'faraway', 'gonow')),
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.jw_theme_wishes (
  theme_id uuid not null references public.jw_themes(id) on delete cascade,
  wish_id uuid not null references public.jw_wishes(id) on delete cascade,
  rank integer not null default 0,
  primary key (theme_id, wish_id)
);
create table if not exists public.jw_daily_usage (
  usage_date date not null default current_date,
  actor_id uuid not null references auth.users(id) on delete cascade,
  ip_hash text not null check (char_length(ip_hash) between 16 and 128),
  wishes integer not null default 0 check (wishes >= 0),
  ripples integer not null default 0 check (ripples >= 0),
  reports integer not null default 0 check (reports >= 0),
  draws integer not null default 0 check (draws >= 0),
  events integer not null default 0 check (events >= 0),
  updated_at timestamptz not null default now(),
  primary key (usage_date, actor_id)
);
create index if not exists jw_daily_usage_ip_idx
  on public.jw_daily_usage (usage_date, ip_hash);
create table if not exists public.jw_daily_ip_usage (
  usage_date date not null default current_date,
  ip_hash text not null check (char_length(ip_hash) between 16 and 128),
  wishes integer not null default 0 check (wishes >= 0),
  ripples integer not null default 0 check (ripples >= 0),
  reports integer not null default 0 check (reports >= 0),
  draws integer not null default 0 check (draws >= 0),
  events integer not null default 0 check (events >= 0),
  updated_at timestamptz not null default now(),
  primary key (usage_date, ip_hash)
);
create table if not exists public.jw_analytics_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  session_id text not null check (char_length(session_id) between 8 and 80),
  event_name text not null check (char_length(event_name) between 1 and 64),
  wish_id uuid references public.jw_wishes(id) on delete set null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists jw_analytics_events_name_created_idx
  on public.jw_analytics_events (event_name, created_at desc);
-- Public content tables are readable only when published. Private identity and
-- interaction tables intentionally have no client policies.
alter table public.jw_wishes enable row level security;
alter table public.jw_wish_owners enable row level security;
alter table public.jw_ripples enable row level security;
alter table public.jw_draw_exposures enable row level security;
alter table public.jw_reports enable row level security;
alter table public.jw_anchors enable row level security;
alter table public.jw_echoes enable row level security;
alter table public.jw_echo_owners enable row level security;
alter table public.jw_themes enable row level security;
alter table public.jw_theme_wishes enable row level security;
alter table public.jw_daily_usage enable row level security;
alter table public.jw_daily_ip_usage enable row level security;
alter table public.jw_analytics_events enable row level security;
drop policy if exists jw_wishes_public_read on public.jw_wishes;
create policy jw_wishes_public_read
on public.jw_wishes for select
to anon, authenticated
using (status = 'published');
drop policy if exists jw_echoes_public_read on public.jw_echoes;
create policy jw_echoes_public_read
on public.jw_echoes for select
to anon, authenticated
using (status = 'published');
drop policy if exists jw_themes_public_read on public.jw_themes;
create policy jw_themes_public_read
on public.jw_themes for select
to anon, authenticated
using (
  status = 'published'
  and (starts_at is null or starts_at <= now())
  and (ends_at is null or ends_at >= now())
);
drop policy if exists jw_theme_wishes_public_read on public.jw_theme_wishes;
create policy jw_theme_wishes_public_read
on public.jw_theme_wishes for select
to anon, authenticated
using (
  exists (
    select 1 from public.jw_themes t
    where t.id = theme_id and t.status = 'published'
  )
);
revoke all on public.jw_wishes, public.jw_wish_owners, public.jw_ripples,
  public.jw_draw_exposures, public.jw_reports, public.jw_anchors,
  public.jw_echoes, public.jw_echo_owners, public.jw_themes,
  public.jw_theme_wishes, public.jw_daily_usage, public.jw_daily_ip_usage,
  public.jw_analytics_events
  from anon, authenticated;
grant select on public.jw_wishes, public.jw_echoes, public.jw_themes, public.jw_theme_wishes
  to anon, authenticated;
grant all on public.jw_wishes, public.jw_wish_owners, public.jw_ripples,
  public.jw_draw_exposures, public.jw_reports, public.jw_anchors,
  public.jw_echoes, public.jw_echo_owners, public.jw_themes,
  public.jw_theme_wishes, public.jw_daily_usage, public.jw_daily_ip_usage,
  public.jw_analytics_events
  to service_role;
grant usage, select on all sequences in schema public to service_role;
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
create or replace function public.jw_internal_throw(
  p_actor_id uuid,
  p_ip_hash text,
  p_destination text,
  p_wish_text text,
  p_sea text,
  p_is_china boolean default true
)
returns public.jw_wishes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wish public.jw_wishes;
  v_destination text := btrim(coalesce(p_destination, ''));
  v_wish_text text := nullif(btrim(coalesce(p_wish_text, '')), '');
begin
  if char_length(v_destination) not between 1 and 15 then
    raise exception 'invalid_destination' using errcode = '22023';
  end if;
  if v_wish_text is not null and char_length(v_wish_text) > 60 then
    raise exception 'invalid_wish_text' using errcode = '22023';
  end if;
  if p_sea not in ('snow', 'island', 'ridge', 'fireworks', 'olddream', 'faraway', 'gonow') then
    raise exception 'invalid_sea' using errcode = '22023';
  end if;

  perform public.jw_internal_assert_usage(p_actor_id, p_ip_hash, 'wishes');

  insert into public.jw_wishes (
    slug, destination, wish_text, sea, is_china, is_seed, status
  ) values (
    lower(encode(gen_random_bytes(6), 'hex')),
    v_destination,
    v_wish_text,
    p_sea,
    coalesce(p_is_china, true),
    false,
    'published'
  ) returning * into v_wish;

  insert into public.jw_wish_owners (wish_id, owner_id)
  values (v_wish.id, p_actor_id);

  return v_wish;
end;
$$;
create or replace function public.jw_internal_draw(
  p_actor_id uuid,
  p_ip_hash text,
  p_limit integer default 1,
  p_exclude uuid[] default '{}'::uuid[]
)
returns setof public.jw_wishes
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_limit not between 1 and 5 then
    raise exception 'invalid_draw_limit' using errcode = '22023';
  end if;

  perform public.jw_internal_assert_usage(p_actor_id, p_ip_hash, 'draws');

  return query
  with picked as (
    select w.id
    from public.jw_wishes w
    where w.status = 'published'
      and not (w.id = any(coalesce(p_exclude, '{}'::uuid[])))
      and not exists (
        select 1 from public.jw_wish_owners o
        where o.wish_id = w.id and o.owner_id = p_actor_id
      )
    order by (
      -ln(greatest(random(), 0.000000001))
      * sqrt(1 + w.together_count + w.been_count + w.reef_count + w.bless_count)
    ), w.created_at desc
    limit p_limit
  ), logged as (
    insert into public.jw_draw_exposures (actor_id, wish_id, source)
    select p_actor_id, picked.id, 'sea' from picked
    returning wish_id
  )
  select w.*
  from public.jw_wishes w
  join logged on logged.wish_id = w.id;
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
create or replace function public.jw_internal_report(
  p_actor_id uuid,
  p_ip_hash text,
  p_wish_id uuid,
  p_reason text,
  p_details text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_inserted uuid;
  v_report_count integer;
  v_status text;
begin
  if p_reason not in ('spam', 'abuse', 'privacy', 'other') then
    raise exception 'invalid_report_reason' using errcode = '22023';
  end if;
  if p_details is not null and char_length(p_details) > 160 then
    raise exception 'invalid_report_details' using errcode = '22023';
  end if;

  insert into public.jw_reports (wish_id, actor_id, reason, details)
  values (p_wish_id, p_actor_id, p_reason, nullif(btrim(coalesce(p_details, '')), ''))
  on conflict (wish_id, actor_id) do nothing
  returning id into v_inserted;

  if v_inserted is null then
    select report_count, status into v_report_count, v_status
    from public.jw_wishes where id = p_wish_id;
    return jsonb_build_object('changed', false, 'reportCount', v_report_count, 'status', v_status);
  end if;

  perform public.jw_internal_assert_usage(p_actor_id, p_ip_hash, 'reports');

  update public.jw_wishes set
    report_count = report_count + 1,
    status = case when report_count + 1 >= 5 then 'quarantined' else status end
  where id = p_wish_id and status <> 'hidden'
  returning report_count, status into v_report_count, v_status;

  if not found then raise exception 'wish_not_found' using errcode = 'P0002'; end if;
  return jsonb_build_object('changed', true, 'reportCount', v_report_count, 'status', v_status);
end;
$$;
create or replace function public.jw_internal_anchor(
  p_actor_id uuid,
  p_wish_id uuid,
  p_anchored boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_anchored then
    insert into public.jw_anchors (actor_id, wish_id)
    values (p_actor_id, p_wish_id)
    on conflict do nothing;
  else
    delete from public.jw_anchors
    where actor_id = p_actor_id and wish_id = p_wish_id;
  end if;
  return p_anchored;
end;
$$;
create or replace function public.jw_internal_create_echo(
  p_actor_id uuid,
  p_wish_id uuid,
  p_permission text,
  p_body text default null
)
returns public.jw_echoes
language plpgsql
security definer
set search_path = public, pg_temp
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
  if not exists (select 1 from public.jw_wishes where id = p_wish_id and status = 'published') then
    raise exception 'wish_not_found' using errcode = 'P0002';
  end if;

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
create or replace function public.jw_internal_track(
  p_actor_id uuid,
  p_ip_hash text,
  p_session_id text,
  p_event_name text,
  p_wish_id uuid default null,
  p_properties jsonb default '{}'::jsonb
)
returns bigint
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id bigint;
begin
  if char_length(p_session_id) not between 8 and 80
    or char_length(p_event_name) not between 1 and 64
    or jsonb_typeof(coalesce(p_properties, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_event' using errcode = '22023';
  end if;
  perform public.jw_internal_assert_usage(p_actor_id, p_ip_hash, 'events');
  insert into public.jw_analytics_events (
    actor_id, session_id, event_name, wish_id, properties
  ) values (
    p_actor_id, p_session_id, p_event_name, p_wish_id, coalesce(p_properties, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.jw_set_updated_at() from public, anon, authenticated;
revoke all on function public.jw_internal_assert_usage(uuid, text, text) from public, anon, authenticated;
revoke all on function public.jw_internal_throw(uuid, text, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.jw_internal_draw(uuid, text, integer, uuid[]) from public, anon, authenticated;
revoke all on function public.jw_internal_ripple(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.jw_internal_report(uuid, text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.jw_internal_anchor(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.jw_internal_create_echo(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.jw_internal_track(uuid, text, text, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.jw_internal_assert_usage(uuid, text, text) to service_role;
grant execute on function public.jw_internal_throw(uuid, text, text, text, text, boolean) to service_role;
grant execute on function public.jw_internal_draw(uuid, text, integer, uuid[]) to service_role;
grant execute on function public.jw_internal_ripple(uuid, text, uuid, text, text) to service_role;
grant execute on function public.jw_internal_report(uuid, text, uuid, text, text) to service_role;
grant execute on function public.jw_internal_anchor(uuid, uuid, boolean) to service_role;
grant execute on function public.jw_internal_create_echo(uuid, uuid, text, text) to service_role;
grant execute on function public.jw_internal_track(uuid, text, text, text, uuid, jsonb) to service_role;
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'jw_wishes'
  ) then
    alter publication supabase_realtime add table public.jw_wishes;
  end if;
end;
$$;
