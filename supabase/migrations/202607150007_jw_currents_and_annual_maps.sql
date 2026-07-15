-- JourneyWave Phase C currents: anonymous resonance matching, tide inclusion,
-- and durable annual voyage snapshots. All objects remain inside jw_.

begin;
create index if not exists jw_resonance_matches_a_period_idx
  on public.jw_resonance_matches (participant_a, period_start desc);
create index if not exists jw_resonance_matches_b_period_idx
  on public.jw_resonance_matches (participant_b, period_start desc);
create or replace function public.jw_internal_build_resonance_matches()
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_period_start date := date_trunc('week', now() at time zone 'Asia/Shanghai')::date;
  v_inserted integer := 0;
begin
  with owned as (
    select distinct on (o.owner_id)
      o.owner_id,
      w.id as wish_id,
      w.destination,
      w.sea,
      w.created_at
    from public.jw_wish_owners o
    join public.jw_wishes w on w.id = o.wish_id and w.status = 'published'
    left join public.jw_match_preferences p on p.owner_id = o.owner_id
    where coalesce(p.enabled, true)
    order by o.owner_id, w.created_at desc
  ), candidates as (
    select
      a.owner_id as participant_a,
      b.owner_id as participant_b,
      a.wish_id as wish_a,
      b.wish_id as wish_b,
      case
        when lower(a.destination) = lower(b.destination)
          then 'destination:' || lower(a.destination)
        else 'sea:' || a.sea
      end as match_key,
      row_number() over (
        partition by a.owner_id
        order by
          (lower(a.destination) = lower(b.destination)) desc,
          md5(a.owner_id::text || b.owner_id::text || v_period_start::text)
      ) as rank_a,
      row_number() over (
        partition by b.owner_id
        order by
          (lower(a.destination) = lower(b.destination)) desc,
          md5(b.owner_id::text || a.owner_id::text || v_period_start::text)
      ) as rank_b
    from owned a
    join owned b on a.owner_id < b.owner_id
      and (lower(a.destination) = lower(b.destination) or a.sea = b.sea)
    where not exists (
      select 1
      from public.jw_resonance_matches previous
      where previous.period_start >= v_period_start - 28
        and (
          (previous.participant_a = a.owner_id and previous.participant_b = b.owner_id)
          or (previous.participant_a = b.owner_id and previous.participant_b = a.owner_id)
        )
    )
  )
  insert into public.jw_resonance_matches (
    participant_a, participant_b, wish_a, wish_b, match_key, period_start
  )
  select participant_a, participant_b, wish_a, wish_b, match_key, v_period_start
  from candidates
  where rank_a = 1 and rank_b = 1
  limit 500
  on conflict do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;
