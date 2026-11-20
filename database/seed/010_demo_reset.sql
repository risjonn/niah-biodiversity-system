-- =====================================================================================
--  !!!  DESTRUCTIVE  !!!   DEMO RESET   !!!  DESTRUCTIVE  !!!
-- =====================================================================================
--
--  Replaces ALL plant records with the demo data, and PERMANENTLY DELETES, with no undo:
--    - every plant record that existed before this run, and with them their plant_photos rows
--    - every sensor reading (sensor_readings)
--    - every alert (alerts)
--
--  BEFORE RUNNING: export a CSV backup of plants, plant_photos, sensor_readings, alerts and
--  sensor_nodes from the Table Editor (each table -> Export -> Export table as CSV), and
--  download any plant photos you want to keep. Don't count on a Supabase backup to undo this.
--  See database/seed/README.md for the full demo-day order.
--
--  It KEEPS: species, species_photos, sensor_nodes, alert_thresholds, profiles, auth users.
--
--  Run in the Supabase SQL Editor, the whole file at once, after 001-017. Part of #19.
-- =====================================================================================
--
-- One transaction, no schema changes: if any check fails, nothing is changed. In order:
--   1. Checks (below). Nothing has been changed if one fails.
--   2. Inserts 40 plant records for the 5 species from 001_sample_species.sql, recorded between
--      1 Aug and 19 Nov 2026 (5 in Aug, 8 in Sep, 12 in Oct, 15 in Nov), all by the botanist
--      account, at locations inside Niah National Park, all pending.
--   3. Reviews 30 of them as the conservation officer: 24 approved, 6 rejected (reasons from the
--      web quick-pick list), 10 left pending (the most recent ones, plus one late-October
--      backlog record). Marks 2 approved plants as monitored.
--   4. Moves NIAH-NODE-01 and NIAH-NODE-02 to the two monitored plants. sensor_nodes.plant_id
--      stays NOT NULL throughout: the nodes are moved before the old plants are deleted.
--   5. Deletes every alert, every sensor reading, and every plant not inserted by this run.
--   6. Gives the three demo accounts realistic names.
--   7. Shows a summary: the new records by month and status, then what was deleted.
--
-- Checks:
--   - refuses if any of the demo records is already in plants (same recorded_at and notes), so it
--     can't be run twice
--   - refuses if any other table has a foreign key to plants (it could be a cascade that would
--     delete more than intended, e.g. a table added outside this repo)
--   - refuses if there are sensor nodes other than NIAH-NODE-01 and NIAH-NODE-02: they would
--     still point at old plants, which can't then be deleted
--   - the three accounts exist with the right roles, the 5 species and both nodes exist
--
-- What references plants (database/schema 001-017):
--   - plant_photos.plant_id  -> on delete cascade, removed with the old plants
--   - sensor_nodes.plant_id  -> no cascade, NOT NULL: moved to the new plants first
--   Views and functions that read plants (plants_public, sensor_node_latest, plant_is_public,
--   report_*) hold no rows and need nothing.
--
-- How it respects the triggers and policies (001-017):
--   - 003: plants are inserted as pending_review with no qr_code; trg_generate_plant_qr_code
--     always generates it on the server.
--   - 004/015: the review step runs with auth.uid() set to the officer (request.jwt.claims, the
--     same way database/tests/015_update_guards_test.sql acts as a user). So trg_guard_plant_updates
--     really checks it, instead of letting everything through as it does when auth.uid() is null:
--     the reviewer is a conservation officer, is not the recorder, and reviewed_by is the officer.
--     recorded_at, recorded_by, qr_code and created_at are never updated.
--   - 015: is_monitored is changed in the same officer step, which the guard allows only for
--     officers and admins.
--   - 017: no photo_url and no plant_photos rows for the new plants, so no photo trigger runs for
--     them. Deleting the old plants cascades to their plant_photos, whose sync_plant_cover_photo
--     trigger only updates plants that are already gone, so it does nothing.
--
-- STORAGE: files in the plant-photos bucket can't be safely deleted from SQL (Supabase keeps
-- storage.objects and the stored files in step through its Storage API). AFTER this file, empty
-- the plant-photos bucket in the dashboard (Storage -> plant-photos -> select all -> Delete). The
-- new records have no photos yet, so every file there belonged to a deleted plant.
-- Do NOT touch the species-photos bucket: species photos are kept.
--
-- People are looked up by email and species by scientific name, so no UUIDs are hard-coded.
-- Times are Sarawak time (+08). synced_at and created_at are when the record reached the server:
-- minutes later where there is phone signal (park HQ, Pangkalan Batu), hours later elsewhere
-- (synced back at HQ in the evening).

