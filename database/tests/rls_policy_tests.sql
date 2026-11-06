-- =====================================================================
-- RLS policy test cases (issue #27)
-- Checks that the botanist, conservation officer, admin and guest role
-- boundaries hold, using the test accounts and the seed data from
-- database/seed/.
--
-- HOW TO RUN
--   Paste this whole file into the Supabase SQL Editor and click Run once.
--   The result is one row per test with PASS, FAIL or SKIP.
--
-- IT CHANGES NOTHING
--   Every test runs inside a block that is undone straight after, so no
--   real data is added, edited or deleted. The helper function and the
--   results table are temporary and disappear when the session ends.
--   Safe to run as many times as you like.
--
-- HOW A TEST WORKS
--   rls_check(id, who, description, expected, sql [, setup])
--   - who: guest (not logged in), botanist, officer or admin
--   - The SQL runs as that user, with the same rules the apps get.
--   - A SELECT test gives back a value (usually a count).
--   - Any other statement gives back the number of rows it changed,
--     or "blocked" if the database refused it with an error.
--   - expected "denied" passes when the action was blocked, or when it
--     changed 0 rows. Either way the user could not do it.
--   - Placeholders filled in before each test:
--     {B} botanist id, {O} officer id, {A} admin id,
--     {SPECIES} Nepenthes rafflesiana, {PENDING} / {APPROVED} a pending /
--     approved plant recorded by the botanist, {NODE} any sensor node.
--     If one is missing (for example no sensor nodes yet), the test is
--     marked SKIP instead of giving a misleading result.
-- =====================================================================

drop table if exists rls_results;
create temp table rls_results (
  test_id text,
  who text,
  test text,
  expected text,
  actual text,
  result text,
  detail text
);

create or replace function pg_temp.rls_check(
  p_id text,
  p_who text,
  p_test text,
  p_expected text,
  p_sql text,
  p_setup text default null
) returns void
language plpgsql
as $fn$
declare
  v_b uuid := (select id from auth.users where email = 'botanists@test.com');
  v_o uuid := (select id from auth.users where email = 'conservation_officer@test.com');
  v_a uuid := (select id from auth.users where email = 'admin@test.com');
  v_keys text[] := array['{B}', '{O}', '{A}', '{SPECIES}', '{PENDING}', '{APPROVED}', '{NODE}'];
  v_vals text[];
  v_uid uuid;
  v_sql text := p_sql;
  v_setup text := p_setup;
  v_actual text;
  v_detail text;
  v_rows bigint;
begin
  v_vals := array[
    v_b::text,
    v_o::text,
    v_a::text,
    (select id::text from species where scientific_name = 'Nepenthes rafflesiana'),
    (select id::text from plants where recorded_by = v_b and review_status = 'pending_review'
      order by (morphological_notes like '[seed]%') desc, recorded_at limit 1),
    (select id::text from plants where recorded_by = v_b and review_status = 'approved'
      order by (morphological_notes like '[seed]%') desc, recorded_at limit 1),
    (select id::text from sensor_nodes order by node_identifier limit 1)
  ];

  v_uid := case p_who when 'botanist' then v_b when 'officer' then v_o when 'admin' then v_a end;
  if p_who <> 'guest' and v_uid is null then
    insert into rls_results values (p_id, p_who, p_test, p_expected, 'skipped', 'SKIP',
      'Test account for ' || p_who || ' not found');
    return;
  end if;

  -- Fill in the placeholders while still running as the database owner
  for i in 1 .. array_length(v_keys, 1) loop
    if strpos(v_sql || coalesce(v_setup, ''), v_keys[i]) > 0 then
      if v_vals[i] is null then
        insert into rls_results values (p_id, p_who, p_test, p_expected, 'skipped', 'SKIP',
          'No test data for ' || v_keys[i]);
        return;
      end if;
      v_sql := replace(v_sql, v_keys[i], quote_literal(v_vals[i]));
      v_setup := replace(v_setup, v_keys[i], quote_literal(v_vals[i]));
    end if;
  end loop;

  -- Act as the user, run the test, then undo everything in this block
  begin
    if p_who = 'guest' then
      perform set_config('request.jwt.claims', '{"role":"anon"}', true);
      perform set_config('role', 'anon', true);
    else
      perform set_config('request.jwt.claims',
        json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
      perform set_config('role', 'authenticated', true);
    end if;

    if v_setup is not null then
      execute v_setup;
    end if;

    if v_sql ~* '^\s*select' then
      execute v_sql into v_actual;
    else
      execute v_sql;
      get diagnostics v_rows = row_count;
      v_actual := v_rows::text;
    end if;

    raise exception 'rls_test_undo';
  exception when others then
    if sqlerrm <> 'rls_test_undo' then
      v_actual := 'blocked';
      v_detail := sqlerrm;
    end if;
  end;

  insert into rls_results values (
    p_id, p_who, p_test, p_expected, coalesce(v_actual, '(no value)'),
    case
      when v_actual = p_expected then 'PASS'
      when p_expected = 'denied' and v_actual in ('blocked', '0') then 'PASS'
      else 'FAIL'
    end,
    v_detail
  );
end;
$fn$;

-- ---------------------------------------------------------------------
-- Plants
-- ---------------------------------------------------------------------
select pg_temp.rls_check('RLS-01', 'guest',
  'Read the plants table directly', '0',
  $$select count(*)::text from plants$$);

select pg_temp.rls_check('RLS-02', 'guest',
  'Read plants_public: approved plants only',
  (select count(*)::text from plants where review_status = 'approved'),
  $$select count(*)::text from plants_public$$);

select pg_temp.rls_check('RLS-03', 'guest',
  'Monitored plant GPS in plants_public is rounded to 2 decimals (count of unrounded)', '0',
  $$select count(*)::text from plants_public
    where is_monitored
      and (latitude::numeric <> round(latitude::numeric, 2)
        or longitude::numeric <> round(longitude::numeric, 2))$$);

select pg_temp.rls_check('RLS-04', 'guest',
  'Edit an approved plant through plants_public', 'denied',
  $$update plants_public set height_cm = 1 where id = {APPROVED}$$);

select pg_temp.rls_check('RLS-05', 'botanist',
  'Read plants recorded by someone else', '0',
  $$select count(*)::text from plants where recorded_by <> {B}$$);

select pg_temp.rls_check('RLS-06', 'botanist',
  'Register a pending plant as themselves', '1',
  $$insert into plants (species_id, latitude, longitude, recorded_by)
    values ({SPECIES}, 3.81, 113.78, {B})$$);

select pg_temp.rls_check('RLS-07', 'botanist',
  'Register a plant that is already approved', 'denied',
  $$insert into plants (species_id, latitude, longitude, recorded_by, review_status)
    values ({SPECIES}, 3.81, 113.78, {B}, 'approved')$$);

select pg_temp.rls_check('RLS-08', 'botanist',
  'Register a plant under the officer''s name', 'denied',
  $$insert into plants (species_id, latitude, longitude, recorded_by)
    values ({SPECIES}, 3.81, 113.78, {O})$$);

select pg_temp.rls_check('RLS-09', 'botanist',
  'Approve their own pending plant', 'denied',
  $$update plants set review_status = 'approved', reviewed_by = {B}, reviewed_at = now()
    where id = {PENDING}$$);

select pg_temp.rls_check('RLS-10', 'botanist',
  'Change the QR code of their own pending plant', 'denied',
  $$update plants set qr_code = 'NIAH-HACKED' where id = {PENDING}$$);

select pg_temp.rls_check('RLS-11', 'botanist',
  'Edit their own plant after it was approved', 'denied',
  $$update plants set morphological_notes = 'changed' where id = {APPROVED}$$);

select pg_temp.rls_check('RLS-12', 'officer',
  'Read all plants', (select count(*)::text from plants),
  $$select count(*)::text from plants$$);

select pg_temp.rls_check('RLS-13', 'officer',
  'Approve a botanist''s pending plant', '1',
  $$update plants set review_status = 'approved', reviewed_by = {O}, reviewed_at = now()
    where id = {PENDING}$$);

select pg_temp.rls_check('RLS-14', 'officer',
  'Approve a plant they recorded themselves', 'denied',
  $$update plants set review_status = 'approved', reviewed_by = {O}, reviewed_at = now()
    where morphological_notes = 'rls-test-14'$$,
  $$insert into plants (species_id, latitude, longitude, recorded_by, morphological_notes)
    values ({SPECIES}, 3.81, 113.78, {O}, 'rls-test-14')$$);

select pg_temp.rls_check('RLS-15', 'officer',
  'Approve a plant with the admin named as reviewer', 'denied',
  $$update plants set review_status = 'approved', reviewed_by = {A}, reviewed_at = now()
    where id = {PENDING}$$);

-- ---------------------------------------------------------------------
-- Species
-- ---------------------------------------------------------------------
select pg_temp.rls_check('RLS-16', 'guest',
  'Read species', (select count(*)::text from species),
  $$select count(*)::text from species$$);

select pg_temp.rls_check('RLS-17', 'botanist',
  'Edit a species', 'denied',
  $$update species set description = 'changed' where id = {SPECIES}$$);

select pg_temp.rls_check('RLS-18', 'officer',
  'Edit a species', '1',
  $$update species set description = 'changed' where id = {SPECIES}$$);

-- ---------------------------------------------------------------------
-- Profiles (user accounts)
-- ---------------------------------------------------------------------
select pg_temp.rls_check('RLS-19', 'botanist',
  'Read all profiles (should see only their own)', '1',
  $$select count(*)::text from profiles$$);

select pg_temp.rls_check('RLS-20', 'botanist',
  'Make themselves admin', 'denied',
  $$update profiles set role = 'admin' where id = {B}$$);

select pg_temp.rls_check('RLS-21', 'admin',
  'Read all profiles', (select count(*)::text from profiles),
  $$select count(*)::text from profiles$$);

select pg_temp.rls_check('RLS-22', 'admin',
  'Change their own role', 'denied',
  $$update profiles set role = 'botanist' where id = {A}$$);

select pg_temp.rls_check('RLS-23', 'officer',
  'Create a new profile', 'denied',
  $$insert into profiles (id, full_name, role) values ({O}, 'Fake user', 'admin')$$);

-- ---------------------------------------------------------------------
-- Sensors and reports
-- ---------------------------------------------------------------------
select pg_temp.rls_check('RLS-24', 'botanist',
  'Read sensor nodes, readings and alerts', '0',
  $$select ((select count(*) from sensor_nodes)
          + (select count(*) from sensor_readings)
          + (select count(*) from alerts))::text$$);

select pg_temp.rls_check('RLS-25', 'officer',
  'Read sensor nodes', (select count(*)::text from sensor_nodes),
  $$select count(*)::text from sensor_nodes$$);

select pg_temp.rls_check('RLS-26', 'officer',
  'Change the global alert thresholds', 'denied',
  $$update alert_thresholds set temperature_max = temperature_max + 1
    where sensor_node_id is null$$);

select pg_temp.rls_check('RLS-27', 'admin',
  'Change the global alert thresholds', '1',
  $$update alert_thresholds set temperature_max = temperature_max + 1
    where sensor_node_id is null$$);

select pg_temp.rls_check('RLS-28', 'guest',
  'Insert a fake sensor reading', 'denied',
  $$insert into sensor_readings (sensor_node_id, temperature, humidity, recorded_at)
    values ({NODE}, 99, 99, now())$$);

select pg_temp.rls_check('RLS-29', 'guest',
  'Run a report function', 'denied',
  $$select count(*)::text from report_species_summary()$$);

-- ---------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------
select test_id, who, test, expected, actual, result, detail
from rls_results
order by test_id;
