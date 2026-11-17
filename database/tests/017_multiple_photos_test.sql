-- Tests for database/schema/017_multiple_photos.sql. Run the whole file in the SQL Editor after
-- applying the migration; the PASS/FAIL table is the result.
--
-- Everything is rolled back at the end, and each check also undoes its own changes, so no check
-- depends on another. The fixture species, plants, photo rows and storage.objects rows never stay
-- in the database; nothing is uploaded to Storage. Needs these existing accounts, which are only
-- read: admin@test.com, conservation_officer@test.com, botanists@test.com
--
-- Storage only signs a URL for a file the caller can select from storage.objects, so "anon can
-- select this object" is what these checks use for "anon can create a signed URL for it".
-- The backfill checks look at the real data, so run this file soon after applying 017.

begin;

create temp table multiple_photos_results (
  position serial primary key,
  check_name text not null,
  result text not null,
  detail text
);

-- Runs one statement as acting_role ('authenticated' or 'anon', with acting_user as the signed-in
-- user), or with no signed-in user when acting_role is null, and keeps the rows it returns as a
-- jsonb array. Then undoes the statement and the role change.
--   statement: a select, or an insert/update/delete with "returning". RLS refuses a select,
--   update or delete by returning fewer rows, with no error, so checks look at the rows.
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

    -- Reaching the handler below undoes the statement and the role change
    raise exception 'undo this check' using errcode = 'MP001';
  exception
    when sqlstate 'MP001' then
      null;
    when others then
      error_message := sqlerrm;
  end;

  if expected_error is not null then
    passed := coalesce(error_message ilike '%' || expected_error || '%', false);
  else
    passed := error_message is null and verified is true;
  end if;

  insert into multiple_photos_results (check_name, result, detail)
  values (
    check_name,
    case when passed then 'PASS' else 'FAIL' end,
    coalesce(error_message, jsonb_array_length(result_rows) || ' row(s)'
      || case when verified is true then '' else ', not as expected: ' || result_rows::text end)
  );
  raise notice '%: %', case when passed then 'PASS' else 'FAIL' end, check_name;
end;
$$;

-- A fixture file path in the recorder's own folder, like the mobile app's uploads
create function pg_temp.photo_path(owner_id uuid, label text) returns text
language sql immutable
as $$ select owner_id::text || '/PHOTO-TEST-' || label || '.jpg' $$;

-- A fixture plant, created with no signed-in user
create function pg_temp.add_plant(
  species uuid, recorder uuid, status text, monitored boolean default false
) returns uuid
language sql
as $$
  insert into public.plants
    (species_id, latitude, longitude, morphological_notes, recorded_by, review_status, is_monitored)
  values (species, 3.8, 113.7, 'PHOTO-TEST', recorder, status::plant_review_status, monitored)
  returning id
$$;

-- Fixture photos at positions 0, 1, 2... in the recorder's folder. Returns their ids in order.
create function pg_temp.add_photos(plant uuid, labels text[]) returns uuid[]
language sql
as $$
  with added as (
    insert into public.plant_photos (plant_id, storage_path, position, uploaded_by)
    select plant, pg_temp.photo_path(p.recorded_by, l.label), l.ord - 1, p.recorded_by
    from public.plants p, unnest(labels) with ordinality as l(label, ord)
    where p.id = plant
    returning id, position
  )
  select array_agg(id order by position) from added
$$;

do $$
declare
  admin_id uuid;
  officer_id uuid;
  botanist_id uuid;
  test_species uuid;
  species_with_photo uuid;
  species_without_photo uuid;
  species_full uuid;
  species_full_photos uuid[];
  -- Fixture plants. bot_ = recorded by the botanist.
  bot_pending_empty uuid;
  bot_pending_full uuid;
  bot_pending_two uuid;
  bot_approved uuid;
  bot_approved_no_photos uuid;
  bot_rejected uuid;
  officer_pending uuid;
  officer_monitored uuid;
  admin_approved uuid;
  two_photos uuid[];
  approved_photos uuid[];
  admin_photos uuid[];
  officer_pending_photos uuid[];
  storage_ready boolean := true;
  public_files text;
  species_url constant text := 'https://photo-test.invalid/species-photos/PHOTO-TEST-';
