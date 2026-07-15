-- JourneyWave product RPCs for weighted draw, public detail, tides, voyage map,
-- current wave, push registration and generated Echo jobs.

begin;
create or replace function public.jw_internal_draw_v2(
  p_actor_id uuid,
  p_ip_hash text,
  p_exclude uuid[] default '{}'::uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_config public.jw_draw_configs;
  v_roll numeric := random() * 100;
  v_rare numeric := random();
  v_bucket text;
  v_variant text := 'standard';
  v_preferred text;
  v_wish public.jw_wishes;
  v_same_count integer := 0;
begin
  perform public.jw_internal_assert_usage(p_actor_id, p_ip_hash, 'draws');
  select * into v_config
  from public.jw_draw_configs where active order by version desc limit 1;
  if not found then raise exception 'draw_config_missing' using errcode = 'P0001'; end if;

  select w.sea into v_preferred
  from public.jw_ripples r
  join public.jw_wishes w on w.id = r.wish_id
  where r.actor_id = p_actor_id
  group by w.sea
  order by count(*) desc, w.sea
  limit 1;

  if v_roll < v_config.new_weight then v_bucket := 'new';
  elsif v_roll < v_config.new_weight + v_config.same_sea_weight then v_bucket := 'same_sea';
  elsif v_roll < v_config.new_weight + v_config.same_sea_weight + v_config.popular_weight then v_bucket := 'popular';
  elsif v_roll < v_config.new_weight + v_config.same_sea_weight + v_config.popular_weight + v_config.quiet_weight then v_bucket := 'quiet';
  else v_bucket := 'resonance';
  end if;

  if v_bucket = 'new' then
    select w.* into v_wish
    from public.jw_wishes w
    where w.status = 'published'
      and w.created_at >= now() - interval '14 days'
      and not (w.id = any(coalesce(p_exclude, '{}'::uuid[])))
      and not exists (
        select 1 from public.jw_wish_owners o
        where o.wish_id = w.id and o.owner_id = p_actor_id
      )
      and not exists (
        select 1 from public.jw_ripples r
        where r.wish_id = w.id and r.actor_id = p_actor_id
      )
    order by (case when w.wish_text is not null then 1.35 else 1 end) * random() desc
    limit 1;
  elsif v_bucket = 'same_sea' and v_preferred is not null then
    select w.* into v_wish
    from public.jw_wishes w
    where w.status = 'published'
      and w.sea = v_preferred
      and not (w.id = any(coalesce(p_exclude, '{}'::uuid[])))
      and not exists (
        select 1 from public.jw_wish_owners o
        where o.wish_id = w.id and o.owner_id = p_actor_id
      )
      and not exists (
        select 1 from public.jw_ripples r
        where r.wish_id = w.id and r.actor_id = p_actor_id
      )
    order by (case when w.wish_text is not null then 1.35 else 1 end) * random() desc
    limit 1;
  elsif v_bucket = 'popular' then
    select w.* into v_wish
    from public.jw_wishes w
    where w.status = 'published'
      and not (w.id = any(coalesce(p_exclude, '{}'::uuid[])))
      and not exists (
        select 1 from public.jw_wish_owners o
        where o.wish_id = w.id and o.owner_id = p_actor_id
      )
      and not exists (
        select 1 from public.jw_ripples r
        where r.wish_id = w.id and r.actor_id = p_actor_id
      )
    order by (w.live_ripple_count + 1) * (case when w.wish_text is not null then 1.35 else 1 end) * random() desc
    limit 1;
  elsif v_bucket = 'quiet' then
    select w.* into v_wish
    from public.jw_wishes w
    where w.status = 'published'
      and w.live_ripple_count <= 1
      and not (w.id = any(coalesce(p_exclude, '{}'::uuid[])))
      and not exists (
        select 1 from public.jw_wish_owners o
        where o.wish_id = w.id and o.owner_id = p_actor_id
      )
      and not exists (
        select 1 from public.jw_ripples r
        where r.wish_id = w.id and r.actor_id = p_actor_id
      )
    order by w.created_at, (case when w.wish_text is not null then 1.35 else 1 end) * random() desc
    limit 1;
  elsif v_bucket = 'resonance' then
    select w.* into v_wish
    from public.jw_wishes w
    where w.status = 'published'
      and not (w.id = any(coalesce(p_exclude, '{}'::uuid[])))
      and not exists (
        select 1 from public.jw_wish_owners o
        where o.wish_id = w.id and o.owner_id = p_actor_id
      )
      and not exists (
        select 1 from public.jw_ripples r
        where r.wish_id = w.id and r.actor_id = p_actor_id
      )
      and exists (
        select 1
        from public.jw_ripples mine
        join public.jw_wishes seen on seen.id = mine.wish_id
        where mine.actor_id = p_actor_id
          and (seen.destination = w.destination or seen.sea = w.sea)
      )
    order by (case when w.wish_text is not null then 1.35 else 1 end) * random() desc
    limit 1;
  end if;

  if v_wish.id is null then
    v_bucket := 'fallback';
    select w.* into v_wish
    from public.jw_wishes w
    where w.status = 'published'
      and not (w.id = any(coalesce(p_exclude, '{}'::uuid[])))
      and not exists (
        select 1 from public.jw_wish_owners o
        where o.wish_id = w.id and o.owner_id = p_actor_id
      )
    order by (case when w.wish_text is not null then 1.35 else 1 end) * random() desc
    limit 1;
  end if;
  if v_wish.id is null then raise exception 'wish_not_found' using errcode = 'P0002'; end if;

  if exists (
    select 1
    from public.jw_theme_wishes tw
    join public.jw_themes t on t.id = tw.theme_id
    where tw.wish_id = v_wish.id
      and t.status = 'published'
      and (t.starts_at is null or t.starts_at <= now())
      and (t.ends_at is null or t.ends_at >= now())
  ) and v_rare < 0.02 then
    v_variant := 'festival';
  elsif v_wish.live_ripple_count >= 5
    and v_rare < 1.0 / v_config.gold_denominator then
    v_variant := 'golden';
  elsif v_preferred is not null and v_wish.sea <> v_preferred
    and v_rare < 1.0 / v_config.far_denominator then
    v_variant := 'far';
  elsif v_wish.created_at < now() - interval '30 days'
    and v_rare < 1.0 / v_config.old_denominator then
    v_variant := 'old';
  end if;

  select count(distinct r.actor_id)::integer into v_same_count
  from public.jw_ripples r
  join public.jw_wishes w on w.id = r.wish_id
  where r.actor_id <> p_actor_id
    and (w.destination = v_wish.destination or w.sea = v_wish.sea);

  insert into public.jw_draw_exposures (
    actor_id, wish_id, source, bucket, variant, config_version, metadata
  ) values (
    p_actor_id,
    v_wish.id,
    'sea',
    v_bucket,
    v_variant,
    v_config.version,
    jsonb_build_object('sameFrequencyCount', v_same_count)
  );

  return jsonb_build_object(
    'wish', to_jsonb(v_wish),
    'bucket', v_bucket,
    'variant', v_variant,
    'sameFrequencyCount', v_same_count
  );
end;
$$;
create or replace function public.jw_internal_wish_detail(
  p_actor_id uuid,
  p_slug text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_wish public.jw_wishes;
begin
  select * into v_wish
  from public.jw_wishes
  where slug = p_slug and status = 'published';
  if not found then return null; end if;

  return jsonb_build_object(
    'wish', to_jsonb(v_wish),
    'isOwner', exists (
      select 1 from public.jw_wish_owners o
      where o.wish_id = v_wish.id and o.owner_id = p_actor_id
    ),
    'ownerState', public.jw_internal_owner_state(p_actor_id, v_wish.id),
    'reefNotes', coalesce((
      select jsonb_agg(
        jsonb_build_object('note', r.note, 'createdAt', r.created_at)
        order by r.created_at desc
      )
      from public.jw_ripples r
      where r.wish_id = v_wish.id
        and r.ripple_type = 'reef'
        and r.note is not null
        and r.moderation_status = 'approved'
    ), '[]'::jsonb),
    'echo', (
      select to_jsonb(e)
      from public.jw_echoes e
      where e.wish_id = v_wish.id
        and e.echo_kind = 'generated_tide'
        and e.status = 'published'
      order by e.version desc
      limit 1
    ),
    'timeline', jsonb_build_array(
      jsonb_build_object('type', 'thrown', 'at', v_wish.created_at),
      jsonb_build_object('type', 'first_ripple', 'at', (
        select min(r.created_at)
        from public.jw_ripples r
        where r.wish_id = v_wish.id
      )),
      jsonb_build_object('type', 'echo', 'at', v_wish.last_echo_at)
    )
  );
end;
$$;
create or replace function public.jw_internal_refresh_tides(p_actor_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_today date := (now() at time zone 'Asia/Shanghai')::date;
  v_start timestamptz := (v_today::timestamp at time zone 'Asia/Shanghai');
  v_end timestamptz := ((v_today + 1)::timestamp at time zone 'Asia/Shanghai');
  v_total integer := 0;
  v_echoes integer := 0;
  v_wishes jsonb := '[]'::jsonb;
  v_summary jsonb;
begin
  perform public.jw_internal_touch_activity(p_actor_id, 'tide_open');

  select coalesce(sum(item_count), 0)::integer,
    coalesce(jsonb_agg(item order by item_count desc), '[]'::jsonb)
  into v_total, v_wishes
  from (
    select count(r.id)::integer as item_count,
      jsonb_build_object(
        'id', w.id,
        'slug', w.slug,
        'destination', w.destination,
        'sea', w.sea,
        'wishText', w.wish_text,
        'newRipples', count(r.id),
        'counts', jsonb_build_object(
          'together', w.together_count,
          'been', w.been_count,
          'reef', w.reef_count,
          'bless', w.bless_count
        )
      ) as item
    from public.jw_wish_owners o
    join public.jw_wishes w on w.id = o.wish_id and w.status = 'published'
    join public.jw_ripples r on r.wish_id = w.id
      and r.created_at >= v_start and r.created_at < v_end
    where o.owner_id = p_actor_id
    group by w.id
  ) daily;

  select count(*)::integer into v_echoes
  from public.jw_echoes e
  join public.jw_wish_owners o on o.wish_id = e.wish_id
  where o.owner_id = p_actor_id
    and e.echo_kind = 'generated_tide'
    and e.created_at >= v_start
    and e.created_at < v_end;

  if v_total > 0 or v_echoes > 0 then
    v_summary := jsonb_build_object(
      'totalRipples', v_total,
      'newEchoes', v_echoes,
      'wishes', v_wishes,
      'message', case when v_total > 0
        then '潮水带回了新的涟漪。'
        else '海的回信已经靠岸。' end
    );
    insert into public.jw_tide_reports (owner_id, tide_date, summary)
    values (p_actor_id, v_today, v_summary)
    on conflict (owner_id, tide_date) do update set summary = excluded.summary;
  end if;

  return coalesce((
    select jsonb_agg(to_jsonb(t) order by t.tide_date desc)
    from (
      select id, tide_date, summary, opened_at, created_at
      from public.jw_tide_reports
      where owner_id = p_actor_id
      order by tide_date desc
      limit 30
    ) t
  ), '[]'::jsonb);
end;
$$;
create or replace function public.jw_internal_open_tide(
  p_actor_id uuid,
  p_report_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_count integer;
begin
  update public.jw_tide_reports
  set opened_at = coalesce(opened_at, now())
  where id = p_report_id and owner_id = p_actor_id;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
create or replace function public.jw_internal_voyage_map(p_actor_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'profile', coalesce((
      select to_jsonb(p)
      from public.jw_profiles p
      where p.actor_id = p_actor_id
    ), jsonb_build_object(
      'streak_count', 0,
      'longest_streak', 0,
      'lighthouse_level', 0
    )),
    'wishes', coalesce((
      select jsonb_agg(to_jsonb(w) order by w.created_at desc)
      from public.jw_wish_owners o
      join public.jw_wishes w on w.id = o.wish_id
      where o.owner_id = p_actor_id
    ), '[]'::jsonb),
    'anchors', coalesce((
      select jsonb_agg(to_jsonb(w) order by a.created_at desc)
      from public.jw_anchors a
      join public.jw_wishes w on w.id = a.wish_id
      where a.actor_id = p_actor_id and w.status = 'published'
    ), '[]'::jsonb),
    'seasLit', coalesce((
      select jsonb_agg(s.sea order by s.sea)
      from (
        select distinct w.sea
        from public.jw_ripples r
        join public.jw_wishes w on w.id = r.wish_id
        where r.actor_id = p_actor_id
      ) s
    ), '[]'::jsonb),
    'sameFrequency', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'destination', w.destination,
        'sea', w.sea,
        'wishSlug', w.slug,
        'status', m.status
      ) order by m.created_at desc)
      from public.jw_resonance_matches m
      join public.jw_wishes w on w.id = case
        when m.participant_a = p_actor_id then m.wish_b else m.wish_a end
      where (m.participant_a = p_actor_id or m.participant_b = p_actor_id)
        and m.status <> 'dismissed'
        and w.status = 'published'
    ), '[]'::jsonb)
  );
