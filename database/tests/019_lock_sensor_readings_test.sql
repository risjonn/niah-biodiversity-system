-- Tests for database/schema/019_lock_sensor_readings.sql. Run the whole file in the SQL Editor
-- after applying the migration; the PASS/FAIL table is the result.
--
-- Everything is rolled back at the end: the fixture species, plant, node and reading never stay
-- in the database. Every fixture is named TEST019-..., so it can't clash with real rows, and real
-- readings are never written. Needs this existing account, which is only read:
--   conservation_officer@test.com

begin;

create temp table lock_readings_results (
  position serial primary key,
  check_name text not null,
  result text not null,
  detail text
);

-- Records one check
create function pg_temp.record(check_name text, passed boolean, detail text default null)
returns void
language plpgsql
as $$
begin
  insert into lock_readings_results (check_name, result, detail)
  values (check_name, case when passed then 'PASS' else 'FAIL' end, detail);
  raise notice '%: %', case when passed then 'PASS' else 'FAIL' end, check_name;
end;
$$;

-- Runs one statement and checks it fails with expected_error matching its message (a
-- case-insensitive regular expression), or succeeds when expected_error is null. With acting_user
-- set, it runs as that signed-in user (role authenticated); with acting_role 'anon', as a visitor.
-- The statement is always undone, so a write that wrongly succeeds leaves nothing behind.
create function pg_temp.check_statement(
  check_name text,
  statement text,
  expected_error text default null,
  acting_user uuid default null,
  acting_role text default null
) returns void
language plpgsql
as $$
declare
  error_message text;
  passed boolean;
begin
  begin
    if acting_user is not null or acting_role is not null then
      execute format('set local role %I', coalesce(acting_role, 'authenticated'));
      execute format(
        'set local request.jwt.claims = %L',
        case when acting_user is null
          then json_build_object('role', coalesce(acting_role, 'authenticated'))
          else json_build_object('sub', acting_user, 'role', coalesce(acting_role, 'authenticated'))
        end::text
      );
    end if;

    execute statement;

    -- Reaching the handler below undoes the statement and the role change
    raise exception 'undo this check' using errcode = 'SC001';
  exception
    when sqlstate 'SC001' then
      null;
    when others then
      error_message := sqlerrm;
  end;

  if expected_error is not null then
    passed := coalesce(error_message ~* expected_error, false);
  else
    passed := error_message is null;
  end if;

  perform pg_temp.record(
    check_name,
    passed,
    coalesce(error_message, case when expected_error is null then 'succeeded' else 'succeeded, expected an error' end)
  );
end;
$$;

do $$
declare
  officer_id uuid;
  fixture_species uuid;
  fixture_plant uuid;
  fixture_node uuid;
  fixture_reading uuid;
  found_text text;