begin
  select u.id into admin_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'admin@test.com' and p.role = 'admin';
  select u.id into officer_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'conservation_officer@test.com' and p.role = 'conservation_officer';
  select u.id into botanist_id from auth.users u join public.profiles p on p.id = u.id
    where u.email = 'botanists@test.com' and p.role = 'botanist';

  if admin_id is null or officer_id is null or botanist_id is null then
    insert into multiple_photos_results (check_name, result, detail)
    values ('setup: test accounts exist with the right roles', 'FAIL', format(
      'admin %s, officer %s, botanist %s',
      case when admin_id is null then 'missing' else 'found' end,
      case when officer_id is null then 'missing' else 'found' end,
      case when botanist_id is null then 'missing' else 'found' end
    ));
    return;
  end if;

  if to_regclass('public.plant_photos') is null or to_regclass('public.species_photos') is null then
    insert into multiple_photos_results (check_name, result, detail)
    values ('setup: migration 017 is applied', 'FAIL', 'plant_photos or species_photos does not exist');
    return;
  end if;

  -- ---------- backfill, on the real data, before any fixtures exist ----------
  insert into multiple_photos_results (check_name, result, detail)
  select 'backfill: every plant with a photo_url has that file as its position 0 photo',
    case when missing = 0 then 'PASS' else 'FAIL' end,
    format('%s plant(s) with a photo_url checked, %s without a matching position 0 row%s',
      checked, missing,
      case when checked = 0 then ' (no plant has a photo_url, so this proves nothing)' else '' end)
  from (
    select count(*) as checked,
      count(*) filter (where not exists (
        select 1 from public.plant_photos pp
        where pp.plant_id = p.id and pp.position = 0 and pp.storage_path = p.photo_url
      )) as missing
    from public.plants p
    where p.photo_url is not null and p.photo_url <> ''
  ) backfill;

  insert into multiple_photos_results (check_name, result, detail)
  select 'backfill: every species with a reference_photo_url has it as its position 0 photo',
    case when missing = 0 then 'PASS' else 'FAIL' end,
    format('%s species with a reference_photo_url checked, %s without a matching position 0 row%s',
      checked, missing,
      case when checked = 0 then ' (no species has a photo, so this proves nothing)' else '' end)
  from (
    select count(*) as checked,
      count(*) filter (where not exists (
        select 1 from public.species_photos sp
        where sp.species_id = s.id and sp.position = 0 and sp.photo_url = s.reference_photo_url
      )) as missing
    from public.species s
    where s.reference_photo_url is not null and s.reference_photo_url <> ''
  ) backfill;

  insert into multiple_photos_results (check_name, result, detail)
  select 'backfill: no photo rows for plants and species without a photo',
    case when extra = 0 then 'PASS' else 'FAIL' end,
    format('%s photo row(s) whose plant or species has no cover', extra)
  from (
    select
      (select count(*) from public.plant_photos pp join public.plants p on p.id = pp.plant_id
        where p.photo_url is null or p.photo_url = '')
      + (select count(*) from public.species_photos sp join public.species s on s.id = sp.species_id
        where s.reference_photo_url is null or s.reference_photo_url = '') as extra
  ) backfill;

  insert into multiple_photos_results (check_name, result, detail)
  select 'backfill: every plant photo is credited to the plant''s recorder',
    case when wrong = 0 then 'PASS' else 'FAIL' end,
    format('%s photo row(s) with a different uploaded_by', wrong)
  from (
    select count(*) as wrong
    from public.plant_photos pp join public.plants p on p.id = pp.plant_id
    where pp.uploaded_by is distinct from p.recorded_by
  ) backfill;

  -- ---------- grants and function settings ----------
  insert into multiple_photos_results (check_name, result, detail)
  select 'plant-photos bucket is still private',
    case when is_public is false then 'PASS' else 'FAIL' end,
    format('public = %s', coalesce(is_public::text, 'bucket missing'))
  from (select (select public from storage.buckets where id = 'plant-photos') as is_public) bucket;

  insert into multiple_photos_results (check_name, result, detail)
  select 'grants: anon can read only plant_id, storage_path and position of plant_photos, and write nothing',
    case when reads_needed and not reads_extra and not writes then 'PASS' else 'FAIL' end,
    format('needed columns %s, uploaded_by/created_at/id %s, insert/update/delete/truncate %s',
      reads_needed, reads_extra, writes)
  from (
    select
      has_column_privilege('anon', 'public.plant_photos', 'plant_id', 'select')
        and has_column_privilege('anon', 'public.plant_photos', 'storage_path', 'select')
        and has_column_privilege('anon', 'public.plant_photos', 'position', 'select') as reads_needed,
      has_column_privilege('anon', 'public.plant_photos', 'uploaded_by', 'select')
        or has_column_privilege('anon', 'public.plant_photos', 'created_at', 'select')
        or has_column_privilege('anon', 'public.plant_photos', 'id', 'select') as reads_extra,
      has_table_privilege('anon', 'public.plant_photos', 'insert, update, delete, truncate')
        or has_any_column_privilege('anon', 'public.plant_photos', 'insert, update') as writes
  ) grants;

  insert into multiple_photos_results (check_name, result, detail)
  select 'grants: authenticated can update only the position of plant_photos, and not truncate',
    case when position_ok and not other_columns and not can_truncate then 'PASS' else 'FAIL' end,
    format('position %s, other columns %s, truncate %s', position_ok, other_columns, can_truncate)
  from (
    select
      has_column_privilege('authenticated', 'public.plant_photos', 'position', 'update') as position_ok,
      has_column_privilege('authenticated', 'public.plant_photos', 'storage_path', 'update')
        or has_column_privilege('authenticated', 'public.plant_photos', 'plant_id', 'update')
        or has_column_privilege('authenticated', 'public.plant_photos', 'uploaded_by', 'update')
        or has_column_privilege('authenticated', 'public.plant_photos', 'created_at', 'update')
        or has_column_privilege('authenticated', 'public.plant_photos', 'id', 'update') as other_columns,
      has_table_privilege('authenticated', 'public.plant_photos', 'truncate') as can_truncate
  ) grants;

  insert into multiple_photos_results (check_name, result, detail)
  select 'grants: anon can only read species_photos; authenticated cannot truncate it',
    case when anon_reads and not anon_writes and not auth_truncate then 'PASS' else 'FAIL' end,
    format('anon select %s, anon writes %s, authenticated truncate %s',
      anon_reads, anon_writes, auth_truncate)
  from (
    select
      has_table_privilege('anon', 'public.species_photos', 'select') as anon_reads,
      has_table_privilege('anon', 'public.species_photos', 'insert, update, delete, truncate') as anon_writes,
      has_table_privilege('authenticated', 'public.species_photos', 'truncate') as auth_truncate
  ) grants;

  insert into multiple_photos_results (check_name, result, detail)
  select 'grants: plants_public is still select-only for anon and authenticated (013)',
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

  insert into multiple_photos_results (check_name, result, detail)
  select 'functions: all 8 set search_path; only plant_is_public and sync_plant_cover_photo are security definer',
    case when function_count = 8 and missing_path = 0
        and definers = 'plant_is_public,sync_plant_cover_photo'
      then 'PASS' else 'FAIL' end,
    format('%s found, %s without search_path, security definer: %s',
      function_count, missing_path, definers)
  from (
    select
      count(*) as function_count,
      count(*) filter (where not coalesce('search_path=public' = any (proconfig), false)) as missing_path,
      coalesce(string_agg(proname::text, ',' order by proname) filter (where prosecdef), 'none')
        as definers
    from pg_proc
    where pronamespace = 'public'::regnamespace
      and proname in ('plant_is_public', 'limit_photos_per_record', 'sync_plant_cover_photo',
        'add_plant_cover_from_photo_url', 'sync_species_cover_photo',
        'sync_species_photos_from_cover', 'reorder_plant_photos', 'reorder_species_photos')
  ) functions;

  insert into multiple_photos_results (check_name, result, detail)
  select 'grants: reorder functions run for authenticated only; plant_is_public for anon and authenticated',
    case when reorder_auth and not reorder_anon and public_anon and public_auth and not via_public
      then 'PASS' else 'FAIL' end,
    format('reorder: authenticated %s, anon %s; plant_is_public: anon %s, authenticated %s; PUBLIC on any %s',
      reorder_auth, reorder_anon, public_anon, public_auth, via_public)
  from (
    select
      has_function_privilege('authenticated', 'public.reorder_plant_photos(uuid, uuid[])', 'execute')
        and has_function_privilege('authenticated', 'public.reorder_species_photos(uuid, uuid[])', 'execute')
        as reorder_auth,
      has_function_privilege('anon', 'public.reorder_plant_photos(uuid, uuid[])', 'execute')
        or has_function_privilege('anon', 'public.reorder_species_photos(uuid, uuid[])', 'execute')
        as reorder_anon,
      has_function_privilege('anon', 'public.plant_is_public(uuid)', 'execute') as public_anon,
      has_function_privilege('authenticated', 'public.plant_is_public(uuid)', 'execute') as public_auth,
      exists (
        select 1
        from pg_proc pr, aclexplode(coalesce(pr.proacl, acldefault('f', pr.proowner))) acl
        where pr.oid in ('public.reorder_plant_photos(uuid, uuid[])'::regprocedure,
            'public.reorder_species_photos(uuid, uuid[])'::regprocedure,
            'public.plant_is_public(uuid)'::regprocedure)
          and acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
      ) as via_public
  ) grants;

  insert into multiple_photos_results (check_name, result, detail)
  select 'grants: nobody but the owner can call the trigger functions directly',
    case when callable = 0 then 'PASS' else 'FAIL' end,
    format('%s trigger function(s) callable by anon, authenticated or PUBLIC', callable)
  from (
    select count(*) as callable
    from pg_proc pr
    where pr.pronamespace = 'public'::regnamespace
      and pr.proname in ('limit_photos_per_record', 'sync_plant_cover_photo',
        'add_plant_cover_from_photo_url', 'sync_species_cover_photo', 'sync_species_photos_from_cover')
      and (
        has_function_privilege('anon', pr.oid, 'execute')
        or has_function_privilege('authenticated', pr.oid, 'execute')
        or exists (
          select 1 from aclexplode(coalesce(pr.proacl, acldefault('f', pr.proowner))) acl
          where acl.grantee = 0 and acl.privilege_type = 'EXECUTE'
        )
      )
  ) grants;

  -- ---------- fixtures, created with no signed-in user ----------
  insert into public.species (scientific_name) values ('PHOTO-TEST species')
    returning id into test_species;
  -- Created the way the current web app creates a species with a photo
  insert into public.species (scientific_name, reference_photo_url)
    values ('PHOTO-TEST species with photo', species_url || 'with.jpg')
    returning id into species_with_photo;
  insert into public.species (scientific_name) values ('PHOTO-TEST species without photo')
    returning id into species_without_photo;
  insert into public.species (scientific_name) values ('PHOTO-TEST species full')
    returning id into species_full;
  insert into public.species_photos (species_id, photo_url, position)
    select species_full, species_url || 'full-' || i || '.jpg', i from generate_series(0, 4) i;
  select array_agg(id order by position) into species_full_photos
    from public.species_photos where species_id = species_full;

  bot_pending_empty := pg_temp.add_plant(test_species, botanist_id, 'pending_review');
  bot_pending_full := pg_temp.add_plant(test_species, botanist_id, 'pending_review');
  bot_pending_two := pg_temp.add_plant(test_species, botanist_id, 'pending_review');
  bot_approved := pg_temp.add_plant(test_species, botanist_id, 'approved');
  bot_approved_no_photos := pg_temp.add_plant(test_species, botanist_id, 'approved');
  bot_rejected := pg_temp.add_plant(test_species, botanist_id, 'rejected');
  officer_pending := pg_temp.add_plant(test_species, officer_id, 'pending_review');
  officer_monitored := pg_temp.add_plant(test_species, officer_id, 'approved', true);
  admin_approved := pg_temp.add_plant(test_species, admin_id, 'approved');

  perform pg_temp.add_photos(bot_pending_full, array['full-0', 'full-1', 'full-2', 'full-3', 'full-4']);
  two_photos := pg_temp.add_photos(bot_pending_two, array['two-0', 'two-1']);
  approved_photos := pg_temp.add_photos(bot_approved, array['approved-0', 'approved-1']);
  perform pg_temp.add_photos(bot_rejected, array['rejected-0']);
  officer_pending_photos := pg_temp.add_photos(officer_pending, array['officer-pending-0']);
  perform pg_temp.add_photos(officer_monitored, array['officer-monitored-0']);
  admin_photos := pg_temp.add_photos(admin_approved, array['admin-approved-0']);

  -- The files themselves, plus one in the botanist's folder that belongs to no plant
  begin
    insert into storage.objects (bucket_id, name)
    select 'plant-photos', storage_path from public.plant_photos
      where storage_path like '%/PHOTO-TEST-%'
    union all
    select 'plant-photos', pg_temp.photo_path(botanist_id, 'orphan');
  exception
    when others then
      storage_ready := false;
      insert into multiple_photos_results (check_name, result, detail)
      values ('setup: storage fixtures could not be created, so the storage checks were skipped',
        'FAIL', sqlerrm);
  end;

  -- ---------- recorder adds photos ----------
  perform pg_temp.run_check(
    'recorder can add 5 photos to their own pending plant; position 0 becomes photo_url',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           select %L, %L || '/PHOTO-TEST-new-' || i || '.jpg', i from generate_series(0, 4) i
           returning position, uploaded_by$sql$,
      bot_pending_empty, botanist_id
    ),
    null,
    format(
      $sql$select jsonb_array_length($1) = 5
             and (select bool_and((r ->> 'uploaded_by')::uuid = %L) from jsonb_array_elements($1) r)
             and (select photo_url from public.plants where id = %L) = %L$sql$,
      botanist_id, bot_pending_empty, pg_temp.photo_path(botanist_id, 'new-0')
    )
  );

  perform pg_temp.run_check(
    'a 6th photo is refused',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           values (%L, %L, 0) returning id$sql$,
      bot_pending_full, pg_temp.photo_path(botanist_id, 'sixth')
    ),
    'at most 5 photos'
  );

  perform pg_temp.run_check(
    'position 5 is refused (0 to 4 only)',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           values (%L, %L, 5) returning id$sql$,
      bot_pending_empty, pg_temp.photo_path(botanist_id, 'position-5')
    ),
    'plant_photos_position_check'
  );

  perform pg_temp.run_check(
    'two photos at the same position are refused',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           values (%L, %L, 0) returning id$sql$,
      bot_pending_two, pg_temp.photo_path(botanist_id, 'same-position')
    ),
    'plant_photos_plant_id_position_key'
  );

  perform pg_temp.run_check(
    'botanist can''t add a photo to someone else''s plant',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           values (%L, %L, 1) returning id$sql$,
      officer_pending, pg_temp.photo_path(botanist_id, 'not-mine')
    ),
    'row-level security'
  );

  perform pg_temp.run_check(
    'officer can''t add a photo to someone else''s pending plant',
    'authenticated', officer_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           values (%L, %L, 0) returning id$sql$,
      bot_pending_empty, pg_temp.photo_path(officer_id, 'officer-adds')
    ),
    'row-level security'
  );

  perform pg_temp.run_check(
    'recorder can''t add a photo after approval',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           values (%L, %L, 0) returning id$sql$,
      bot_approved_no_photos, pg_temp.photo_path(botanist_id, 'after-approval')
    ),
    'row-level security'
  );

  perform pg_temp.run_check(
    'recorder can''t add a photo after rejection',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           values (%L, %L, 1) returning id$sql$,
      bot_rejected, pg_temp.photo_path(botanist_id, 'after-rejection')
    ),
    'row-level security'
  );

  perform pg_temp.run_check(
    'a file in someone else''s folder is refused',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           values (%L, %L, 0) returning id$sql$,
      bot_pending_empty, pg_temp.photo_path(officer_id, 'officers-file')
    ),
    'row-level security'
  );

  perform pg_temp.run_check(
    'a path that starts with the user id but not the user''s folder is refused',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           values (%L, %L, 0) returning id$sql$,
      bot_pending_empty, botanist_id::text || '-other/PHOTO-TEST-lookalike.jpg'
    ),
    'row-level security'
  );

  perform pg_temp.run_check(
    'uploaded_by naming someone else is refused',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position, uploaded_by)
           values (%L, %L, 0, %L) returning id$sql$,
      bot_pending_empty, pg_temp.photo_path(botanist_id, 'spoofed'), officer_id
    ),
    'row-level security'
  );

  perform pg_temp.run_check(
    'a file already attached to another plant is refused',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           values (%L, %L, 0) returning id$sql$,
      bot_pending_empty, pg_temp.photo_path(botanist_id, 'two-0')
    ),
    'plant_photos_storage_path_key'
  );

  perform pg_temp.run_check(
    'anon can''t add photos',
    'anon', null,
    format(
      $sql$insert into public.plant_photos (plant_id, storage_path, position)
           values (%L, 'x/PHOTO-TEST-anon.jpg', 0) returning plant_id$sql$,
      bot_pending_empty
    ),
    'permission denied'
  );

  -- ---------- who can read plant photos ----------
  perform pg_temp.run_check(
    'recorder can read the photos of their own pending plant',
    'authenticated', botanist_id,
    format($sql$select id from public.plant_photos where plant_id = %L$sql$, bot_pending_full),
    null,
    'select jsonb_array_length($1) = 5'
  );

  perform pg_temp.run_check(
    'officer can read the photos of someone else''s pending plant',
    'authenticated', officer_id,
    format($sql$select id from public.plant_photos where plant_id = %L$sql$, bot_pending_full),
    null,
    'select jsonb_array_length($1) = 5'
  );

  perform pg_temp.run_check(
    'admin can read the photos of someone else''s pending plant',
    'authenticated', admin_id,
    format($sql$select id from public.plant_photos where plant_id = %L$sql$, bot_pending_full),
    null,
    'select jsonb_array_length($1) = 5'
  );

  perform pg_temp.run_check(
    'botanist can''t read the photos of someone else''s pending plant',
    'authenticated', botanist_id,
    format($sql$select id from public.plant_photos where plant_id = %L$sql$, officer_pending),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'botanist can''t read the photos of someone else''s monitored plant',
    'authenticated', botanist_id,
    format($sql$select id from public.plant_photos where plant_id = %L$sql$, officer_monitored),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'botanist can read the photos of someone else''s approved, unmonitored plant',
    'authenticated', botanist_id,
    format($sql$select id from public.plant_photos where plant_id = %L$sql$, admin_approved),
    null,
    'select jsonb_array_length($1) = 1'
  );

  -- ---------- guests ----------
  perform pg_temp.run_check(
    'anon sees the photos of an approved, unmonitored plant, in order',
    'anon', null,
    format(
      $sql$select storage_path, position from public.plant_photos
           where plant_id = %L order by position$sql$,
      bot_approved
    ),
    null,
    format(
      $sql$select jsonb_array_length($1) = 2
             and $1 -> 0 ->> 'storage_path' = %L and $1 -> 1 ->> 'storage_path' = %L$sql$,
      pg_temp.photo_path(botanist_id, 'approved-0'), pg_temp.photo_path(botanist_id, 'approved-1')
    )
  );

  perform pg_temp.run_check(
    'anon sees nothing for a pending plant',
    'anon', null,
    format($sql$select storage_path from public.plant_photos where plant_id = %L$sql$, bot_pending_full),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'anon sees nothing for a rejected plant',
    'anon', null,
    format($sql$select storage_path from public.plant_photos where plant_id = %L$sql$, bot_rejected),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'anon sees nothing for a monitored plant',
    'anon', null,
    format($sql$select storage_path from public.plant_photos where plant_id = %L$sql$, officer_monitored),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'anon sees exactly the test photos of approved, unmonitored plants',
    'anon', null,
    $sql$select storage_path from public.plant_photos where storage_path like '%/PHOTO-TEST-%'$sql$,
    null,
    format(
      $sql$select (select array_agg(r ->> 'storage_path' order by r ->> 'storage_path')
                   from jsonb_array_elements($1) r)
             = array(select unnest(array[%L, %L, %L]) order by 1)$sql$,
      pg_temp.photo_path(botanist_id, 'approved-0'), pg_temp.photo_path(botanist_id, 'approved-1'),
      pg_temp.photo_path(admin_id, 'admin-approved-0')
    )
  );

  perform pg_temp.run_check(
    'anon can''t read who uploaded a photo',
    'anon', null,
    format($sql$select uploaded_by from public.plant_photos where plant_id = %L$sql$, bot_approved),
    'permission denied'
  );

  -- ---------- guests and plant-photos storage (selecting = creating a signed URL) ----------
  if storage_ready then
    public_files := format('array(select unnest(array[%L, %L, %L]) order by 1)',
      pg_temp.photo_path(botanist_id, 'approved-0'), pg_temp.photo_path(botanist_id, 'approved-1'),
      pg_temp.photo_path(admin_id, 'admin-approved-0'));

    perform pg_temp.run_check(
      'storage: anon can select (so sign URLs for) exactly the files of approved, unmonitored plants',
      'anon', null,
      $sql$select name from storage.objects
           where bucket_id = 'plant-photos' and name like '%/PHOTO-TEST-%'$sql$,
      null,
      format(
        $sql$select coalesce((select array_agg(r ->> 'name' order by r ->> 'name')
                              from jsonb_array_elements($1) r), '{}') = %s$sql$,
        public_files
      )
    );

    perform pg_temp.run_check(
      'storage: anon can''t read the file of a pending plant',
      'anon', null,
      format(
        $sql$select name from storage.objects where bucket_id = 'plant-photos' and name = %L$sql$,
        pg_temp.photo_path(botanist_id, 'full-0')
      ),
      null,
      'select jsonb_array_length($1) = 0'
    );

    perform pg_temp.run_check(
      'storage: anon can''t read the file of a rejected plant',
      'anon', null,
      format(
        $sql$select name from storage.objects where bucket_id = 'plant-photos' and name = %L$sql$,
        pg_temp.photo_path(botanist_id, 'rejected-0')
      ),
      null,
      'select jsonb_array_length($1) = 0'
    );

    perform pg_temp.run_check(
      'storage: anon can''t read the file of a monitored plant',
      'anon', null,
      format(
        $sql$select name from storage.objects where bucket_id = 'plant-photos' and name = %L$sql$,
        pg_temp.photo_path(officer_id, 'officer-monitored-0')
      ),
      null,
      'select jsonb_array_length($1) = 0'
    );

    perform pg_temp.run_check(
      'storage: anon can''t read a file that belongs to no plant',
      'anon', null,
      format(
        $sql$select name from storage.objects where bucket_id = 'plant-photos' and name = %L$sql$,
        pg_temp.photo_path(botanist_id, 'orphan')
      ),
      null,
      'select jsonb_array_length($1) = 0'
    );

    perform pg_temp.run_check(
      'storage: botanist sees own files and public ones, not someone else''s pending or monitored files',
      'authenticated', botanist_id,
      $sql$select name from storage.objects
           where bucket_id = 'plant-photos' and name like '%/PHOTO-TEST-%'$sql$,
      null,
      format(
        $sql$select exists (select 1 from jsonb_array_elements($1) r where r ->> 'name' = %L)
               and exists (select 1 from jsonb_array_elements($1) r where r ->> 'name' = %L)
               and not exists (select 1 from jsonb_array_elements($1) r where r ->> 'name' in (%L, %L))$sql$,
        pg_temp.photo_path(botanist_id, 'full-0'), pg_temp.photo_path(admin_id, 'admin-approved-0'),
        pg_temp.photo_path(officer_id, 'officer-pending-0'),
        pg_temp.photo_path(officer_id, 'officer-monitored-0')
      )
    );

    perform pg_temp.run_check(
      'storage: officer can still read every plant photo (006)',
      'authenticated', officer_id,
      $sql$select name from storage.objects
           where bucket_id = 'plant-photos' and name like '%/PHOTO-TEST-%'$sql$,
      null,
      $sql$select jsonb_array_length($1) =
             (select count(*) from storage.objects
              where bucket_id = 'plant-photos' and name like '%/PHOTO-TEST-%')$sql$
    );

    perform pg_temp.run_check(
      'storage: anon can''t upload to plant-photos',
      'anon', null,
      $sql$insert into storage.objects (bucket_id, name)
           values ('plant-photos', 'anon/PHOTO-TEST-upload.jpg') returning name$sql$,
      'row-level security'
    );
  end if;

  -- ---------- removing photos ----------
  perform pg_temp.run_check(
    'recorder can remove a photo of their own pending plant; the next one becomes photo_url',
    'authenticated', botanist_id,
    format($sql$delete from public.plant_photos where id = %L returning id$sql$, two_photos[1]),
    null,
    format(
      $sql$select jsonb_array_length($1) = 1
             and (select photo_url from public.plants where id = %L) = %L$sql$,
      bot_pending_two, pg_temp.photo_path(botanist_id, 'two-1')
    )
  );

  perform pg_temp.run_check(
    'removing the only photo clears photo_url',
    'authenticated', officer_id,
    format($sql$delete from public.plant_photos where id = %L returning id$sql$, officer_pending_photos[1]),
    null,
    format(
      $sql$select jsonb_array_length($1) = 1
             and (select photo_url from public.plants where id = %L) is null$sql$,
      officer_pending
    )
  );

  perform pg_temp.run_check(
    'recorder can''t remove a photo after approval',
    'authenticated', botanist_id,
    format($sql$delete from public.plant_photos where id = %L returning id$sql$, approved_photos[1]),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'officer can''t remove photos of someone else''s plant',
    'authenticated', officer_id,
    format($sql$delete from public.plant_photos where plant_id = %L returning id$sql$, bot_pending_two),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'admin can remove a photo of an approved plant; photo_url follows',
    'authenticated', admin_id,
    format($sql$delete from public.plant_photos where id = %L returning id$sql$, approved_photos[1]),
    null,
    format(
      $sql$select jsonb_array_length($1) = 1
             and (select photo_url from public.plants where id = %L) = %L$sql$,
      bot_approved, pg_temp.photo_path(botanist_id, 'approved-1')
    )
  );

  -- The case sync_plant_cover_photo is security definer for: no update policy on plants covers it
  perform pg_temp.run_check(
    'admin removing the cover of a reviewed plant they recorded still clears photo_url',
    'authenticated', admin_id,
    format($sql$delete from public.plant_photos where id = %L returning id$sql$, admin_photos[1]),
    null,
    format(
      $sql$select jsonb_array_length($1) = 1
             and (select photo_url from public.plants where id = %L) is null$sql$,
      admin_approved
    )
  );

  perform pg_temp.run_check(
    'anon can''t remove photos',
    'anon', null,
    format($sql$delete from public.plant_photos where plant_id = %L returning plant_id$sql$, bot_approved),
    'permission denied'
  );

  perform pg_temp.run_check(
    'deleting a plant deletes its photos',
    null, null,
    format($sql$delete from public.plants where id = %L returning id$sql$, bot_pending_two),
    null,
    format($sql$select not exists (select 1 from public.plant_photos where plant_id = %L)$sql$,
      bot_pending_two)
  );

  -- ---------- reordering ----------
  perform pg_temp.run_check(
    'recorder can swap two photos of their own pending plant; photo_url follows',
    'authenticated', botanist_id,
    format(
      $sql$select true as done from public.reorder_plant_photos(%L, array[%L, %L]::uuid[])$sql$,
      bot_pending_two, two_photos[2], two_photos[1]
    ),
    null,
    format(
      $sql$select (select position from public.plant_photos where id = %L) = 0
             and (select position from public.plant_photos where id = %L) = 1
             and (select photo_url from public.plants where id = %L) = %L$sql$,
      two_photos[2], two_photos[1], bot_pending_two, pg_temp.photo_path(botanist_id, 'two-1')
    )
  );

  perform pg_temp.run_check(
    'recorder can move a photo to a free position with a plain update',
    'authenticated', botanist_id,
    format($sql$update public.plant_photos set position = 4 where id = %L returning position$sql$,
      two_photos[2]),
    null,
    'select jsonb_array_length($1) = 1'
  );

  perform pg_temp.run_check(
    'recorder can''t change which file a photo points to',
    'authenticated', botanist_id,
    format(
      $sql$update public.plant_photos set storage_path = %L where id = %L returning id$sql$,
      pg_temp.photo_path(botanist_id, 'swapped-file'), two_photos[1]
    ),
    'permission denied'
  );

  perform pg_temp.run_check(
    'recorder can''t move a photo to another plant',
    'authenticated', botanist_id,
    format($sql$update public.plant_photos set plant_id = %L where id = %L returning id$sql$,
      bot_pending_empty, two_photos[1]),
    'permission denied'
  );

  perform pg_temp.run_check(
    'recorder can''t reorder after approval',
    'authenticated', botanist_id,
    format(
      $sql$select true as done from public.reorder_plant_photos(%L, array[%L, %L]::uuid[])$sql$,
      bot_approved, approved_photos[2], approved_photos[1]
    ),
    'Only the person who recorded this plant'
  );

  perform pg_temp.run_check(
    'officer can''t reorder someone else''s plant',
    'authenticated', officer_id,
    format(
      $sql$select true as done from public.reorder_plant_photos(%L, array[%L, %L]::uuid[])$sql$,
      bot_pending_two, two_photos[2], two_photos[1]
    ),
    'Only the person who recorded this plant'
  );

  perform pg_temp.run_check(
    'botanist can''t reorder a plant whose photos they can''t see',
    'authenticated', botanist_id,
    format(
      $sql$select true as done from public.reorder_plant_photos(%L, array[%L]::uuid[])$sql$,
      officer_pending, officer_pending_photos[1]
    ),
    'no photos of this plant record that you can reorder'
  );

  perform pg_temp.run_check(
    'admin can reorder the photos of an approved plant',
    'authenticated', admin_id,
    format(
      $sql$select true as done from public.reorder_plant_photos(%L, array[%L, %L]::uuid[])$sql$,
      bot_approved, approved_photos[2], approved_photos[1]
    ),
    null,
    format($sql$select (select photo_url from public.plants where id = %L) = %L$sql$,
      bot_approved, pg_temp.photo_path(botanist_id, 'approved-1'))
  );

  perform pg_temp.run_check(
    'reordering must list every photo once',
    'authenticated', botanist_id,
    format(
      $sql$select true as done from public.reorder_plant_photos(%L, array[%L, %L]::uuid[])$sql$,
      bot_pending_two, two_photos[1], two_photos[1]
    ),
    'List every photo'
  );

  perform pg_temp.run_check(
    'anon can''t reorder',
    'anon', null,
    format(
      $sql$select true as done from public.reorder_plant_photos(%L, array[%L, %L]::uuid[])$sql$,
      bot_approved, approved_photos[2], approved_photos[1]
    ),
    'permission denied for function'
  );

  -- ---------- app versions that only know plants.photo_url ----------
  perform pg_temp.run_check(
    'old app: a new plant with a photo_url gets that file as its position 0 photo',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plants (species_id, latitude, longitude, morphological_notes,
             photo_url, recorded_by)
           values (%L, 3.8, 113.7, 'PHOTO-TEST', %L, %L) returning id$sql$,
      test_species, pg_temp.photo_path(botanist_id, 'old-app'), botanist_id
    ),
    null,
    format(
      $sql$select exists (
             select 1 from public.plant_photos
             where plant_id = ($1 -> 0 ->> 'id')::uuid and position = 0
               and storage_path = %L and uploaded_by = %L)$sql$,
      pg_temp.photo_path(botanist_id, 'old-app'), botanist_id
    )
  );

  perform pg_temp.run_check(
    'old app: a new plant whose photo_url is in someone else''s folder is refused',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.plants (species_id, latitude, longitude, morphological_notes,
             photo_url, recorded_by)
           values (%L, 3.8, 113.7, 'PHOTO-TEST', %L, %L) returning id$sql$,
      test_species, pg_temp.photo_path(officer_id, 'officer-pending-0'), botanist_id
    ),
    'row-level security'
  );

  perform pg_temp.run_check(
    'changing photo_url directly is still allowed while pending, and leaves plant_photos alone',
    'authenticated', botanist_id,
    format($sql$update public.plants set photo_url = 'edited.jpg' where id = %L returning id$sql$,
      bot_pending_two),
    null,
    format(
      $sql$select jsonb_array_length($1) = 1
             and (select count(*) from public.plant_photos where plant_id = %L) = 2
             and not exists (select 1 from public.plant_photos where storage_path = 'edited.jpg')$sql$,
      bot_pending_two
    )
  );

  -- ---------- plants_public ----------
  perform pg_temp.run_check(
    'plants_public: has_photos and photo_url only for approved, unmonitored plants',
    'anon', null,
    format(
      $sql$select id, has_photos, photo_url from public.plants_public
           where id in (%L, %L, %L, %L)$sql$,
      bot_approved, bot_approved_no_photos, officer_monitored, bot_pending_full
    ),
    null,
    format(
      $sql$select jsonb_array_length($1) = 3
             and exists (select 1 from jsonb_array_elements($1) r where r ->> 'id' = %L
               and (r ->> 'has_photos')::boolean and r ->> 'photo_url' = %L)
             and exists (select 1 from jsonb_array_elements($1) r where r ->> 'id' = %L
               and not (r ->> 'has_photos')::boolean and r ->> 'photo_url' is null)
             and exists (select 1 from jsonb_array_elements($1) r where r ->> 'id' = %L
               and not (r ->> 'has_photos')::boolean and r ->> 'photo_url' is null)$sql$,
      bot_approved, pg_temp.photo_path(botanist_id, 'approved-0'),
      bot_approved_no_photos, officer_monitored
    )
  );

  insert into multiple_photos_results (check_name, result, detail)
  select 'plants_public: exposes the 005 columns plus has_photos, nothing else',
    case when cols = 'id,species_id,qr_code,height_cm,morphological_notes,photo_url,latitude,'
        || 'longitude,is_monitored,recorded_at,has_photos' then 'PASS' else 'FAIL' end,
    cols
  from (
    select string_agg(column_name::text, ',' order by ordinal_position) as cols
    from information_schema.columns
    where table_schema = 'public' and table_name = 'plants_public'
  ) view_columns;

  -- ---------- species photos ----------
  perform pg_temp.run_check(
    'anon can read species photos',
    'anon', null,
    format($sql$select photo_url, position from public.species_photos where species_id = %L$sql$,
      species_with_photo),
    null,
    format($sql$select jsonb_array_length($1) = 1 and $1 -> 0 ->> 'photo_url' = %L$sql$,
      species_url || 'with.jpg')
  );

  perform pg_temp.run_check(
    'botanist can read species photos',
    'authenticated', botanist_id,
    format($sql$select id from public.species_photos where species_id = %L$sql$, species_full),
    null,
    'select jsonb_array_length($1) = 5'
  );

  perform pg_temp.run_check(
    'anon can''t add species photos',
    'anon', null,
    format(
      $sql$insert into public.species_photos (species_id, photo_url, position)
           values (%L, 'https://photo-test.invalid/anon.jpg', 0) returning position$sql$,
      species_without_photo
    ),
    'permission denied'
  );

  perform pg_temp.run_check(
    'botanist can''t add species photos',
    'authenticated', botanist_id,
    format(
      $sql$insert into public.species_photos (species_id, photo_url, position)
           values (%L, 'https://photo-test.invalid/botanist.jpg', 0) returning id$sql$,
      species_without_photo
    ),
    'row-level security'
  );

  perform pg_temp.run_check(
    'botanist can''t change species photos',
    'authenticated', botanist_id,
    format(
      $sql$update public.species_photos set photo_url = 'https://photo-test.invalid/changed.jpg'
           where species_id = %L returning id$sql$,
      species_full
    ),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'botanist can''t remove species photos',
    'authenticated', botanist_id,
    format($sql$delete from public.species_photos where species_id = %L returning id$sql$, species_full),
    null,
    'select jsonb_array_length($1) = 0'
  );

  perform pg_temp.run_check(
    'officer can add a species photo; the first one becomes reference_photo_url',
    'authenticated', officer_id,
    format(
      $sql$insert into public.species_photos (species_id, photo_url, position)
           values (%L, %L, 0) returning id$sql$,
      species_without_photo, species_url || 'officer-added.jpg'
    ),
    null,
    format(
      $sql$select jsonb_array_length($1) = 1
             and (select reference_photo_url from public.species where id = %L) = %L$sql$,
      species_without_photo, species_url || 'officer-added.jpg'
    )
  );

  perform pg_temp.run_check(
    'admin can add a second species photo; the cover stays',
    'authenticated', admin_id,
    format(
      $sql$insert into public.species_photos (species_id, photo_url, position)
           values (%L, %L, 1) returning id$sql$,
      species_with_photo, species_url || 'admin-added.jpg'
    ),
    null,
    format(
      $sql$select jsonb_array_length($1) = 1
             and (select reference_photo_url from public.species where id = %L) = %L$sql$,
      species_with_photo, species_url || 'with.jpg'
    )
  );

  perform pg_temp.run_check(
    'officer can change the cover species photo; reference_photo_url follows',
    'authenticated', officer_id,
    format(
      $sql$update public.species_photos set photo_url = %L
           where species_id = %L and position = 0 returning id$sql$,
      species_url || 'changed.jpg', species_full
    ),
    null,
    format(
      $sql$select jsonb_array_length($1) = 1
             and (select reference_photo_url from public.species where id = %L) = %L$sql$,
      species_full, species_url || 'changed.jpg'
    )
  );

  perform pg_temp.run_check(
    'officer can remove the cover species photo; the next one becomes reference_photo_url',
    'authenticated', officer_id,
    format(
      $sql$delete from public.species_photos where species_id = %L and position = 0 returning id$sql$,
      species_full
    ),
    null,
    format(
      $sql$select jsonb_array_length($1) = 1
             and (select reference_photo_url from public.species where id = %L) = %L$sql$,
      species_full, species_url || 'full-1.jpg'
    )
  );

  perform pg_temp.run_check(
    'a 6th species photo is refused',
    'authenticated', officer_id,
    format(
      $sql$insert into public.species_photos (species_id, photo_url, position)
           values (%L, 'https://photo-test.invalid/sixth.jpg', 0) returning id$sql$,
      species_full
    ),
    'at most 5 photos'
  );

  perform pg_temp.run_check(
    'officer can reorder species photos; reference_photo_url follows',
    'authenticated', officer_id,
    format(
      $sql$select true as done from public.reorder_species_photos(%L, %L::uuid[])$sql$,
      species_full,
      array[species_full_photos[5], species_full_photos[4], species_full_photos[3],
        species_full_photos[2], species_full_photos[1]]
    ),
    null,
    format($sql$select (select reference_photo_url from public.species where id = %L) = %L$sql$,
      species_full, species_url || 'full-4.jpg')
  );

  perform pg_temp.run_check(
    'botanist can''t reorder species photos',
    'authenticated', botanist_id,
    format(
      $sql$select true as done from public.reorder_species_photos(%L, %L::uuid[])$sql$,
      species_full,
      array[species_full_photos[5], species_full_photos[4], species_full_photos[3],
        species_full_photos[2], species_full_photos[1]]
    ),
    'Only conservation officers and admins'
  );

  -- ---------- the current web app, which only knows species.reference_photo_url ----------
  perform pg_temp.run_check(
    'web app: a new species with a photo gets it at position 0',
    'authenticated', officer_id,
    format(
      $sql$insert into public.species (scientific_name, reference_photo_url)
           values ('PHOTO-TEST species from web', %L) returning id$sql$,
      species_url || 'web-new.jpg'
    ),
    null,
    format(
      $sql$select exists (select 1 from public.species_photos
             where species_id = ($1 -> 0 ->> 'id')::uuid and position = 0 and photo_url = %L)$sql$,
      species_url || 'web-new.jpg'
    )
  );

  perform pg_temp.run_check(
    'web app: replacing reference_photo_url replaces the cover photo',
    'authenticated', officer_id,
    format(
      $sql$update public.species set reference_photo_url = %L where id = %L returning id$sql$,
      species_url || 'web-replaced.jpg', species_with_photo
    ),
    null,
    format(
      $sql$select (select array_agg(photo_url) from public.species_photos where species_id = %L)
             = array[%L]$sql$,
      species_with_photo, species_url || 'web-replaced.jpg'
    )
  );

  perform pg_temp.run_check(
    'web app: clearing reference_photo_url removes the cover photo',
    'authenticated', officer_id,
    format(
      $sql$update public.species set reference_photo_url = null where id = %L returning id$sql$,
      species_with_photo
    ),
    null,
    format(
      $sql$select not exists (select 1 from public.species_photos where species_id = %L)
             and (select reference_photo_url from public.species where id = %L) is null$sql$,
      species_with_photo, species_with_photo
    )
  );
exception
  -- A setup error becomes a FAIL row so the script still reaches the rollback below
  when others then
    insert into multiple_photos_results (check_name, result, detail)
    values ('setup failed, so the checks did not run', 'FAIL', sqlerrm);
end;
$$;

select check_name, result, detail from multiple_photos_results order by position;

rollback;
