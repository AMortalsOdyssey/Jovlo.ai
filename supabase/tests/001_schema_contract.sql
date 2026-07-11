begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

select plan(23);

select has_extension('postgis', 'PostGIS is enabled');
select has_table('public', 'trips', 'trips table exists');
select has_table('public', 'trip_versions', 'immutable versions table exists');
select has_table('public', 'change_sets', 'change_sets table exists');
select has_table('public', 'trip_publications', 'publication table exists');
select has_table('public', 'report_generations', 'report generations table exists');
select has_table('public', 'mutation_idempotency', 'shared idempotency ledger exists');

select has_function('public', 'create_trip', array['text', 'jsonb', 'text']);
select has_function('public', 'save_draft', array['uuid', 'bigint', 'jsonb', 'text']);
select has_function(
  'public',
  'publish_trip_version',
  array['uuid', 'uuid', 'bigint', 'jsonb', 'jsonb', 'text', 'text', 'text']
);
select has_function(
  'public',
  'prepare_change_set',
  array['uuid', 'uuid', 'text[]', 'jsonb', 'jsonb', 'text', 'text', 'jsonb', 'text']
);
select has_function('public', 'apply_change_set', array['uuid', 'text', 'text']);
select has_function(
  'public',
  'restore_trip_version',
  array['uuid', 'uuid', 'jsonb', 'text', 'text']
);
select has_function(
  'public',
  'create_report_generation',
  array['uuid', 'uuid', 'text', 'jsonb', 'text']
);
select has_function(
  'public',
  'create_publication',
  array['uuid', 'text', 'uuid', 'uuid', 'text', 'jsonb', 'text']
);
select has_function('public', 'read_public_trip', array['text']);
select has_function('public', 'read_public_report', array['text']);

select ok(
  not has_table_privilege('authenticated', 'public.trip_versions', 'DELETE'),
  'authenticated users cannot delete versions directly'
);
select ok(
  not has_table_privilege('authenticated', 'public.trip_versions', 'INSERT'),
  'authenticated users cannot forge versions directly'
);
select ok(
  has_function_privilege('authenticated', 'public.apply_change_set(uuid,text,text)', 'EXECUTE'),
  'authenticated users can call controlled apply RPC'
);
select ok(
  has_function_privilege('anon', 'public.read_public_report(text)', 'EXECUTE'),
  'anonymous users can call token-gated public report RPC'
);
select matches(
  (
    select pg_get_constraintdef(oid)
    from pg_constraint
    where conrelid = 'public.trip_publications'::regclass
      and conname = 'publication_exactly_one_target'
  ),
  'target_kind.*version.*version_id IS NOT NULL.*report_id IS NULL.*report.*report_id IS NOT NULL.*version_id IS NULL',
  'publication target check enforces target kind and exactly one foreign key'
);
select is(
  (
    select array_agg(attname order by array_position(index_keys, attnum))
    from (
      select i.indkey::smallint[] as index_keys, unnest(i.indkey) as attnum
      from pg_index as i
      where i.indrelid = 'public.mutation_idempotency'::regclass and i.indisprimary
    ) as pk
    join pg_attribute as attribute
      on attribute.attrelid = 'public.mutation_idempotency'::regclass
     and attribute.attnum = pk.attnum
    group by index_keys
  ),
  array['owner_id', 'operation_scope', 'idempotency_key']::name[],
  'idempotency primary key is owner plus operation scope plus key'
);

select * from finish();
rollback;
