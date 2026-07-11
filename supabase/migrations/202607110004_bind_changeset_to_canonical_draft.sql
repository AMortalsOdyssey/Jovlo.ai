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
  v_db_draft_hash := jovlo_private.sha256_json(v_draft_snapshot);
  if p_draft_hash <> v_db_draft_hash then
    raise exception using errcode = 'P0001', message = 'JOVLO:CHANGESET_STALE:draft hash mismatch';
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
