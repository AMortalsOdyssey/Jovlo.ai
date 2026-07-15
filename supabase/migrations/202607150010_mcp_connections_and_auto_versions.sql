begin;

alter table public.trip_versions
  drop constraint if exists trip_versions_source_check;

alter table public.trip_versions
  add constraint trip_versions_source_check check (
    source in ('manual', 'manual_auto', 'agent', 'changeset', 'restore', 'template')
  );

create table public.mcp_connections (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  trip_id uuid not null references public.trips(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'revoked', 'expired')),
  client_name text,
  client_id text,
  scopes text[] not null default array['read', 'write'],
  authorized_at timestamptz,
  last_seen_at timestamptz,
  expires_at timestamptz not null default (now() + interval '10 minutes'),
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (cardinality(scopes) > 0 and scopes <@ array['read', 'write']::text[])
);

create index mcp_connections_owner_trip_created_idx
  on public.mcp_connections (owner_id, trip_id, created_at desc);

create index mcp_connections_expiry_idx
  on public.mcp_connections (expires_at)
  where status in ('pending', 'active');

alter table public.mcp_connections enable row level security;
alter table public.mcp_connections force row level security;

create policy mcp_connections_owner_select on public.mcp_connections
  for select to authenticated
  using (owner_id = (select auth.uid()));

create policy mcp_connections_owner_insert on public.mcp_connections
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (
      select 1 from public.trips
      where trips.id = mcp_connections.trip_id
        and trips.owner_id = (select auth.uid())
        and trips.deleted_at is null
    )
  );

create policy mcp_connections_owner_update on public.mcp_connections
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

create trigger touch_mcp_connections
before update on public.mcp_connections
for each row execute function jovlo_private.touch_updated_at();

