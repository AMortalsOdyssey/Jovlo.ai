begin;

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists postgis with schema extensions;

create schema if not exists jovlo_private;
revoke all on schema jovlo_private from public;
revoke all on schema jovlo_private from anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trips (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 160),
  status text not null default 'draft' check (status in ('draft', 'active', 'completed', 'archived')),
  timezone text not null default 'Asia/Shanghai',
  current_version_id uuid,
  current_draft_id uuid,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.stay_anchor_areas (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  name text not null check (char_length(name) between 1 and 160),
  region text not null,
  location_wgs84 extensions.geography(Point, 4326) not null,
  gcj02_lon double precision not null check (gcj02_lon between -180 and 180),
  gcj02_lat double precision not null check (gcj02_lat between -90 and 90),
  price_reference jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  booking_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint stay_anchor_area_visibility_owner check (
    (visibility = 'public' and owner_id is null)
    or (visibility = 'private' and owner_id is not null)
  )
);

create table public.places (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete cascade,
  visibility text not null default 'public' check (visibility in ('public', 'private')),
  status text not null default 'active' check (status in ('active', 'unverified', 'retired')),
  name text not null check (char_length(name) between 1 and 160),
  type text not null,
  address text,
  location_wgs84 extensions.geography(Point, 4326) not null,
  gcj02_lon double precision not null check (gcj02_lon between -180 and 180),
  gcj02_lat double precision not null check (gcj02_lat between -90 and 90),
  source_crs text not null default 'WGS84' check (source_crs in ('WGS84', 'GCJ02')),
  region text,
  tags text[] not null default '{}',
  catalog_revision bigint not null default 1 check (catalog_revision > 0),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_visibility_owner check (
    (visibility = 'public' and owner_id is null and trip_id is null)
    or (visibility = 'private' and owner_id is not null)
  )
);

