begin;

create extension if not exists pgtap with schema extensions;
set local search_path = extensions, public, pg_catalog;

create temporary table tap_results (
  seq bigint generated always as identity,
  result text not null
) on commit drop;

insert into tap_results(result)
select plan(23);

insert into tap_results(result)
select has_extension('postgis', 'PostGIS is enabled');
insert into tap_results(result)
select has_table('public', 'trips', 'trips table exists');
insert into tap_results(result)
select has_table('public', 'trip_versions', 'immutable versions table exists');
insert into tap_results(result)
select has_table('public', 'change_sets', 'change_sets table exists');
insert into tap_results(result)
select has_table('public', 'trip_publications', 'publication table exists');
insert into tap_results(result)
select has_table('public', 'report_generations', 'report generations table exists');
insert into tap_results(result)
select has_table('public', 'mutation_idempotency', 'shared idempotency ledger exists');

insert into tap_results(result)
select has_function('public', 'create_trip', array['text', 'jsonb', 'text']);
insert into tap_results(result)
select has_function('public', 'save_draft', array['uuid', 'bigint', 'jsonb', 'text']);
insert into tap_results(result)
select has_function(
  'public',
  'publish_trip_version',
  array['uuid', 'uuid', 'bigint', 'jsonb', 'jsonb', 'text', 'text', 'text']
);
insert into tap_results(result)
select has_function(
  'public',
  'prepare_change_set',
  array['uuid', 'uuid', 'text[]', 'jsonb', 'jsonb', 'text', 'text', 'jsonb', 'text']
);
insert into tap_results(result)
select has_function('public', 'apply_change_set', array['uuid', 'text', 'text']);
insert into tap_results(result)
select has_function(
  'public',
  'restore_trip_version',
  array['uuid', 'uuid', 'jsonb', 'text', 'text']
);
insert into tap_results(result)
select has_function(
  'public',
  'create_report_generation',
  array['uuid', 'uuid', 'text', 'jsonb', 'text']
);
insert into tap_results(result)
select has_function(
  'public',
  'create_publication',
  array['uuid', 'text', 'uuid', 'uuid', 'text', 'jsonb', 'text']
);
insert into tap_results(result)
select has_function('public', 'read_public_trip', array['text']);
insert into tap_results(result)
select has_function('public', 'read_public_report', array['text']);

insert into tap_results(result)
select ok(
  not has_table_privilege('authenticated', 'public.trip_versions', 'DELETE'),
  'authenticated users cannot delete versions directly'
);
insert into tap_results(result)
select ok(
  not has_table_privilege('authenticated', 'public.trip_versions', 'INSERT'),
  'authenticated users cannot forge versions directly'
);
insert into tap_results(result)
select ok(
  has_function_privilege('authenticated', 'public.apply_change_set(uuid,text,text)', 'EXECUTE'),
  'authenticated users can call controlled apply RPC'
);
insert into tap_results(result)
select ok(
  has_function_privilege('anon', 'public.read_public_report(text)', 'EXECUTE'),
  'anonymous users can call token-gated public report RPC'
);
insert into tap_results(result)
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
insert into tap_results(result)
select is(
  (
    select array_agg(attribute.attname order by array_position(pk.index_keys, pk.attnum))
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

insert into tap_results(result)
select * from finish();

select result from tap_results order by seq;
rollback;