create or replace function public.jw_internal_build_annual_map(
  p_actor_id uuid,
  p_year integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_snapshot jsonb;
  v_row public.jw_annual_maps;
begin
  if p_year not between 2020 and 2200 then
    raise exception 'invalid_map_year' using errcode = '22023';
  end if;

  v_start := (make_date(p_year, 1, 1)::timestamp at time zone 'Asia/Shanghai');
  v_end := (make_date(p_year + 1, 1, 1)::timestamp at time zone 'Asia/Shanghai');

  select jsonb_build_object(
    'year', p_year,
    'wishCount', (
      select count(*)::integer
      from public.jw_wish_owners o
      join public.jw_wishes w on w.id = o.wish_id
      where o.owner_id = p_actor_id and w.created_at >= v_start and w.created_at < v_end
    ),
    'ripplesReceived', (
      select count(*)::integer
      from public.jw_wish_owners o
      join public.jw_ripples r on r.wish_id = o.wish_id
      where o.owner_id = p_actor_id and r.created_at >= v_start and r.created_at < v_end
    ),
    'anchorCount', (
      select count(*)::integer
      from public.jw_anchors a
      where a.actor_id = p_actor_id and a.created_at >= v_start and a.created_at < v_end
    ),
    'seasLit', coalesce((
      select jsonb_agg(s.sea order by s.sea)
      from (
        select distinct w.sea
        from public.jw_ripples r
        join public.jw_wishes w on w.id = r.wish_id
        where r.actor_id = p_actor_id and r.created_at >= v_start and r.created_at < v_end
      ) s
    ), '[]'::jsonb),
    'residentSea', (
      select w.sea
      from public.jw_ripples r
      join public.jw_wishes w on w.id = r.wish_id
      where r.actor_id = p_actor_id and r.created_at >= v_start and r.created_at < v_end
      group by w.sea
      order by count(*) desc, w.sea
      limit 1
    ),
    'topWish', (
      select jsonb_build_object(
        'slug', w.slug,
        'destination', w.destination,
        'sea', w.sea,
        'ripples', count(r.id)::integer
      )
      from public.jw_wish_owners o
      join public.jw_wishes w on w.id = o.wish_id
      left join public.jw_ripples r on r.wish_id = w.id
        and r.created_at >= v_start and r.created_at < v_end
      where o.owner_id = p_actor_id
      group by w.id
      order by count(r.id) desc, w.created_at desc
      limit 1
    ),
    'longestStreak', coalesce((
      select p.longest_streak from public.jw_profiles p where p.actor_id = p_actor_id
    ), 0)
  ) into v_snapshot;

  insert into public.jw_annual_maps (owner_id, map_year, slug, snapshot)
  values (
    p_actor_id,
    p_year,
    format('annual-%s-%s', p_year, substr(md5(p_actor_id::text), 1, 12)),
    v_snapshot
  )
  on conflict (owner_id, map_year) do update set
    snapshot = excluded.snapshot,
    generated_at = now()
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;
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
  ), match_rows as (
    select m.participant_a as owner_id, w.slug, w.destination, w.sea
    from public.jw_resonance_matches m
    join public.jw_wishes w on w.id = m.wish_b and w.status = 'published'
    where m.created_at >= v_start and m.created_at < v_end
    union all
    select m.participant_b as owner_id, w.slug, w.destination, w.sea
    from public.jw_resonance_matches m
    join public.jw_wishes w on w.id = m.wish_a and w.status = 'published'
    where m.created_at >= v_start and m.created_at < v_end
  ), match_totals as (
    select owner_id, count(*)::integer as match_count,
      jsonb_agg(jsonb_build_object(
        'slug', slug,
        'destination', destination,
        'sea', sea
      ) order by destination) as matches
    from match_rows
    group by owner_id
  ), affected as (
    select owner_id from wish_totals
    union
    select owner_id from echo_totals
    union
    select owner_id from match_totals
  )
  insert into public.jw_tide_reports (owner_id, tide_date, summary)
  select
    a.owner_id,
    v_today,
    jsonb_build_object(
      'totalRipples', coalesce(w.total_ripples, 0),
      'newEchoes', coalesce(e.new_echoes, 0),
      'sameFrequencyCount', coalesce(m.match_count, 0),
      'sameFrequency', coalesce(m.matches, '[]'::jsonb),
      'wishes', coalesce(w.wishes, '[]'::jsonb),
      'message', case
        when coalesce(w.total_ripples, 0) > 0 then '潮水带回了新的涟漪。'
        when coalesce(e.new_echoes, 0) > 0 then '海的回信已经靠岸。'
        else '有一只同频瓶，顺着洋流靠近了。'
      end
    )
  from affected a
  left join wish_totals w on w.owner_id = a.owner_id
  left join echo_totals e on e.owner_id = a.owner_id
  left join match_totals m on m.owner_id = a.owner_id
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
        when (t.summary->>'newEchoes')::integer > 0
          then '海的回信已经靠岸。'
        else '有一只同频瓶，顺着洋流靠近了。'
      end,
      'url', '/tide',
      'tag', format('jw-tide-%s-%s', t.owner_id, t.tide_date)
    ) order by t.created_at, s.created_at)
    from public.jw_tide_reports t
    join public.jw_push_subscriptions s on s.owner_id = t.owner_id and s.enabled
    where t.tide_date = v_today and t.notified_at is null
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.jw_internal_build_resonance_matches() from public, anon, authenticated;
revoke all on function public.jw_internal_build_annual_map(uuid, integer) from public, anon, authenticated;
grant execute on function public.jw_internal_build_resonance_matches() to service_role;
grant execute on function public.jw_internal_build_annual_map(uuid, integer) to service_role;
commit;
