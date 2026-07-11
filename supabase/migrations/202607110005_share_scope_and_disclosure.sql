create or replace function jovlo_private.validate_publication_disclosure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text := coalesce(new.disclosure_config ->> 'viewScope', 'overview');
begin
  if pg_catalog.jsonb_typeof(new.disclosure_config) <> 'object'
     or pg_catalog.jsonb_typeof(new.disclosure_config -> 'showExactDates') <> 'boolean'
     or pg_catalog.jsonb_typeof(new.disclosure_config -> 'showSources') <> 'boolean'
     or pg_catalog.jsonb_typeof(new.disclosure_config -> 'showBudget') <> 'boolean'
     or v_scope not in ('overview', 'day') then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid disclosure config';
  end if;

  if new.target_kind = 'report' and v_scope <> 'overview' then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:reports only support overview scope';
  end if;

  if v_scope = 'overview' and (new.disclosure_config ? 'dayId' or new.disclosure_config ? 'overviewToken') then
    raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:overview scope contains day fields';
  end if;

  if v_scope = 'day' then
    if not (new.disclosure_config ->> 'dayId') ~ '^[0-9a-fA-F-]{36}$'
       or not exists (
         select 1
         from public.trip_versions as version,
              pg_catalog.jsonb_array_elements(version.snapshot -> 'days') as day(value)
         where version.id = new.version_id
           and day.value ->> 'id' = new.disclosure_config ->> 'dayId'
       ) then
      raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:day does not belong to version';
    end if;
    if new.disclosure_config ? 'overviewToken'
       and not (new.disclosure_config ->> 'overviewToken') ~ '^[A-Za-z0-9_-]{24,160}$' then
      raise exception using errcode = 'P0001', message = 'JOVLO:VALIDATION_FAILED:invalid overview token';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists publications_validate_disclosure on public.trip_publications;
create trigger publications_validate_disclosure
before insert or update of disclosure_config, version_id, target_kind
on public.trip_publications
for each row execute function jovlo_private.validate_publication_disclosure();

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
    'derived', v_derived_snapshot,
    'disclosureConfig', v_disclosure
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
    'actualSummary', v_actual_summary,
    'disclosureConfig', v_disclosure
  );
end;
$$;

revoke all on function jovlo_private.validate_publication_disclosure() from public, anon, authenticated;
