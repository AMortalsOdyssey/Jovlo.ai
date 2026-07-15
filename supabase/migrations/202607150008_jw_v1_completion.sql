-- JourneyWave v1 completion: fair rate limits, preference controls, and weekly currents.

begin;
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
  v_actor_limit integer;
  v_ip_limit integer;
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
begin
  if p_actor_id is null or p_ip_hash is null or char_length(p_ip_hash) < 16 then
    raise exception 'invalid_identity' using errcode = '22023';
  end if;

  if p_kind = 'wishes' then v_actor_limit := 5; v_ip_limit := 500;
  elsif p_kind = 'ripples' then v_actor_limit := 100; v_ip_limit := 10000;
  elsif p_kind = 'reports' then v_actor_limit := 20; v_ip_limit := 2000;
  elsif p_kind = 'draws' then v_actor_limit := 300; v_ip_limit := 30000;
  elsif p_kind = 'events' then v_actor_limit := 500; v_ip_limit := 50000;
  elsif p_kind = 'echoes' then v_actor_limit := 20; v_ip_limit := 2000;
  else raise exception 'invalid_usage_kind' using errcode = '22023';
  end if;

  insert into public.jw_daily_usage (usage_date, actor_id, ip_hash)
  values (v_today, p_actor_id, p_ip_hash)
  on conflict (usage_date, actor_id) do nothing;

  execute format(
    'select %I from public.jw_daily_usage where usage_date = $1 and actor_id = $2 for update',
    p_kind
  ) into v_actor_count using v_today, p_actor_id;

  insert into public.jw_daily_ip_usage (usage_date, ip_hash)
  values (v_today, p_ip_hash)
  on conflict (usage_date, ip_hash) do nothing;

  execute format(
    'select %I from public.jw_daily_ip_usage where usage_date = $1 and ip_hash = $2 for update',
    p_kind
  ) into v_ip_count using v_today, p_ip_hash;

  if v_actor_count >= v_actor_limit or v_ip_count >= v_ip_limit then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;

  execute format(
    'update public.jw_daily_usage set %I = %I + 1, updated_at = now() where usage_date = $1 and actor_id = $2',
    p_kind,
    p_kind
  ) using v_today, p_actor_id;

  execute format(
    'update public.jw_daily_ip_usage set %I = %I + 1, updated_at = now() where usage_date = $1 and ip_hash = $2',
    p_kind,
    p_kind
  ) using v_today, p_ip_hash;
end;
$$;
create or replace function public.jw_internal_get_match_preference(p_actor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select enabled from public.jw_match_preferences where owner_id = p_actor_id
  ), true);
