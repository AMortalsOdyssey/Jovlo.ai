-- JourneyWave daily tide generation and push-delivery handoff.

begin;
alter table public.jw_tide_reports
  add column if not exists notified_at timestamptz;
create or replace function public.jw_internal_build_tides()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_start timestamptz := (v_today::timestamp at time zone 'Asia/Shanghai');
  v_end timestamptz := ((v_today + 1)::timestamp at time zone 'Asia/Shanghai');
begin
  with wish_changes as (
    select
      o.owner_id,
      w.id,
      w.slug,
      w.destination,
      w.sea,
      w.wish_text,
      count(r.id)::integer as new_ripples,
      jsonb_build_object(
        'together', w.together_count,
        'been', w.been_count,
        'reef', w.reef_count,
        'bless', w.bless_count
      ) as counts
    from public.jw_wish_owners o
    join public.jw_wishes w on w.id = o.wish_id and w.status = 'published'
    join public.jw_ripples r on r.wish_id = w.id
      and r.created_at >= v_start and r.created_at < v_end
    group by o.owner_id, w.id
  ), wish_totals as (
    select
      owner_id,
      sum(new_ripples)::integer as total_ripples,
      jsonb_agg(jsonb_build_object(
        'id', id,
        'slug', slug,
        'destination', destination,
        'sea', sea,
        'wishText', wish_text,
        'newRipples', new_ripples,
        'counts', counts
      ) order by new_ripples desc, destination) as wishes
    from wish_changes
    group by owner_id
  ), echo_totals as (
    select o.owner_id, count(e.id)::integer as new_echoes
    from public.jw_wish_owners o
    join public.jw_echoes e on e.wish_id = o.wish_id
      and e.echo_kind = 'generated_tide'
      and e.status = 'published'
      and e.created_at >= v_start and e.created_at < v_end
    group by o.owner_id
  ), affected as (
    select owner_id from wish_totals
    union
    select owner_id from echo_totals
  )
  insert into public.jw_tide_reports (owner_id, tide_date, summary)
  select
    a.owner_id,
    v_today,
    jsonb_build_object(
      'totalRipples', coalesce(w.total_ripples, 0),
      'newEchoes', coalesce(e.new_echoes, 0),
      'wishes', coalesce(w.wishes, '[]'::jsonb),
      'message', case when coalesce(w.total_ripples, 0) > 0
        then '潮水带回了新的涟漪。'
        else '海的回信已经靠岸。' end
    )
  from affected a
  left join wish_totals w on w.owner_id = a.owner_id
  left join echo_totals e on e.owner_id = a.owner_id
  on conflict (owner_id, tide_date) do update set
    notified_at = case
      when public.jw_tide_reports.summary is distinct from excluded.summary then null
      else public.jw_tide_reports.notified_at end,
    summary = excluded.summary;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'reportId', t.id,
      'subscriptionId', s.id,
      'subscription', s.subscription,
      'title', 'JourneyWave · 潮汐靠岸',
      'body', case
        when (t.summary->>'totalRipples')::integer > 0
          then format('你的愿望收到 %s 圈新涟漪。', t.summary->>'totalRipples')
        else '海的回信已经靠岸。' end,
      'url', '/tide',
      'tag', format('jw-tide-%s-%s', t.owner_id, t.tide_date)
    ) order by t.created_at, s.created_at)
    from public.jw_tide_reports t
    join public.jw_push_subscriptions s on s.owner_id = t.owner_id and s.enabled
    where t.tide_date = v_today and t.notified_at is null
  ), '[]'::jsonb);
end;
$$;
create or replace function public.jw_internal_mark_push(
  p_report_id uuid,
  p_subscription_id uuid,
  p_success boolean,
  p_error_code text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.jw_push_subscriptions set
    last_success_at = case when p_success then now() else last_success_at end,
    last_error_code = case when p_success then null else left(coalesce(p_error_code, 'push_failed'), 80) end,
    enabled = case when coalesce(p_error_code, '') in ('404', '410') then false else enabled end,
    updated_at = now()
  where id = p_subscription_id;

  if p_success then
    update public.jw_tide_reports
    set notified_at = coalesce(notified_at, now())
    where id = p_report_id;
  end if;
end;
$$;
revoke all on function public.jw_internal_build_tides() from public, anon, authenticated;
revoke all on function public.jw_internal_mark_push(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.jw_internal_build_tides() to service_role;
grant execute on function public.jw_internal_mark_push(uuid, uuid, boolean, text) to service_role;
commit;
