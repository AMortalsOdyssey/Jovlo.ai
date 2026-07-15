-- JourneyWave Phase B/C schema and integrity hardening.
-- All durable objects are jw_ prefixed because this app shares jovlo-ai.

begin;
alter table public.jw_wishes
  add column if not exists echo_version integer not null default 0 check (echo_version >= 0),
  add column if not exists last_echo_at timestamptz,
  add column if not exists live_ripple_count integer generated always as (
    greatest(0, together_count - legacy_together_count)
      + been_count + reef_count + bless_count
  ) stored;
alter table public.jw_echoes
  add column if not exists echo_kind text not null default 'reaction_share'
    check (echo_kind in ('reaction_share', 'generated_tide')),
  add column if not exists version integer check (version is null or version > 0),
  add column if not exists summary jsonb,
  add column if not exists trigger_live_ripple_count integer
    check (trigger_live_ripple_count is null or trigger_live_ripple_count >= 0),
  add column if not exists prompt_version text,
  add column if not exists model_name text,
  add column if not exists generated_at timestamptz;
create unique index if not exists jw_echoes_generated_version_idx
  on public.jw_echoes (wish_id, echo_kind, version)
  where echo_kind = 'generated_tide' and version is not null;
alter table public.jw_draw_exposures
  add column if not exists bucket text,
  add column if not exists variant text,
  add column if not exists config_version integer,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
create table if not exists public.jw_profiles (
  actor_id uuid primary key references auth.users(id) on delete cascade,
  last_active_on date,
  streak_count integer not null default 0 check (streak_count >= 0),
  longest_streak integer not null default 0 check (longest_streak >= 0),
  lighthouse_level integer not null default 0 check (lighthouse_level between 0 and 7),
  binding_prompted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.jw_activity_days (
  actor_id uuid not null references auth.users(id) on delete cascade,
  activity_date date not null,
  action_mask integer not null default 0 check (action_mask >= 0),
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  primary key (actor_id, activity_date)
);
create table if not exists public.jw_tide_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  tide_date date not null,
  summary jsonb not null,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, tide_date)
);
create index if not exists jw_tide_reports_owner_date_idx
  on public.jw_tide_reports (owner_id, tide_date desc);
create table if not exists public.jw_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  endpoint_hash text not null,
  subscription jsonb not null,
  enabled boolean not null default true,
  last_success_at timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, endpoint_hash)
);
create table if not exists public.jw_echo_jobs (
  id uuid primary key default gen_random_uuid(),
  wish_id uuid not null references public.jw_wishes(id) on delete cascade,
  target_version integer not null check (target_version > 0),
  trigger_count integer not null check (trigger_count >= 5),
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  not_before timestamptz not null default now(),
  lease_until timestamptz,
  last_error_code text,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (wish_id, target_version)
);
create index if not exists jw_echo_jobs_claim_idx
  on public.jw_echo_jobs (status, not_before, lease_until);
create table if not exists public.jw_draw_configs (
  version integer primary key,
  active boolean not null default false,
  new_weight integer not null check (new_weight >= 0),
  same_sea_weight integer not null check (same_sea_weight >= 0),
  popular_weight integer not null check (popular_weight >= 0),
  quiet_weight integer not null check (quiet_weight >= 0),
  resonance_weight integer not null check (resonance_weight >= 0),
  gold_denominator integer not null check (gold_denominator >= 1),
  far_denominator integer not null check (far_denominator >= 1),
  old_denominator integer not null check (old_denominator >= 1),
  created_at timestamptz not null default now(),
  check (new_weight + same_sea_weight + popular_weight + quiet_weight + resonance_weight = 100)
);
insert into public.jw_draw_configs (
  version, active, new_weight, same_sea_weight, popular_weight,
  quiet_weight, resonance_weight, gold_denominator, far_denominator, old_denominator
) values (1, true, 40, 25, 15, 10, 10, 50, 80, 100)
on conflict (version) do update set active = excluded.active;
create table if not exists public.jw_wave_reports (
  id uuid primary key default gen_random_uuid(),
  theme_id uuid not null references public.jw_themes(id) on delete cascade,
  slug text not null unique,
  week_start date not null,
  week_end date not null,
  summary text not null check (char_length(summary) between 1 and 180),
  stats jsonb not null default '{}'::jsonb,
  status text not null default 'published'
    check (status in ('draft', 'published', 'archived')),
  created_at timestamptz not null default now(),
  check (week_end >= week_start)
);
create table if not exists public.jw_match_preferences (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
create table if not exists public.jw_resonance_matches (
  id uuid primary key default gen_random_uuid(),
  participant_a uuid not null references auth.users(id) on delete cascade,
  participant_b uuid not null references auth.users(id) on delete cascade,
  wish_a uuid not null references public.jw_wishes(id) on delete cascade,
  wish_b uuid not null references public.jw_wishes(id) on delete cascade,
  match_key text not null,
  period_start date not null,
  status text not null default 'unseen'
    check (status in ('unseen', 'seen', 'dismissed')),
  created_at timestamptz not null default now(),
  check (participant_a <> participant_b),
  unique (participant_a, participant_b, match_key, period_start)
);
create table if not exists public.jw_annual_maps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  map_year integer not null check (map_year between 2020 and 2200),
  slug text not null unique,
  snapshot jsonb not null,
  status text not null default 'private' check (status in ('private', 'published')),
  generated_at timestamptz not null default now(),
  unique (owner_id, map_year)
);
create table if not exists public.jw_ab_assignments (
  actor_id uuid not null references auth.users(id) on delete cascade,
  experiment_key text not null,
  variant text not null,
  assigned_at timestamptz not null default now(),
  primary key (actor_id, experiment_key)
);
alter table public.jw_profiles enable row level security;
alter table public.jw_activity_days enable row level security;
alter table public.jw_tide_reports enable row level security;
alter table public.jw_push_subscriptions enable row level security;
alter table public.jw_echo_jobs enable row level security;
alter table public.jw_draw_configs enable row level security;
alter table public.jw_wave_reports enable row level security;
alter table public.jw_match_preferences enable row level security;
alter table public.jw_resonance_matches enable row level security;
alter table public.jw_annual_maps enable row level security;
alter table public.jw_ab_assignments enable row level security;
revoke all on public.jw_profiles, public.jw_activity_days, public.jw_tide_reports,
  public.jw_push_subscriptions, public.jw_echo_jobs, public.jw_draw_configs,
  public.jw_wave_reports, public.jw_match_preferences, public.jw_resonance_matches,
  public.jw_annual_maps, public.jw_ab_assignments
  from anon, authenticated;
