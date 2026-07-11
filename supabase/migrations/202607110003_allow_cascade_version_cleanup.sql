create or replace function jovlo_private.guard_trip_version_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_catalog.pg_trigger_depth() > 1 then
    return old;
  end if;
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