begin;

drop table if exists pg_temp.demo_reset_counts;
create temp table demo_reset_counts (
  step integer primary key,
  item text not null,
  row_count bigint not null
);

drop table if exists pg_temp.demo_plants;
create temp table demo_plants (
  n integer primary key,
  id uuid not null default gen_random_uuid(),
  scientific_name text not null,
  height_cm numeric not null,
  notes text not null,
  lat double precision not null,
  lng double precision not null,
  location text not null,
  recorded_at timestamptz not null,
  sync_after interval not null,
  status text not null check (status in ('pending_review', 'approved', 'rejected')),
  rejection_reason text,
  reviewed_at timestamptz,
  node_identifier text,
  node_installed_at timestamptz,
  check ((status = 'pending_review') = (reviewed_at is null)),
  check ((status = 'rejected') = (rejection_reason is not null)),
  check ((node_identifier is null) = (node_installed_at is null)),
  check (node_identifier is null or status = 'approved')
);

insert into demo_plants (
  n, scientific_name, height_cm, notes, lat, lng, location,
  recorded_at, sync_after, status, rejection_reason, reviewed_at, node_identifier, node_installed_at
) values
  -- ---------- August: 5 (4 approved, 1 rejected) ----------
  (1, 'Eusideroxylon zwageri', 2600,
   'Mature tree, DBH about 62 cm. Straight bole, bark reddish-brown and flaking in small patches. Several large single-seeded fruits on the ground under the crown.',
   3.8211, 113.7629, 'Park HQ forest edge, behind the visitor chalets',
   '2026-08-04 08:40+08', '35 minutes', 'approved', null, '2026-08-07 10:15+08', null, null),
  (2, 'Nepenthes rafflesiana', 180,
   'Climbing over riverbank shrubs. Lower pitchers egg-shaped with two fringed wings; upper pitchers funnel-shaped without wings. Cream to green with red-purple blotches.',
   3.8192, 113.7664, 'Pangkalan Batu, open scrub on the river bank beside the boat landing',
   '2026-08-11 09:25+08', '20 minutes', 'approved', null, '2026-08-13 14:20+08', null, null),
  (3, 'Nepenthes ampullaria', 35,
   'Dense cluster of about 30 squat, rounded lower pitchers on the peat surface. Lids narrow and bent back, leaving the mouths open. Green with red speckles; several hold fallen leaves.',
   3.8247, 113.7651, 'Peat swamp near Sungai Niah, about 150 m north of the river crossing',
   '2026-08-19 10:05+08', '7 hours 40 minutes', 'approved', null, '2026-08-21 09:40+08', null, null),
  (4, 'Gonystylus bancanus', 2800,
   'Tall tree, straight cylindrical bole, no buttresses. GPS accuracy was poor (about 40 m) under the closed canopy.',
   3.8262, 113.7633, 'Peat swamp near Sungai Niah, off the old survey line',
   '2026-08-26 14:10+08', '4 hours 5 minutes', 'rejected', 'Location inaccurate', '2026-08-28 11:00+08', null, null),
  (5, 'Nepenthes bicalcarata', 450,
   'Climbing into a sapling beside the boards. Rounded lower pitchers with two sharp spurs under the lid. Swollen, hollow tendrils with ants going in and out.',
   3.8158, 113.7712, 'Great Cave plankwalk, swampy section about 600 m from Pangkalan Batu',
   '2026-08-29 08:15+08', '9 hours 20 minutes', 'approved', null, '2026-09-01 10:30+08', null, null),

  -- ---------- September: 8 (7 approved, 1 rejected), both monitored plants ----------
  (6, 'Gonystylus bancanus', 3400,
   'Mature tree, DBH about 55 cm. Straight cylindrical bole without buttresses, bark grey-brown and shallowly fissured. On deep, waterlogged peat. No sign of cutting nearby.',
   3.8256, 113.7645, 'Peat swamp near Sungai Niah, west bank, 20 m off the old survey line',
   '2026-09-03 09:10+08', '8 hours 15 minutes', 'approved', null, '2026-09-05 15:05+08',
   'NIAH-NODE-01', '2026-09-12 10:30+08'),
  (7, 'Nepenthes ampullaria', 50,
   'Two rosettes with a carpet of lower pitchers around their bases. Pitchers deep red all over.',
   3.8139, 113.7741, 'Great Cave plankwalk, wet ground beside the boards about 1 km from Pangkalan Batu',
   '2026-09-06 10:40+08', '7 hours 30 minutes', 'approved', null, '2026-09-08 09:20+08', null, null),
  (8, 'Eusideroxylon zwageri', 3100,
   'Large tree, DBH about 78 cm. Bark reddish-brown, flaking in small patches. Crown healthy, no sign of cutting nearby.',
   3.8088, 113.7821, 'Foot of the limestone, mixed forest below the Great Cave West Mouth',
   '2026-09-10 08:30+08', '9 hours', 'approved', null, '2026-09-14 10:00+08',
   'NIAH-NODE-02', '2026-09-18 11:00+08'),
  (9, 'Nepenthes rafflesiana', 90,
   'Rosette with lower pitchers only, about 12 cm tall, two fringed wings. Cream with dark red spots, ribbed red peristome.',
   3.8217, 113.7618, 'Park HQ forest edge, open sandy ground behind the visitor chalets',
   '2026-09-13 14:45+08', '15 minutes', 'approved', null, '2026-09-15 11:10+08', null, null),
  (10, 'Nepenthes bicalcarata', 700,
   'Large climber reaching about 7 m into the canopy. Upper pitchers with two spurs under the lid clearly visible. Leaves large, up to about 60 cm.',
   3.8273, 113.7672, 'Peat swamp near Sungai Niah, along the drainage line north of park HQ',
   '2026-09-17 09:55+08', '6 hours 50 minutes', 'approved', null, '2026-09-19 14:00+08', null, null),
  (11, 'Eusideroxylon zwageri', 1200,
   'Pole-sized tree, DBH about 18 cm, in a small gap beside the trail. Leaves leathery, alternate.',
   3.8049, 113.7862, 'Painted Cave trail, mixed forest between the Great Cave and the Painted Cave',
   '2026-09-21 10:20+08', '7 hours 45 minutes', 'approved', null, '2026-09-24 09:45+08', null, null),
  (12, 'Nepenthes rafflesiana', 40,
   'Small rounded pitchers in a dense carpet at ground level. Lids narrow and bent back, so the mouths are open.',
   3.8121, 113.7769, 'Great Cave plankwalk, low wet ground about 1.4 km from Pangkalan Batu',
   '2026-09-25 15:05+08', '3 hours 10 minutes', 'rejected', 'Wrong species', '2026-09-28 10:30+08', null, null),
  (13, 'Nepenthes ampullaria', 30,
   'Cluster of green, lightly speckled lower pitchers partly buried in leaf litter. Two pitchers hold decaying leaves.',
   3.8238, 113.7622, 'Peat swamp near Sungai Niah, under dense swamp forest close to the river bank',
   '2026-09-29 08:50+08', '8 hours 30 minutes', 'approved', null, '2026-10-01 14:30+08', null, null),

  -- ---------- October: 12 (8 approved, 3 rejected, 1 pending) ----------
  (14, 'Gonystylus bancanus', 380,
   'Sapling, single straight stem. Leaves leathery and glossy.',
   3.8169, 113.7697, 'Great Cave plankwalk, peat swamp section just past Pangkalan Batu',
   '2026-10-02 09:15+08', '8 hours 5 minutes', 'approved', null, '2026-10-05 10:10+08', null, null),
  (15, 'Nepenthes rafflesiana', 260,
   'Climbing through riverbank shrubs. Upper pitchers funnel-shaped, pale green with sparse red spots, hanging from coiled tendrils.',
   3.8188, 113.7671, 'Pangkalan Batu, shrubs along the river bank upstream of the landing',
   '2026-10-04 10:30+08', '25 minutes', 'approved', null, '2026-10-06 15:20+08', null, null),
  (16, 'Nepenthes bicalcarata', 300,
   'Lower pitchers at the base of the plant. Spurs hard to make out from the boards.',
   3.8146, 113.7728, 'Great Cave plankwalk, swampy section about 800 m from Pangkalan Batu',
   '2026-10-07 14:20+08', '3 hours 35 minutes', 'rejected', 'Photo unclear', '2026-10-09 09:30+08', null, null),
  (17, 'Eusideroxylon zwageri', 450,
   'Sapling under partial shade, single stem. Leaves leathery, alternate.',
   3.8208, 113.7641, 'Park HQ forest edge, near the path down to the river crossing',
   '2026-10-09 08:45+08', '30 minutes', 'approved', null, '2026-10-12 11:45+08', null, null),
  (18, 'Nepenthes ampullaria', 25,
   'Small cluster of red-speckled lower pitchers at the foot of a shrub, in deep shade.',
   3.8214, 113.7633, 'Park HQ forest edge, damp shaded hollow behind the park office',
   '2026-10-12 09:40+08', '10 minutes', 'approved', null, '2026-10-14 10:05+08', null, null),
  (19, 'Gonystylus bancanus', 2900,
   'Tall tree, DBH about 41 cm. Straight bole without buttresses. Crown healthy, no damage seen.',
   3.8279, 113.7618, 'Peat swamp near Sungai Niah, about 400 m north of park HQ',
   '2026-10-15 15:30+08', '2 hours 40 minutes', 'approved', null, '2026-10-19 09:15+08', null, null),
  (20, 'Nepenthes rafflesiana', 95,
   'Rosette with lower pitchers, two fringed wings. Cream with dark red spots.',
   3.8217, 113.7619, 'Park HQ forest edge, open sandy ground behind the visitor chalets',
   '2026-10-18 10:10+08', '20 minutes', 'rejected', 'Duplicate record', '2026-10-20 14:40+08', null, null),
  (21, 'Nepenthes rafflesiana', 150,
   'In a sunny gap at the trail edge. Lower and upper pitchers on the same plant; upper ones funnel-shaped.',
   3.8041, 113.7879, 'Painted Cave trail, sunny gap at the edge of the trail',
   '2026-10-21 08:55+08', '8 hours 50 minutes', 'approved', null, '2026-10-23 10:20+08', null, null),
  (22, 'Nepenthes bicalcarata', 220,
   'Young plant just starting to climb. Lower pitchers with a wide orange-red peristome and two spurs. Swollen, hollow tendrils.',
   3.8251, 113.7689, 'Peat swamp near Sungai Niah, edge of the drainage line',
   '2026-10-23 13:35+08', '4 hours 20 minutes', 'approved', null, '2026-10-26 09:50+08', null, null),
  (23, 'Eusideroxylon zwageri', 1500,
   'Pole-sized tree, bark smooth and pale grey. Leaves in opposite pairs.',
   3.8074, 113.7838, 'Foot of the limestone, along the path to the Great Cave',
   '2026-10-26 09:05+08', '8 hours 40 minutes', 'rejected', 'Wrong species', '2026-10-28 11:30+08', null, null),
  (24, 'Nepenthes ampullaria', 60,
   'Rosette climbing a little into low shrubs, lower pitchers around the base. Green with red speckles.',
   3.8112, 113.7784, 'Great Cave plankwalk, wet ground near the end of the boards',
   '2026-10-28 10:45+08', '7 hours 15 minutes', 'approved', null, '2026-10-30 15:10+08', null, null),
  (25, 'Gonystylus bancanus', 520,
   'Young tree about 5 m, straight stem. Leaves leathery and glossy.',
   3.8233, 113.7608, 'Peat swamp near Sungai Niah, close to the river bank',
   '2026-10-29 14:50+08', '3 hours 25 minutes', 'pending_review', null, null, null, null),

  -- ---------- November (to the 19th): 15 (5 approved, 1 rejected, 9 pending) ----------
  (26, 'Eusideroxylon zwageri', 2200,
   'Mature tree close to the boards, DBH about 49 cm. Bark reddish-brown, flaking in small patches. Fallen fruits on the plankwalk.',
   3.8128, 113.7757, 'Great Cave plankwalk, about 1.2 km from Pangkalan Batu',
   '2026-11-02 09:20+08', '8 hours 10 minutes', 'approved', null, '2026-11-04 10:40+08', null, null),
  (27, 'Nepenthes bicalcarata', 550,
   'Climbing about 5 m up a small tree. Upper pitchers with spurs clearly visible; ants in the swollen tendrils.',
   3.8163, 113.7705, 'Great Cave plankwalk, swampy section about 500 m from Pangkalan Batu',
   '2026-11-03 10:15+08', '7 hours 5 minutes', 'approved', null, '2026-11-05 14:15+08', null, null),
  (28, 'Nepenthes rafflesiana', 320,
   'Climbing along the forest edge. Funnel-shaped upper pitchers, mostly green, with a ribbed red peristome.',
   3.8203, 113.7647, 'Park HQ forest edge, near the path down to the river crossing',
   '2026-11-05 08:35+08', '15 minutes', 'approved', null, '2026-11-07 09:30+08', null, null),
  (29, 'Nepenthes ampullaria', 30,
   'Cluster of rounded pitchers among tree roots. Poor light.',
   3.8244, 113.7660, 'Peat swamp near Sungai Niah, among tree roots by the river',
   '2026-11-06 14:05+08', '3 hours 50 minutes', 'rejected', 'Photo unclear', '2026-11-09 10:50+08', null, null),
  (30, 'Nepenthes ampullaria', 45,
   'Cluster of rounded lower pitchers in a shaded wet hollow. Green with heavy red speckling.',
   3.8195, 113.7657, 'Pangkalan Batu, shaded wet hollow just off the landing',
   '2026-11-09 09:50+08', '20 minutes', 'approved', null, '2026-11-11 11:20+08', null, null),
  (31, 'Gonystylus bancanus', 2500,
   'Tall tree, DBH about 38 cm. Straight bole without buttresses, bark grey-brown.',
   3.8153, 113.7718, 'Great Cave plankwalk, peat swamp section about 700 m from Pangkalan Batu',
   '2026-11-11 10:30+08', '7 hours 25 minutes', 'approved', null, '2026-11-13 15:00+08', null, null),
  (32, 'Eusideroxylon zwageri', 650,
   'Sapling about 6.5 m, single stem. Leaves leathery, alternate.',
   3.8036, 113.7851, 'Painted Cave trail, shaded slope below the cliff',
   '2026-11-12 08:40+08', '9 hours 5 minutes', 'pending_review', null, null, null, null),
  (33, 'Nepenthes bicalcarata', 380,
   'Climber with both lower and upper pitchers. Two spurs under each lid, dark red peristome.',
   3.8266, 113.7651, 'Peat swamp near Sungai Niah, along the drainage line north of park HQ',
   '2026-11-13 09:30+08', '7 hours 55 minutes', 'pending_review', null, null, null, null),
  (34, 'Nepenthes rafflesiana', 110,
   'Rosette with fringed, winged lower pitchers, heavily blotched purple-red.',
   3.8135, 113.7748, 'Great Cave plankwalk, open edge of the boards about 1.1 km from Pangkalan Batu',
   '2026-11-14 14:15+08', '3 hours 30 minutes', 'pending_review', null, null, null, null),
  (35, 'Nepenthes ampullaria', 40,
   'Large cluster of more than 40 lower pitchers covering about 1 square metre of peat.',
   3.8259, 113.7676, 'Peat swamp near Sungai Niah, edge of the drainage line',
   '2026-11-15 10:05+08', '6 hours 40 minutes', 'pending_review', null, null, null, null),
  (36, 'Eusideroxylon zwageri', 1900,
   'Tree, DBH about 35 cm. Bark reddish-brown, flaking in small patches. Several seedlings under the crown.',
   3.8219, 113.7625, 'Park HQ forest edge, behind the visitor chalets',
   '2026-11-16 08:25+08', '25 minutes', 'pending_review', null, null, null, null),
  (37, 'Nepenthes rafflesiana', 200,
   'Climbing on riverbank shrubs, with both lower and upper pitchers.',
   3.8183, 113.7676, 'Pangkalan Batu, shrubs along the river bank upstream of the landing',
   '2026-11-17 09:45+08', '30 minutes', 'pending_review', null, null, null, null),
  (38, 'Gonystylus bancanus', 3100,
   'Tall tree, DBH about 47 cm, straight bole without buttresses. Old cut stump of another tree about 10 m away.',
   3.8270, 113.7627, 'Peat swamp near Sungai Niah, off the old survey line',
   '2026-11-17 15:20+08', '2 hours 45 minutes', 'pending_review', null, null, null, null),
  (39, 'Nepenthes ampullaria', 30,
   'Small cluster of green lower pitchers on wet ground, close to the Great Cave.',
   3.8107, 113.7792, 'Great Cave plankwalk, wet ground near the end of the boards',
   '2026-11-18 10:35+08', '7 hours 20 minutes', 'pending_review', null, null, null, null),
  (40, 'Nepenthes bicalcarata', 260,
   'Re-recorded with a clearer photo. Lower pitchers at the base, wide orange peristome and two spurs. Swollen tendrils.',
   3.8150, 113.7724, 'Great Cave plankwalk, swampy section about 800 m from Pangkalan Batu',
   '2026-11-19 09:10+08', '8 hours', 'pending_review', null, null, null, null);

