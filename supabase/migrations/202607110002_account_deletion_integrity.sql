begin;

alter table public.trip_drafts
  drop constraint trip_drafts_updated_by_fkey,
  add constraint trip_drafts_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete cascade,
  drop constraint trip_drafts_base_version_fk,
  add constraint trip_drafts_base_version_fk
    foreign key (base_version_id) references public.trip_versions(id) on delete set null;

alter table public.trip_versions
  drop constraint trip_versions_created_by_fkey,
  add constraint trip_versions_created_by_fkey
    foreign key (created_by) references auth.users(id) on delete cascade,
  drop constraint trip_versions_parent_version_id_fkey,
  add constraint trip_versions_parent_version_id_fkey
    foreign key (parent_version_id) references public.trip_versions(id) on delete set null;

alter table public.trips
  drop constraint trips_current_version_fk,
  add constraint trips_current_version_fk
    foreign key (current_version_id) references public.trip_versions(id)
    on delete set null deferrable initially deferred,
  drop constraint trips_current_draft_fk,
  add constraint trips_current_draft_fk
    foreign key (current_draft_id) references public.trip_drafts(id)
    on delete set null deferrable initially deferred;

alter table public.change_sets
  drop constraint change_sets_base_version_id_fkey,
  add constraint change_sets_base_version_id_fkey
    foreign key (base_version_id) references public.trip_versions(id) on delete cascade,
  drop constraint change_sets_applied_version_id_fkey,
  add constraint change_sets_applied_version_id_fkey
    foreign key (applied_version_id) references public.trip_versions(id) on delete set null,
  drop constraint change_sets_derived_from_change_set_id_fkey,
  add constraint change_sets_derived_from_change_set_id_fkey
    foreign key (derived_from_change_set_id) references public.change_sets(id) on delete set null;

alter table public.place_proposals
  drop constraint place_proposals_resolved_place_id_fkey,
  add constraint place_proposals_resolved_place_id_fkey
    foreign key (resolved_place_id) references public.places(id) on delete set null,
  drop constraint place_proposals_resolved_by_fkey,
  add constraint place_proposals_resolved_by_fkey
    foreign key (resolved_by) references auth.users(id) on delete set null;

alter table public.trip_actuals
  drop constraint trip_actuals_source_version_id_fkey,
  add constraint trip_actuals_source_version_id_fkey
    foreign key (source_version_id) references public.trip_versions(id) on delete cascade;

alter table public.report_generations
  drop constraint report_generations_version_id_fkey,
  add constraint report_generations_version_id_fkey
    foreign key (version_id) references public.trip_versions(id) on delete cascade,
  drop constraint report_generations_expense_snapshot_id_fkey,
  add constraint report_generations_expense_snapshot_id_fkey
    foreign key (expense_snapshot_id) references public.expense_snapshots(id) on delete cascade,
  drop constraint report_generations_actual_snapshot_id_fkey,
  add constraint report_generations_actual_snapshot_id_fkey
    foreign key (actual_snapshot_id) references public.actual_snapshots(id) on delete cascade;

alter table public.trip_publications
  drop constraint trip_publications_version_id_fkey,
  add constraint trip_publications_version_id_fkey
    foreign key (version_id) references public.trip_versions(id) on delete cascade,
  drop constraint trip_publications_report_id_fkey,
  add constraint trip_publications_report_id_fkey
    foreign key (report_id) references public.report_generations(id) on delete cascade;

commit;