grant all on public.jw_profiles, public.jw_activity_days, public.jw_tide_reports,
  public.jw_push_subscriptions, public.jw_echo_jobs, public.jw_draw_configs,
  public.jw_wave_reports, public.jw_match_preferences, public.jw_resonance_matches,
  public.jw_annual_maps, public.jw_ab_assignments
  to service_role;
drop policy if exists jw_echoes_public_read on public.jw_echoes;
create policy jw_echoes_public_read
on public.jw_echoes for select
to anon, authenticated
using (
  status = 'published'
  and exists (
    select 1 from public.jw_wishes w
    where w.id = wish_id and w.status = 'published'
  )
);
drop policy if exists jw_theme_wishes_public_read on public.jw_theme_wishes;
create policy jw_theme_wishes_public_read
on public.jw_theme_wishes for select
to anon, authenticated
using (
  exists (
    select 1
    from public.jw_themes t
    join public.jw_wishes w on w.id = wish_id
    where t.id = theme_id
      and t.status = 'published'
      and (t.starts_at is null or t.starts_at <= now())
      and (t.ends_at is null or t.ends_at >= now())
      and w.status = 'published'
  )
);
drop policy if exists jw_wave_reports_public_read on public.jw_wave_reports;
create policy jw_wave_reports_public_read
on public.jw_wave_reports for select
to anon, authenticated
using (
  status = 'published'
  and exists (
    select 1 from public.jw_themes t
    where t.id = theme_id and t.status = 'published'
  )
);
grant select on public.jw_wave_reports to anon, authenticated;
create or replace function public.jw_internal_touch_activity(
  p_actor_id uuid,
  p_action text
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_bit integer;
  v_last date;
  v_streak integer;
  v_longest integer;
begin
  if p_action = 'throw' then v_bit := 1;
  elsif p_action = 'ripple' then v_bit := 2;
  elsif p_action = 'tide_open' then v_bit := 4;
  elsif p_action = 'anchor' then v_bit := 8;
  else raise exception 'invalid_activity_action' using errcode = '22023';
  end if;

  insert into public.jw_activity_days (actor_id, activity_date, action_mask)
  values (p_actor_id, v_today, v_bit)
  on conflict (actor_id, activity_date) do update set
    action_mask = public.jw_activity_days.action_mask | excluded.action_mask,
    last_at = now();

  select last_active_on, streak_count, longest_streak
  into v_last, v_streak, v_longest
  from public.jw_profiles
  where actor_id = p_actor_id
  for update;

  if not found then
    insert into public.jw_profiles (
      actor_id, last_active_on, streak_count, longest_streak, lighthouse_level
    ) values (p_actor_id, v_today, 1, 1, 1);
    return;
  end if;
  if v_last = v_today then return; end if;
  if v_last = v_today - 1 then v_streak := v_streak + 1;
  else v_streak := 1;
  end if;

  update public.jw_profiles set
    last_active_on = v_today,
    streak_count = v_streak,
    longest_streak = greatest(v_longest, v_streak),
    lighthouse_level = least(7, greatest(1, v_streak)),
    updated_at = now()
  where actor_id = p_actor_id;
end;
$$;
create or replace function public.jw_activity_from_owner()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.jw_internal_touch_activity(new.owner_id, 'throw'); return new; end;
$$;
create or replace function public.jw_activity_from_ripple()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.jw_internal_touch_activity(new.actor_id, 'ripple'); return new; end;
$$;
create or replace function public.jw_activity_from_anchor()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public.jw_internal_touch_activity(new.actor_id, 'anchor'); return new; end;
$$;
drop trigger if exists jw_wish_owner_activity on public.jw_wish_owners;
create trigger jw_wish_owner_activity after insert on public.jw_wish_owners
for each row execute function public.jw_activity_from_owner();
drop trigger if exists jw_ripple_activity on public.jw_ripples;
create trigger jw_ripple_activity after insert or update on public.jw_ripples
for each row execute function public.jw_activity_from_ripple();
drop trigger if exists jw_anchor_activity on public.jw_anchors;
create trigger jw_anchor_activity after insert on public.jw_anchors
for each row execute function public.jw_activity_from_anchor();
create or replace function public.jw_decrement_ripple_counter()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.jw_wishes set
    together_count = case when old.ripple_type = 'together'
      then greatest(legacy_together_count, together_count - 1) else together_count end,
    been_count = case when old.ripple_type = 'been'
      then greatest(0, been_count - 1) else been_count end,
    reef_count = case when old.ripple_type = 'reef'
      then greatest(0, reef_count - 1) else reef_count end,
    bless_count = case when old.ripple_type = 'bless'
      then greatest(0, bless_count - 1) else bless_count end
  where id = old.wish_id;
  return old;
end;
$$;
drop trigger if exists jw_ripple_delete_counter on public.jw_ripples;
create trigger jw_ripple_delete_counter after delete on public.jw_ripples
for each row execute function public.jw_decrement_ripple_counter();
create or replace function public.jw_decrement_report_counter()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  update public.jw_wishes set report_count = greatest(0, report_count - 1)
  where id = old.wish_id;
  return old;
end;
$$;
drop trigger if exists jw_report_delete_counter on public.jw_reports;
create trigger jw_report_delete_counter after delete on public.jw_reports
for each row execute function public.jw_decrement_report_counter();
create or replace function public.jw_internal_set_reef_moderation(
  p_actor_id uuid,
  p_wish_id uuid,
  p_status text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  if p_status not in ('approved', 'rejected') then
    raise exception 'invalid_moderation_status' using errcode = '22023';
  end if;
  update public.jw_ripples set moderation_status = p_status, updated_at = now()
  where actor_id = p_actor_id and wish_id = p_wish_id and ripple_type = 'reef';
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
insert into public.jw_themes (
  slug, title, summary, cover_sea, status, starts_at, ends_at
) values (
  'faraway-current', '本周浪潮 · 远方海',
  '把那处“此生一定要去”的地方，交给这一周的洋流。',
  'faraway', 'published', null, null
) on conflict (slug) do update set
  title = excluded.title,
  summary = excluded.summary,
  cover_sea = excluded.cover_sea,
  status = excluded.status;
insert into public.jw_theme_wishes (theme_id, wish_id, rank)
select t.id, w.id, row_number() over (
  order by w.live_ripple_count desc, w.created_at desc
)::integer
from public.jw_themes t
cross join lateral (
  select * from public.jw_wishes
  where status = 'published' and sea = 'faraway'
  order by live_ripple_count desc, created_at desc limit 12
) w
where t.slug = 'faraway-current'
on conflict (theme_id, wish_id) do update set rank = excluded.rank;
insert into public.jw_wave_reports (
  theme_id, slug, week_start, week_end, summary, stats, status
)
select t.id, 'faraway-current-report',
  date_trunc('week', now() at time zone 'Asia/Shanghai')::date,
  (date_trunc('week', now() at time zone 'Asia/Shanghai')::date + 6),
  '这周，远方海把那些不愿忘记的目的地推到了浪尖。',
  jsonb_build_object(
    'wishCount', (select count(*) from public.jw_wishes w where w.status = 'published' and w.sea = 'faraway'),
    'generatedAt', now()
  ),
  'published'
from public.jw_themes t
where t.slug = 'faraway-current'
on conflict (slug) do update set
  stats = excluded.stats,
  summary = excluded.summary;
revoke all on function public.jw_internal_touch_activity(uuid, text) from public, anon, authenticated;
revoke all on function public.jw_activity_from_owner() from public, anon, authenticated;
revoke all on function public.jw_activity_from_ripple() from public, anon, authenticated;
revoke all on function public.jw_activity_from_anchor() from public, anon, authenticated;
revoke all on function public.jw_decrement_ripple_counter() from public, anon, authenticated;
revoke all on function public.jw_decrement_report_counter() from public, anon, authenticated;
revoke all on function public.jw_internal_set_reef_moderation(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.jw_internal_touch_activity(uuid, text) to service_role;
grant execute on function public.jw_internal_set_reef_moderation(uuid, uuid, text) to service_role;
commit;