$$;
create or replace function public.jw_internal_set_match_preference(
  p_actor_id uuid,
  p_enabled boolean
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.jw_match_preferences (owner_id, enabled, updated_at)
  values (p_actor_id, coalesce(p_enabled, false), now())
  on conflict (owner_id) do update set
    enabled = excluded.enabled,
    updated_at = excluded.updated_at;
  return coalesce(p_enabled, false);
end;
$$;
create or replace function public.jw_internal_build_weekly_wave()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_week_start date := date_trunc('week', now() at time zone 'Asia/Shanghai')::date;
  v_week_end date;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_slug text;
  v_report_slug text;
  v_sea text;
  v_sea_name text;
  v_wish_count integer;
  v_theme_id uuid;
  v_title text;
  v_summary text;
begin
  v_week_end := v_week_start + 6;
  v_starts_at := v_week_start::timestamp at time zone 'Asia/Shanghai';
  v_ends_at := (v_week_start + 7)::timestamp at time zone 'Asia/Shanghai';
  v_slug := 'weekly-' || to_char(v_week_start, 'YYYY-MM-DD');
  v_report_slug := v_slug || '-report';

  select w.sea
  into v_sea
  from public.jw_wishes w
  where w.status = 'published'
    and w.created_at >= v_starts_at - interval '7 days'
  group by w.sea
  order by count(*) desc, sum(w.live_ripple_count) desc, w.sea
  limit 1;

  if v_sea is null then
    select w.sea
    into v_sea
    from public.jw_wishes w
    where w.status = 'published'
    group by w.sea
    order by count(*) desc, sum(w.live_ripple_count) desc, w.sea
    limit 1;
  end if;

  if v_sea is null then
    return jsonb_build_object('published', false, 'reason', 'no_published_wishes');
  end if;

  v_sea_name := case v_sea
    when 'snow' then '雪原海'
    when 'island' then '岛屿海'
    when 'ridge' then '山脊海'
    when 'fireworks' then '烟火海'
    when 'olddream' then '旧梦海'
    when 'faraway' then '远方海'
    else '说走就走海'
  end;
  v_title := '本周浪潮 · ' || v_sea_name;

  select count(*)::integer into v_wish_count
  from public.jw_wishes
  where status = 'published' and sea = v_sea;
  v_summary := format('这周，%s有更多远方被想起。%s 只愿望正沿着同一股潮汐靠岸。', v_sea_name, least(v_wish_count, 12));

  update public.jw_themes
  set status = 'archived', ends_at = least(coalesce(ends_at, now()), now())
  where slug like 'weekly-%' and slug <> v_slug and status = 'published';

  insert into public.jw_themes (
    slug, title, summary, cover_sea, status, starts_at, ends_at
  ) values (
    v_slug, v_title, v_summary, v_sea, 'published', v_starts_at, v_ends_at
  )
  on conflict (slug) do update set
    title = excluded.title,
    summary = excluded.summary,
    cover_sea = excluded.cover_sea,
    status = 'published',
    starts_at = excluded.starts_at,
    ends_at = excluded.ends_at
  returning id into v_theme_id;

  delete from public.jw_theme_wishes where theme_id = v_theme_id;
  insert into public.jw_theme_wishes (theme_id, wish_id, rank)
  select v_theme_id, ranked.id, ranked.rank
  from (
    select w.id, row_number() over (
      order by w.live_ripple_count desc, w.created_at desc, w.id
    )::integer as rank
    from public.jw_wishes w
    where w.status = 'published' and w.sea = v_sea
    limit 12
  ) ranked;

  insert into public.jw_wave_reports (
    theme_id, slug, week_start, week_end, summary, stats, status
  ) values (
    v_theme_id,
    v_report_slug,
    v_week_start,
    v_week_end,
    format('%s成为本周的公共浪潮，共收录 %s 只匿名旅行愿望。', v_sea_name, least(v_wish_count, 12)),
    jsonb_build_object(
      'wishCount', least(v_wish_count, 12),
      'coverSea', v_sea,
      'generatedAt', now()
    ),
    'published'
  )
  on conflict (slug) do update set
    theme_id = excluded.theme_id,
    week_start = excluded.week_start,
    week_end = excluded.week_end,
    summary = excluded.summary,
    stats = excluded.stats,
    status = 'published';

  return jsonb_build_object(
    'published', true,
    'themeId', v_theme_id,
    'slug', v_slug,
    'coverSea', v_sea,
    'wishCount', least(v_wish_count, 12),
    'weekStart', v_week_start,
    'weekEnd', v_week_end
  );
end;
$$;
revoke all on function public.jw_internal_assert_usage(uuid, text, text) from public, anon, authenticated;
revoke all on function public.jw_internal_get_match_preference(uuid) from public, anon, authenticated;
revoke all on function public.jw_internal_set_match_preference(uuid, boolean) from public, anon, authenticated;
revoke all on function public.jw_internal_build_weekly_wave() from public, anon, authenticated;
grant execute on function public.jw_internal_assert_usage(uuid, text, text) to service_role;
grant execute on function public.jw_internal_get_match_preference(uuid) to service_role;
grant execute on function public.jw_internal_set_match_preference(uuid, boolean) to service_role;
grant execute on function public.jw_internal_build_weekly_wave() to service_role;
commit;
