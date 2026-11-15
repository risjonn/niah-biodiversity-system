-- Tests for database/schema/016_sensor_chart_report.sql. Run the whole file in the SQL Editor
-- after applying the migration; the PASS/FAIL table is the result.
--
-- Everything is rolled back at the end: the fixture species, plant, sensor node and readings
-- never stay in the database. Needs these existing accounts, which are only read:
--   admin@test.com, conservation_officer@test.com, botanists@test.com
--
-- The fixture readings are on 1 and 2 January 2025, Sarawak time. One is at 00:10 on 2 January
-- in Sarawak, which is still 1 January in UTC, so bucketing in UTC instead of Asia/Kuching fails.

begin;

create temp table sensor_chart_results (
  position serial primary key,
  check_name text not null,
  result text not null,
  detail text
);

-- Runs one query as acting_role ('authenticated' or 'anon') and acting_user, and keeps its rows
-- as a jsonb array. Then undoes the role change.
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

  insert into sensor_chart_results (check_name, result, detail)
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
  fixture_node uuid;
  -- The fixture node's rows for 1 and 2 January 2025, Sarawak time
  fixture_query text;
  -- The fixture node's rows as typed columns, for the verify queries
  as_rows constant text := 'jsonb_to_recordset($1) as r(sensor_node_id uuid,
    bucket_start timestamptz, avg_temperature numeric, avg_humidity numeric,
    motion_events bigint, readings bigint)';