$$;
create or replace function public.jw_internal_current_wave()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'theme', to_jsonb(t),
    'wishes', coalesce((
      select jsonb_agg(to_jsonb(w) order by tw.rank, w.live_ripple_count desc)
      from public.jw_theme_wishes tw
      join public.jw_wishes w on w.id = tw.wish_id
      where tw.theme_id = t.id and w.status = 'published'
    ), '[]'::jsonb),
    'report', (
      select to_jsonb(r)
      from public.jw_wave_reports r
      where r.theme_id = t.id and r.status = 'published'
      order by r.week_start desc
      limit 1
    )
  )
  from public.jw_themes t
  where t.status = 'published'
    and (t.starts_at is null or t.starts_at <= now())
    and (t.ends_at is null or t.ends_at >= now())
  order by t.created_at desc
  limit 1;
$$;
create or replace function public.jw_internal_upsert_push(
  p_actor_id uuid,
  p_endpoint text,
  p_subscription jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare v_hash text;
begin
  if char_length(coalesce(p_endpoint, '')) not between 20 and 2048
    or jsonb_typeof(p_subscription) <> 'object' then
    raise exception 'invalid_push_subscription' using errcode = '22023';
  end if;
  v_hash := encode(digest(p_endpoint, 'sha256'), 'hex');
  if not exists (
    select 1 from public.jw_push_subscriptions
    where owner_id = p_actor_id and endpoint_hash = v_hash
  ) and (
    select count(*) from public.jw_push_subscriptions
    where owner_id = p_actor_id and enabled
  ) >= 5 then
    raise exception 'rate_limit_exceeded' using errcode = 'P0001';
  end if;
  insert into public.jw_push_subscriptions (
    owner_id, endpoint_hash, subscription, enabled
  ) values (
    p_actor_id, v_hash, p_subscription, true
  )
  on conflict (owner_id, endpoint_hash) do update set
    subscription = excluded.subscription,
    enabled = true,
    last_error_code = null,
    updated_at = now();
  return true;
end;
$$;
create or replace function public.jw_internal_claim_echo(p_wish_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wish public.jw_wishes;
  v_latest public.jw_echoes;
  v_target integer;
  v_job public.jw_echo_jobs;
  v_true_count integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('generated-echo:' || p_wish_id::text, 0)
  );
  select * into v_wish
  from public.jw_wishes
  where id = p_wish_id and status = 'published'
  for update;
  if not found then return null; end if;

  select count(*)::integer into v_true_count
  from public.jw_ripples
  where wish_id = p_wish_id;
  if v_true_count < 5 then return null; end if;

  select * into v_latest
  from public.jw_echoes
  where wish_id = p_wish_id
    and echo_kind = 'generated_tide'
    and status = 'published'
  order by version desc
  limit 1;

  if found then
    if v_latest.generated_at > now() - interval '24 hours' then return null; end if;
    if v_true_count <= coalesce(v_latest.trigger_live_ripple_count, 0) then return null; end if;
    if v_true_count < 5 + coalesce(v_latest.version, 1) * 10
      and v_latest.generated_at > now() - interval '7 days' then return null; end if;
    v_target := coalesce(v_latest.version, 0) + 1;
  else
    v_target := 1;
  end if;

  insert into public.jw_echo_jobs (
    wish_id, target_version, trigger_count, status, attempts, lease_until
  ) values (
    p_wish_id,
    v_target,
    v_true_count,
    'running',
    1,
    now() + interval '2 minutes'
  )
  on conflict (wish_id, target_version) do nothing
  returning * into v_job;
  if v_job.id is null then return null; end if;

  return jsonb_build_object(
    'jobId', v_job.id,
    'version', v_target,
    'wish', jsonb_build_object(
      'id', v_wish.id,
      'destination', v_wish.destination,
      'wishText', v_wish.wish_text,
      'sea', v_wish.sea
    ),
    'counts', jsonb_build_object(
      'together', greatest(0, v_wish.together_count - v_wish.legacy_together_count),
      'been', v_wish.been_count,
      'reef', v_wish.reef_count,
      'bless', v_wish.bless_count,
      'total', v_true_count
    ),
    'reefNotes', coalesce((
      select jsonb_agg(r.note order by r.created_at desc)
      from public.jw_ripples r
      where r.wish_id = p_wish_id
        and r.ripple_type = 'reef'
        and r.note is not null
        and r.moderation_status = 'approved'
    ), '[]'::jsonb)
  );
end;
$$;
create or replace function public.jw_internal_complete_echo(
  p_job_id uuid,
  p_summary jsonb,
  p_prompt_version text,
  p_model_name text
)
returns public.jw_echoes
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_job public.jw_echo_jobs;
  v_echo public.jw_echoes;
begin
  if jsonb_typeof(p_summary) <> 'object'
    or jsonb_typeof(p_summary->'counts') <> 'object'
    or char_length(coalesce(p_summary->>'seaLetter', '')) > 80 then
    raise exception 'invalid_echo_summary' using errcode = '22023';
  end if;
  select * into v_job
  from public.jw_echo_jobs
  where id = p_job_id and status = 'running'
  for update;
  if not found then raise exception 'echo_job_not_claimed' using errcode = 'P0001'; end if;

  insert into public.jw_echoes (
    slug, wish_id, permission, body, status, echo_kind, version, summary,
    trigger_live_ripple_count, prompt_version, model_name, generated_at
  ) values (
    lower(encode(gen_random_bytes(6), 'hex')),
    v_job.wish_id,
    'bless',
    nullif(btrim(coalesce(p_summary->>'seaLetter', '')), ''),
    'published',
    'generated_tide',
    v_job.target_version,
    p_summary,
    v_job.trigger_count,
    nullif(p_prompt_version, ''),
    nullif(p_model_name, ''),
    now()
  )
  returning * into v_echo;

  update public.jw_wishes set
    echo_version = v_job.target_version,
    last_echo_at = now()
  where id = v_job.wish_id and status = 'published';

  update public.jw_echo_jobs set
    status = 'completed',
    finished_at = now(),
    lease_until = null
  where id = p_job_id;
  return v_echo;
end;
$$;
create or replace function public.jw_internal_fail_echo(
  p_job_id uuid,
  p_error_code text
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.jw_echo_jobs set
    status = 'failed',
    last_error_code = left(coalesce(p_error_code, 'unknown'), 80),
    not_before = now() + interval '1 hour',
    lease_until = null
  where id = p_job_id and status = 'running';
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
declare v_id bigint;
begin
  if p_event_name not in (
    'landing_view', 'first_draw', 'first_ripple', 'throw_start', 'throw_done',
    'share_click', 'share_landing_view', 'share_landing_ripple',
    'notify_prompt', 'notify_grant', 'tide_open', 'echo_view'
  ) then
    raise exception 'invalid_event_name' using errcode = '22023';
  end if;
  if char_length(p_session_id) not between 8 and 80
    or octet_length(coalesce(p_properties, '{}'::jsonb)::text) > 4096 then
    raise exception 'invalid_event_payload' using errcode = '22023';
  end if;
  perform public.jw_internal_assert_usage(p_actor_id, p_ip_hash, 'events');
  insert into public.jw_analytics_events (
    actor_id, session_id, event_name, wish_id, properties
  ) values (
    p_actor_id,
    p_session_id,
    p_event_name,
    p_wish_id,
    coalesce(p_properties, '{}'::jsonb)
  ) returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.jw_internal_draw_v2(uuid, text, uuid[]) from public, anon, authenticated;
revoke all on function public.jw_internal_wish_detail(uuid, text) from public, anon, authenticated;
revoke all on function public.jw_internal_refresh_tides(uuid) from public, anon, authenticated;
revoke all on function public.jw_internal_open_tide(uuid, uuid) from public, anon, authenticated;
revoke all on function public.jw_internal_voyage_map(uuid) from public, anon, authenticated;
revoke all on function public.jw_internal_current_wave() from public, anon, authenticated;
revoke all on function public.jw_internal_upsert_push(uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.jw_internal_claim_echo(uuid) from public, anon, authenticated;
revoke all on function public.jw_internal_complete_echo(uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.jw_internal_fail_echo(uuid, text) from public, anon, authenticated;
grant execute on function public.jw_internal_draw_v2(uuid, text, uuid[]) to service_role;
grant execute on function public.jw_internal_wish_detail(uuid, text) to service_role;
grant execute on function public.jw_internal_refresh_tides(uuid) to service_role;
grant execute on function public.jw_internal_open_tide(uuid, uuid) to service_role;
grant execute on function public.jw_internal_voyage_map(uuid) to service_role;
grant execute on function public.jw_internal_current_wave() to service_role;
grant execute on function public.jw_internal_upsert_push(uuid, text, jsonb) to service_role;
grant execute on function public.jw_internal_claim_echo(uuid) to service_role;
grant execute on function public.jw_internal_complete_echo(uuid, jsonb, text, text) to service_role;
grant execute on function public.jw_internal_fail_echo(uuid, text) to service_role;
commit;