create or replace function public.create_mcp_connection(
  p_trip_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'create_mcp_connection:' || p_trip_id::text;
  v_replay jsonb;
  v_connection public.mcp_connections%rowtype;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object('tripId', p_trip_id)
  );
  if v_replay is not null then return v_replay; end if;

  perform 1 from public.trips
  where id = p_trip_id and owner_id = v_owner_id and deleted_at is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;

  update public.mcp_connections
  set status = 'expired'
  where owner_id = v_owner_id
    and trip_id = p_trip_id
    and status in ('pending', 'active')
    and expires_at <= now();

  insert into public.mcp_connections (trip_id, owner_id)
  values (p_trip_id, v_owner_id)
  returning * into v_connection;

  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id)
  values (v_owner_id, p_trip_id, v_owner_id, v_scope, v_connection.id);

  v_response := pg_catalog.jsonb_build_object(
    'id', v_connection.id,
    'tripId', v_connection.trip_id,
    'status', v_connection.status,
    'scopes', v_connection.scopes,
    'expiresAt', v_connection.expires_at,
    'createdAt', v_connection.created_at
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.activate_mcp_connection(
  p_connection_id uuid,
  p_client_id text,
  p_client_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_connection public.mcp_connections%rowtype;
begin
  update public.mcp_connections
  set status = 'active',
      client_id = coalesce(nullif(trim(p_client_id), ''), client_id),
      client_name = coalesce(nullif(trim(p_client_name), ''), client_name, 'MCP Agent'),
      authorized_at = coalesce(authorized_at, now()),
      last_seen_at = now(),
      expires_at = case when status = 'pending' then now() + interval '8 hours' else expires_at end
  where id = p_connection_id
    and owner_id = v_owner_id
    and status in ('pending', 'active')
    and revoked_at is null
    and expires_at > now()
  returning * into v_connection;

  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;

  return pg_catalog.jsonb_build_object(
    'id', v_connection.id,
    'tripId', v_connection.trip_id,
    'status', v_connection.status,
    'expiresAt', v_connection.expires_at,
    'lastSeenAt', v_connection.last_seen_at
  );
end;
$$;

create or replace function public.revoke_mcp_connection(
  p_connection_id uuid,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'revoke_mcp_connection:' || p_connection_id::text;
  v_replay jsonb;
  v_trip_id uuid;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    pg_catalog.jsonb_build_object('connectionId', p_connection_id)
  );
  if v_replay is not null then return v_replay; end if;

  update public.mcp_connections
  set status = 'revoked', revoked_at = now()
  where id = p_connection_id and owner_id = v_owner_id and status <> 'revoked'
  returning trip_id into v_trip_id;

  if not found then
    select trip_id into v_trip_id from public.mcp_connections
    where id = p_connection_id and owner_id = v_owner_id;
  end if;
  if v_trip_id is null then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;

  v_response := pg_catalog.jsonb_build_object(
    'id', p_connection_id,
    'status', 'revoked',
    'revokedAt', now()
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.apply_agent_snapshot(
  p_connection_id uuid,
  p_trip_id uuid,
  p_expected_revision bigint,
  p_base_version_id uuid,
  p_snapshot jsonb,
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
  v_scope text := 'apply_agent_snapshot:' || p_trip_id::text;
  v_replay jsonb;
  v_current_version_id uuid;
  v_draft_id uuid;
  v_draft_revision bigint;
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
      'connectionId', p_connection_id,
      'tripId', p_trip_id,
      'expectedRevision', p_expected_revision,
      'baseVersionId', p_base_version_id,
      'snapshot', p_snapshot,
      'derivedSnapshot', p_derived_snapshot,
      'message', p_message
    )
  );
  if v_replay is not null then return v_replay; end if;

  perform 1 from public.mcp_connections
  where id = p_connection_id
    and trip_id = p_trip_id
    and owner_id = v_owner_id
    and status = 'active'
    and revoked_at is null
    and expires_at > now();
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;

  select trip.current_version_id, draft.id, draft.revision
  into v_current_version_id, v_draft_id, v_draft_revision
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
  if v_draft_revision <> p_expected_revision then
    raise exception using errcode = 'P0001', message = 'JOVLO:DRAFT_REVISION_STALE';
  end if;
  if p_message is null or char_length(trim(p_message)) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid version message';
  end if;

  perform jovlo_private.assert_snapshot_v1(p_trip_id, p_snapshot);
  if pg_catalog.jsonb_typeof(p_derived_snapshot) <> 'object' then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid derived snapshot';
  end if;

  v_snapshot_hash := jovlo_private.sha256_json(p_snapshot);
  v_derived_hash := jovlo_private.sha256_json(p_derived_snapshot);
  select coalesce(max(version_no), 0) + 1 into v_version_no
  from public.trip_versions where trip_id = p_trip_id;

  insert into public.trip_versions (
    id, trip_id, version_no, parent_version_id, source, message,
    snapshot, snapshot_hash, derived_snapshot, derived_hash, created_by
  ) values (
    v_version_id, p_trip_id, v_version_no, v_current_version_id, 'agent', trim(p_message),
    p_snapshot, v_snapshot_hash, p_derived_snapshot, v_derived_hash, v_owner_id
  );

  update public.trips
  set current_version_id = v_version_id,
      title = p_snapshot ->> 'title',
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
  where id = v_draft_id and revision = p_expected_revision;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:DRAFT_REVISION_STALE';
  end if;

  update public.mcp_connections set last_seen_at = now() where id = p_connection_id;

  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id, metadata)
  values (
    v_owner_id, p_trip_id, v_owner_id, v_scope, v_version_id,
    pg_catalog.jsonb_build_object('versionNo', v_version_no, 'source', 'agent', 'connectionId', p_connection_id)
  );

  v_response := pg_catalog.jsonb_build_object(
    'tripId', p_trip_id,
    'versionId', v_version_id,
    'versionNo', v_version_no,
    'snapshotHash', v_snapshot_hash,
    'derivedHash', v_derived_hash,
    'draftRevision', p_expected_revision + 1
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
  if p_source not in ('manual', 'manual_auto', 'changeset', 'restore', 'template') then
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

revoke all on table public.mcp_connections from public, anon;
grant select, insert, update on table public.mcp_connections to authenticated;

revoke all on function public.publish_trip_version(uuid, uuid, bigint, jsonb, jsonb, text, text, text) from public, anon, authenticated;
revoke all on function public.create_mcp_connection(uuid, text) from public, anon, authenticated;
revoke all on function public.activate_mcp_connection(uuid, text, text) from public, anon, authenticated;
revoke all on function public.revoke_mcp_connection(uuid, text) from public, anon, authenticated;
revoke all on function public.apply_agent_snapshot(uuid, uuid, bigint, uuid, jsonb, jsonb, text, text) from public, anon, authenticated;

grant execute on function public.publish_trip_version(uuid, uuid, bigint, jsonb, jsonb, text, text, text) to authenticated;
grant execute on function public.create_mcp_connection(uuid, text) to authenticated;
grant execute on function public.activate_mcp_connection(uuid, text, text) to authenticated;
grant execute on function public.revoke_mcp_connection(uuid, text) to authenticated;
grant execute on function public.apply_agent_snapshot(uuid, uuid, bigint, uuid, jsonb, jsonb, text, text) to authenticated;

commit;