create table public.place_variants (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  kind text not null,
  price_range jsonb,
  stay_minutes integer check (stay_minutes between 5 and 720),
  parking text,
  opening_hours jsonb,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.source_groups (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  canonical_group_hash text not null unique,
  created_at timestamptz not null default now()
);

create table public.sources (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete cascade,
  change_set_id uuid,
  source_ref text,
  source_group_id uuid references public.source_groups(id) on delete set null,
  scope text not null check (scope in ('catalog_public', 'trip_private')),
  platform text not null,
  canonical_url text not null check (canonical_url ~ '^https://'),
  title text not null,
  author text,
  published_at date,
  captured_at timestamptz not null default now(),
  summary text not null check (char_length(summary) between 1 and 1200),
  content_hash text,
  commercial_relationship text check (commercial_relationship in ('yes', 'no', 'unknown')),
  withdrawn_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint source_scope_owner check (
    (scope = 'catalog_public' and owner_id is null and trip_id is null)
    or (scope = 'trip_private' and owner_id is not null and trip_id is not null)
  )
);

create table public.route_templates (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  slug text not null,
  version integer not null check (version > 0),
  days integer not null check (days between 1 and 30),
  corridor_geojson jsonb not null,
  skeleton_json jsonb not null,
  tags text[] not null default '{}',
  status text not null check (status in ('draft', 'verified', 'retired')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (slug, version)
);

create table public.trip_drafts (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  trip_id uuid not null unique references public.trips(id) on delete cascade,
  base_version_id uuid,
  snapshot jsonb not null,
  revision bigint not null default 0 check (revision >= 0),
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now()
);

create table public.trip_versions (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  version_no integer not null check (version_no > 0),
  parent_version_id uuid references public.trip_versions(id) on delete restrict,
  source text not null check (source in ('manual', 'changeset', 'restore', 'template')),
  message text not null check (char_length(message) between 1 and 500),
  snapshot jsonb not null,
  snapshot_hash text not null,
  derived_snapshot jsonb not null,
  derived_hash text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique (trip_id, version_no)
);

alter table public.trip_drafts
  add constraint trip_drafts_base_version_fk
  foreign key (base_version_id) references public.trip_versions(id) on delete restrict;

alter table public.trips
  add constraint trips_current_version_fk
  foreign key (current_version_id) references public.trip_versions(id) on delete restrict deferrable initially deferred,
  add constraint trips_current_draft_fk
  foreign key (current_draft_id) references public.trip_drafts(id) on delete restrict deferrable initially deferred;

create table public.place_claims (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  trip_id uuid references public.trips(id) on delete cascade,
  owner_id uuid references auth.users(id) on delete cascade,
  scope text not null check (scope in ('catalog_public', 'trip_private')),
  field text not null,
  value_json jsonb not null,
  evidence_status text not null default 'single_source' check (
    evidence_status in ('official', 'corroborated', 'single_source', 'conflicting', 'stale', 'excluded')
  ),
  review_status text not null default 'pending' check (review_status in ('pending', 'approved', 'rejected')),
  reason text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint place_claim_scope_owner check (
    (scope = 'catalog_public' and owner_id is null and trip_id is null)
    or (scope = 'trip_private' and owner_id is not null and trip_id is not null)
  )
);

create table public.change_sets (
  id uuid primary key,
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  base_version_id uuid not null references public.trip_versions(id) on delete restrict,
  payload_idempotency_key text not null,
  payload jsonb not null,
  payload_hash text not null,
  status text not null default 'uploaded' check (
    status in ('uploaded', 'validating', 'stale', 'conflict', 'ready', 'applying', 'applied', 'failed', 'rejected')
  ),
  selected_group_ids text[] not null default '{}',
  prepared_snapshot jsonb,
  prepared_derived_snapshot jsonb,
  prepared_draft_hash text,
  prepared_input_hash text,
  prepared_hash text,
  prepared_side_effects jsonb,
  prepared_at timestamptz,
  prepared_expires_at timestamptz,
  applied_version_id uuid references public.trip_versions(id) on delete restrict,
  derived_from_change_set_id uuid references public.change_sets(id) on delete restrict,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, payload_idempotency_key)
);

alter table public.sources
  add constraint sources_change_set_fk
  foreign key (change_set_id) references public.change_sets(id) on delete set null;

create table public.change_set_sources (
  change_set_id uuid not null references public.change_sets(id) on delete cascade,
  source_id uuid not null references public.sources(id) on delete cascade,
  primary key (change_set_id, source_id)
);

create table public.place_proposals (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  change_set_id uuid not null references public.change_sets(id) on delete cascade,
  proposal_group_id text not null,
  proposal_ref text not null,
  original_name text not null,
  original_address text,
  original_coordinate jsonb,
  source_crs text check (source_crs in ('WGS84', 'GCJ02')),
  candidate_matches jsonb not null default '[]'::jsonb,
  resolution_status text not null default 'unresolved' check (
    resolution_status in ('unresolved', 'matched', 'private_created', 'rejected')
  ),
  resolved_place_id uuid references public.places(id) on delete restrict,
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (change_set_id, proposal_ref)
);

create table public.route_segment_cache (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  input_hash text not null unique,
  provider text not null,
  strategy text not null,
  normalized_result jsonb not null,
  calculated_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  day_id uuid,
  stop_id uuid,
  category text not null check (
    category in ('lodging', 'meals', 'fuel_charging_tolls', 'tickets_activities', 'parking', 'transport', 'other')
  ),
  amount numeric(12,2) not null check (amount > 0),
  currency text not null default 'CNY' check (currency = 'CNY'),
  occurred_on date not null,
  note text,
  receipt_asset_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trip_actuals (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_version_id uuid not null references public.trip_versions(id) on delete restrict,
  day_id uuid not null,
  stop_id uuid,
  status text not null check (status in ('visited', 'skipped')),
  rating integer check (rating between 1 and 5),
  note text,
  actual_start_at timestamptz,
  actual_end_at timestamptz,
  orphaned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (trip_id, day_id, stop_id)
);

create table public.expense_snapshots (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  snapshot jsonb not null,
  summary jsonb not null,
  snapshot_hash text not null,
  created_at timestamptz not null default now()
);

create table public.actual_snapshots (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  snapshot jsonb not null,
  summary jsonb not null,
  snapshot_hash text not null,
  created_at timestamptz not null default now()
);

create table public.report_generations (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  version_id uuid not null references public.trip_versions(id) on delete restrict,
  expense_snapshot_id uuid not null references public.expense_snapshots(id) on delete restrict,
  actual_snapshot_id uuid not null references public.actual_snapshots(id) on delete restrict,
  report_type text not null check (report_type in ('plan', 'actual')),
  status text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'revoked')),
  output_key text,
  config jsonb not null default '{}'::jsonb,
  config_hash text not null,
  error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.trip_publications (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  target_kind text not null check (target_kind in ('version', 'report')),
  version_id uuid references public.trip_versions(id) on delete restrict,
  report_id uuid references public.report_generations(id) on delete restrict,
  token_hash text not null unique,
  disclosure_config jsonb not null default '{}'::jsonb,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publication_exactly_one_target check (
    (target_kind = 'version' and version_id is not null and report_id is null)
    or (target_kind = 'report' and report_id is not null and version_id is null)
  )
);

create table public.asset_licenses (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  object_key text not null unique,
  source text not null,
  author text,
  license text not null,
  proof_url text,
  allowed_uses text[] not null default '{}',
  takedown_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.audit_events (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  owner_id uuid,
  trip_id uuid,
  actor_id uuid,
  operation_scope text not null,
  entity_id uuid,
  request_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.mutation_idempotency (
  owner_id uuid not null references auth.users(id) on delete cascade,
  operation_scope text not null,
  idempotency_key text not null,
  request_hash text not null,
  response_json jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (owner_id, operation_scope, idempotency_key),
  check (char_length(idempotency_key) between 8 and 160)
);

create index trips_owner_updated_idx on public.trips (owner_id, updated_at desc) where deleted_at is null;
create index places_location_wgs84_gist on public.places using gist (location_wgs84);
create index stay_anchor_areas_location_gist on public.stay_anchor_areas using gist (location_wgs84);
create index places_owner_trip_idx on public.places (owner_id, trip_id) where visibility = 'private';
create unique index sources_private_url_unique on public.sources (owner_id, trip_id, canonical_url)
  where scope = 'trip_private' and withdrawn_at is null;
create unique index sources_public_url_unique on public.sources (canonical_url)
  where scope = 'catalog_public' and withdrawn_at is null;
create unique index sources_change_ref_unique on public.sources (change_set_id, source_ref)
  where change_set_id is not null and source_ref is not null;
create index place_claims_place_field_idx on public.place_claims (place_id, field, review_status);
create index trip_versions_trip_no_desc_idx on public.trip_versions (trip_id, version_no desc);
create index change_sets_trip_status_idx on public.change_sets (trip_id, status, updated_at desc);
create index place_proposals_change_status_idx on public.place_proposals (change_set_id, resolution_status);
create index expenses_trip_date_category_idx on public.expenses (trip_id, occurred_on, category);
create index actuals_trip_source_version_idx on public.trip_actuals (trip_id, source_version_id);
create index reports_trip_created_idx on public.report_generations (trip_id, created_at desc);
create index publications_trip_active_idx on public.trip_publications (trip_id, created_at desc) where revoked_at is null;
create index audit_events_trip_created_idx on public.audit_events (trip_id, created_at desc);

create or replace function jovlo_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at before update on public.profiles
for each row execute function jovlo_private.touch_updated_at();
create trigger trips_touch_updated_at before update on public.trips
for each row execute function jovlo_private.touch_updated_at();
create trigger stay_areas_touch_updated_at before update on public.stay_anchor_areas
for each row execute function jovlo_private.touch_updated_at();
create trigger places_touch_updated_at before update on public.places
for each row execute function jovlo_private.touch_updated_at();
create trigger place_variants_touch_updated_at before update on public.place_variants
for each row execute function jovlo_private.touch_updated_at();
create trigger sources_touch_updated_at before update on public.sources
for each row execute function jovlo_private.touch_updated_at();
create trigger claims_touch_updated_at before update on public.place_claims
for each row execute function jovlo_private.touch_updated_at();
create trigger changesets_touch_updated_at before update on public.change_sets
for each row execute function jovlo_private.touch_updated_at();
create trigger proposals_touch_updated_at before update on public.place_proposals
for each row execute function jovlo_private.touch_updated_at();
create trigger expenses_touch_updated_at before update on public.expenses
for each row execute function jovlo_private.touch_updated_at();
create trigger actuals_touch_updated_at before update on public.trip_actuals
for each row execute function jovlo_private.touch_updated_at();
create trigger reports_touch_updated_at before update on public.report_generations
for each row execute function jovlo_private.touch_updated_at();
create trigger publications_touch_updated_at before update on public.trip_publications
for each row execute function jovlo_private.touch_updated_at();

create or replace function jovlo_private.guard_trip_version_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_catalog.current_setting('jovlo.audit_version_delete', true) = 'on'
     and session_user in ('postgres', 'service_role') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception using
    errcode = 'P0001',
    message = 'JOVLO:IMMUTABLE_VERSION:published versions cannot be updated or deleted';
end;
$$;

create trigger trip_versions_immutable
before update or delete on public.trip_versions
for each row execute function jovlo_private.guard_trip_version_immutable();

create or replace function jovlo_private.require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception using errcode = 'P0001', message = 'JOVLO:AUTH_REQUIRED';
  end if;
  return v_user_id;
end;
$$;

create or replace function jovlo_private.sha256_json(p_value jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select pg_catalog.encode(
    extensions.digest(pg_catalog.convert_to(coalesce(p_value, 'null'::jsonb)::text, 'UTF8'), 'sha256'),
    'hex'
  );
$$;

create or replace function jovlo_private.begin_mutation(
  p_owner_id uuid,
  p_operation_scope text,
  p_idempotency_key text,
  p_request jsonb
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_request_hash text := jovlo_private.sha256_json(p_request);
  v_stored_hash text;
  v_response jsonb;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 160 then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid idempotency key';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_owner_id::text || ':' || p_operation_scope || ':' || p_idempotency_key,
      0
    )
  );

  select item.request_hash, item.response_json
    into v_stored_hash, v_response
  from public.mutation_idempotency as item
  where item.owner_id = p_owner_id
    and item.operation_scope = p_operation_scope
    and item.idempotency_key = p_idempotency_key;

  if found then
    if v_stored_hash <> v_request_hash then
      raise exception using errcode = 'P0001', message = 'JOVLO:IDEMPOTENCY_KEY_REUSED';
    end if;
    if v_response is null then
      raise exception using errcode = 'P0001', message = 'JOVLO:INTERNAL_ERROR:incomplete idempotency record';
    end if;
    return v_response;
  end if;

  insert into public.mutation_idempotency (
    owner_id, operation_scope, idempotency_key, request_hash
  ) values (
    p_owner_id, p_operation_scope, p_idempotency_key, v_request_hash
  );
  return null;
end;
$$;

create or replace function jovlo_private.complete_mutation(
  p_owner_id uuid,
  p_operation_scope text,
  p_idempotency_key text,
  p_response jsonb
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.mutation_idempotency
  set response_json = p_response,
      completed_at = now()
  where owner_id = p_owner_id
    and operation_scope = p_operation_scope
    and idempotency_key = p_idempotency_key;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:INTERNAL_ERROR:missing idempotency record';
  end if;
end;
$$;

create or replace function jovlo_private.assert_snapshot_v1(p_trip_id uuid, p_snapshot jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_day_count integer;
  v_intent_days integer;
begin
  if pg_catalog.jsonb_typeof(p_snapshot) <> 'object'
     or coalesce((p_snapshot ->> 'schemaVersion')::integer, 0) <> 1
     or (p_snapshot ->> 'tripId')::uuid <> p_trip_id
     or pg_catalog.jsonb_typeof(p_snapshot -> 'days') <> 'array'
     or pg_catalog.jsonb_typeof(p_snapshot -> 'placeRefs') <> 'object'
     or pg_catalog.jsonb_typeof(p_snapshot -> 'sourceRefs') <> 'object'
     or pg_catalog.jsonb_typeof(p_snapshot -> 'stayAreaRefs') <> 'object' then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid TripSnapshotV1 envelope';
  end if;

  select count(*)::integer into v_day_count
  from pg_catalog.jsonb_array_elements(p_snapshot -> 'days');
  v_intent_days := (p_snapshot #>> '{intent,days}')::integer;
  if v_day_count < 1 or v_day_count <> v_intent_days then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:day count mismatch';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_snapshot -> 'days') with ordinality as d(value, ordinal)
    where (d.value ->> 'dayIndex')::integer <> d.ordinal::integer
  ) then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:dayIndex must be contiguous';
  end if;

  if exists (
    select 1
    from (
      select s.value ->> 'id' as stop_id, count(*)
      from pg_catalog.jsonb_array_elements(p_snapshot -> 'days') as d(value)
      cross join lateral pg_catalog.jsonb_array_elements(d.value -> 'stops') as s(value)
      group by s.value ->> 'id'
      having count(*) > 1
    ) duplicates
  ) then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:duplicate stop id';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_snapshot -> 'days') as d(value)
    cross join lateral pg_catalog.jsonb_array_elements(d.value -> 'stops') as s(value)
    where not ((p_snapshot -> 'placeRefs') ? (s.value ->> 'placeId'))
  ) then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:stop place reference missing';
  end if;

  if not ((p_snapshot -> 'placeRefs') ? (p_snapshot #>> '{intent,entryAnchor,placeId}'))
     or not ((p_snapshot -> 'placeRefs') ? (p_snapshot #>> '{intent,exitAnchor,placeId}')) then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:entry or exit reference missing';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_snapshot -> 'days') with ordinality as d(value, ordinal)
    where d.ordinal < v_day_count and not (d.value ? 'overnightStay')
  ) then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:overnight anchor missing';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_snapshot -> 'days') as d(value)
    where d.value ? 'overnightStay'
      and (
        ((d.value #>> '{overnightStay,kind}') = 'place'
          and not ((p_snapshot -> 'placeRefs') ? (d.value #>> '{overnightStay,placeId}')))
        or ((d.value #>> '{overnightStay,kind}') = 'area'
          and not ((p_snapshot -> 'stayAreaRefs') ? (d.value #>> '{overnightStay,areaId}')))
        or (d.value #>> '{overnightStay,kind}') not in ('place', 'area')
      )
  ) then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid overnight anchor';
  end if;
end;
$$;

create or replace function public.create_trip(
  p_title text,
  p_snapshot jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_trip_id uuid;
  v_draft_id uuid := pg_catalog.gen_random_uuid();
  v_scope text := 'create_trip';
  v_replay jsonb;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object('title', p_title, 'snapshot', p_snapshot)
  );
  if v_replay is not null then return v_replay; end if;

  if p_title is null or char_length(trim(p_title)) not between 1 and 160 then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid title';
  end if;
  begin
    v_trip_id := (p_snapshot ->> 'tripId')::uuid;
  exception when others then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid tripId';
  end;
  perform jovlo_private.assert_snapshot_v1(v_trip_id, p_snapshot);

  insert into public.trips (id, owner_id, title, status)
  values (v_trip_id, v_owner_id, trim(p_title), 'draft');

  insert into public.trip_drafts (id, trip_id, base_version_id, snapshot, revision, updated_by)
  values (v_draft_id, v_trip_id, null, p_snapshot, 0, v_owner_id);

  update public.trips set current_draft_id = v_draft_id where id = v_trip_id;

  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id)
  values (v_owner_id, v_trip_id, v_owner_id, v_scope, v_trip_id);

  v_response := pg_catalog.jsonb_build_object(
    'tripId', v_trip_id,
    'draftId', v_draft_id,
    'revision', 0,
    'currentVersionId', null
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.save_draft(
  p_trip_id uuid,
  p_expected_revision bigint,
  p_snapshot jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'save_draft:' || p_trip_id::text;
  v_replay jsonb;
  v_revision bigint;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'tripId', p_trip_id,
      'expectedRevision', p_expected_revision,
      'snapshot', p_snapshot
    )
  );
  if v_replay is not null then return v_replay; end if;

  perform 1
  from public.trips as trip
  where trip.id = p_trip_id and trip.owner_id = v_owner_id and trip.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;

  perform jovlo_private.assert_snapshot_v1(p_trip_id, p_snapshot);
  update public.trip_drafts
  set snapshot = p_snapshot,
      revision = revision + 1,
      updated_by = v_owner_id,
      updated_at = now()
  where trip_id = p_trip_id and revision = p_expected_revision
  returning revision into v_revision;

  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:DRAFT_REVISION_STALE';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'tripId', p_trip_id,
    'revision', v_revision,
    'snapshotHash', jovlo_private.sha256_json(p_snapshot)
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.publish_trip_version(
  p_trip_id uuid,
  p_base_version_id uuid,
  p_draft_revision bigint,
  p_snapshot jsonb,
  p_derived_snapshot jsonb,
  p_message text,
  p_source text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'publish_trip_version:' || p_trip_id::text;
  v_replay jsonb;
  v_current_version_id uuid;
  v_draft_id uuid;
  v_draft_revision bigint;
  v_draft_snapshot jsonb;
  v_version_id uuid := pg_catalog.gen_random_uuid();
  v_version_no integer;
  v_snapshot_hash text;
  v_derived_hash text;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'tripId', p_trip_id,
      'baseVersionId', p_base_version_id,
      'draftRevision', p_draft_revision,
      'snapshot', p_snapshot,
      'derivedSnapshot', p_derived_snapshot,
      'message', p_message,
      'source', p_source
    )
  );
  if v_replay is not null then return v_replay; end if;

  select trip.current_version_id, draft.id, draft.revision, draft.snapshot
    into v_current_version_id, v_draft_id, v_draft_revision, v_draft_snapshot
  from public.trips as trip
  join public.trip_drafts as draft on draft.id = trip.current_draft_id
  where trip.id = p_trip_id
    and trip.owner_id = v_owner_id
    and trip.deleted_at is null
  for update of trip, draft;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;
  if v_current_version_id is distinct from p_base_version_id then
    raise exception using errcode = 'P0001', message = 'JOVLO:BASE_VERSION_STALE';
  end if;
  if v_draft_revision <> p_draft_revision then
    raise exception using errcode = 'P0001', message = 'JOVLO:DRAFT_REVISION_STALE';
  end if;
  if p_source not in ('manual', 'changeset', 'restore', 'template') then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid version source';
  end if;
  if p_message is null or char_length(trim(p_message)) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid version message';
  end if;
  if pg_catalog.jsonb_typeof(p_derived_snapshot) <> 'object' then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid derived snapshot';
  end if;
  perform jovlo_private.assert_snapshot_v1(p_trip_id, p_snapshot);
  if jovlo_private.sha256_json(v_draft_snapshot) <> jovlo_private.sha256_json(p_snapshot) then
    raise exception using errcode = 'P0001', message = 'JOVLO:DRAFT_REVISION_STALE:snapshot does not match locked draft';
  end if;

  v_snapshot_hash := jovlo_private.sha256_json(p_snapshot);
  v_derived_hash := jovlo_private.sha256_json(p_derived_snapshot);
  select coalesce(max(version.version_no), 0) + 1
    into v_version_no
  from public.trip_versions as version
  where version.trip_id = p_trip_id;

  insert into public.trip_versions (
    id, trip_id, version_no, parent_version_id, source, message,
    snapshot, snapshot_hash, derived_snapshot, derived_hash, created_by
  ) values (
    v_version_id, p_trip_id, v_version_no, v_current_version_id, p_source, trim(p_message),
    p_snapshot, v_snapshot_hash, p_derived_snapshot, v_derived_hash, v_owner_id
  );

  update public.trips
  set current_version_id = v_version_id,
      status = case when status = 'draft' then 'active' else status end
  where id = p_trip_id and current_version_id is not distinct from p_base_version_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:BASE_VERSION_STALE';
  end if;

  update public.trip_drafts
  set base_version_id = v_version_id,
      snapshot = p_snapshot,
      revision = revision + 1,
      updated_by = v_owner_id,
      updated_at = now()
  where id = v_draft_id and revision = p_draft_revision;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:DRAFT_REVISION_STALE';
  end if;

  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id, metadata)
  values (
    v_owner_id, p_trip_id, v_owner_id, v_scope, v_version_id,
    pg_catalog.jsonb_build_object('versionNo', v_version_no, 'source', p_source)
  );

  v_response := pg_catalog.jsonb_build_object(
    'tripId', p_trip_id,
    'versionId', v_version_id,
    'versionNo', v_version_no,
    'snapshotHash', v_snapshot_hash,
    'derivedHash', v_derived_hash,
    'draftRevision', p_draft_revision + 1
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.upload_change_set(
  p_trip_id uuid,
  p_payload jsonb,
  p_base_version_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'upload_change_set:' || p_trip_id::text;
  v_replay jsonb;
  v_change_set_id uuid;
  v_current_version_id uuid;
  v_draft_base_version_id uuid;
  v_draft_snapshot jsonb;
  v_head_hash text;
  v_group jsonb;
  v_operation jsonb;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'tripId', p_trip_id,
      'payload', p_payload,
      'baseVersionId', p_base_version_id
    )
  );
  if v_replay is not null then return v_replay; end if;

  if pg_catalog.jsonb_typeof(p_payload) <> 'object'
     or coalesce((p_payload ->> 'schemaVersion')::integer, 0) <> 1
     or (p_payload ->> 'tripId')::uuid <> p_trip_id
     or (p_payload ->> 'baseVersionId')::uuid <> p_base_version_id
     or (p_payload ->> 'idempotencyKey') is distinct from p_idempotency_key then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_INVALID';
  end if;
  v_change_set_id := (p_payload ->> 'changeSetId')::uuid;

  select trip.current_version_id, draft.base_version_id, draft.snapshot, head.snapshot_hash
    into v_current_version_id, v_draft_base_version_id, v_draft_snapshot, v_head_hash
  from public.trips as trip
  join public.trip_drafts as draft on draft.id = trip.current_draft_id
  join public.trip_versions as head on head.id = trip.current_version_id
  where trip.id = p_trip_id
    and trip.owner_id = v_owner_id
    and trip.deleted_at is null
  for update of trip, draft;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;
  if v_current_version_id <> p_base_version_id then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_STALE';
  end if;
  if v_draft_base_version_id <> v_current_version_id
     or jovlo_private.sha256_json(v_draft_snapshot) <> v_head_hash then
    raise exception using errcode = 'P0001', message = 'JOVLO:DIRTY_DRAFT_REQUIRES_CHECKPOINT';
  end if;

  insert into public.change_sets (
    id, trip_id, owner_id, base_version_id, payload_idempotency_key,
    payload, payload_hash, status
  ) values (
    v_change_set_id, p_trip_id, v_owner_id, p_base_version_id, p_idempotency_key,
    p_payload, jovlo_private.sha256_json(p_payload), 'uploaded'
  );

  for v_group in
    select item.value from pg_catalog.jsonb_array_elements(p_payload -> 'proposalGroups') as item(value)
  loop
    for v_operation in
      select item.value from pg_catalog.jsonb_array_elements(v_group -> 'operations') as item(value)
    loop
      if v_operation ->> 'type' = 'PROPOSE_PLACE' then
        insert into public.place_proposals (
          change_set_id, proposal_group_id, proposal_ref, original_name,
          original_address, original_coordinate, source_crs
        ) values (
          v_change_set_id,
          v_group ->> 'groupId',
          v_operation ->> 'proposalRef',
          v_operation ->> 'name',
          v_operation ->> 'address',
          v_operation -> 'coordinate',
          v_operation #>> '{coordinate,crs}'
        );
      end if;
    end loop;
  end loop;

  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id)
  values (v_owner_id, p_trip_id, v_owner_id, v_scope, v_change_set_id);

  v_response := pg_catalog.jsonb_build_object(
    'changeSetId', v_change_set_id,
    'tripId', p_trip_id,
    'baseVersionId', p_base_version_id,
    'status', 'uploaded'
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_INVALID';
end;
$$;

create or replace function public.prepare_change_set(
  p_change_set_id uuid,
  p_base_version_id uuid,
  p_selected_group_ids text[],
  p_candidate_snapshot jsonb,
  p_derived_snapshot jsonb,
  p_draft_hash text,
  p_prepared_hash text,
  p_prepared_side_effects jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'prepare_change_set:' || p_change_set_id::text;
  v_replay jsonb;
  v_trip_id uuid;
  v_status text;
  v_change_base uuid;
  v_payload jsonb;
  v_expected_groups jsonb;
  v_current_version_id uuid;
  v_draft_base_version_id uuid;
  v_draft_snapshot jsonb;
  v_head_hash text;
  v_db_draft_hash text;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'changeSetId', p_change_set_id,
      'baseVersionId', p_base_version_id,
      'selectedGroupIds', p_selected_group_ids,
      'candidateSnapshot', p_candidate_snapshot,
      'derivedSnapshot', p_derived_snapshot,
      'draftHash', p_draft_hash,
      'preparedHash', p_prepared_hash,
      'preparedSideEffects', p_prepared_side_effects
    )
  );
  if v_replay is not null then return v_replay; end if;

  select change_set.trip_id, change_set.status, change_set.base_version_id, change_set.payload,
         trip.current_version_id, draft.base_version_id, draft.snapshot, head.snapshot_hash
    into v_trip_id, v_status, v_change_base, v_payload,
         v_current_version_id, v_draft_base_version_id, v_draft_snapshot, v_head_hash
  from public.change_sets as change_set
  join public.trips as trip on trip.id = change_set.trip_id
  join public.trip_drafts as draft on draft.id = trip.current_draft_id
  join public.trip_versions as head on head.id = trip.current_version_id
  where change_set.id = p_change_set_id
    and change_set.owner_id = v_owner_id
    and trip.owner_id = v_owner_id
    and trip.deleted_at is null
  for update of change_set, trip, draft;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;
  if v_status not in ('uploaded', 'validating', 'stale', 'conflict', 'ready') then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_CONFLICT:invalid state';
  end if;
  if v_change_base <> p_base_version_id or v_current_version_id <> p_base_version_id then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_STALE';
  end if;
  if v_draft_base_version_id <> v_current_version_id
     or jovlo_private.sha256_json(v_draft_snapshot) <> v_head_hash then
    raise exception using errcode = 'P0001', message = 'JOVLO:DIRTY_DRAFT_REQUIRES_CHECKPOINT';
  end if;
  if coalesce(pg_catalog.array_length(p_selected_group_ids, 1), 0) = 0 then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_INVALID:no groups selected';
  end if;
  if p_prepared_hash !~ '^sha256:[0-9a-f]{64}$'
     or pg_catalog.jsonb_typeof(p_derived_snapshot) <> 'object'
     or pg_catalog.jsonb_typeof(p_prepared_side_effects) <> 'object' then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_INVALID:invalid prepared payload';
  end if;

  if exists (
    select 1
    from unnest(p_selected_group_ids) as selected(group_id)
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_payload -> 'proposalGroups') as original(value)
      where original.value ->> 'groupId' = selected.group_id
    )
  ) then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_INVALID:selected group not in uploaded payload';
  end if;

  select coalesce(pg_catalog.jsonb_agg(original.value order by original.ordinal), '[]'::jsonb)
    into v_expected_groups
  from pg_catalog.jsonb_array_elements(v_payload -> 'proposalGroups') with ordinality as original(value, ordinal)
  where original.value ->> 'groupId' = any(p_selected_group_ids);
  if coalesce(p_prepared_side_effects -> 'selectedGroups', '[]'::jsonb) <> v_expected_groups then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_INVALID:prepared groups differ from upload';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(
      coalesce(p_prepared_side_effects -> 'sources', '[]'::jsonb)
    ) as prepared(value)
    where not exists (
      select 1
      from pg_catalog.jsonb_array_elements(v_payload -> 'sources') as original(value)
      where original.value = prepared.value - 'sourceId' - 'persist'
    )
      or not ((prepared.value ->> 'sourceId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      or (
        not coalesce((prepared.value ->> 'persist')::boolean, true)
        and not exists (
          select 1 from public.sources as source
          where source.id = (prepared.value ->> 'sourceId')::uuid
            and (source.scope = 'catalog_public' or source.owner_id = v_owner_id)
        )
      )
  ) then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_INVALID:invalid prepared sources';
  end if;
  perform jovlo_private.assert_snapshot_v1(v_trip_id, p_candidate_snapshot);
  v_db_draft_hash := jovlo_private.sha256_json(v_draft_snapshot);

  update public.change_sets
  set status = 'ready',
      selected_group_ids = p_selected_group_ids,
      prepared_snapshot = p_candidate_snapshot,
      prepared_derived_snapshot = p_derived_snapshot,
      prepared_draft_hash = v_db_draft_hash,
      prepared_input_hash = p_draft_hash,
      prepared_hash = p_prepared_hash,
      prepared_side_effects = p_prepared_side_effects,
      prepared_at = now(),
      prepared_expires_at = now() + interval '15 minutes',
      failure_code = null
  where id = p_change_set_id;

  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id, metadata)
  values (
    v_owner_id, v_trip_id, v_owner_id, v_scope, p_change_set_id,
    pg_catalog.jsonb_build_object('selectedGroupIds', p_selected_group_ids)
  );

  v_response := pg_catalog.jsonb_build_object(
    'changeSetId', p_change_set_id,
    'status', 'ready',
    'preparedHash', p_prepared_hash,
    'preparedExpiresAt', now() + interval '15 minutes'
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.apply_change_set(
  p_change_set_id uuid,
  p_prepared_hash text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'apply_change_set:' || p_change_set_id::text;
  v_replay jsonb;
  v_change_set public.change_sets%rowtype;
  v_current_version_id uuid;
  v_draft_id uuid;
  v_draft_base_version_id uuid;
  v_draft_revision bigint;
  v_draft_snapshot jsonb;
  v_version_id uuid := pg_catalog.gen_random_uuid();
  v_version_no integer;
  v_snapshot_hash text;
  v_derived_hash text;
  v_source jsonb;
  v_group jsonb;
  v_operation jsonb;
  v_source_ref text;
  v_source_id uuid;
  v_place_id uuid;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'changeSetId', p_change_set_id,
      'preparedHash', p_prepared_hash
    )
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_change_set
  from public.change_sets as change_set
  where change_set.id = p_change_set_id and change_set.owner_id = v_owner_id
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;

  select trip.current_version_id, draft.id, draft.base_version_id, draft.revision, draft.snapshot
    into v_current_version_id, v_draft_id, v_draft_base_version_id, v_draft_revision, v_draft_snapshot
  from public.trips as trip
  join public.trip_drafts as draft on draft.id = trip.current_draft_id
  where trip.id = v_change_set.trip_id
    and trip.owner_id = v_owner_id
    and trip.deleted_at is null
  for update of trip, draft;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;

  if v_change_set.status <> 'ready'
     or v_change_set.prepared_hash is distinct from p_prepared_hash
     or v_change_set.prepared_expires_at is null
     or v_change_set.prepared_expires_at <= now() then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_STALE';
  end if;
  if v_current_version_id <> v_change_set.base_version_id
     or v_draft_base_version_id <> v_current_version_id
     or jovlo_private.sha256_json(v_draft_snapshot) <> v_change_set.prepared_draft_hash then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_STALE';
  end if;
  if exists (
    select 1 from public.place_proposals as proposal
    where proposal.change_set_id = p_change_set_id
      and proposal.proposal_group_id = any(v_change_set.selected_group_ids)
      and proposal.resolution_status = 'unresolved'
  ) then
    raise exception using errcode = 'P0001', message = 'JOVLO:PLACE_PROPOSAL_UNRESOLVED';
  end if;

  update public.change_sets set status = 'applying' where id = p_change_set_id;

  for v_source in
    select item.value
    from pg_catalog.jsonb_array_elements(
      coalesce(v_change_set.prepared_side_effects -> 'sources', '[]'::jsonb)
    ) as item(value)
  loop
    if coalesce((v_source ->> 'persist')::boolean, true) then
      insert into public.sources (
        id, owner_id, trip_id, change_set_id, source_ref, scope, platform,
        canonical_url, title, author, published_at, summary,
        content_hash, commercial_relationship
      ) values (
        (v_source ->> 'sourceId')::uuid,
        v_owner_id,
        v_change_set.trip_id,
        p_change_set_id,
        v_source ->> 'sourceRef',
        'trip_private',
        v_source ->> 'platform',
        v_source ->> 'url',
        v_source ->> 'title',
        v_source ->> 'author',
        case when v_source ? 'publishedAt' then (v_source ->> 'publishedAt')::date else null end,
        v_source ->> 'summary',
        v_source ->> 'contentFingerprint',
        coalesce(v_source ->> 'commercialRelationship', 'unknown')
      )
      on conflict (change_set_id, source_ref)
        where change_set_id is not null and source_ref is not null
      do nothing;
    end if;
  end loop;

  insert into public.change_set_sources (change_set_id, source_id)
  select p_change_set_id, source.id
  from public.sources as source
  where source.change_set_id = p_change_set_id
  on conflict do nothing;

  insert into public.change_set_sources (change_set_id, source_id)
  select p_change_set_id, source.id
  from pg_catalog.jsonb_array_elements(
    coalesce(v_change_set.prepared_side_effects -> 'sources', '[]'::jsonb)
  ) as item(value)
  join public.sources as source on source.id = (item.value ->> 'sourceId')::uuid
  where source.scope = 'catalog_public' or source.owner_id = v_owner_id
  on conflict do nothing;

  for v_group in
    select item.value
    from pg_catalog.jsonb_array_elements(
      coalesce(v_change_set.prepared_side_effects -> 'selectedGroups', '[]'::jsonb)
    ) as item(value)
  loop
    for v_operation in
      select item.value
      from pg_catalog.jsonb_array_elements(v_group -> 'operations') as item(value)
    loop
      if v_operation ->> 'type' = 'UPSERT_PLACE_CLAIM' then
        v_place_id := (v_operation ->> 'placeId')::uuid;
        v_source_ref := v_operation #>> '{sourceRefs,0}';
        select source.id into v_source_id
        from public.sources as source
        where (source.change_set_id = p_change_set_id and source.source_ref = v_source_ref)
           or (source.id::text = v_source_ref and (source.scope = 'catalog_public' or source.owner_id = v_owner_id))
           or (
             source.id = (
               select (item.value ->> 'sourceId')::uuid
               from pg_catalog.jsonb_array_elements(
                 coalesce(v_change_set.prepared_side_effects -> 'sources', '[]'::jsonb)
               ) as item(value)
               where item.value ->> 'sourceRef' = v_source_ref
               limit 1
             )
             and (source.scope = 'catalog_public' or source.owner_id = v_owner_id)
           )
        order by (source.change_set_id = p_change_set_id) desc
        limit 1;
        if v_source_id is null
           or not exists (
             select 1 from public.places as place
             where place.id = v_place_id
               and (place.visibility = 'public' or place.owner_id = v_owner_id)
           ) then
          raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_INVALID:claim reference unresolved';
        end if;
        insert into public.place_claims (
          place_id, source_id, trip_id, owner_id, scope, field,
          value_json, evidence_status, review_status
        ) values (
          v_place_id,
          v_source_id,
          v_change_set.trip_id,
          v_owner_id,
          'trip_private',
          v_operation ->> 'field',
          v_operation -> 'value',
          'single_source',
          'pending'
        )
        on conflict (owner_id, trip_id, place_id, field, source_id)
          where scope = 'trip_private'
        do update set
          value_json = excluded.value_json,
          evidence_status = 'single_source',
          review_status = 'pending',
          updated_at = now();
      end if;
    end loop;
  end loop;

  perform jovlo_private.assert_snapshot_v1(v_change_set.trip_id, v_change_set.prepared_snapshot);
  v_snapshot_hash := jovlo_private.sha256_json(v_change_set.prepared_snapshot);
  v_derived_hash := jovlo_private.sha256_json(v_change_set.prepared_derived_snapshot);
  select coalesce(max(version.version_no), 0) + 1 into v_version_no
  from public.trip_versions as version
  where version.trip_id = v_change_set.trip_id;

  insert into public.trip_versions (
    id, trip_id, version_no, parent_version_id, source, message,
    snapshot, snapshot_hash, derived_snapshot, derived_hash, created_by
  ) values (
    v_version_id,
    v_change_set.trip_id,
    v_version_no,
    v_current_version_id,
    'changeset',
    '应用 ChangeSet ' || p_change_set_id::text,
    v_change_set.prepared_snapshot,
    v_snapshot_hash,
    v_change_set.prepared_derived_snapshot,
    v_derived_hash,
    v_owner_id
  );

  update public.trips
  set current_version_id = v_version_id,
      status = case when status = 'draft' then 'active' else status end
  where id = v_change_set.trip_id and current_version_id = v_change_set.base_version_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_STALE';
  end if;

  update public.trip_drafts
  set base_version_id = v_version_id,
      snapshot = v_change_set.prepared_snapshot,
      revision = revision + 1,
      updated_by = v_owner_id,
      updated_at = now()
  where id = v_draft_id and revision = v_draft_revision;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_STALE';
  end if;

  update public.change_sets
  set status = 'applied', applied_version_id = v_version_id, failure_code = null
  where id = p_change_set_id;

  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id, metadata)
  values (
    v_owner_id, v_change_set.trip_id, v_owner_id, v_scope, v_version_id,
    pg_catalog.jsonb_build_object('changeSetId', p_change_set_id, 'versionNo', v_version_no)
  );

  v_response := pg_catalog.jsonb_build_object(
    'changeSetId', p_change_set_id,
    'status', 'applied',
    'tripId', v_change_set.trip_id,
    'versionId', v_version_id,
    'versionNo', v_version_no,
    'snapshotHash', v_snapshot_hash,
    'derivedHash', v_derived_hash
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.resolve_place_proposal(
  p_change_set_id uuid,
  p_proposal_ref text,
  p_existing_place_id uuid,
  p_private_place jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'resolve_place_proposal:' || p_change_set_id::text || ':' || p_proposal_ref;
  v_replay jsonb;
  v_trip_id uuid;
  v_status text;
  v_proposal_id uuid;
  v_place_id uuid;
  v_lon double precision;
  v_lat double precision;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'changeSetId', p_change_set_id,
      'proposalRef', p_proposal_ref,
      'existingPlaceId', p_existing_place_id,
      'privatePlace', p_private_place
    )
  );
  if v_replay is not null then return v_replay; end if;

  if (p_existing_place_id is not null) = (p_private_place is not null) then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:choose exactly one resolution';
  end if;

  select change_set.trip_id, change_set.status, proposal.id
    into v_trip_id, v_status, v_proposal_id
  from public.change_sets as change_set
  join public.place_proposals as proposal on proposal.change_set_id = change_set.id
  where change_set.id = p_change_set_id
    and change_set.owner_id = v_owner_id
    and proposal.proposal_ref = p_proposal_ref
  for update of change_set, proposal;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;
  if v_status in ('applying', 'applied', 'rejected') then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_CONFLICT:proposal is no longer editable';
  end if;

  if p_existing_place_id is not null then
    select place.id into v_place_id
    from public.places as place
    where place.id = p_existing_place_id
      and (place.visibility = 'public' or place.owner_id = v_owner_id);
    if v_place_id is null then
      raise exception using errcode = 'P0001', message = 'JOVLO:PLACE_PROPOSAL_UNRESOLVED';
    end if;
    update public.place_proposals
    set resolution_status = 'matched',
        resolved_place_id = v_place_id,
        resolved_by = v_owner_id,
        resolved_at = now()
    where id = v_proposal_id;
  else
    if pg_catalog.jsonb_typeof(p_private_place) <> 'object' then
      raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid private place';
    end if;
    v_place_id := (p_private_place ->> 'placeId')::uuid;
    v_lon := (p_private_place #>> '{wgs84,lon}')::double precision;
    v_lat := (p_private_place #>> '{wgs84,lat}')::double precision;
    if v_lon not between 108.4 and 111.4 or v_lat not between 18 and 20.4 then
      raise exception using errcode = 'P0001', message = 'JOVLO:PLACE_PROPOSAL_UNRESOLVED:outside Hainan';
    end if;
    insert into public.places (
      id, owner_id, trip_id, visibility, status, name, type, address,
      location_wgs84, gcj02_lon, gcj02_lat, source_crs, region, tags
    ) values (
      v_place_id,
      v_owner_id,
      v_trip_id,
      'private',
      'unverified',
      p_private_place ->> 'name',
      coalesce(p_private_place ->> 'type', 'custom'),
      p_private_place ->> 'address',
      extensions.st_setsrid(extensions.st_makepoint(v_lon, v_lat), 4326)::extensions.geography,
      (p_private_place #>> '{gcj02,lon}')::double precision,
      (p_private_place #>> '{gcj02,lat}')::double precision,
      coalesce(p_private_place #>> '{wgs84,crs}', 'WGS84'),
      p_private_place ->> 'region',
      coalesce(
        array(select pg_catalog.jsonb_array_elements_text(p_private_place -> 'tags')),
        '{}'::text[]
      )
    );
    update public.place_proposals
    set resolution_status = 'private_created',
        resolved_place_id = v_place_id,
        resolved_by = v_owner_id,
        resolved_at = now()
    where id = v_proposal_id;
  end if;

  update public.change_sets
  set status = 'conflict',
      prepared_snapshot = null,
      prepared_derived_snapshot = null,
      prepared_draft_hash = null,
      prepared_hash = null,
      prepared_at = null,
      prepared_expires_at = null
  where id = p_change_set_id and status = 'ready';

  v_response := pg_catalog.jsonb_build_object(
    'changeSetId', p_change_set_id,
    'proposalRef', p_proposal_ref,
    'resolvedPlaceId', v_place_id,
    'resolutionStatus', case when p_existing_place_id is null then 'private_created' else 'matched' end
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = 'P0001', message = 'JOVLO:PLACE_PROPOSAL_UNRESOLVED:invalid place payload';
end;
$$;

create or replace function public.create_private_source(
  p_trip_id uuid,
  p_source jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'create_private_source:' || p_trip_id::text;
  v_replay jsonb;
  v_source_id uuid := pg_catalog.gen_random_uuid();
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(v_owner_id, v_scope, p_idempotency_key, p_source);
  if v_replay is not null then return v_replay; end if;

  perform 1 from public.trips as trip
  where trip.id = p_trip_id and trip.owner_id = v_owner_id and trip.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;
  if pg_catalog.jsonb_typeof(p_source) <> 'object'
     or coalesce(p_source ->> 'url', '') !~ '^https://'
     or char_length(coalesce(p_source ->> 'summary', '')) not between 1 and 1200 then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid private source';
  end if;

  insert into public.sources (
    id, owner_id, trip_id, scope, platform, canonical_url, title,
    author, published_at, summary, content_hash, commercial_relationship
  ) values (
    v_source_id,
    v_owner_id,
    p_trip_id,
    'trip_private',
    p_source ->> 'platform',
    p_source ->> 'url',
    p_source ->> 'title',
    p_source ->> 'author',
    case when p_source ? 'publishedAt' then (p_source ->> 'publishedAt')::date else null end,
    p_source ->> 'summary',
    p_source ->> 'contentFingerprint',
    coalesce(p_source ->> 'commercialRelationship', 'unknown')
  );

  v_response := pg_catalog.jsonb_build_object('sourceId', v_source_id, 'tripId', p_trip_id);
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.restore_trip_version(
  p_trip_id uuid,
  p_target_version_id uuid,
  p_derived_snapshot jsonb,
  p_message text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'restore_trip_version:' || p_trip_id::text;
  v_replay jsonb;
  v_current_version_id uuid;
  v_draft_id uuid;
  v_draft_revision bigint;
  v_draft_base uuid;
  v_draft_snapshot jsonb;
  v_head_hash text;
  v_target_snapshot jsonb;
  v_target_hash text;
  v_version_id uuid := pg_catalog.gen_random_uuid();
  v_version_no integer;
  v_derived_hash text;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'tripId', p_trip_id,
      'targetVersionId', p_target_version_id,
      'derivedSnapshot', p_derived_snapshot,
      'message', p_message
    )
  );
  if v_replay is not null then return v_replay; end if;

  select trip.current_version_id, draft.id, draft.revision, draft.base_version_id,
         draft.snapshot, head.snapshot_hash
    into v_current_version_id, v_draft_id, v_draft_revision, v_draft_base,
         v_draft_snapshot, v_head_hash
  from public.trips as trip
  join public.trip_drafts as draft on draft.id = trip.current_draft_id
  join public.trip_versions as head on head.id = trip.current_version_id
  where trip.id = p_trip_id and trip.owner_id = v_owner_id and trip.deleted_at is null
  for update of trip, draft;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;
  if v_draft_base <> v_current_version_id
     or jovlo_private.sha256_json(v_draft_snapshot) <> v_head_hash then
    raise exception using errcode = 'P0001', message = 'JOVLO:DIRTY_DRAFT_REQUIRES_CHECKPOINT';
  end if;

  select version.snapshot, version.snapshot_hash
    into v_target_snapshot, v_target_hash
  from public.trip_versions as version
  where version.id = p_target_version_id and version.trip_id = p_trip_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;
  if pg_catalog.jsonb_typeof(p_derived_snapshot) <> 'object' then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid derived snapshot';
  end if;
  perform jovlo_private.assert_snapshot_v1(p_trip_id, v_target_snapshot);
  v_derived_hash := jovlo_private.sha256_json(p_derived_snapshot);
  select coalesce(max(version.version_no), 0) + 1 into v_version_no
  from public.trip_versions as version where version.trip_id = p_trip_id;

  insert into public.trip_versions (
    id, trip_id, version_no, parent_version_id, source, message,
    snapshot, snapshot_hash, derived_snapshot, derived_hash, created_by
  ) values (
    v_version_id, p_trip_id, v_version_no, v_current_version_id, 'restore', trim(p_message),
    v_target_snapshot, v_target_hash, p_derived_snapshot, v_derived_hash, v_owner_id
  );
  update public.trips set current_version_id = v_version_id
  where id = p_trip_id and current_version_id = v_current_version_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:BASE_VERSION_STALE';
  end if;
  update public.trip_drafts
  set base_version_id = v_version_id,
      snapshot = v_target_snapshot,
      revision = revision + 1,
      updated_by = v_owner_id,
      updated_at = now()
  where id = v_draft_id and revision = v_draft_revision;

  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id, metadata)
  values (
    v_owner_id, p_trip_id, v_owner_id, v_scope, v_version_id,
    pg_catalog.jsonb_build_object('restoredFromVersionId', p_target_version_id)
  );
  v_response := pg_catalog.jsonb_build_object(
    'tripId', p_trip_id,
    'versionId', v_version_id,
    'versionNo', v_version_no,
    'restoredFromVersionId', p_target_version_id,
    'snapshotHash', v_target_hash,
    'derivedHash', v_derived_hash
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function jovlo_private.sanitize_snapshot(
  p_snapshot jsonb,
  p_disclosure_config jsonb
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_snapshot jsonb := p_snapshot - 'userNotes';
  v_days jsonb;
  v_places jsonb;
  v_intent jsonb;
  v_show_dates boolean := coalesce(p_disclosure_config -> 'showExactDates', 'false'::jsonb) = 'true'::jsonb;
  v_show_sources boolean := coalesce(p_disclosure_config -> 'showSources', 'false'::jsonb) = 'true'::jsonb;
begin
  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_set(
        case when v_show_dates then day.value else day.value - 'date' end,
        '{stops}',
        coalesce(
          (
            select pg_catalog.jsonb_agg(
              case
                when v_show_sources then stop.value - 'privateNote'
                else pg_catalog.jsonb_set(stop.value - 'privateNote', '{sourceIds}', '[]'::jsonb, true)
              end
              order by stop.ordinal
            )
            from pg_catalog.jsonb_array_elements(day.value -> 'stops') with ordinality as stop(value, ordinal)
          ),
          '[]'::jsonb
        ),
        true
      )
      order by day.ordinal
    ),
    '[]'::jsonb
  ) into v_days
  from pg_catalog.jsonb_array_elements(v_snapshot -> 'days') with ordinality as day(value, ordinal);
  v_snapshot := pg_catalog.jsonb_set(v_snapshot, '{days}', v_days, true);

  v_intent := v_snapshot -> 'intent';
  if not v_show_dates then
    v_intent := v_intent - 'startDate';
  end if;
  v_snapshot := pg_catalog.jsonb_set(v_snapshot, '{intent}', v_intent, true);

  if not v_show_sources then
    v_snapshot := pg_catalog.jsonb_set(v_snapshot, '{sourceRefs}', '{}'::jsonb, true);
    select coalesce(
      pg_catalog.jsonb_object_agg(entry.key, pg_catalog.jsonb_set(entry.value, '{sourceIds}', '[]'::jsonb, true)),
      '{}'::jsonb
    ) into v_places
    from pg_catalog.jsonb_each(v_snapshot -> 'placeRefs') as entry(key, value);
    v_snapshot := pg_catalog.jsonb_set(v_snapshot, '{placeRefs}', v_places, true);
  end if;
  return v_snapshot;
end;
$$;

create or replace function public.create_report_generation(
  p_trip_id uuid,
  p_version_id uuid,
  p_report_type text,
  p_config jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'create_report_generation:' || p_trip_id::text;
  v_replay jsonb;
  v_expense_snapshot jsonb;
  v_actual_snapshot jsonb;
  v_expense_summary jsonb;
  v_actual_summary jsonb;
  v_by_category jsonb;
  v_expense_snapshot_id uuid := pg_catalog.gen_random_uuid();
  v_actual_snapshot_id uuid := pg_catalog.gen_random_uuid();
  v_report_id uuid := pg_catalog.gen_random_uuid();
  v_expense_count integer;
  v_actual_count integer;
  v_expense_total numeric;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'tripId', p_trip_id,
      'versionId', p_version_id,
      'reportType', p_report_type,
      'config', p_config
    )
  );
  if v_replay is not null then return v_replay; end if;

  perform 1
  from public.trips as trip
  join public.trip_versions as version on version.trip_id = trip.id
  where trip.id = p_trip_id
    and trip.owner_id = v_owner_id
    and trip.deleted_at is null
    and version.id = p_version_id
  for update of trip;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;
  if p_report_type not in ('plan', 'actual') or pg_catalog.jsonb_typeof(p_config) <> 'object' then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid report request';
  end if;

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(expense) order by expense.created_at), '[]'::jsonb),
         count(*)::integer,
         coalesce(sum(expense.amount), 0)
    into v_expense_snapshot, v_expense_count, v_expense_total
  from public.expenses as expense
  where expense.trip_id = p_trip_id and expense.owner_id = v_owner_id;

  select coalesce(pg_catalog.jsonb_object_agg(totals.category, totals.amount), '{}'::jsonb)
    into v_by_category
  from (
    select expense.category, sum(expense.amount) as amount
    from public.expenses as expense
    where expense.trip_id = p_trip_id and expense.owner_id = v_owner_id
    group by expense.category
  ) as totals;
  v_expense_summary := pg_catalog.jsonb_build_object(
    'count', v_expense_count,
    'total', v_expense_total,
    'currency', 'CNY',
    'byCategory', v_by_category
  );

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(actual) order by actual.created_at), '[]'::jsonb),
         count(*)::integer
    into v_actual_snapshot, v_actual_count
  from public.trip_actuals as actual
  where actual.trip_id = p_trip_id and actual.owner_id = v_owner_id;
  v_actual_summary := pg_catalog.jsonb_build_object(
    'count', v_actual_count,
    'visited', (
      select count(*) from public.trip_actuals as actual
      where actual.trip_id = p_trip_id and actual.owner_id = v_owner_id and actual.status = 'visited'
    ),
    'skipped', (
      select count(*) from public.trip_actuals as actual
      where actual.trip_id = p_trip_id and actual.owner_id = v_owner_id and actual.status = 'skipped'
    )
  );
  if p_report_type = 'actual' and v_actual_count = 0 then
    raise exception using errcode = 'P0001', message = 'JOVLO:REPORT_GENERATION_FAILED:no actual records';
  end if;

  insert into public.expense_snapshots (
    id, trip_id, owner_id, snapshot, summary, snapshot_hash
  ) values (
    v_expense_snapshot_id, p_trip_id, v_owner_id, v_expense_snapshot,
    v_expense_summary, jovlo_private.sha256_json(v_expense_snapshot)
  );
  insert into public.actual_snapshots (
    id, trip_id, owner_id, snapshot, summary, snapshot_hash
  ) values (
    v_actual_snapshot_id, p_trip_id, v_owner_id, v_actual_snapshot,
    v_actual_summary, jovlo_private.sha256_json(v_actual_snapshot)
  );
  insert into public.report_generations (
    id, trip_id, owner_id, version_id, expense_snapshot_id, actual_snapshot_id,
    report_type, status, config, config_hash
  ) values (
    v_report_id, p_trip_id, v_owner_id, p_version_id, v_expense_snapshot_id, v_actual_snapshot_id,
    p_report_type, 'ready', p_config, jovlo_private.sha256_json(p_config)
  );

  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id, metadata)
  values (
    v_owner_id, p_trip_id, v_owner_id, v_scope, v_report_id,
    pg_catalog.jsonb_build_object('reportType', p_report_type, 'versionId', p_version_id)
  );
  v_response := pg_catalog.jsonb_build_object(
    'reportId', v_report_id,
    'tripId', p_trip_id,
    'versionId', p_version_id,
    'expenseSnapshotId', v_expense_snapshot_id,
    'actualSnapshotId', v_actual_snapshot_id,
    'status', 'ready'
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.create_publication(
  p_trip_id uuid,
  p_target_kind text,
  p_version_id uuid,
  p_report_id uuid,
  p_token_hash text,
  p_disclosure_config jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'create_publication:' || p_trip_id::text || ':' || p_target_kind;
  v_replay jsonb;
  v_publication_id uuid := pg_catalog.gen_random_uuid();
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object(
      'tripId', p_trip_id,
      'targetKind', p_target_kind,
      'versionId', p_version_id,
      'reportId', p_report_id,
      'tokenHash', p_token_hash,
      'disclosureConfig', p_disclosure_config
    )
  );
  if v_replay is not null then return v_replay; end if;

  perform 1 from public.trips as trip
  where trip.id = p_trip_id and trip.owner_id = v_owner_id and trip.deleted_at is null
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;
  if p_token_hash !~ '^[0-9a-f]{64}$' or pg_catalog.jsonb_typeof(p_disclosure_config) <> 'object' then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid publication request';
  end if;
  if p_target_kind = 'version' then
    if p_version_id is null or p_report_id is not null
       or not exists (
         select 1 from public.trip_versions as version
         where version.id = p_version_id and version.trip_id = p_trip_id
       ) then
      raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid version publication target';
    end if;
  elsif p_target_kind = 'report' then
    if p_report_id is null or p_version_id is not null
       or not exists (
         select 1 from public.report_generations as report
         where report.id = p_report_id and report.trip_id = p_trip_id
           and report.owner_id = v_owner_id and report.status = 'ready'
       ) then
      raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid report publication target';
    end if;
  else
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid target kind';
  end if;

  insert into public.trip_publications (
    id, trip_id, owner_id, target_kind, version_id, report_id,
    token_hash, disclosure_config
  ) values (
    v_publication_id, p_trip_id, v_owner_id, p_target_kind, p_version_id, p_report_id,
    p_token_hash, p_disclosure_config
  );
  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id, metadata)
  values (
    v_owner_id, p_trip_id, v_owner_id, v_scope, v_publication_id,
    pg_catalog.jsonb_build_object('targetKind', p_target_kind, 'versionId', p_version_id, 'reportId', p_report_id)
  );
  v_response := pg_catalog.jsonb_build_object(
    'publicationId', v_publication_id,
    'tripId', p_trip_id,
    'targetKind', p_target_kind,
    'versionId', p_version_id,
    'reportId', p_report_id,
    'createdAt', now()
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.revoke_publication(
  p_publication_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'revoke_publication:' || p_publication_id::text;
  v_replay jsonb;
  v_trip_id uuid;
  v_revoked_at timestamptz;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id, v_scope, p_idempotency_key,
    pg_catalog.jsonb_build_object('publicationId', p_publication_id)
  );
  if v_replay is not null then return v_replay; end if;

  update public.trip_publications
  set revoked_at = coalesce(revoked_at, now())
  where id = p_publication_id and owner_id = v_owner_id
  returning trip_id, revoked_at into v_trip_id, v_revoked_at;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;
  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id)
  values (v_owner_id, v_trip_id, v_owner_id, v_scope, p_publication_id);
  v_response := pg_catalog.jsonb_build_object(
    'publicationId', p_publication_id,
    'revokedAt', v_revoked_at
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.read_public_trip(p_token_hash text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_publication_id uuid;
  v_version_id uuid;
  v_snapshot jsonb;
  v_derived_snapshot jsonb;
  v_disclosure jsonb;
  v_revoked_at timestamptz;
begin
  select publication.id, publication.version_id, version.snapshot, version.derived_snapshot,
         publication.disclosure_config, publication.revoked_at
    into v_publication_id, v_version_id, v_snapshot, v_derived_snapshot, v_disclosure, v_revoked_at
  from public.trip_publications as publication
  join public.trip_versions as version on version.id = publication.version_id
  where publication.token_hash = p_token_hash and publication.target_kind = 'version';
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:PUBLICATION_NOT_FOUND';
  end if;
  if v_revoked_at is not null then
    raise exception using errcode = 'P0001', message = 'JOVLO:PUBLICATION_REVOKED';
  end if;
  return pg_catalog.jsonb_build_object(
    'publicationId', v_publication_id,
    'versionId', v_version_id,
    'snapshot', jovlo_private.sanitize_snapshot(v_snapshot, v_disclosure),
    'derived', v_derived_snapshot
  );
end;
$$;

create or replace function public.read_public_report(p_token_hash text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_publication_id uuid;
  v_report_id uuid;
  v_version_id uuid;
  v_report_type text;
  v_report_status text;
  v_snapshot jsonb;
  v_derived_snapshot jsonb;
  v_expense_summary jsonb;
  v_actual_summary jsonb;
  v_disclosure jsonb;
  v_revoked_at timestamptz;
begin
  select publication.id, report.id, report.version_id, report.report_type, report.status,
         version.snapshot, version.derived_snapshot, expense.summary, actual.summary,
         publication.disclosure_config, publication.revoked_at
    into v_publication_id, v_report_id, v_version_id, v_report_type, v_report_status,
         v_snapshot, v_derived_snapshot, v_expense_summary, v_actual_summary,
         v_disclosure, v_revoked_at
  from public.trip_publications as publication
  join public.report_generations as report on report.id = publication.report_id
  join public.trip_versions as version on version.id = report.version_id
  join public.expense_snapshots as expense on expense.id = report.expense_snapshot_id
  join public.actual_snapshots as actual on actual.id = report.actual_snapshot_id
  where publication.token_hash = p_token_hash and publication.target_kind = 'report';
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:PUBLICATION_NOT_FOUND';
  end if;
  if v_revoked_at is not null or v_report_status = 'revoked' then
    raise exception using errcode = 'P0001', message = 'JOVLO:PUBLICATION_REVOKED';
  end if;
  return pg_catalog.jsonb_build_object(
    'publicationId', v_publication_id,
    'reportId', v_report_id,
    'versionId', v_version_id,
    'reportType', v_report_type,
    'snapshot', jovlo_private.sanitize_snapshot(v_snapshot, v_disclosure),
    'derived', v_derived_snapshot,
    'expenseSummary', v_expense_summary,
    'actualSummary', v_actual_summary
  );
end;
$$;

create or replace function public.upsert_expense(
  p_trip_id uuid,
  p_expense jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'upsert_expense:' || p_trip_id::text;
  v_replay jsonb;
  v_expense_id uuid := coalesce((p_expense ->> 'id')::uuid, pg_catalog.gen_random_uuid());
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(v_owner_id, v_scope, p_idempotency_key, p_expense);
  if v_replay is not null then return v_replay; end if;
  perform 1 from public.trips as trip
  where trip.id = p_trip_id and trip.owner_id = v_owner_id and trip.deleted_at is null;
  if not found then raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN'; end if;

  insert into public.expenses (
    id, trip_id, owner_id, day_id, stop_id, category, amount,
    currency, occurred_on, note, receipt_asset_key
  ) values (
    v_expense_id,
    p_trip_id,
    v_owner_id,
    nullif(p_expense ->> 'dayId', '')::uuid,
    nullif(p_expense ->> 'stopId', '')::uuid,
    p_expense ->> 'category',
    (p_expense ->> 'amount')::numeric,
    coalesce(p_expense ->> 'currency', 'CNY'),
    (p_expense ->> 'occurredOn')::date,
    p_expense ->> 'note',
    p_expense ->> 'receiptAssetKey'
  )
  on conflict (id) do update
  set day_id = excluded.day_id,
      stop_id = excluded.stop_id,
      category = excluded.category,
      amount = excluded.amount,
      currency = excluded.currency,
      occurred_on = excluded.occurred_on,
      note = excluded.note,
      receipt_asset_key = excluded.receipt_asset_key
  where public.expenses.owner_id = v_owner_id and public.expenses.trip_id = p_trip_id;
  if not found then raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN'; end if;

  v_response := pg_catalog.jsonb_build_object('expenseId', v_expense_id, 'tripId', p_trip_id);
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then
  raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid expense';
end;
$$;

create or replace function public.delete_expense(
  p_expense_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'delete_expense:' || p_expense_id::text;
  v_replay jsonb;
  v_trip_id uuid;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id, v_scope, p_idempotency_key,
    pg_catalog.jsonb_build_object('expenseId', p_expense_id)
  );
  if v_replay is not null then return v_replay; end if;
  delete from public.expenses
  where id = p_expense_id and owner_id = v_owner_id
  returning trip_id into v_trip_id;
  if not found then raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN'; end if;
  v_response := pg_catalog.jsonb_build_object('expenseId', p_expense_id, 'tripId', v_trip_id, 'deleted', true);
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.upsert_actual_record(
  p_trip_id uuid,
  p_actual jsonb,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'upsert_actual_record:' || p_trip_id::text;
  v_replay jsonb;
  v_actual_id uuid := coalesce((p_actual ->> 'id')::uuid, pg_catalog.gen_random_uuid());
  v_source_version_id uuid := (p_actual ->> 'sourceVersionId')::uuid;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(v_owner_id, v_scope, p_idempotency_key, p_actual);
  if v_replay is not null then return v_replay; end if;
  perform 1
  from public.trips as trip
  join public.trip_versions as version on version.trip_id = trip.id
  where trip.id = p_trip_id and trip.owner_id = v_owner_id
    and trip.deleted_at is null and version.id = v_source_version_id;
  if not found then raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN'; end if;

  insert into public.trip_actuals (
    id, trip_id, owner_id, source_version_id, day_id, stop_id,
    status, rating, note, actual_start_at, actual_end_at, orphaned
  ) values (
    v_actual_id,
    p_trip_id,
    v_owner_id,
    v_source_version_id,
    (p_actual ->> 'dayId')::uuid,
    nullif(p_actual ->> 'stopId', '')::uuid,
    p_actual ->> 'status',
    nullif(p_actual ->> 'rating', '')::integer,
    p_actual ->> 'note',
    nullif(p_actual ->> 'actualStartAt', '')::timestamptz,
    nullif(p_actual ->> 'actualEndAt', '')::timestamptz,
    coalesce((p_actual ->> 'orphaned')::boolean, false)
  )
  on conflict (id) do update
  set source_version_id = excluded.source_version_id,
      day_id = excluded.day_id,
      stop_id = excluded.stop_id,
      status = excluded.status,
      rating = excluded.rating,
      note = excluded.note,
      actual_start_at = excluded.actual_start_at,
      actual_end_at = excluded.actual_end_at,
      orphaned = excluded.orphaned
  where public.trip_actuals.owner_id = v_owner_id and public.trip_actuals.trip_id = p_trip_id;
  if not found then raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN'; end if;

  v_response := pg_catalog.jsonb_build_object('actualId', v_actual_id, 'tripId', p_trip_id);
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation then
  raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid actual record';
end;
$$;

create unique index place_claims_private_identity_unique
on public.place_claims (owner_id, trip_id, place_id, field, source_id)
where scope = 'trip_private';

alter table public.profiles enable row level security;
alter table public.trips enable row level security;
alter table public.trip_drafts enable row level security;
alter table public.trip_versions enable row level security;
alter table public.stay_anchor_areas enable row level security;
alter table public.places enable row level security;
alter table public.place_variants enable row level security;
alter table public.source_groups enable row level security;
alter table public.sources enable row level security;
alter table public.place_claims enable row level security;
alter table public.route_templates enable row level security;
alter table public.change_sets enable row level security;
alter table public.change_set_sources enable row level security;
alter table public.place_proposals enable row level security;
alter table public.route_segment_cache enable row level security;
alter table public.expenses enable row level security;
alter table public.trip_actuals enable row level security;
alter table public.expense_snapshots enable row level security;
alter table public.actual_snapshots enable row level security;
alter table public.report_generations enable row level security;
alter table public.trip_publications enable row level security;
alter table public.asset_licenses enable row level security;
alter table public.audit_events enable row level security;
alter table public.mutation_idempotency enable row level security;

create policy profiles_select_self on public.profiles
for select to authenticated
using (id = (select auth.uid()));

create policy trips_select_owner on public.trips
for select to authenticated
using (owner_id = (select auth.uid()) and deleted_at is null);

create policy drafts_select_owner on public.trip_drafts
for select to authenticated
using (exists (
  select 1 from public.trips as trip
  where trip.id = trip_drafts.trip_id and trip.owner_id = (select auth.uid()) and trip.deleted_at is null
));

create policy versions_select_owner on public.trip_versions
for select to authenticated
using (exists (
  select 1 from public.trips as trip
  where trip.id = trip_versions.trip_id and trip.owner_id = (select auth.uid()) and trip.deleted_at is null
));

create policy stay_areas_select_visible on public.stay_anchor_areas
for select to authenticated
using (visibility = 'public' or owner_id = (select auth.uid()));

create policy places_select_visible on public.places
for select to authenticated
using (visibility = 'public' or owner_id = (select auth.uid()));

create policy place_variants_select_visible on public.place_variants
for select to authenticated
using (exists (
  select 1 from public.places as place
  where place.id = place_variants.place_id
    and (place.visibility = 'public' or place.owner_id = (select auth.uid()))
));

create policy source_groups_select_public_evidence on public.source_groups
for select to authenticated
using (exists (
  select 1 from public.sources as source
  where source.source_group_id = source_groups.id and source.scope = 'catalog_public'
));

create policy sources_select_visible on public.sources
for select to authenticated
using (scope = 'catalog_public' or owner_id = (select auth.uid()));

create policy claims_select_visible on public.place_claims
for select to authenticated
using (
  (scope = 'catalog_public' and review_status = 'approved')
  or owner_id = (select auth.uid())
);

create policy templates_select_verified on public.route_templates
for select to authenticated
using (status = 'verified');

create policy change_sets_select_owner on public.change_sets
for select to authenticated
using (owner_id = (select auth.uid()));

create policy change_set_sources_select_owner on public.change_set_sources
for select to authenticated
using (exists (
  select 1 from public.change_sets as change_set
  where change_set.id = change_set_sources.change_set_id
    and change_set.owner_id = (select auth.uid())
));

create policy proposals_select_owner on public.place_proposals
for select to authenticated
using (exists (
  select 1 from public.change_sets as change_set
  where change_set.id = place_proposals.change_set_id
    and change_set.owner_id = (select auth.uid())
));

create policy expenses_select_owner on public.expenses
for select to authenticated
using (owner_id = (select auth.uid()));

create policy actuals_select_owner on public.trip_actuals
for select to authenticated
using (owner_id = (select auth.uid()));

create policy expense_snapshots_select_owner on public.expense_snapshots
for select to authenticated
using (owner_id = (select auth.uid()));

create policy actual_snapshots_select_owner on public.actual_snapshots
for select to authenticated
using (owner_id = (select auth.uid()));

create policy reports_select_owner on public.report_generations
for select to authenticated
using (owner_id = (select auth.uid()));

create policy publications_select_owner on public.trip_publications
for select to authenticated
using (owner_id = (select auth.uid()));

create policy asset_licenses_select_active on public.asset_licenses
for select to authenticated
using (takedown_at is null);

revoke all on all tables in schema public from anon, authenticated;
grant select on table
  public.profiles,
  public.trips,
  public.trip_drafts,
  public.trip_versions,
  public.stay_anchor_areas,
  public.places,
  public.place_variants,
  public.source_groups,
  public.sources,
  public.place_claims,
  public.route_templates,
  public.change_sets,
  public.change_set_sources,
  public.place_proposals,
  public.expenses,
  public.trip_actuals,
  public.expense_snapshots,
  public.actual_snapshots,
  public.report_generations,
  public.trip_publications,
  public.asset_licenses
to authenticated;

revoke all on all functions in schema jovlo_private from public, anon, authenticated;

revoke all on function public.create_trip(text, jsonb, text) from public, anon, authenticated;
revoke all on function public.save_draft(uuid, bigint, jsonb, text) from public, anon, authenticated;
revoke all on function public.publish_trip_version(uuid, uuid, bigint, jsonb, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.upload_change_set(uuid, jsonb, uuid, text) from public, anon, authenticated;
revoke all on function public.prepare_change_set(uuid, uuid, text[], jsonb, jsonb, text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.apply_change_set(uuid, text, text) from public, anon, authenticated;
revoke all on function public.resolve_place_proposal(uuid, text, uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.create_private_source(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.restore_trip_version(uuid, uuid, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.create_report_generation(uuid, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.create_publication(uuid, text, uuid, uuid, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.revoke_publication(uuid, text) from public, anon, authenticated;
revoke all on function public.read_public_trip(text) from public, anon, authenticated;
revoke all on function public.read_public_report(text) from public, anon, authenticated;
revoke all on function public.upsert_expense(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.delete_expense(uuid, text) from public, anon, authenticated;
revoke all on function public.upsert_actual_record(uuid, jsonb, text) from public, anon, authenticated;

grant execute on function public.create_trip(text, jsonb, text) to authenticated;
grant execute on function public.save_draft(uuid, bigint, jsonb, text) to authenticated;
grant execute on function public.publish_trip_version(uuid, uuid, bigint, jsonb, jsonb, text, text, text) to authenticated;
grant execute on function public.upload_change_set(uuid, jsonb, uuid, text) to authenticated;
grant execute on function public.prepare_change_set(uuid, uuid, text[], jsonb, jsonb, text, text, jsonb, text) to authenticated;
grant execute on function public.apply_change_set(uuid, text, text) to authenticated;
grant execute on function public.resolve_place_proposal(uuid, text, uuid, jsonb, text) to authenticated;
grant execute on function public.create_private_source(uuid, jsonb, text) to authenticated;
grant execute on function public.restore_trip_version(uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function public.create_report_generation(uuid, uuid, text, jsonb, text) to authenticated;
grant execute on function public.create_publication(uuid, text, uuid, uuid, text, jsonb, text) to authenticated;
grant execute on function public.revoke_publication(uuid, text) to authenticated;
grant execute on function public.upsert_expense(uuid, jsonb, text) to authenticated;
grant execute on function public.delete_expense(uuid, text) to authenticated;
grant execute on function public.upsert_actual_record(uuid, jsonb, text) to authenticated;
grant execute on function public.read_public_trip(text) to anon, authenticated;
grant execute on function public.read_public_report(text) to anon, authenticated;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

commit;