do $$
declare
  botanist_id uuid;
  officer_id uuid;
  admin_id uuid;
  problem text;
  changed bigint;
  expected bigint;
  old_plants bigint;
  old_photos bigint;
  old_readings bigint;
  old_alerts bigint;
  bucket_files bigint;
begin
  -- ---------- checks ----------
  -- Can't run twice: the demo records are recognised by their recorded_at and notes
  select count(*) into changed
  from plants p
  join demo_plants d on p.recorded_at = d.recorded_at and p.morphological_notes = d.notes;
  if changed > 0 then
    raise exception 'Demo reset not run: % of the demo plant records are already in plants, so the reset has already been run. Nothing was changed.',
      changed;
  end if;

  select string_agg(format('%s (%s)', conrelid::regclass, conname), ', ')
  into problem
  from pg_constraint
  where contype = 'f'
    and confrelid = 'public.plants'::regclass
    and conrelid not in ('public.plant_photos'::regclass, 'public.sensor_nodes'::regclass);
  if problem is not null then
    raise exception 'Demo reset not run: these foreign keys also reference plants and are not handled here: %. Check what they are before going on.',
      problem;
  end if;

  select string_agg(node_identifier, ', ' order by node_identifier)
  into problem
  from sensor_nodes
  where node_identifier not in ('NIAH-NODE-01', 'NIAH-NODE-02');
  if problem is not null then
    raise exception 'Demo reset not run: the reset only moves NIAH-NODE-01 and NIAH-NODE-02, and these other nodes would still point at plants it deletes: %. Delete them first (their readings, alerts and own alert_thresholds row go with them).',
      problem;
  end if;

  select p.id into botanist_id
  from profiles p join auth.users u on u.id = p.id
  where lower(u.email) = 'botanists@test.com' and p.role = 'botanist';
  select p.id into officer_id
  from profiles p join auth.users u on u.id = p.id
  where lower(u.email) = 'conservation_officer@test.com' and p.role = 'conservation_officer';
  select p.id into admin_id
  from profiles p join auth.users u on u.id = p.id
  where lower(u.email) = 'admin@test.com' and p.role = 'admin';

  if botanist_id is null then
    raise exception 'Demo reset not run: no botanist profile for botanists@test.com';
  end if;
  if officer_id is null then
    raise exception 'Demo reset not run: no conservation_officer profile for conservation_officer@test.com';
  end if;
  if admin_id is null then
    raise exception 'Demo reset not run: no admin profile for admin@test.com';
  end if;

  select string_agg(distinct d.scientific_name, ', ')
  into problem
  from demo_plants d
  where not exists (
    select 1 from species s where lower(s.scientific_name) = lower(d.scientific_name)
  );
  if problem is not null then
    raise exception 'Demo reset not run: these species are missing (run 001_sample_species.sql): %', problem;
  end if;

  select string_agg(w.node_identifier, ', ')
  into problem
  from (values ('NIAH-NODE-01'), ('NIAH-NODE-02')) as w(node_identifier)
  where not exists (select 1 from sensor_nodes sn where sn.node_identifier = w.node_identifier);
  if problem is not null then
    raise exception 'Demo reset not run: sensor node(s) % not found. Check the node identifiers in sensor_nodes.', problem;
  end if;

  -- Everything there now is old data that the reset deletes
  select count(*) into old_plants from plants;
  select count(*) into old_photos from plant_photos;
  select count(*) into old_readings from sensor_readings;
  select count(*) into old_alerts from alerts;
  select count(*) into bucket_files from storage.objects where bucket_id = 'plant-photos';

  -- ---------- insert, as the botanist would, all pending ----------
  -- No qr_code (003 generates it), no photo_url (017), not monitored, not reviewed
  insert into plants (
    id, species_id, height_cm, morphological_notes, latitude, longitude, location_description,
    review_status, is_monitored, recorded_by, recorded_at, synced_at, created_at
  )
  select
    d.id, s.id, d.height_cm, d.notes, d.lat, d.lng, d.location,
    'pending_review', false, botanist_id, d.recorded_at,
    d.recorded_at + d.sync_after, d.recorded_at + d.sync_after
  from demo_plants d
  join species s on lower(s.scientific_name) = lower(d.scientific_name);

  get diagnostics changed = row_count;
  select count(*) into expected from demo_plants;
  if changed <> expected then
    raise exception 'Demo reset not run: inserted % plants, expected %', changed, expected;
  end if;

  -- ---------- review, as the officer ----------
  -- Acting as the officer means trg_guard_plant_updates (015) checks these updates for real
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', officer_id, 'role', 'authenticated')::text,
    true
  );
  if auth.uid() is distinct from officer_id then
    raise exception 'Demo reset not run: could not act as the officer for the review step';
  end if;

  update plants p
  set review_status = d.status::plant_review_status,
      reviewed_by = officer_id,
      reviewed_at = d.reviewed_at,
      rejection_reason = d.rejection_reason
  from demo_plants d
  where d.id = p.id and d.status <> 'pending_review';

  get diagnostics changed = row_count;
  select count(*) into expected from demo_plants where status <> 'pending_review';
  if changed <> expected then
    raise exception 'Demo reset not run: reviewed % plants, expected %', changed, expected;
  end if;

  -- Monitoring is an officer decision too (015 allows only officers and admins)
  update plants p
  set is_monitored = true
  from demo_plants d
  where d.id = p.id and d.node_identifier is not null;

  get diagnostics changed = row_count;
  if changed <> 2 then
    raise exception 'Demo reset not run: marked % plants as monitored, expected 2', changed;
  end if;

  -- Back to no signed-in user for the rest
  perform set_config('request.jwt.claims', '', true);

  -- ---------- move the sensor nodes to the monitored plants ----------
  -- Before deleting the old plants, so plant_id always points at a plant (NOT NULL, 001).
  -- The node sits at the plant, as in 002_sample_sensor_nodes.sql. installed_at is set to a few
  -- days after the plant was approved, so it isn't later than the readings the simulator backfills.
  update sensor_nodes sn
  set plant_id = d.id,
      latitude = d.lat,
      longitude = d.lng,
      installed_at = d.node_installed_at
  from demo_plants d
  where sn.node_identifier = d.node_identifier;

  get diagnostics changed = row_count;
  if changed <> 2 then
    raise exception 'Demo reset not run: moved % sensor nodes, expected 2', changed;
  end if;

  if exists (
    select 1 from sensor_nodes
    where node_identifier in ('NIAH-NODE-01', 'NIAH-NODE-02') and not is_active
  ) then
    raise notice 'NIAH-NODE-01 or NIAH-NODE-02 is marked inactive, so the simulator backfill will get 409 for it. Set is_active = true before the backfill.';
  end if;

  -- ---------- delete the old data ----------
  -- alerts first: alerts.sensor_reading_id references sensor_readings with no cascade
  delete from alerts;
  delete from sensor_readings;
  -- Every plant not inserted above. Their plant_photos rows go with them (on delete cascade, 017).
  delete from plants p
  where not exists (select 1 from demo_plants d where d.id = p.id);

  get diagnostics changed = row_count;
  if changed <> old_plants then
    raise exception 'Demo reset not run: deleted % old plants, expected %', changed, old_plants;
  end if;

  if (select count(*) from plants) <> (select count(*) from demo_plants)
     or exists (select 1 from plant_photos)
     or exists (select 1 from sensor_readings)
     or exists (select 1 from alerts) then
    raise exception 'Demo reset not run: old rows were still left after deleting';
  end if;

  -- ---------- names for the demo accounts ----------
  -- Fictional names. profiles has no updated_at trigger, so it is set here.
  update profiles p
  set full_name = v.full_name, updated_at = now()
  from (values
    (botanist_id, 'Rosalind anak Ujang'),
    (officer_id, 'Mohd Hafiz bin Sulaiman'),
    (admin_id, 'Lau Mei Ling')
  ) as v(id, full_name)
  where p.id = v.id;

  get diagnostics changed = row_count;
  if changed <> 3 then
    raise exception 'Demo reset not run: renamed % accounts, expected 3', changed;
  end if;

  insert into demo_reset_counts (step, item, row_count) values
    (1, 'Deleted: old plants', old_plants),
    (2, 'Deleted: their plant_photos rows', old_photos),
    (3, 'Deleted: sensor readings', old_readings),
    (4, 'Deleted: alerts', old_alerts),
    (5, 'Files left in the plant-photos bucket: empty it in the dashboard now', bucket_files);

  raise notice 'Added % demo plant records. Deleted % old plants (% photo rows), % sensor readings and % alerts.',
    (select count(*) from demo_plants), old_plants, old_photos, old_readings, old_alerts;
