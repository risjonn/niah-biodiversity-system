-- Tests for database/schema/020_sensor_node_latest_device_fields.sql. Run the whole file in the
-- SQL Editor after applying the migration; the PASS/FAIL table is the result.
--
-- Everything is rolled back at the end: the fixture species, plant, nodes, readings and any
-- alerts they raise never stay in the database. Every fixture is named TEST020-..., so it can't
-- clash with real rows. Needs these existing accounts, which are only read:
--   admin@test.com, conservation_officer@test.com, botanists@test.com
--
-- Fixture nodes:
--   A: an older reading with every device field, then a newer one with none. The view must show
--      the newer reading's nulls, not fall back to the older values.
--   B: one reading with every device field and a CRITICAL code.
--   C: no readings. Still has a row, with every reading column null.
-- The readings have no temperature or humidity and no motion, so the threshold trigger (009)
-- raises nothing; B's CRITICAL_FALL raises a device alert (018), rolled back with the rest.

begin;

create temp table sensor_latest_results (
  position serial primary key,
  check_name text not null,
  result text not null,
  detail text
);

-- Runs one query as acting_role ('authenticated' or 'anon') and acting_user, and keeps its rows
-- as a jsonb array. Then undoes the role change. The same helper as in the 016 tests.
--   expected_error: the check passes if the query fails with this text in its message.
--   Without it, the check passes if the query succeeds and verify (a query run afterwards with
--   full access, given the rows as $1, returning true or false) agrees.
create function pg_temp.run_check(
  check_name text,
  acting_role text,
  acting_user uuid,
  query text,
  expected_error text default null,
  verify text default null
) returns void
language plpgsql
as $$
declare
  result_rows jsonb;
  verified boolean := true;
  error_message text;
  passed boolean;
begin
  begin
    execute format('set local role %I', acting_role);
    execute format(
      'set local request.jwt.claims = %L',
      case when acting_user is null
        then json_build_object('role', acting_role)
        else json_build_object('sub', acting_user, 'role', acting_role)
      end::text
    );

    execute format('select coalesce(jsonb_agg(t), ''[]''::jsonb) from (%s) t', query)
      into result_rows;

    reset role;
    if verify is not null then
      execute verify into verified using result_rows;
    end if;

    -- Reaching the handler below undoes the role and claims change
    raise exception 'undo this check' using errcode = 'SC001';
  exception
    when sqlstate 'SC001' then
      null;
    when others then
      error_message := sqlerrm;
  end;

  if expected_error is not null then
    passed := coalesce(error_message ilike '%' || expected_error || '%', false);
  else
    passed := error_message is null and verified is true;
  end if;

  insert into sensor_latest_results (check_name, result, detail)
  values (
    check_name,
    case when passed then 'PASS' else 'FAIL' end,
    coalesce(error_message, jsonb_array_length(result_rows) || ' row(s)'
      || case when verified is true then '' else ', rows were not as expected: ' || result_rows::text end)
  );
  raise notice '%: %', case when passed then 'PASS' else 'FAIL' end, check_name;
end;
$$;

do $$
declare
  admin_id uuid;
  officer_id uuid;
  botanist_id uuid;
  fixture_species uuid;
  fixture_plant uuid;
  node_a uuid;
  node_b uuid;
  node_c uuid;
  fixture_query text;
  -- The 010 columns, in 010's order. 020 must keep them first and unchanged.
  columns_010 constant text[] := array[
    'id', 'node_identifier', 'is_active', 'battery_level', 'latitude', 'longitude', 'plant_id',
    'qr_code', 'scientific_name', 'reading_id', 'temperature', 'humidity', 'motion_detected',
    'motion_duration_seconds', 'recorded_at', 'last_received_at'
  ];
  columns_020 constant text[] := array[
    'alert_status', 'alert_status_severity', 'alert_status_description', 'tilt_angle',
    'plant_tilt_angle', 'soil_moisture', 'is_raining', 'human_detected', 'reading_latitude',
    'reading_longitude'
  ];
  view_columns text[];
  -- The fixture rows as typed columns, for the verify queries
  as_rows constant text := 'jsonb_to_recordset($1) as r(id uuid, node_identifier text,
    reading_id uuid, latitude double precision, longitude double precision,
    alert_status text, alert_status_severity text, alert_status_description text,
    tilt_angle numeric, plant_tilt_angle numeric, soil_moisture numeric, is_raining boolean,
    human_detected boolean, reading_latitude double precision, reading_longitude double precision)';
