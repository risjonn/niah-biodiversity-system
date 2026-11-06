-- Security fix F-15 (#30): insert_sensor_reading and upload_sensor_data
-- were created outside the repo as SECURITY DEFINER functions with no
-- device-key or role check, callable by anyone including anon. Sensor
-- readings must go through the ingest-reading Edge Function instead.
-- The functions are only revoked, not dropped, so this can be undone.
-- Wrapped in checks because a fresh database built from this repo
-- does not have these functions.
do $$
begin
  if to_regprocedure('public.insert_sensor_reading(uuid, numeric, numeric)') is not null then
    revoke execute on function public.insert_sensor_reading(uuid, numeric, numeric)
      from public, anon, authenticated;
  end if;
  if to_regprocedure('public.upload_sensor_data(uuid, double precision, double precision)') is not null then
    revoke execute on function public.upload_sensor_data(uuid, double precision, double precision)
      from public, anon, authenticated;
  end if;
end $$;