end $$;

commit;

-- ---------- summary ----------
-- The SQL Editor shows the last result, so this comes after commit. New records by month in
-- Sarawak time (as report_records_by_month in 012 groups them), then what was deleted.
-- Expected: 2026-08 5 (4/0/1), 2026-09 8 (7/0/1, 2 monitored), 2026-10 12 (8/1/3),
-- 2026-11 15 (5/9/1), Total 40 (24 approved / 10 pending / 6 rejected, 2 monitored).
select item, records, approved, pending_review, rejected, monitored
from (
  select
    1 as part,
    date_trunc('month', recorded_at at time zone 'Asia/Kuching') as sort_month,
    0 as step,
    coalesce(to_char(date_trunc('month', recorded_at at time zone 'Asia/Kuching'), 'YYYY-MM'), 'Total') as item,
    count(*) as records,
    count(*) filter (where review_status = 'approved') as approved,
    count(*) filter (where review_status = 'pending_review') as pending_review,
    count(*) filter (where review_status = 'rejected') as rejected,
    count(*) filter (where is_monitored) as monitored
  from plants
  group by rollup (date_trunc('month', recorded_at at time zone 'Asia/Kuching'))

  union all

  select 2, null, step, item, row_count, null, null, null, null
  from demo_reset_counts
) summary
order by part, sort_month nulls last, step;