begin
  select u.id into admin_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'admin@test.com' and p.role = 'admin';
  select u.id into officer_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'conservation_officer@test.com' and p.role = 'conservation_officer';
  select u.id into botanist_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'botanists@test.com' and p.role = 'botanist';

  if admin_id is null or officer_id is null or botanist_id is null then
    insert into sensor_chart_results (check_name, result, detail)
    values ('setup: test accounts exist with the right roles', 'FAIL', format(
      'admin %s, officer %s, botanist %s',
      case when admin_id is null then 'missing' else 'found' end,
      case when officer_id is null then 'missing' else 'found' end,
      case when botanist_id is null then 'missing' else 'found' end
    ));
    return;
  end if;

  if to_regprocedure('public.report_sensor_chart(timestamptz, timestamptz, text)') is null then
    insert into sensor_chart_results (check_name, result, detail)
    values ('setup: migration 016 is applied', 'FAIL', 'report_sensor_chart does not exist');
    return;
  end if;

  -- ---------- grants ----------
  insert into sensor_chart_results (check_name, result, detail)
  select 'grants: authenticated can execute, anon and PUBLIC cannot',
    case when authenticated_can and not anon_can and not public_can then 'PASS' else 'FAIL' end,
    format('authenticated %s, anon %s, PUBLIC %s', authenticated_can, anon_can, public_can)
  from (
    select
      has_function_privilege('authenticated',
        'public.report_sensor_chart(timestamptz, timestamptz, text)', 'execute') as authenticated_can,
      has_function_privilege('anon',
        'public.report_sensor_chart(timestamptz, timestamptz, text)', 'execute') as anon_can,
      exists (
        select 1
        from pg_proc pr, aclexplode(coalesce(pr.proacl, acldefault('f', pr.proowner))) acl
        where pr.oid = 'public.report_sensor_chart(timestamptz, timestamptz, text)'::regprocedure
          and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ) as public_can
  ) grants;

  insert into sensor_chart_results (check_name, result, detail)
  select 'function is security invoker',
    case when not prosecdef then 'PASS' else 'FAIL' end,
    case when prosecdef then 'security definer would skip RLS on sensor_readings' else null end
  from pg_proc
  where oid = 'public.report_sensor_chart(timestamptz, timestamptz, text)'::regprocedure;

  -- ---------- fixtures, created with no signed-in user ----------
  insert into public.species (scientific_name) values ('CHART-TEST species')
    returning id into fixture_species;
  insert into public.plants (species_id, latitude, longitude, morphological_notes, recorded_by)
    values (fixture_species, 3.8, 113.7, 'CHART-TEST', officer_id)
    returning id into fixture_plant;
  insert into public.sensor_nodes (plant_id, node_identifier, latitude, longitude)
    values (fixture_plant, 'CHART-TEST-NODE', 3.8, 113.7)
    returning id into fixture_node;

  -- Inside the default alert limits, so the threshold trigger raises no alerts
  insert into public.sensor_readings
    (sensor_node_id, temperature, humidity, motion_detected, recorded_at)
  values
    (fixture_node, 24.0, 80, false, '2025-01-01 01:10:00+08'),
    (fixture_node, 25.0, 90, true,  '2025-01-01 01:50:00+08'),
    (fixture_node, 30.0, 70, false, '2025-01-01 23:30:00+08'),
    -- 2 January in Sarawak, 1 January (16:10) in UTC
    (fixture_node, null, 75, true,  '2025-01-02 00:10:00+08'),
    -- Exactly at p_to below, so left out (p_to is exclusive)
    (fixture_node, 26.0, 85, false, '2025-01-03 00:00:00+08');

  fixture_query := format(
    $sql$select * from public.report_sensor_chart('2025-01-01 00:00+08', '2025-01-03 00:00+08', %%L)
         where sensor_node_id = %L$sql$,
    fixture_node
  );

  -- ---------- officer and admin get rows ----------
  perform pg_temp.run_check(
    'officer gets hourly rows, grouped in Sarawak time',
    'authenticated', officer_id,
    format(fixture_query, 'hour'),
    null,
    format($sql$select
      (select count(*) from %1$s) = 3
      and exists (select 1 from %1$s where r.bucket_start = '2025-01-01 01:00+08'
        and r.readings = 2 and r.avg_temperature = 24.5 and r.avg_humidity = 85.0
        and r.motion_events = 1)
      and exists (select 1 from %1$s where r.bucket_start = '2025-01-01 23:00+08'
        and r.readings = 1 and r.avg_temperature = 30.0 and r.motion_events = 0)
      and exists (select 1 from %1$s where r.bucket_start = '2025-01-02 00:00+08'
        and r.readings = 1 and r.avg_temperature is null and r.motion_events = 1)$sql$,
      as_rows)
  );

  perform pg_temp.run_check(
    'officer gets daily rows that start at Sarawak midnight',
    'authenticated', officer_id,
    format(fixture_query, 'day'),
    null,
    format($sql$select
      (select count(*) from %1$s) = 2
      and exists (select 1 from %1$s where r.bucket_start = '2025-01-01 00:00+08'
        and r.readings = 3 and r.motion_events = 1 and r.avg_temperature = 26.3)
      and exists (select 1 from %1$s where r.bucket_start = '2025-01-02 00:00+08'
        and r.readings = 1 and r.motion_events = 1)$sql$,
      as_rows)
  );

  perform pg_temp.run_check(
    'admin gets the same hourly rows',
    'authenticated', admin_id,
    format(fixture_query, 'hour'),
    null,
    format('select (select count(*) from %s) = 3', as_rows)
  );

  perform pg_temp.run_check(
    'p_bucket defaults to hour',
    'authenticated', officer_id,
    format(
      $sql$select * from public.report_sensor_chart('2025-01-01 00:00+08', '2025-01-03 00:00+08')
           where sensor_node_id = %L$sql$,
      fixture_node
    ),
    null,
    format('select (select count(*) from %s) = 3', as_rows)
  );

  -- ---------- other callers ----------
  perform pg_temp.run_check(
    'botanist gets no rows (RLS on sensor_readings applies)',
    'authenticated', botanist_id,
    format(fixture_query, 'hour'),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'anon is refused',
    'anon', null,
    format(fixture_query, 'hour'),
    'permission denied for function'
  );

  -- ---------- bad arguments ----------
  perform pg_temp.run_check(
    'p_to before p_from is refused',
    'authenticated', officer_id,
    $sql$select * from public.report_sensor_chart('2025-01-03 00:00+08', '2025-01-01 00:00+08')$sql$,
    'end of the period is before the start'
  );

  perform pg_temp.run_check(
    'a range over 31 days is refused',
    'authenticated', officer_id,
    $sql$select * from public.report_sensor_chart('2025-01-01 00:00+08', '2025-02-01 00:00:01+08')$sql$,
    'at most 31 days'
  );

  perform pg_temp.run_check(
    'a range of exactly 31 days is allowed',
    'authenticated', officer_id,
    $sql$select * from public.report_sensor_chart('2025-01-01 00:00+08', '2025-02-01 00:00+08')$sql$
  );

  perform pg_temp.run_check(
    'a missing p_from is refused',
    'authenticated', officer_id,
    $sql$select * from public.report_sensor_chart(null, '2025-01-03 00:00+08')$sql$,
    'both a start and an end'
  );

  perform pg_temp.run_check(
    'a missing p_to is refused',
    'authenticated', officer_id,
    $sql$select * from public.report_sensor_chart('2025-01-01 00:00+08', null)$sql$,
    'both a start and an end'
  );

  perform pg_temp.run_check(
    'a bucket other than hour or day is refused',
    'authenticated', officer_id,
    $sql$select * from public.report_sensor_chart('2025-01-01 00:00+08', '2025-01-03 00:00+08', 'week')$sql$,
    'by hour or day'
  );
exception
  -- A setup error becomes a FAIL row so the script still reaches the rollback below
  when others then
    insert into sensor_chart_results (check_name, result, detail)
    values ('setup failed, so the checks did not run', 'FAIL', sqlerrm);
end;
$$;

select check_name, result, detail from sensor_chart_results order by position;

rollback;
