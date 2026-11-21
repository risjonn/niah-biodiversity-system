-- Security fix F-18: anyone could insert sensor readings. Run after 018.
--
-- Finding: the live project had an RLS policy on sensor_readings, "Enable insert for anonymous
-- users" (INSERT, for public, with check (true)), added by hand in the dashboard during IoT
-- testing and in no migration. Anyone with the app's public (anon) key, which ships inside the
-- mobile and web apps, could insert readings without logging in, and every fake reading runs the
-- alert triggers (009, 018), so it could raise or bury alerts on the officer dashboard. This is
-- RLS-28 in database/tests/rls_test_results.md. The policy has since been dropped by hand on live;
-- this migration makes that part of the repo and closes the table at the grant level too, so a
-- policy like it added later still can't let anon or signed-in users write.
--
-- Readings only come in through the ingest-reading Edge Function, which checks the device key and
-- writes with the service role. The service role has its own grants and bypasses RLS, so it is
-- unaffected. The web app only reads readings (staff, through sensor_readings_select_staff in 001),
-- and SELECT is not revoked. Seeds and the SQL Editor run as postgres, also unaffected.
--
-- Also brings the fixed device_alert_codes severity check from 018 to databases that already ran
-- the earlier 018 (see the end of this file).
--
-- Safe to run more than once: every step checks first or is a no-op when already done.

-- ---------- the hand-made policy ----------
drop policy if exists "Enable insert for anonymous users" on public.sensor_readings;

-- ---------- write grants ----------
-- Supabase grants every new table in public to anon and authenticated directly, not only through
-- PUBLIC (see 016), so revoke from all three.
revoke insert, update, delete, truncate on public.sensor_readings from public, anon, authenticated;

-- ---------- device_alert_codes severity check (same step as in 018) ----------
-- The earlier check, device_alert_codes_alert_severity, compared with = and so let a WARNING or
-- CRITICAL code with a null alert_severity through (the check came out null, and a null check
-- passes). It is replaced by one using "is not distinct from", which is never null. The 16 codes
-- already in the table satisfy it, so adding it changes no rows.
alter table public.device_alert_codes drop constraint if exists device_alert_codes_alert_severity;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.device_alert_codes'::regclass
      and conname = 'device_alert_codes_alert_severity_matches'
  ) then
    alter table public.device_alert_codes
      add constraint device_alert_codes_alert_severity_matches check (
        alert_severity is not distinct from case severity
          when 'INFO' then null::alert_severity
          when 'WARNING' then 'medium'::alert_severity
          when 'CRITICAL' then 'high'::alert_severity
        end
      );
  end if;
end $$;
