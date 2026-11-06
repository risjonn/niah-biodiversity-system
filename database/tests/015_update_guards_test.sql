-- Tests for database/schema/015_update_guards.sql (F-01, F-13, F-14). Run the whole file in the
-- SQL Editor after applying the migration; the PASS/FAIL table is the result.
--
-- Everything is rolled back at the end, and each check also undoes its own changes, so no check
-- depends on another. Needs these existing accounts, which are only read:
--   admin@test.com, conservation_officer@test.com, botanists@test.com

begin;

create temp table update_guard_results (
  position serial primary key,
  check_name text not null,
  result text not null,
  detail text
);

-- Runs one statement as acting_user (or with no signed-in user when null), then undoes it.
--   expected_error: the check passes if the statement fails with this text in its message.
--   Without it, the check passes if exactly one row changed and verify (a query run afterwards
--   with full access, returning true or false) agrees. Row count matters because RLS refuses
--   an update by changing 0 rows, with no error.
create function pg_temp.run_check(
  check_name text,
  acting_user uuid,
  statement text,
  expected_error text default null,
  verify text default null
) returns void
language plpgsql
as $$
declare
  rows_changed bigint := 0;
  verified boolean := true;
  error_message text;
  passed boolean;
begin
  begin
    if acting_user is not null then
      set local role authenticated;
      execute format(
        'set local request.jwt.claims = %L',
        json_build_object('sub', acting_user, 'role', 'authenticated')::text
      );
    end if;

    execute statement;
    get diagnostics rows_changed = row_count;

    reset role;
    if verify is not null then
      execute verify into verified;
    end if;

    -- Reaching the handler below undoes the statement and the role change
    raise exception 'undo this check' using errcode = 'UG001';
  exception
    when sqlstate 'UG001' then
      null;
    when others then
      error_message := sqlerrm;
  end;

  if expected_error is not null then
    passed := coalesce(error_message ilike '%' || expected_error || '%', false);
  else
    passed := error_message is null and rows_changed = 1 and verified is true;
  end if;

  insert into update_guard_results (check_name, result, detail)
  values (
    check_name,
    case when passed then 'PASS' else 'FAIL' end,
    coalesce(error_message, rows_changed || ' row(s) changed'
      || case when verified is true then '' else ', stored values were not as expected' end)
  );
  raise notice '%: %', case when passed then 'PASS' else 'FAIL' end, check_name;
end;
$$;

do $$
declare
  admin_id uuid;
  officer_id uuid;
  botanist_id uuid;
  species_a uuid;
  species_b uuid;
  officer_plant uuid;
  botanist_plant uuid;