begin
  select u.id into admin_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'admin@test.com' and p.role = 'admin';
  select u.id into officer_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'conservation_officer@test.com' and p.role = 'conservation_officer';
  select u.id into botanist_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'botanists@test.com' and p.role = 'botanist';

  if admin_id is null or officer_id is null or botanist_id is null then
    insert into sensor_latest_results (check_name, result, detail)
    values ('setup: test accounts exist with the right roles', 'FAIL', format(
      'admin %s, officer %s, botanist %s',
      case when admin_id is null then 'missing' else 'found' end,
      case when officer_id is null then 'missing' else 'found' end,
      case when botanist_id is null then 'missing' else 'found' end
    ));
    return;
  end if;

  -- ---------- shape ----------
  select array_agg(attname::text order by attnum) into view_columns
  from pg_attribute
  where attrelid = 'public.sensor_node_latest'::regclass and attnum > 0 and not attisdropped;

  if not (view_columns @> columns_020) then
    insert into sensor_latest_results (check_name, result, detail)
    values ('setup: migration 020 is applied', 'FAIL',
      'sensor_node_latest has no device columns: ' || array_to_string(view_columns, ', '));
    return;
  end if;

  insert into sensor_latest_results (check_name, result, detail)
  values (
    'the 010 columns come first, in the same order',
    case when view_columns[1:16] = columns_010 then 'PASS' else 'FAIL' end,
    array_to_string(view_columns, ', ')
  );

  insert into sensor_latest_results (check_name, result, detail)
  values (
    'the new columns follow them, and nothing else is added',
    case when view_columns[17:] = columns_020 then 'PASS' else 'FAIL' end,
    array_to_string(view_columns[17:], ', ')
  );

  -- ---------- security and grants, the same as 010 ----------
  insert into sensor_latest_results (check_name, result, detail)
  select 'view is security_invoker',
    case when coalesce(reloptions, '{}') @> array['security_invoker=true'] then 'PASS' else 'FAIL' end,
    coalesce(array_to_string(reloptions, ', '), 'no options: the view would skip RLS')
  from pg_class
  where oid = 'public.sensor_node_latest'::regclass;

  insert into sensor_latest_results (check_name, result, detail)
  select 'grants: authenticated can select, anon cannot, and neither can write',
    case when authenticated_select and not anon_select and not authenticated_write and not anon_write
      then 'PASS' else 'FAIL' end,
    format('authenticated select %s write %s, anon select %s write %s',
      authenticated_select, authenticated_write, anon_select, anon_write)
  from (
    select
      has_table_privilege('authenticated', 'public.sensor_node_latest', 'select') as authenticated_select,
      has_table_privilege('anon', 'public.sensor_node_latest', 'select') as anon_select,
      has_table_privilege('authenticated', 'public.sensor_node_latest', 'insert, update, delete') as authenticated_write,
      has_table_privilege('anon', 'public.sensor_node_latest', 'insert, update, delete') as anon_write
  ) grants;

  -- ---------- fixtures, created with no signed-in user ----------
  insert into public.species (scientific_name) values ('TEST020 species')
    returning id into fixture_species;
  insert into public.plants (species_id, latitude, longitude, morphological_notes, recorded_by)
    values (fixture_species, 3.8, 113.7, 'TEST020', officer_id)
    returning id into fixture_plant;
  insert into public.sensor_nodes (plant_id, node_identifier, latitude, longitude)
    values (fixture_plant, 'TEST020-NODE-A', 3.8, 113.7)
    returning id into node_a;
  insert into public.sensor_nodes (plant_id, node_identifier, latitude, longitude)
    values (fixture_plant, 'TEST020-NODE-B', 3.8, 113.7)
    returning id into node_b;
  insert into public.sensor_nodes (plant_id, node_identifier, latitude, longitude)
    values (fixture_plant, 'TEST020-NODE-C', 3.8, 113.7)
    returning id into node_c;

  insert into public.sensor_readings
    (sensor_node_id, motion_detected, recorded_at, alert_status, tilt_angle, plant_tilt_angle,
     soil_moisture, is_raining, human_detected, latitude, longitude)
  values
    -- A's older reading, with everything
    (node_a, false, '2025-01-01 10:00+08', 'TILT_ONLY', 12.5, 3, 40, true, false, 3.81, 113.71),
    -- A's latest reading, with nothing
    (node_a, false, '2025-01-01 10:01+08', null, null, null, null, null, null, null, null),
    -- B's only reading
    (node_b, false, '2025-01-01 10:00+08', 'CRITICAL_FALL', 80, 4.2, 55.5, false, true, 3.8003, 113.7004);

  fixture_query := format(
    'select * from public.sensor_node_latest where id in (%L, %L, %L)',
    node_a, node_b, node_c
  );

  -- ---------- officer and admin ----------
  perform pg_temp.run_check(
    'officer sees the latest reading''s device fields (node B)',
    'authenticated', officer_id,
    fixture_query,
    null,
    format($sql$select exists (select 1 from %s
      where r.node_identifier = 'TEST020-NODE-B'
        and r.alert_status = 'CRITICAL_FALL'
        and r.alert_status_severity = 'CRITICAL'
        and r.alert_status_description = (select description from public.device_alert_codes where code = 'CRITICAL_FALL')
        and r.tilt_angle = 80 and r.plant_tilt_angle = 4.2 and r.soil_moisture = 55.5
        and r.is_raining = false and r.human_detected = true
        and r.reading_latitude = 3.8003 and r.reading_longitude = 113.7004
        -- the node's installed position, not the reading's
        and r.latitude = 3.8 and r.longitude = 113.7)$sql$,
      as_rows)
  );

  perform pg_temp.run_check(
    'a latest reading without device fields shows nulls, not an older reading''s values (node A)',
    'authenticated', officer_id,
    fixture_query,
    null,
    format($sql$select exists (select 1 from %s
      where r.node_identifier = 'TEST020-NODE-A'
        and r.reading_id is not null
        and r.alert_status is null and r.alert_status_severity is null
        and r.alert_status_description is null
        and r.tilt_angle is null and r.plant_tilt_angle is null and r.soil_moisture is null
        and r.is_raining is null and r.human_detected is null
        and r.reading_latitude is null and r.reading_longitude is null)$sql$,
      as_rows)
  );

  perform pg_temp.run_check(
    'a node with no readings still has a row, with the reading columns null (node C)',
    'authenticated', officer_id,
    fixture_query,
    null,
    format($sql$select exists (select 1 from %s
      where r.node_identifier = 'TEST020-NODE-C'
        and r.reading_id is null and r.alert_status is null and r.alert_status_severity is null
        and r.tilt_angle is null and r.reading_latitude is null)$sql$,
      as_rows)
  );

  perform pg_temp.run_check(
    'officer sees all three fixture nodes',
    'authenticated', officer_id,
    fixture_query,
    null,
    'select jsonb_array_length($1) = 3'
  );

  perform pg_temp.run_check(
    'admin sees the same rows and device fields',
    'authenticated', admin_id,
    fixture_query,
    null,
    format($sql$select jsonb_array_length($1) = 3 and exists (select 1 from %s
      where r.node_identifier = 'TEST020-NODE-B' and r.alert_status_severity = 'CRITICAL')$sql$,
      as_rows)
  );

  -- ---------- other callers ----------
  perform pg_temp.run_check(
    'botanist gets no rows (RLS on the tables applies)',
    'authenticated', botanist_id,
    fixture_query,
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'anon is refused',
    'anon', null,
    fixture_query,
    'permission denied'
  );
exception
  -- A setup error becomes a FAIL row so the script still reaches the rollback below
  when others then
    insert into sensor_latest_results (check_name, result, detail)
    values ('setup failed, so the checks did not run', 'FAIL', sqlerrm);
end;
$$;

select check_name, result, detail from sensor_latest_results order by position;

rollback;
