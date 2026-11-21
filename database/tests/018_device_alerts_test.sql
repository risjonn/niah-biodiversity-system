-- Tests for database/schema/018_device_alerts.sql. Run the whole file in the SQL Editor after
-- applying the migration; the PASS/FAIL table is the result.
--
-- Everything is rolled back at the end: the fixture species, plant, nodes, thresholds, readings
-- and alerts never stay in the database, and nor do the node renames tried at the end. Every
-- fixture is named TEST018-..., so it can't clash with real rows, and real nodes are only read
-- (whatever their names are). Needs these existing accounts, which are only read:
--   conservation_officer@test.com, botanists@test.com
--
-- The fixture node gets its own alert_thresholds row, so the threshold checks don't depend on
-- what the global row has been changed to.

begin;

create temp table device_alert_results (
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
  insert into device_alert_results (check_name, result, detail)
  values (check_name, case when passed then 'PASS' else 'FAIL' end, detail);
  raise notice '%: %', case when passed then 'PASS' else 'FAIL' end, check_name;
end;
$$;

-- Runs one statement and checks it fails with expected_error matching its message, or succeeds when
-- expected_error is null. With acting_user set, it runs as that signed-in user (role
-- authenticated); with acting_role 'anon', as a visitor. The statement is always undone, so a
-- statement that should fail can't leave anything behind when it wrongly succeeds.
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

  -- expected_error is a case-insensitive regular expression, so 'a|b' accepts either message
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
  botanist_id uuid;
  fixture_species uuid;
  fixture_plant uuid;
  node_a uuid;
  node_b uuid;
  reading_id uuid;
  alert_count int;
  alert_row alerts%rowtype;
  impact_alert uuid;
  saved_status text;
  wrong_codes text;
  renamed int;
  qr_before text;
  guard_case record;
  node_position text;
begin
  select u.id into officer_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'conservation_officer@test.com' and p.role = 'conservation_officer';
  select u.id into botanist_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'botanists@test.com' and p.role = 'botanist';

  if officer_id is null or botanist_id is null then
    perform pg_temp.record('setup: test accounts exist with the right roles', false, format(
      'officer %s, botanist %s',
      case when officer_id is null then 'missing' else 'found' end,
      case when botanist_id is null then 'missing' else 'found' end
    ));
    return;
  end if;

  if to_regclass('public.device_alert_codes') is null
    or to_regprocedure('public.create_device_alert()') is null then
    perform pg_temp.record('setup: migration 018 is applied', false, 'device_alert_codes or create_device_alert is missing');
    return;
  end if;

  -- ---------- the codes and their severities ----------
  -- The contract's list (docs/iot/gateway-contract.md, section 2), compared both ways
  with expected(code, severity, alert_severity) as (
    values
      ('NORMAL', 'INFO', null::alert_severity),
      ('MOTION_ONLY', 'INFO', null),
      ('TILT_ONLY', 'INFO', null),
      ('WEATHER_STORM', 'INFO', null),
      ('MAINTENANCE_MODE', 'INFO', null),
      ('POACHING_RISK', 'WARNING', 'medium'),
      ('IMPACT_DETECTED', 'WARNING', 'medium'),
      ('LOITERING', 'WARNING', 'medium'),
      ('REPEATED_DISTURBANCE', 'WARNING', 'medium'),
      ('NIGHT_POACHING_RISK', 'CRITICAL', 'high'),
      ('CRITICAL_FALL', 'CRITICAL', 'high'),
      ('PLANT_STOLEN_MOVING', 'CRITICAL', 'high'),
      ('GPS_SHIELDED_OR_JAMMED', 'CRITICAL', 'high'),
      ('FIRE_OR_CANOPY_BREACH', 'CRITICAL', 'high'),
      ('TAMPER_LID_OPENED', 'CRITICAL', 'high'),
      ('POWER_LOSS', 'CRITICAL', 'high')
  ),
  differences as (
    (select code, severity, alert_severity from expected
     except select code, severity, alert_severity from public.device_alert_codes)
    union all
    (select code, severity, alert_severity from public.device_alert_codes
     except select code, severity, alert_severity from expected)
  )
  select string_agg(code, ', ') into wrong_codes from differences;
  perform pg_temp.record(
    'codes: exactly the 16 contract codes, INFO raises nothing, WARNING medium, CRITICAL high',
    wrong_codes is null,
    coalesce('different: ' || wrong_codes, '16 codes')
  );

  -- device_alert_codes_alert_severity_matches: the null-safe check (018, and 019 for databases
  -- that ran the earlier 018, whose check let this row through)
  perform pg_temp.check_statement(
    'codes: a WARNING code without an alert severity is refused',
    $sql$insert into public.device_alert_codes (code, severity, alert_severity, description)
         values ('TEST_CODE', 'WARNING', null, 'test')$sql$,
    'device_alert_codes_alert_severity_matches'
  );

  -- ---------- the sensor_readings columns 018 owns ----------
  -- Five of them were first added by hand on the live project, with defaults. Each must now have
  -- the wanted type, no default and allow null.
  select string_agg(format('%s (%s, default %s, nullable %s)', w.name,
           coalesce(format_type(a.atttypid, a.atttypmod), 'missing'),
           coalesce(pg_get_expr(d.adbin, d.adrelid), 'none'),
           coalesce((not a.attnotnull)::text, '?')), '; ' order by w.name)
  into wrong_codes
  from (values
    ('tilt_angle', 'numeric'), ('plant_tilt_angle', 'numeric'), ('soil_moisture', 'numeric'),
    ('is_raining', 'boolean'), ('tamper_detected', 'boolean'), ('human_detected', 'boolean'),
    ('alert_status', 'text'), ('latitude', 'double precision'), ('longitude', 'double precision')
  ) as w(name, wanted)
  left join pg_attribute a
    on a.attrelid = 'public.sensor_readings'::regclass and a.attname = w.name and not a.attisdropped
  left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum is null
     or format_type(a.atttypid, a.atttypmod) <> w.wanted
     or d.adbin is not null
     or a.attnotnull;
  perform pg_temp.record(
    'columns: the 9 new sensor_readings columns have the right types, no default, and allow null',
    wrong_codes is null,
    coalesce('wrong: ' || wrong_codes, 'tilt_angle, plant_tilt_angle, soil_moisture, is_raining, tamper_detected, human_detected, alert_status, latitude, longitude')
  );

  -- ---------- grants ----------
  perform pg_temp.record(
    'grants: anon and authenticated cannot write device_alert_codes',
    not has_table_privilege('anon', 'public.device_alert_codes', 'insert, update, delete, truncate')
      and not has_table_privilege('authenticated', 'public.device_alert_codes', 'insert, update, delete, truncate'),
    null
  );

  perform pg_temp.record(
    'grants: anon and authenticated cannot execute the new functions',
    not has_function_privilege('anon', 'public.create_device_alert()', 'execute')
      and not has_function_privilege('authenticated', 'public.create_device_alert()', 'execute')
      and not has_function_privilege('anon', 'public.guard_alert_updates()', 'execute')
      and not has_function_privilege('authenticated', 'public.guard_alert_updates()', 'execute'),
    null
  );

  perform pg_temp.record(
    'create_device_alert is security definer with a fixed search_path',
    prosecdef and coalesce('search_path=public' = any(proconfig), false),
    format('security definer %s, config %s', prosecdef, coalesce(proconfig::text, 'none'))
  )
  from pg_proc where oid = 'public.create_device_alert()'::regprocedure;

  perform pg_temp.check_statement(
    'anon cannot read device_alert_codes',
    'select * from public.device_alert_codes',
    'permission denied',
    null, 'anon'
  );

  -- ---------- fixtures, created with no signed-in user ----------
  -- Every name starts with TEST018-, which no real species, plant or node uses, so the fixtures
  -- never collide with real rows whatever state the database is in. Real nodes are never touched.
  insert into public.species (scientific_name) values ('TEST018 species')
    returning id into fixture_species;
  insert into public.plants (species_id, latitude, longitude, morphological_notes, recorded_by)
    values (fixture_species, 3.8, 113.7, 'TEST018', officer_id)
    returning id into fixture_plant;
  insert into public.sensor_nodes (plant_id, node_identifier, latitude, longitude)
    values (fixture_plant, 'TEST018-NODE-A', 3.8, 113.7)
    returning id into node_a;
  insert into public.sensor_nodes (plant_id, node_identifier, latitude, longitude)
    values (fixture_plant, 'TEST018-NODE-B', 3.8, 113.7)
    returning id into node_b;
  insert into public.alert_thresholds
    (sensor_node_id, temperature_min, temperature_max, humidity_min, humidity_max, motion_window_seconds)
  values
    (node_a, 18, 35, 50, 100, 10),
    (node_b, 18, 35, 50, 100, 10);

  perform pg_temp.check_statement(
    'officer can read the codes',
    $sql$do $inner$ begin
      if (select count(*) from public.device_alert_codes) <> 16 then
        raise exception 'officer sees % codes', (select count(*) from public.device_alert_codes);
      end if;
    end $inner$ $sql$,
    null, officer_id
  );

  perform pg_temp.check_statement(
    'botanist sees no codes',
    $sql$do $inner$ begin
      if exists (select 1 from public.device_alert_codes) then
        raise exception 'botanist can see the codes';
      end if;
    end $inner$ $sql$,
    null, botanist_id
  );

  -- ---------- INFO: saved on the reading, no alert ----------
  insert into public.sensor_readings
    (sensor_node_id, temperature, humidity, motion_detected, motion_duration_seconds, recorded_at,
     tilt_angle, plant_tilt_angle, soil_moisture, is_raining, tamper_detected, human_detected, alert_status)
  values (node_a, 25, 80, true, 3, now(), 6.5, 4.0, 45, false, false, false, 'MOTION_ONLY')
  returning id into reading_id;

  select alert_status into saved_status from public.sensor_readings where id = reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  perform pg_temp.record(
    'INFO code (MOTION_ONLY) is saved on the reading and raises no alert',
    saved_status = 'MOTION_ONLY' and alert_count = 0,
    format('alert_status %s, %s alert(s)', saved_status, alert_count)
  );

  insert into public.sensor_readings (sensor_node_id, temperature, humidity, recorded_at, alert_status)
  values (node_a, 25, 80, now(), 'NORMAL')
  returning id into reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  perform pg_temp.record('NORMAL raises no alert', alert_count = 0, format('%s alert(s)', alert_count));

  -- A basic reading, as the gateway sends now with SEND_EXTRA_FIELDS = false
  insert into public.sensor_readings (sensor_node_id, temperature, humidity, motion_detected, recorded_at)
  values (node_a, 25, 80, false, now())
  returning id into reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  perform pg_temp.record(
    'a reading without the extra fields is saved and raises no alert',
    alert_count = 0,
    format('%s alert(s)', alert_count)
  );

  -- ---------- WARNING and CRITICAL: one alert with the right severity ----------
  insert into public.sensor_readings (sensor_node_id, temperature, humidity, recorded_at, tilt_angle, alert_status)
  values (node_a, 25, 80, now(), 2.1, 'IMPACT_DETECTED')
  returning id into reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  select * into alert_row from public.alerts where sensor_reading_id = reading_id limit 1;
  impact_alert := alert_row.id;
  perform pg_temp.record(
    'WARNING code (IMPACT_DETECTED) raises one medium device alert',
    alert_count = 1 and alert_row.alert_type = 'device_alert' and alert_row.alert_code = 'IMPACT_DETECTED'
      and alert_row.severity = 'medium' and alert_row.sensor_node_id = node_a
      and not alert_row.is_acknowledged,
    format('%s alert(s): %s %s %s, "%s"', alert_count, alert_row.alert_type, alert_row.alert_code,
      alert_row.severity, alert_row.message)
  );

  insert into public.sensor_readings (sensor_node_id, recorded_at, tilt_angle, alert_status)
  values (node_a, now(), 82.3, 'CRITICAL_FALL')
  returning id into reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  select * into alert_row from public.alerts where sensor_reading_id = reading_id limit 1;
  perform pg_temp.record(
    'CRITICAL code (CRITICAL_FALL) raises one high device alert',
    alert_count = 1 and alert_row.alert_type = 'device_alert' and alert_row.alert_code = 'CRITICAL_FALL'
      and alert_row.severity = 'high',
    format('%s alert(s): %s %s %s', alert_count, alert_row.alert_type, alert_row.alert_code, alert_row.severity)
  );

  -- ---------- dedupe ----------
  insert into public.sensor_readings (sensor_node_id, recorded_at, alert_status)
  values (node_a, now(), 'IMPACT_DETECTED')
  returning id into reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  perform pg_temp.record(
    'a repeat of IMPACT_DETECTED while its alert is open raises nothing',
    alert_count = 0
      and (select count(*) from public.alerts where sensor_node_id = node_a and alert_code = 'IMPACT_DETECTED') = 1,
    format('%s new alert(s)', alert_count)
  );

  insert into public.sensor_readings (sensor_node_id, recorded_at, alert_status)
  values (node_a, now(), 'LOITERING')
  returning id into reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  perform pg_temp.record(
    'a different code on the same node still raises its own alert',
    alert_count = 1,
    format('%s alert(s)', alert_count)
  );

  insert into public.sensor_readings (sensor_node_id, recorded_at, alert_status)
  values (node_b, now(), 'IMPACT_DETECTED')
  returning id into reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  perform pg_temp.record(
    'the same code on another node raises its own alert',
    alert_count = 1,
    format('%s alert(s)', alert_count)
  );

  -- ---------- acknowledging, as the officer through RLS ----------
  -- Each tries to acknowledge and change one other column in the same update. The guard names
  -- the column it refused.
  for guard_case in
    select * from (values
      ('alert_code', $set$alert_code = 'LOITERING'$set$),
      ('alert_type', $set$alert_type = 'motion_detected'$set$),
      ('message', $set$message = 'rewritten'$set$),
      ('severity', $set$severity = 'low'$set$),
      ('created_at', $set$created_at = created_at - interval '1 day'$set$),
      ('sensor_reading_id', $set$sensor_reading_id = null$set$),
      ('sensor_node_id', format('sensor_node_id = %L', node_b))
    ) as c(column_name, assignment)
  loop
    perform pg_temp.check_statement(
      format('guard: officer cannot change %s while acknowledging', guard_case.column_name),
      format(
        $sql$update public.alerts set is_acknowledged = true, acknowledged_by = %L,
             acknowledged_at = now(), %s where id = %L$sql$,
        officer_id, guard_case.assignment, impact_alert
      ),
      'cannot be changed: ' || guard_case.column_name,
      officer_id
    );
  end loop;

  perform pg_temp.check_statement(
    'guard: officer cannot change message without acknowledging either',
    format($sql$update public.alerts set message = 'rewritten' where id = %L$sql$, impact_alert),
    -- The guard runs before the policy's WITH CHECK, but either refusal will do
    'cannot be changed: message|row-level security',
    officer_id
  );

  -- No signed-in user (SQL Editor, service role): anything may change, as
  -- database/seed/012_align_alert_times.sql needs for created_at
  perform pg_temp.check_statement(
    'guard: with no signed-in user, created_at and message can still be changed',
    format(
      $sql$do $inner$ begin
        update public.alerts set created_at = created_at - interval '1 hour', message = 'maintenance'
        where id = %L;
        if not found then raise exception 'no row updated'; end if;
      end $inner$ $sql$,
      impact_alert
    )
  );

  -- This one is kept, so run as the officer directly instead of through check_statement
  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', officer_id, 'role', 'authenticated')::text, true);
  update public.alerts
  set is_acknowledged = true, acknowledged_by = officer_id, acknowledged_at = now()
  where id = impact_alert;
  get diagnostics alert_count = row_count;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  select * into alert_row from public.alerts where id = impact_alert;
  perform pg_temp.record(
    'guard: officer can acknowledge a device alert, and nothing else changes',
    alert_count = 1 and alert_row.is_acknowledged and alert_row.acknowledged_by = officer_id
      and alert_row.alert_code = 'IMPACT_DETECTED' and alert_row.severity = 'medium'
      and alert_row.message like 'IMPACT_DETECTED at node TEST018-NODE-A:%',
    format('%s row(s) updated, "%s"', alert_count, alert_row.message)
  );

  insert into public.sensor_readings (sensor_node_id, recorded_at, alert_status)
  values (node_a, now(), 'IMPACT_DETECTED')
  returning id into reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  perform pg_temp.record(
    'after acknowledging, a repeat of IMPACT_DETECTED raises a new alert',
    alert_count = 1
      and (select count(*) from public.alerts
           where sensor_node_id = node_a and alert_code = 'IMPACT_DETECTED' and not is_acknowledged) = 1,
    format('%s new alert(s)', alert_count)
  );

  -- ---------- refused values ----------
  perform pg_temp.check_statement(
    'an unknown alert_status is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, alert_status)
                values (%L, now(), 'NOT_A_CODE')$sql$, node_a),
    'sensor_readings_alert_status_fkey'
  );

  perform pg_temp.check_statement(
    'a lower-case code is refused (codes are exact)',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, alert_status)
                values (%L, now(), 'normal')$sql$, node_a),
    'sensor_readings_alert_status_fkey'
  );

  perform pg_temp.check_statement(
    'tilt_angle below 0 is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, tilt_angle)
                values (%L, now(), -0.1)$sql$, node_a),
    'sensor_readings_tilt_angle_range'
  );
  perform pg_temp.check_statement(
    'tilt_angle above 180 is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, tilt_angle)
                values (%L, now(), 180.1)$sql$, node_a),
    'sensor_readings_tilt_angle_range'
  );
  perform pg_temp.check_statement(
    'plant_tilt_angle above 180 is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, plant_tilt_angle)
                values (%L, now(), 181)$sql$, node_a),
    'sensor_readings_plant_tilt_angle_range'
  );
  perform pg_temp.check_statement(
    'plant_tilt_angle below 0 is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, plant_tilt_angle)
                values (%L, now(), -1)$sql$, node_a),
    'sensor_readings_plant_tilt_angle_range'
  );
  perform pg_temp.check_statement(
    'soil_moisture above 100 is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, soil_moisture)
                values (%L, now(), 100.5)$sql$, node_a),
    'sensor_readings_soil_moisture_range'
  );
  perform pg_temp.check_statement(
    'soil_moisture below 0 is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, soil_moisture)
                values (%L, now(), -1)$sql$, node_a),
    'sensor_readings_soil_moisture_range'
  );
  perform pg_temp.check_statement(
    'the range limits themselves are allowed (0 and 180 degrees, 0 and 100 %)',
    format($sql$insert into public.sensor_readings
                  (sensor_node_id, recorded_at, tilt_angle, plant_tilt_angle, soil_moisture)
                values (%1$L, now(), 0, 180, 0), (%1$L, now(), 180, 0, 100)$sql$, node_a)
  );

  perform pg_temp.check_statement(
    'a threshold alert with an alert_code is refused',
    format($sql$insert into public.alerts (sensor_node_id, alert_type, alert_code, severity)
                values (%L, 'temperature_anomaly', 'CRITICAL_FALL', 'medium')$sql$, node_b),
    'alerts_alert_code_only_on_device_alerts'
  );
  perform pg_temp.check_statement(
    'a device alert without an alert_code is refused',
    format($sql$insert into public.alerts (sensor_node_id, alert_type, severity)
                values (%L, 'device_alert', 'high')$sql$, node_b),
    'alerts_alert_code_only_on_device_alerts'
  );
  perform pg_temp.check_statement(
    'an alert with an unknown alert_code is refused',
    format($sql$insert into public.alerts (sensor_node_id, alert_type, alert_code, severity)
                values (%L, 'device_alert', 'NOT_A_CODE', 'high')$sql$, node_b),
    'alerts_alert_code_fkey'
  );

  -- Refused either way: after 019 authenticated has no insert grant ("permission denied"), and
  -- before it there is no insert policy ("row-level security"). Before 019, a database that still
  -- has the hand-made "Enable insert for anonymous users" policy lets this through, so it FAILs.
  perform pg_temp.check_statement(
    'officer cannot insert a reading (no insert grant after 019, no insert policy before it)',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, alert_status)
                values (%L, now(), 'CRITICAL_FALL')$sql$, node_b),
    'permission denied|row-level security',
    officer_id
  );

  -- ---------- GPS on the reading ----------
  perform pg_temp.check_statement(
    'latitude above 90 is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, latitude, longitude)
                values (%L, now(), 90.1, 113.7)$sql$, node_a),
    'sensor_readings_latitude_range'
  );
  perform pg_temp.check_statement(
    'latitude below -90 is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, latitude, longitude)
                values (%L, now(), -90.1, 113.7)$sql$, node_a),
    'sensor_readings_latitude_range'
  );
  perform pg_temp.check_statement(
    'longitude above 180 is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, latitude, longitude)
                values (%L, now(), 3.8, 180.1)$sql$, node_a),
    'sensor_readings_longitude_range'
  );
  perform pg_temp.check_statement(
    'longitude below -180 is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, latitude, longitude)
                values (%L, now(), 3.8, -180.1)$sql$, node_a),
    'sensor_readings_longitude_range'
  );
  perform pg_temp.check_statement(
    'latitude without longitude is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, latitude)
                values (%L, now(), 3.8)$sql$, node_a),
    'sensor_readings_position_pair'
  );
  perform pg_temp.check_statement(
    'longitude without latitude is refused',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, longitude)
                values (%L, now(), 113.7)$sql$, node_a),
    'sensor_readings_position_pair'
  );
  perform pg_temp.check_statement(
    'GPS range limits themselves are allowed (±90, ±180)',
    format($sql$insert into public.sensor_readings (sensor_node_id, recorded_at, latitude, longitude)
                values (%1$L, now(), 90, 180), (%1$L, now(), -90, -180)$sql$, node_a)
  );

  -- A moving box: the fix is kept on the reading, the node stays at its installed position (3.8, 113.7)
  insert into public.sensor_readings (sensor_node_id, recorded_at, latitude, longitude, alert_status)
  values (node_a, now(), 3.812345, 113.776543, 'PLANT_STOLEN_MOVING')
  returning id into reading_id;
  select format('%s, %s', latitude, longitude) into node_position from public.sensor_nodes where id = node_a;
  perform pg_temp.record(
    'GPS is saved on the reading and the node keeps its installed position',
    exists (select 1 from public.sensor_readings
            where id = reading_id and latitude = 3.812345 and longitude = 113.776543)
      and node_position = '3.8, 113.7',
    'node at ' || node_position
  );

  -- ---------- threshold alerts still work ----------
  insert into public.sensor_readings (sensor_node_id, temperature, humidity, motion_detected, recorded_at)
  values (node_b, 40, 80, false, now())
  returning id into reading_id;
  select count(*) into alert_count from public.alerts
    where sensor_reading_id = reading_id and alert_type = 'temperature_anomaly' and severity = 'medium'
      and alert_code is null;
  perform pg_temp.record(
    'a hot reading without the extra fields still raises a temperature_anomaly alert',
    alert_count = 1,
    format('%s alert(s)', alert_count)
  );

  -- Long motion (30 s, over node_b's 10 s window) with alert_status: the node decides, so no
  -- motion_detected. The humidity limit still applies.
  insert into public.sensor_readings
    (sensor_node_id, temperature, humidity, motion_detected, motion_duration_seconds, recorded_at, alert_status)
  values (node_b, 25, 40, true, 30, now(), 'POACHING_RISK')
  returning id into reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  perform pg_temp.record(
    'with alert_status: humidity limit and device alert apply, long motion raises no motion_detected',
    alert_count = 2
      and exists (select 1 from public.alerts where sensor_reading_id = reading_id and alert_type = 'humidity_anomaly')
      and exists (select 1 from public.alerts where sensor_reading_id = reading_id and alert_code = 'POACHING_RISK')
      and not exists (select 1 from public.alerts where sensor_node_id = node_b and alert_type = 'motion_detected'),
    format('%s alert(s), expected humidity and POACHING_RISK only', alert_count)
  );

  -- The same with an INFO code: nothing about motion at all
  insert into public.sensor_readings
    (sensor_node_id, temperature, humidity, motion_detected, motion_duration_seconds, recorded_at, alert_status)
  values (node_b, 25, 80, true, 45, now(), 'MOTION_ONLY')
  returning id into reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  perform pg_temp.record(
    'with alert_status MOTION_ONLY: 45 s of motion raises no alert',
    alert_count = 0,
    format('%s alert(s)', alert_count)
  );

  -- A hot reading with alert_status: the temperature limit still applies. node_b's temperature
  -- alert is open already, so this uses node_a, which has none.
  insert into public.sensor_readings
    (sensor_node_id, temperature, humidity, motion_detected, motion_duration_seconds, recorded_at, alert_status)
  values (node_a, 39, 80, true, 30, now(), 'NORMAL')
  returning id into reading_id;
  select count(*) into alert_count from public.alerts where sensor_reading_id = reading_id;
  perform pg_temp.record(
    'with alert_status NORMAL: a hot reading still raises temperature_anomaly, motion still nothing',
    alert_count = 1
      and exists (select 1 from public.alerts where sensor_reading_id = reading_id and alert_type = 'temperature_anomaly'),
    format('%s alert(s), expected temperature_anomaly only', alert_count)
  );

  -- Without alert_status (the gateway today): the insert names only the basic columns, as
  -- ingest-reading does for a basic reading. The left-out fields must be stored as null, not
  -- filled from a default (the live project's hand-made alert_status defaulted to 'NORMAL', which
  -- would have switched off motion alerts), and long motion still raises motion_detected.
  insert into public.sensor_readings
    (sensor_node_id, temperature, humidity, motion_detected, motion_duration_seconds, recorded_at)
  values (node_b, 25, 80, true, 30, now())
  returning id into reading_id;
  select count(*) into alert_count from public.alerts
    where sensor_reading_id = reading_id and alert_type = 'motion_detected' and severity = 'high';
  select format('alert_status %s, tamper_detected %s, is_raining %s, tilt_angle %s, soil_moisture %s',
      coalesce(alert_status, 'null'), coalesce(tamper_detected::text, 'null'),
      coalesce(is_raining::text, 'null'), coalesce(tilt_angle::text, 'null'),
      coalesce(soil_moisture::text, 'null'))
    into saved_status
    from public.sensor_readings where id = reading_id;
  perform pg_temp.record(
    'without alert_status: stored as null (no default), and 30 s of motion still raises motion_detected',
    alert_count = 1
      and saved_status = 'alert_status null, tamper_detected null, is_raining null, tilt_angle null, soil_moisture null',
    format('%s motion alert(s); %s', alert_count, saved_status)
  );

  -- An open device alert must not stop threshold alerts, and the other way round
  insert into public.sensor_readings (sensor_node_id, temperature, recorded_at, alert_status)
  values (node_b, 10, now(), 'TAMPER_LID_OPENED')
  returning id into reading_id;
  perform pg_temp.record(
    'open alerts of one kind do not block the other kind',
    exists (select 1 from public.alerts where sensor_reading_id = reading_id and alert_code = 'TAMPER_LID_OPENED')
      and not exists (select 1 from public.alerts where sensor_reading_id = reading_id and alert_type = 'temperature_anomaly'),
    'temperature_anomaly is already open on this node from the hot reading, so only the tamper alert is new'
  );

  -- ---------- node rename ----------
  -- Did 018's rename run on this database? Read only: real nodes are looked at, never changed,
  -- and none of them has to exist. FAIL means a node still has an old name, e.g. because 018
  -- skipped it when the new name was already taken (it prints a notice when that happens).
  select coalesce(string_agg(node_identifier, ', ' order by node_identifier), 'none')
  into node_position
  from public.sensor_nodes
  where node_identifier in ('NODE-01', 'NODE-02', 'NIAH-NODE-01', 'NIAH-NODE-02');
  perform pg_temp.record(
    'rename: no real node is still called NIAH-NODE-01 or NIAH-NODE-02',
    not exists (select 1 from public.sensor_nodes where node_identifier in ('NIAH-NODE-01', 'NIAH-NODE-02')),
    'real nodes with these names: ' || node_position
  );

  -- The guarded rename step itself, run on the fixture nodes only. The UPDATEs below are 018's
  -- statement with each name given a TEST018- prefix (NIAH-NODE-0x -> NODE-0x becomes
  -- TEST018-NIAH-NODE-0x -> TEST018-NODE-0x); otherwise keep them the same as 018's. In its own
  -- block, so an error here is one FAIL row and the checks above are kept.
  begin
    update public.sensor_nodes set node_identifier = 'TEST018-NIAH-NODE-01' where id = node_a;
    update public.sensor_nodes set node_identifier = 'TEST018-NIAH-NODE-02' where id = node_b;
    select string_agg(qr_code, ',' order by id) into qr_before from public.plants;

    update sensor_nodes sn
    set node_identifier = r.new_name
    from (values ('TEST018-NIAH-NODE-01', 'TEST018-NODE-01'), ('TEST018-NIAH-NODE-02', 'TEST018-NODE-02'))
      as r(old_name, new_name)
    where sn.node_identifier = r.old_name
      and not exists (
        select 1 from sensor_nodes taken where taken.node_identifier = r.new_name
      );
    get diagnostics renamed = row_count;
    perform pg_temp.record(
      'rename step: old names become the new ones, readings and alerts follow',
      renamed = 2
        and (select node_identifier from public.sensor_nodes where id = node_a) = 'TEST018-NODE-01'
        and (select node_identifier from public.sensor_nodes where id = node_b) = 'TEST018-NODE-02'
        and exists (select 1 from public.alerts where sensor_node_id = node_a)
        and exists (select 1 from public.sensor_readings where sensor_node_id = node_a),
      format('%s renamed', renamed)
    );

    -- Run it again: nothing left to rename
    update sensor_nodes sn
    set node_identifier = r.new_name
    from (values ('TEST018-NIAH-NODE-01', 'TEST018-NODE-01'), ('TEST018-NIAH-NODE-02', 'TEST018-NODE-02'))
      as r(old_name, new_name)
    where sn.node_identifier = r.old_name
      and not exists (
        select 1 from sensor_nodes taken where taken.node_identifier = r.new_name
      );
    get diagnostics renamed = row_count;
    perform pg_temp.record('rename step: safe to run twice (second run renames nothing)', renamed = 0,
      format('%s renamed', renamed));

    -- The new name already taken: node_b goes back to its old name first, which frees
    -- TEST018-NODE-02, then node_a takes TEST018-NODE-02. node_b must then be skipped.
    update public.sensor_nodes set node_identifier = 'TEST018-NIAH-NODE-02' where id = node_b;
    update public.sensor_nodes set node_identifier = 'TEST018-NODE-02' where id = node_a;
    update sensor_nodes sn
    set node_identifier = r.new_name
    from (values ('TEST018-NIAH-NODE-01', 'TEST018-NODE-01'), ('TEST018-NIAH-NODE-02', 'TEST018-NODE-02'))
      as r(old_name, new_name)
    where sn.node_identifier = r.old_name
      and not exists (
        select 1 from sensor_nodes taken where taken.node_identifier = r.new_name
      );
    get diagnostics renamed = row_count;
    perform pg_temp.record(
      'rename step: skipped when the new name is already taken',
      renamed = 0
        and (select node_identifier from public.sensor_nodes where id = node_b) = 'TEST018-NIAH-NODE-02',
      format('%s renamed', renamed)
    );

    perform pg_temp.record(
      'rename step: plant QR codes are unchanged',
      qr_before is not distinct from (select string_agg(qr_code, ',' order by id) from public.plants),
      null
    );
  exception
    when others then
      perform pg_temp.record('rename step: ran without an error', false, sqlerrm);
  end;
exception
  -- A setup error becomes a FAIL row so the script still reaches the rollback below
  when others then
    insert into device_alert_results (check_name, result, detail)
    values ('setup failed, so the remaining checks did not run', 'FAIL', sqlerrm);
end;
$$;

select check_name, result, detail from device_alert_results order by position;

rollback;