begin
  select u.id into officer_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'conservation_officer@test.com' and p.role = 'conservation_officer';

  if officer_id is null then
    perform pg_temp.record('setup: conservation_officer@test.com exists with that role', false, 'missing');
    return;
  end if;

  -- ---------- policies ----------
  perform pg_temp.record(
    'policy "Enable insert for anonymous users" no longer exists',
    not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = 'sensor_readings'
        and policyname = 'Enable insert for anonymous users'
    ),
    null
  );

  -- Any other hand-made write policy would show up here too
  select string_agg(format('%s (%s)', policyname, cmd), ', ' order by policyname)
  into found_text
  from pg_policies
  where schemaname = 'public' and tablename = 'sensor_readings'
    and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL');
  perform pg_temp.record(
    'sensor_readings has no insert, update, delete or all policy',
    found_text is null,
    coalesce('found: ' || found_text, 'none')
  );

  -- ---------- grants ----------
  -- has_table_privilege counts grants to PUBLIC too
  select string_agg(format('%s %s', r.role_name, p.privilege), ', ' order by r.role_name, p.privilege)
  into found_text
  from (values ('anon'), ('authenticated')) as r(role_name)
  cross join (values ('insert'), ('update'), ('delete'), ('truncate')) as p(privilege)
  where has_table_privilege(r.role_name, 'public.sensor_readings', p.privilege);
  perform pg_temp.record(
    'anon and authenticated hold no insert, update, delete or truncate grant on sensor_readings',
    found_text is null,
    coalesce('still granted: ' || found_text, 'none')
  );

  perform pg_temp.record(
    'authenticated still holds select on sensor_readings',
    has_table_privilege('authenticated', 'public.sensor_readings', 'select'),
    null
  );

  -- ---------- fixtures, created with no signed-in user ----------
  insert into public.species (scientific_name) values ('TEST019 species')
    returning id into fixture_species;
  insert into public.plants (species_id, latitude, longitude, morphological_notes, recorded_by)
    values (fixture_species, 3.8, 113.7, 'TEST019', officer_id)
    returning id into fixture_plant;
  insert into public.sensor_nodes (plant_id, node_identifier, latitude, longitude)
    values (fixture_plant, 'TEST019-NODE', 3.8, 113.7)
    returning id into fixture_node;
  -- Inside the default limits, no alert_status: raises no alert
  insert into public.sensor_readings (sensor_node_id, temperature, humidity, motion_detected, recorded_at)
    values (fixture_node, 25, 80, false, now())
    returning id into fixture_reading;

  -- ---------- anon ----------
  perform pg_temp.check_statement(
    'anon cannot insert a reading',
    format($sql$insert into public.sensor_readings (sensor_node_id, temperature, humidity, recorded_at)
                values (%L, 99, 99, now())$sql$, fixture_node),
    'permission denied',
    null, 'anon'
  );
  perform pg_temp.check_statement(
    'anon cannot update a reading',
    format($sql$update public.sensor_readings set temperature = 99 where id = %L$sql$, fixture_reading),
    'permission denied',
    null, 'anon'
  );
  perform pg_temp.check_statement(
    'anon cannot delete a reading',
    format($sql$delete from public.sensor_readings where id = %L$sql$, fixture_reading),
    'permission denied',
    null, 'anon'
  );

  -- ---------- conservation officer ----------
  perform pg_temp.check_statement(
    'officer cannot insert a reading',
    format($sql$insert into public.sensor_readings (sensor_node_id, temperature, humidity, recorded_at)
                values (%L, 99, 99, now())$sql$, fixture_node),
    'permission denied',
    officer_id
  );
  perform pg_temp.check_statement(
    'officer cannot update a reading',
    format($sql$update public.sensor_readings set temperature = 99 where id = %L$sql$, fixture_reading),
    'permission denied',
    officer_id
  );
  perform pg_temp.check_statement(
    'officer cannot delete a reading',
    format($sql$delete from public.sensor_readings where id = %L$sql$, fixture_reading),
    'permission denied',
    officer_id
  );
  perform pg_temp.check_statement(
    'officer can still select readings',
    format(
      $sql$do $inner$ begin
        if not exists (select 1 from public.sensor_readings where id = %L and temperature = 25) then
          raise exception 'officer cannot see the fixture reading';
        end if;
      end $inner$ $sql$,
      fixture_reading
    ),
    null,
    officer_id
  );

  perform pg_temp.record(
    'the fixture reading is unchanged after the refused writes',
    exists (select 1 from public.sensor_readings where id = fixture_reading and temperature = 25 and humidity = 80),
    null
  );

  -- ---------- device_alert_codes severity check (also in 018) ----------
  perform pg_temp.record(
    'the old severity check is gone and the fixed one exists',
    not exists (select 1 from pg_constraint
                where conrelid = 'public.device_alert_codes'::regclass
                  and conname = 'device_alert_codes_alert_severity')
      and exists (select 1 from pg_constraint
                  where conrelid = 'public.device_alert_codes'::regclass
                    and conname = 'device_alert_codes_alert_severity_matches'),
    null
  );
  perform pg_temp.check_statement(
    'a WARNING code with no alert severity is refused',
    $sql$insert into public.device_alert_codes (code, severity, alert_severity, description)
         values ('TEST_CODE', 'WARNING', null, 'test')$sql$,
    'device_alert_codes_alert_severity_matches'
  );
  perform pg_temp.check_statement(
    'a CRITICAL code with no alert severity is refused',
    $sql$insert into public.device_alert_codes (code, severity, alert_severity, description)
         values ('TEST_CODE', 'CRITICAL', null, 'test')$sql$,
    'device_alert_codes_alert_severity_matches'
  );
  perform pg_temp.check_statement(
    'a WARNING code with high severity is refused',
    $sql$insert into public.device_alert_codes (code, severity, alert_severity, description)
         values ('TEST_CODE', 'WARNING', 'high', 'test')$sql$,
    'device_alert_codes_alert_severity_matches'
  );
  perform pg_temp.check_statement(
    'an INFO code with an alert severity is refused',
    $sql$insert into public.device_alert_codes (code, severity, alert_severity, description)
         values ('TEST_CODE', 'INFO', 'medium', 'test')$sql$,
    'device_alert_codes_alert_severity_matches'
  );
  perform pg_temp.check_statement(
    'a correctly mapped CRITICAL code is allowed',
    $sql$insert into public.device_alert_codes (code, severity, alert_severity, description)
         values ('TEST_CODE', 'CRITICAL', 'high', 'test')$sql$
  );
exception
  -- A setup error becomes a FAIL row so the script still reaches the rollback below
  when others then
    insert into lock_readings_results (check_name, result, detail)
    values ('setup failed, so the remaining checks did not run', 'FAIL', sqlerrm);
end;
$$;

select check_name, result, detail from lock_readings_results order by position;

rollback;
