-- Tests for database/schema/021_sensitive_locations.sql. Run the whole file in the SQL Editor after
-- applying the migration; the PASS/FAIL table is the result.
--
-- Everything is rolled back at the end, and each check also undoes its own changes, so no check
-- depends on another. Fixture species, plants, photo rows and storage.objects rows are all named
-- SENSLOC-TEST (species "SENSLOC-TEST ...", notes 'SENSLOC-TEST', files ".../SENSLOC-TEST-*.jpg"),
-- never stay in the database, and nothing is uploaded to Storage. Needs these existing accounts,
-- which are only read: admin@test.com, conservation_officer@test.com, botanists@test.com
--
-- Storage only signs a URL for a file the caller can select from storage.objects, so "anon can
-- select this object" is what these checks use for "anon can create a signed URL for it".

begin;

create temp table sensitive_locations_results (
  position serial primary key,
  check_name text not null,
  result text not null,
  detail text
);

-- Same helper as database/tests/017_multiple_photos_test.sql.
-- Runs one statement as acting_role ('authenticated' or 'anon', with acting_user as the signed-in
-- user), or with no signed-in user when acting_role is null, and keeps the rows it returns as a
-- jsonb array. Then undoes the statement and the role change.
--   expected_error: the check passes if the statement fails with this text in its message.
--   Without it, the check passes if the statement succeeds and verify (a query run afterwards
--   with full access, given the rows as $1, returning true or false) agrees.
create function pg_temp.run_check(
  check_name text,
  acting_role text,
  acting_user uuid,
  statement text,
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
    if acting_role is not null then
      execute format('set local role %I', acting_role);
      execute format(
        'set local request.jwt.claims = %L',
        case when acting_user is null
          then json_build_object('role', acting_role)
          else json_build_object('sub', acting_user, 'role', acting_role)
        end::text
      );
    end if;

    execute format('with t as (%s) select coalesce(jsonb_agg(t), ''[]''::jsonb) from t', statement)
      into result_rows;

    reset role;
    if verify is not null then
      execute verify into verified using result_rows;
    end if;

    raise exception 'undo this check' using errcode = 'SL001';
  exception
    when sqlstate 'SL001' then
      null;
    when others then
      error_message := sqlerrm;
  end;

  if expected_error is not null then
    passed := coalesce(error_message ilike '%' || expected_error || '%', false);
  else
    passed := error_message is null and verified is true;
  end if;

  insert into sensitive_locations_results (check_name, result, detail)
  values (
    check_name,
    case when passed then 'PASS' else 'FAIL' end,
    coalesce(error_message, jsonb_array_length(result_rows) || ' row(s)'
      || case when verified is true then '' else ', not as expected: ' || result_rows::text end)
  );
  raise notice '%: %', case when passed then 'PASS' else 'FAIL' end, check_name;
end;
$$;

-- Exact fixture position: 5 decimals, so rounding to 2 is visible (3.82, 113.77)
create function pg_temp.lat() returns double precision language sql immutable as $$ select 3.81678::double precision $$;
create function pg_temp.lon() returns double precision language sql immutable as $$ select 113.77349::double precision $$;

create function pg_temp.photo_path(owner_id uuid, label text) returns text
language sql immutable
as $$ select owner_id::text || '/SENSLOC-TEST-' || label || '.jpg' $$;

-- A fixture plant with one photo (position 0) in the recorder's folder, created with no signed-in
-- user. The 017 trigger copies the photo into plants.photo_url.
create function pg_temp.add_plant(
  species uuid, recorder uuid, status text, monitored boolean, label text
) returns uuid
language plpgsql
as $$
declare
  new_id uuid;
begin
  insert into public.plants
    (species_id, latitude, longitude, location_description, morphological_notes, recorded_by,
     review_status, is_monitored)
  values (species, pg_temp.lat(), pg_temp.lon(), 'SENSLOC-TEST exact spot', 'SENSLOC-TEST',
    recorder, status::plant_review_status, monitored)
  returning id into new_id;

  insert into public.plant_photos (plant_id, storage_path, position, uploaded_by)
  values (new_id, pg_temp.photo_path(recorder, label), 0, recorder);
  return new_id;
end;
$$;

-- "The rows in $1 are exactly these ids", for verify queries
create function pg_temp.same_ids(rows jsonb, ids uuid[]) returns boolean
language sql immutable
as $$
  select coalesce((select array_agg((r ->> 'id')::uuid order by (r ->> 'id')::uuid)
                   from jsonb_array_elements(rows) r), '{}')
       = coalesce((select array_agg(i order by i) from unnest(ids) i), '{}')
$$;

do $$
declare
  admin_id uuid;
  officer_id uuid;
  botanist_id uuid;
  sp_lc uuid;
  sp_nt uuid;
  sp_vu uuid;
  sp_en uuid;
  sp_cr uuid;
  -- Fixture plants. bot_ = recorded by the botanist, admin_ = by the admin. Approved unless named.
  bot_lc uuid;
  bot_nt uuid;
  bot_vu uuid;
  bot_en uuid;
  bot_cr uuid;
  bot_lc_monitored uuid;
  bot_cr_pending uuid;
  admin_lc uuid;
  admin_cr uuid;
  sensitive uuid[];
  open_plants uuid[];
  all_fixtures uuid[];
  storage_ready boolean := true;
begin
  select u.id into admin_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'admin@test.com' and p.role = 'admin';
  select u.id into officer_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'conservation_officer@test.com' and p.role = 'conservation_officer';
  select u.id into botanist_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'botanists@test.com' and p.role = 'botanist';

  if admin_id is null or officer_id is null or botanist_id is null then
    insert into sensitive_locations_results (check_name, result, detail)
    values ('setup: test accounts exist with the right roles', 'FAIL', format(
      'admin %s, officer %s, botanist %s',
      case when admin_id is null then 'missing' else 'found' end,
      case when officer_id is null then 'missing' else 'found' end,
      case when botanist_id is null then 'missing' else 'found' end
    ));
    return;
  end if;

  if to_regprocedure('public.plant_location_is_sensitive(boolean, conservation_status)') is null then
    insert into sensitive_locations_results (check_name, result, detail)
    values ('setup: migration 021 is applied', 'FAIL', 'plant_location_is_sensitive does not exist');
    return;
  end if;

  -- ---------- the rule itself ----------
  insert into sensitive_locations_results (check_name, result, detail)
  select 'conservation_status enum still has exactly the 5 values 021 was written for',
    case when vals = array['least_concern', 'near_threatened', 'vulnerable', 'endangered',
        'critically_endangered'] then 'PASS' else 'FAIL' end,
    array_to_string(vals, ', ')
  from (select enum_range(null::conservation_status)::text[] as vals) e;

  insert into sensitive_locations_results (check_name, result, detail)
  select 'plant_location_is_sensitive: monitored, VU, EN, CR (and missing values) yes; LC, NT no',
    case when wrong = 0 then 'PASS' else 'FAIL' end,
    format('%s of %s combinations wrong', wrong, total)
  from (
    select count(*) filter (
             where public.plant_location_is_sensitive(m, s) is distinct from expected) as wrong,
      count(*) as total
    from (values
      (false, 'least_concern'::conservation_status, false),
      (false, 'near_threatened', false),
      (false, 'vulnerable', true),
      (false, 'endangered', true),
      (false, 'critically_endangered', true),
      (true, 'least_concern', true),
      (true, 'near_threatened', true),
      (true, 'critically_endangered', true),
      (null, 'least_concern', true),
      (false, null, true)
    ) t(m, s, expected)
  ) truth;

  -- ---------- security settings and grants kept from 005/013/017 ----------
  insert into sensitive_locations_results (check_name, result, detail)
  select 'plants_public still runs as its owner (no security_invoker), as in 005/017',
    case when not coalesce(reloptions @> array['security_invoker=true'], false)
      then 'PASS' else 'FAIL' end,
    coalesce(array_to_string(reloptions, ', '), 'no options')
  from pg_class where oid = 'public.plants_public'::regclass;

  insert into sensitive_locations_results (check_name, result, detail)
  select 'functions: plant_is_public security definer + stable, plant_location_is_sensitive '
      || 'security invoker + immutable, both search_path=public',
    case when count(*) = 2
        and bool_and(coalesce('search_path=public' = any (proconfig), false))
        and bool_and(prosecdef = (proname = 'plant_is_public'))
        and bool_and(provolatile::text = case proname when 'plant_is_public' then 's' else 'i' end)
      then 'PASS' else 'FAIL' end,
    string_agg(format('%s: definer %s, volatility %s, config %s',
      proname, prosecdef, provolatile, proconfig), '; ')
  from pg_proc
  where pronamespace = 'public'::regnamespace
    and proname in ('plant_is_public', 'plant_location_is_sensitive');

  insert into sensitive_locations_results (check_name, result, detail)
  select 'grants: plants_public select-only for anon and authenticated (013)',
    case when can_read and not can_write then 'PASS' else 'FAIL' end,
    format('select %s, writes %s', can_read, can_write)
  from (
    select
      has_table_privilege('anon', 'public.plants_public', 'select')
        and has_table_privilege('authenticated', 'public.plants_public', 'select') as can_read,
      has_table_privilege('anon', 'public.plants_public', 'insert, update, delete, truncate')
        or has_table_privilege('authenticated', 'public.plants_public', 'insert, update, delete, truncate')
        as can_write
  ) grants;

  insert into sensitive_locations_results (check_name, result, detail)
  select 'grants: both functions executable by anon and authenticated, not via PUBLIC',
    case when callable and not via_public then 'PASS' else 'FAIL' end,
    format('anon and authenticated %s, PUBLIC %s', callable, via_public)
  from (
    select
      has_function_privilege('anon', 'public.plant_is_public(uuid)', 'execute')
        and has_function_privilege('authenticated', 'public.plant_is_public(uuid)', 'execute')
        and has_function_privilege('anon',
          'public.plant_location_is_sensitive(boolean, conservation_status)', 'execute')
        and has_function_privilege('authenticated',
          'public.plant_location_is_sensitive(boolean, conservation_status)', 'execute') as callable,
      exists (
        select 1
        from pg_proc pr, aclexplode(coalesce(pr.proacl, acldefault('f', pr.proowner))) acl
        where pr.oid in ('public.plant_is_public(uuid)'::regprocedure,
            'public.plant_location_is_sensitive(boolean, conservation_status)'::regprocedure)
          and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ) as via_public
  ) grants;

  insert into sensitive_locations_results (check_name, result, detail)
  select 'plants_public: the 017 columns plus location_withheld and location_label; '
      || 'no location_description',
    case when cols = 'id,species_id,qr_code,height_cm,morphological_notes,photo_url,latitude,'
        || 'longitude,is_monitored,recorded_at,has_photos,location_withheld,location_label'
      then 'PASS' else 'FAIL' end,
    cols
  from (
    select string_agg(column_name::text, ',' order by ordinal_position) as cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'plants_public'
  ) view_columns;

  -- ---------- fixtures, created with no signed-in user ----------
  insert into public.species (scientific_name, conservation_status)
    values ('SENSLOC-TEST least concern', 'least_concern') returning id into sp_lc;
  insert into public.species (scientific_name, conservation_status)
    values ('SENSLOC-TEST near threatened', 'near_threatened') returning id into sp_nt;
  insert into public.species (scientific_name, conservation_status)
    values ('SENSLOC-TEST vulnerable', 'vulnerable') returning id into sp_vu;
  insert into public.species (scientific_name, conservation_status)
    values ('SENSLOC-TEST endangered', 'endangered') returning id into sp_en;
  insert into public.species (scientific_name, conservation_status)
    values ('SENSLOC-TEST critically endangered', 'critically_endangered') returning id into sp_cr;

  bot_lc := pg_temp.add_plant(sp_lc, botanist_id, 'approved', false, 'lc');
  bot_nt := pg_temp.add_plant(sp_nt, botanist_id, 'approved', false, 'nt');
  bot_vu := pg_temp.add_plant(sp_vu, botanist_id, 'approved', false, 'vu');
  bot_en := pg_temp.add_plant(sp_en, botanist_id, 'approved', false, 'en');
  bot_cr := pg_temp.add_plant(sp_cr, botanist_id, 'approved', false, 'cr');
  bot_lc_monitored := pg_temp.add_plant(sp_lc, botanist_id, 'approved', true, 'lc-monitored');
  bot_cr_pending := pg_temp.add_plant(sp_cr, botanist_id, 'pending_review', false, 'cr-pending');
  admin_lc := pg_temp.add_plant(sp_lc, admin_id, 'approved', false, 'admin-lc');
  admin_cr := pg_temp.add_plant(sp_cr, admin_id, 'approved', false, 'admin-cr');

  sensitive := array[bot_vu, bot_en, bot_cr, bot_lc_monitored, admin_cr];
  open_plants := array[bot_lc, bot_nt, admin_lc];
  all_fixtures := sensitive || open_plants || bot_cr_pending;

  begin
    insert into storage.objects (bucket_id, name)
    select 'plant-photos', storage_path from public.plant_photos
      where storage_path like '%/SENSLOC-TEST-%';
  exception
    when others then
      storage_ready := false;
      insert into sensitive_locations_results (check_name, result, detail)
      values ('setup: storage fixtures could not be created, so the storage checks were skipped',
        'FAIL', sqlerrm);
  end;

  -- ---------- guests: plants_public ----------
  perform pg_temp.run_check(
    'anon: VU, EN, CR and monitored plants have null coordinates, location_withheld, the park label, no photos',
    'anon', null,
    format($sql$select * from public.plants_public where id = any (%L::uuid[])$sql$, sensitive),
    null,
    format(
      $sql$select pg_temp.same_ids($1, %L::uuid[])
             and (select bool_and(r -> 'latitude' = 'null'::jsonb
                    and r -> 'longitude' = 'null'::jsonb
                    and (r ->> 'location_withheld')::boolean
                    and r ->> 'location_label' = 'Niah National Park'
                    and not (r ->> 'has_photos')::boolean
                    and r -> 'photo_url' = 'null'::jsonb)
                  from jsonb_array_elements($1) r)$sql$,
      sensitive
    )
  );

  perform pg_temp.run_check(
    'anon: LC and NT plants have coordinates rounded to 2 decimals, not withheld, with photos',
    'anon', null,
    format($sql$select * from public.plants_public where id = any (%L::uuid[])$sql$, open_plants),
    null,
    format(
      $sql$select pg_temp.same_ids($1, %L::uuid[])
             and (select bool_and((r ->> 'latitude')::numeric = 3.82
                    and (r ->> 'longitude')::numeric = 113.77
                    and not (r ->> 'location_withheld')::boolean
                    and r ->> 'location_label' = 'Niah National Park'
                    and (r ->> 'has_photos')::boolean
                    and r ->> 'photo_url' is not null)
                  from jsonb_array_elements($1) r)$sql$,
      open_plants
    )
  );

  perform pg_temp.run_check(
    'anon: morphological_notes null for VU, EN, CR and monitored plants, kept for LC and NT',
    'anon', null,
    format($sql$select id, morphological_notes from public.plants_public where id = any (%L::uuid[])$sql$,
      sensitive || open_plants),
    null,
    format(
      $sql$select pg_temp.same_ids($1, %L::uuid[])
             and (select bool_and(case when (r ->> 'id')::uuid = any (%L::uuid[])
                                    then r -> 'morphological_notes' = 'null'::jsonb
                                    else r ->> 'morphological_notes' = 'SENSLOC-TEST' end)
                  from jsonb_array_elements($1) r)$sql$,
      sensitive || open_plants, sensitive
    )
  );

  perform pg_temp.run_check(
    'anon: no exact coordinates for any approved plant in the database (count of unrounded)',
    'anon', null,
    $sql$select id from public.plants_public
         where latitude::numeric <> round(latitude::numeric, 2)
            or longitude::numeric <> round(longitude::numeric, 2)$sql$,
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'anon: location_description can''t be read through plants_public',
    'anon', null,
    'select location_description from public.plants_public',
    'location_description'
  );

  perform pg_temp.run_check(
    'anon: still can''t read the plants table (005)',
    'anon', null,
    format($sql$select id from public.plants where id = any (%L::uuid[])$sql$, all_fixtures),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'anon: pending plants are still not in plants_public',
    'anon', null,
    format($sql$select id from public.plants_public where id = %L$sql$, bot_cr_pending),
    null,
    'select jsonb_array_length($1) = 0'
  );

  -- ---------- guests: photos ----------
  perform pg_temp.run_check(
    'anon: plant_photos of VU, EN, CR and monitored plants are hidden',
    'anon', null,
    format($sql$select plant_id from public.plant_photos where plant_id = any (%L::uuid[])$sql$,
      sensitive),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'anon: plant_photos of LC and NT plants are visible',
    'anon', null,
    format($sql$select plant_id as id from public.plant_photos where plant_id = any (%L::uuid[])$sql$,
      open_plants),
    null,
    format('select pg_temp.same_ids($1, %L::uuid[])', open_plants)
  );

  perform pg_temp.run_check(
    'anon: plant_is_public is false for every sensitive plant and true for LC and NT',
    'anon', null,
    format(
      $sql$select id, public.plant_is_public(id) as is_public
           from unnest(%L::uuid[]) id$sql$,
      sensitive || open_plants
    ),
    null,
    format(
      $sql$select bool_and((r ->> 'is_public')::boolean = ((r ->> 'id')::uuid = any (%L::uuid[])))
           from jsonb_array_elements($1) r$sql$,
      open_plants
    )
  );

  if storage_ready then
    perform pg_temp.run_check(
      'storage: anon can select (so sign URLs for) only the files of LC and NT plants',
      'anon', null,
      $sql$select name from storage.objects
           where bucket_id = 'plant-photos' and name like '%/SENSLOC-TEST-%'$sql$,
      null,
      format(
        $sql$select coalesce((select array_agg(r ->> 'name' order by r ->> 'name')
                              from jsonb_array_elements($1) r), '{}')
               = array(select unnest(array[%L, %L, %L]) order by 1)$sql$,
        pg_temp.photo_path(botanist_id, 'lc'), pg_temp.photo_path(botanist_id, 'nt'),
        pg_temp.photo_path(admin_id, 'admin-lc')
      )
    );

    perform pg_temp.run_check(
      'storage: anon can''t select the file of a CR plant',
      'anon', null,
      format(
        $sql$select name from storage.objects where bucket_id = 'plant-photos' and name = %L$sql$,
        pg_temp.photo_path(botanist_id, 'cr')
      ),
      null,
      'select jsonb_array_length($1) = 0'
    );
  end if;

  -- ---------- conservation officer and admin: unchanged ----------
  perform pg_temp.run_check(
    'officer: exact coordinates and location_description for every fixture plant, sensitive or not',
    'authenticated', officer_id,
    format(
      $sql$select id, latitude, longitude, location_description from public.plants
           where id = any (%L::uuid[])$sql$,
      all_fixtures
    ),
    null,
    format(
      $sql$select pg_temp.same_ids($1, %L::uuid[])
             and (select bool_and((r ->> 'latitude')::float8 = pg_temp.lat()
                    and (r ->> 'longitude')::float8 = pg_temp.lon()
                    and r ->> 'location_description' = 'SENSLOC-TEST exact spot')
                  from jsonb_array_elements($1) r)$sql$,
      all_fixtures
    )
  );

  perform pg_temp.run_check(
    'officer: sees every fixture photo row, sensitive or not',
    'authenticated', officer_id,
    format($sql$select plant_id as id from public.plant_photos where plant_id = any (%L::uuid[])$sql$,
      all_fixtures),
    null,
    format('select pg_temp.same_ids($1, %L::uuid[])', all_fixtures)
  );

  if storage_ready then
    perform pg_temp.run_check(
      'storage: officer can select every fixture file (006)',
      'authenticated', officer_id,
      $sql$select name from storage.objects
           where bucket_id = 'plant-photos' and name like '%/SENSLOC-TEST-%'$sql$,
      null,
      format('select jsonb_array_length($1) = %s', cardinality(all_fixtures))
    );
  end if;

  perform pg_temp.run_check(
    'admin: exact coordinates for every fixture plant',
    'authenticated', admin_id,
    format($sql$select id, latitude, longitude from public.plants where id = any (%L::uuid[])$sql$,
      all_fixtures),
    null,
    format(
      $sql$select pg_temp.same_ids($1, %L::uuid[])
             and (select bool_and((r ->> 'latitude')::float8 = pg_temp.lat()
                    and (r ->> 'longitude')::float8 = pg_temp.lon())
                  from jsonb_array_elements($1) r)$sql$,
      all_fixtures
    )
  );

  -- ---------- the recorder: unchanged ----------
  perform pg_temp.run_check(
    'recorder: exact coordinates and description of their own plants, including CR, monitored and pending',
    'authenticated', botanist_id,
    $sql$select id, latitude, longitude, location_description from public.plants
         where morphological_notes = 'SENSLOC-TEST'$sql$,
    null,
    format(
      $sql$select pg_temp.same_ids($1, %L::uuid[])
             and (select bool_and((r ->> 'latitude')::float8 = pg_temp.lat()
                    and (r ->> 'longitude')::float8 = pg_temp.lon()
                    and r ->> 'location_description' = 'SENSLOC-TEST exact spot')
                  from jsonb_array_elements($1) r)$sql$,
      array[bot_lc, bot_nt, bot_vu, bot_en, bot_cr, bot_lc_monitored, bot_cr_pending]
    )
  );

  perform pg_temp.run_check(
    'recorder: sees the photo rows of their own sensitive plants',
    'authenticated', botanist_id,
    format($sql$select plant_id as id from public.plant_photos where plant_id = any (%L::uuid[])$sql$,
      array[bot_vu, bot_en, bot_cr, bot_lc_monitored, bot_cr_pending]),
    null,
    format('select pg_temp.same_ids($1, %L::uuid[])',
      array[bot_vu, bot_en, bot_cr, bot_lc_monitored, bot_cr_pending])
  );

  if storage_ready then
    perform pg_temp.run_check(
      'storage: recorder can select the files of their own sensitive plants (006)',
      'authenticated', botanist_id,
      format(
        $sql$select name from storage.objects where bucket_id = 'plant-photos' and name in (%L, %L)$sql$,
        pg_temp.photo_path(botanist_id, 'cr'), pg_temp.photo_path(botanist_id, 'lc-monitored')
      ),
      null,
      'select jsonb_array_length($1) = 2'
    );
  end if;

  -- ---------- a botanist looking at someone else's plant gets the guest view ----------
  perform pg_temp.run_check(
    'botanist (not the recorder): someone else''s CR plant is withheld in plants_public, LC rounded',
    'authenticated', botanist_id,
    format($sql$select id, latitude, longitude, location_withheld from public.plants_public
                where id in (%L, %L)$sql$, admin_cr, admin_lc),
    null,
    format(
      $sql$select pg_temp.same_ids($1, array[%L, %L]::uuid[])
             and exists (select 1 from jsonb_array_elements($1) r where r ->> 'id' = %L
               and (r ->> 'location_withheld')::boolean and r -> 'latitude' = 'null'::jsonb)
             and exists (select 1 from jsonb_array_elements($1) r where r ->> 'id' = %L
               and not (r ->> 'location_withheld')::boolean and (r ->> 'latitude')::numeric = 3.82)$sql$,
      admin_cr, admin_lc, admin_cr, admin_lc
    )
  );

  perform pg_temp.run_check(
    'botanist (not the recorder): can''t read the photo rows of someone else''s CR plant, can for LC',
    'authenticated', botanist_id,
    format($sql$select plant_id as id from public.plant_photos where plant_id in (%L, %L)$sql$,
      admin_cr, admin_lc),
    null,
    format('select pg_temp.same_ids($1, array[%L]::uuid[])', admin_lc)
  );
exception
  -- A setup error becomes a FAIL row so the script still reaches the rollback below
  when others then
    insert into sensitive_locations_results (check_name, result, detail)
    values ('setup failed, so the checks did not run', 'FAIL', sqlerrm);
end;
$$;

select check_name, result, detail from sensitive_locations_results order by position;

rollback;
