-- gen_random_bytes is installed in Supabase's extensions schema. Keep the
-- security-definer search path fixed while making that trusted schema visible.
alter function public.jw_internal_throw(uuid, text, text, text, text, boolean)
  set search_path = public, extensions, pg_temp;
alter function public.jw_internal_create_echo(uuid, uuid, text, text)
  set search_path = public, extensions, pg_temp;
