begin;

alter table public.mcp_connections
  alter column trip_id drop not null;

drop policy if exists mcp_connections_owner_insert on public.mcp_connections;
create policy mcp_connections_owner_insert on public.mcp_connections
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (
      trip_id is null
      or exists (
        select 1 from public.trips
        where trips.id = mcp_connections.trip_id
          and trips.owner_id = (select auth.uid())
          and trips.deleted_at is null
      )
    )
  );

drop policy if exists mcp_connections_owner_update on public.mcp_connections;
create policy mcp_connections_owner_update on public.mcp_connections
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (
    owner_id = (select auth.uid())
    and (
      trip_id is null
      or exists (
        select 1 from public.trips
        where trips.id = mcp_connections.trip_id
          and trips.owner_id = (select auth.uid())
          and trips.deleted_at is null
      )
    )
  );

create index mcp_connections_owner_unbound_created_idx
  on public.mcp_connections (owner_id, created_at desc)
  where trip_id is null;

create or replace function public.create_unbound_mcp_connection(
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_id uuid := jovlo_private.require_user();
  v_scope text := 'create_unbound_mcp_connection';
  v_replay jsonb;
  v_connection public.mcp_connections%rowtype;
  v_response jsonb;
begin
  v_replay := jovlo_private.begin_mutation(
    v_owner_id,
    v_scope,
    p_idempotency_key,
    '{}'::jsonb
  );
  if v_replay is not null then return v_replay; end if;

  update public.mcp_connections
  set status = 'revoked', revoked_at = now()
  where owner_id = v_owner_id
    and trip_id is null
    and status in ('pending', 'active')
    and revoked_at is null;

  insert into public.mcp_connections (trip_id, owner_id)
  values (null, v_owner_id)
  returning * into v_connection;

  insert into public.audit_events (owner_id, actor_id, operation_scope, entity_id)
  values (v_owner_id, v_owner_id, v_scope, v_connection.id);

  v_response := pg_catalog.jsonb_build_object(
    'id', v_connection.id,
    'tripId', null,
    'status', v_connection.status,
    'scopes', v_connection.scopes,
    'expiresAt', v_connection.expires_at,
    'createdAt', v_connection.created_at
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

create or replace function public.create_trip_from_mcp(
  p_connection_id uuid,
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
  v_scope text := 'create_trip_from_mcp:' || p_connection_id::text;
  v_replay jsonb;
  v_connection public.mcp_connections%rowtype;
  v_trip_id uuid;
  v_draft_id uuid := pg_catalog.gen_random_uuid();
  v_version_id uuid := pg_catalog.gen_random_uuid();
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
      'snapshot', p_snapshot,
      'derivedSnapshot', p_derived_snapshot,
      'message', p_message
    )
  );
  if v_replay is not null then return v_replay; end if;

  select * into v_connection
  from public.mcp_connections
  where id = p_connection_id
    and owner_id = v_owner_id
    and trip_id is null
    and status = 'active'
    and revoked_at is null
    and expires_at > now()
  for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;

  if p_message is null or char_length(trim(p_message)) not between 1 and 500 then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid version message';
  end if;
  begin
    v_trip_id := (p_snapshot ->> 'tripId')::uuid;
  exception when others then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid tripId';
  end;
  if exists (select 1 from public.trips where id = v_trip_id) then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:tripId already exists';
  end if;
  perform jovlo_private.assert_snapshot_v1(v_trip_id, p_snapshot);
  if pg_catalog.jsonb_typeof(p_derived_snapshot) <> 'object' then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid derived snapshot';
  end if;

  v_snapshot_hash := jovlo_private.sha256_json(p_snapshot);
  v_derived_hash := jovlo_private.sha256_json(p_derived_snapshot);

  insert into public.trips (id, owner_id, title, status)
  values (v_trip_id, v_owner_id, trim(p_snapshot ->> 'title'), 'active');

  insert into public.trip_versions (
    id, trip_id, version_no, parent_version_id, source, message,
    snapshot, snapshot_hash, derived_snapshot, derived_hash, created_by
  ) values (
    v_version_id, v_trip_id, 1, null, 'agent', trim(p_message),
    p_snapshot, v_snapshot_hash, p_derived_snapshot, v_derived_hash, v_owner_id
  );

  insert into public.trip_drafts (
    id, trip_id, base_version_id, snapshot, revision, updated_by
  ) values (
    v_draft_id, v_trip_id, v_version_id, p_snapshot, 1, v_owner_id
  );

  update public.trips
  set current_version_id = v_version_id,
      current_draft_id = v_draft_id
  where id = v_trip_id;

  update public.mcp_connections
  set trip_id = v_trip_id,
      last_seen_at = now()
  where id = p_connection_id and trip_id is null;
  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;

  insert into public.audit_events (
    owner_id, trip_id, actor_id, operation_scope, entity_id, metadata
  ) values (
    v_owner_id, v_trip_id, v_owner_id, v_scope, v_version_id,
    pg_catalog.jsonb_build_object('versionNo', 1, 'source', 'agent', 'connectionId', p_connection_id)
  );

  v_response := pg_catalog.jsonb_build_object(
    'tripId', v_trip_id,
    'versionId', v_version_id,
    'versionNo', 1,
    'snapshotHash', v_snapshot_hash,
    'derivedHash', v_derived_hash,
    'draftRevision', 1
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
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
  v_connection public.mcp_connections%rowtype;
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
  set status = 'revoked', revoked_at = coalesce(revoked_at, now())
  where id = p_connection_id and owner_id = v_owner_id
  returning * into v_connection;

  if not found then
    raise exception using errcode = 'P0001', message = 'JOVLO:FORBIDDEN';
  end if;

  insert into public.audit_events (owner_id, trip_id, actor_id, operation_scope, entity_id)
  values (v_owner_id, v_connection.trip_id, v_owner_id, v_scope, v_connection.id);

  v_response := pg_catalog.jsonb_build_object(
    'id', v_connection.id,
    'tripId', v_connection.trip_id,
    'status', 'revoked',
    'revokedAt', v_connection.revoked_at
  );
  perform jovlo_private.complete_mutation(v_owner_id, v_scope, p_idempotency_key, v_response);
  return v_response;
end;
$$;

revoke all on function public.create_unbound_mcp_connection(text) from public, anon, authenticated;
revoke all on function public.create_trip_from_mcp(uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.revoke_mcp_connection(uuid, text) from public, anon, authenticated;
grant execute on function public.create_unbound_mcp_connection(text) to authenticated;
grant execute on function public.create_trip_from_mcp(uuid, jsonb, jsonb, text, text) to authenticated;
grant execute on function public.revoke_mcp_connection(uuid, text) to authenticated;

commit;