begin
  select u.id into admin_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'admin@test.com' and p.role = 'admin';
  select u.id into officer_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'conservation_officer@test.com' and p.role = 'conservation_officer';
  select u.id into botanist_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'botanists@test.com' and p.role = 'botanist';

  if admin_id is null or officer_id is null or botanist_id is null then
    insert into update_guard_results (check_name, result, detail)
    values ('setup: test accounts exist with the right roles', 'FAIL', format(
      'admin %s, officer %s, botanist %s',
      case when admin_id is null then 'missing' else 'found' end,
      case when officer_id is null then 'missing' else 'found' end,
      case when botanist_id is null then 'missing' else 'found' end
    ));
    return;
  end if;

  insert into update_guard_results (check_name, result, detail)
  select 'setup: migration 015 is applied',
    case when trigger_exists then 'PASS' else 'FAIL' end,
    case when trigger_exists then 'trg_guard_plant_updates exists'
      else 'trg_guard_plant_updates is missing, so the checks below test the old behaviour' end
  from (
    select exists (
      select 1 from pg_trigger
      where tgrelid = 'public.plants'::regclass and tgname = 'trg_guard_plant_updates'
    ) as trigger_exists
  ) trigger_check;

  -- Fixtures, created with no signed-in user
  insert into public.species (scientific_name) values ('SECURITY-TEST species A')
    returning id into species_a;
  insert into public.species (scientific_name) values ('SECURITY-TEST species B')
    returning id into species_b;

  insert into public.plants (species_id, latitude, longitude, morphological_notes, recorded_by)
    values (species_a, 3.8, 113.7, 'SECURITY-TEST', officer_id)
    returning id into officer_plant;
  insert into public.plants (species_id, latitude, longitude, morphological_notes, recorded_by)
    values (species_a, 3.8, 113.7, 'SECURITY-TEST', botanist_id)
    returning id into botanist_plant;

  -- ---------- the checks #30 asks for ----------
  perform pg_temp.run_check(
    'F-13: officer self-approval with a recorded_by change is refused',
    officer_id,
    format(
      $sql$update public.plants set review_status = 'approved', reviewed_by = %L,
           reviewed_at = now(), recorded_by = %L where id = %L$sql$,
      officer_id, botanist_id, officer_plant
    ),
    'recorded a plant cannot be changed'
  );

  perform pg_temp.run_check(
    'F-14: botanist qr_code change on own pending record is refused',
    botanist_id,
    format($sql$update public.plants set qr_code = 'HACK-001' where id = %L$sql$, botanist_plant),
    'QR codes cannot be changed'
  );

  perform pg_temp.run_check(
    'botanist detail edit on own pending record still works',
    botanist_id,
    format(
      $sql$update public.plants set species_id = %L, height_cm = 42,
           morphological_notes = 'SECURITY-TEST edited', photo_url = 'edited.jpg',
           latitude = 3.81, longitude = 113.71, location_description = 'edited',
           synced_at = '2026-01-01T00:00:00Z' where id = %L$sql$,
      species_b, botanist_plant
    ),
    null,
    format(
      $sql$select species_id = %L and height_cm = 42
             and morphological_notes = 'SECURITY-TEST edited' and photo_url = 'edited.jpg'
             and latitude = 3.81 and longitude = 113.71 and location_description = 'edited'
             and synced_at = '2026-01-01T00:00:00Z' from public.plants where id = %L$sql$,
      species_b, botanist_plant
    )
  );

  -- The same update as reviewPlant in web-app/src/hooks/usePlants.js
  perform pg_temp.run_check(
    'officer approving someone else''s record still works',
    officer_id,
    format(
      $sql$update public.plants set review_status = 'approved', reviewed_by = %L,
           reviewed_at = now(), rejection_reason = null
           where id = %L and review_status = 'pending_review'$sql$,
      officer_id, botanist_plant
    ),
    null,
    format(
      $sql$select review_status = 'approved' and reviewed_by = %L
           from public.plants where id = %L$sql$,
      officer_id, botanist_plant
    )
  );

  perform pg_temp.run_check(
    'F-01: admin changing own role is refused',
    admin_id,
    format($sql$update public.profiles set role = 'botanist' where id = %L$sql$, admin_id),
    'cannot change your own role'
  );

  perform pg_temp.run_check(
    'admin changing another user''s role still works',
    admin_id,
    format(
      $sql$update public.profiles set role = 'conservation_officer' where id = %L$sql$,
      botanist_id
    ),
    null,
    format(
      $sql$select role = 'conservation_officer' from public.profiles where id = %L$sql$,
      botanist_id
    )
  );

  -- ---------- other rules in the migration ----------
  perform pg_temp.run_check(
    'extra: officer self-approval without a recorded_by change is refused',
    officer_id,
    format(
      $sql$update public.plants set review_status = 'approved', reviewed_by = %L,
           reviewed_at = now() where id = %L$sql$,
      officer_id, officer_plant
    ),
    'who did not record this plant'
  );

  perform pg_temp.run_check(
    'extra: botanist changing a review column on own pending record is refused',
    botanist_id,
    format(
      $sql$update public.plants set rejection_reason = 'SECURITY-TEST' where id = %L$sql$,
      botanist_plant
    ),
    'who did not record this plant'
  );

  perform pg_temp.run_check(
    'extra: officer approving under another person''s name is refused',
    officer_id,
    format(
      $sql$update public.plants set review_status = 'approved', reviewed_by = %L,
           reviewed_at = now() where id = %L$sql$,
      admin_id, botanist_plant
    ),
    'under the name of the person making it'
  );

  perform pg_temp.run_check(
    'extra: botanist changing recorded_at is refused',
    botanist_id,
    format(
      $sql$update public.plants set recorded_at = '2020-01-01T00:00:00Z' where id = %L$sql$,
      botanist_plant
    ),
    'time a plant was recorded cannot be changed'
  );

  perform pg_temp.run_check(
    'extra: botanist changing created_at is refused',
    botanist_id,
    format(
      $sql$update public.plants set created_at = '2020-01-01T00:00:00Z' where id = %L$sql$,
      botanist_plant
    ),
    'time a plant record was created cannot be changed'
  );

  perform pg_temp.run_check(
    'extra: botanist changing id is refused',
    botanist_id,
    format(
      $sql$update public.plants set id = gen_random_uuid() where id = %L$sql$,
      botanist_plant
    ),
    'IDs cannot be changed'
  );

  perform pg_temp.run_check(
    'extra: botanist changing own role is refused',
    botanist_id,
    format($sql$update public.profiles set role = 'admin' where id = %L$sql$, botanist_id),
    'cannot change your own role'
  );

  perform pg_temp.run_check(
    'extra: maintenance with no signed-in user can still change protected columns',
    null,
    format(
      $sql$update public.plants set qr_code = 'NIAH-TESTQR', recorded_at = '2020-01-01T00:00:00Z',
           is_monitored = true where id = %L$sql$,
      botanist_plant
    ),
    null,
    format(
      $sql$select qr_code = 'NIAH-TESTQR' and is_monitored from public.plants where id = %L$sql$,
      botanist_plant
    )
  );

  perform pg_temp.run_check(
    'botanist changing is_monitored on own pending record is refused',
    botanist_id,
    format($sql$update public.plants set is_monitored = true where id = %L$sql$, botanist_plant),
    'can change whether a plant is monitored'
  );

  perform pg_temp.run_check(
    'officer changing is_monitored on someone else''s record works',
    officer_id,
    format($sql$update public.plants set is_monitored = true where id = %L$sql$, botanist_plant),
    null,
    format($sql$select is_monitored from public.plants where id = %L$sql$, botanist_plant)
  );

  perform pg_temp.run_check(
    'admin changing is_monitored on someone else''s record works',
    admin_id,
    format($sql$update public.plants set is_monitored = true where id = %L$sql$, botanist_plant),
    null,
    format($sql$select is_monitored from public.plants where id = %L$sql$, botanist_plant)
  );

  perform pg_temp.run_check(
    'role change with no signed-in user works',
    null,
    format(
      $sql$update public.profiles set role = 'conservation_officer' where id = %L$sql$,
      botanist_id
    ),
    null,
    format(
      $sql$select role = 'conservation_officer' from public.profiles where id = %L$sql$,
      botanist_id
    )
  );
exception
  -- A setup error becomes a FAIL row so the script still reaches the rollback below
  when others then
    insert into update_guard_results (check_name, result, detail)
    values ('setup failed, so the checks did not run', 'FAIL', sqlerrm);
end;
$$;

select check_name, result, detail from update_guard_results order by position;

rollback;
