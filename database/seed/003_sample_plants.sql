-- Sample plant records for testing (issue #19, plant records half)
-- Run ONCE in the Supabase SQL Editor, after 001_sample_species.sql.
-- On a fresh database, run 002_sample_sensor_nodes.sql again after this file,
-- so the sample sensor nodes can attach to these approved plants.
--
-- Species are looked up by scientific name and people by email, so no IDs are
-- hard-coded and this file works on any copy of the database.
-- Every note starts with [seed] so these rows can be told apart from app test data.
-- qr_code is left out on purpose: the database generates it automatically.

insert into plants (
  species_id, height_cm, morphological_notes, latitude, longitude,
  location_description, review_status, reviewed_by, reviewed_at,
  rejection_reason, is_monitored, recorded_by, recorded_at
)
select
  s.id,
  v.height_cm,
  '[seed] ' || v.notes,
  v.lat,
  v.lng,
  v.location,
  v.status::plant_review_status,
  case when v.status = 'pending_review' then null else officer.id end,
  case when v.status = 'pending_review' then null
       else now() - (v.days_ago - 1) * interval '1 day' end,
  v.rejection_reason,
  v.monitored,
  botanist.id,
  now() - v.days_ago * interval '1 day'
from (values
  ('Eusideroxylon zwageri', 1850, 'Mature tree, straight bole, dark reddish-brown bark.',
     3.8152, 113.7816, 'Beside the plankwalk to the Great Cave', 'approved', null, false, 30),
  ('Eusideroxylon zwageri', 420, 'Sapling, single stem, young leaves reddish.',
     3.8139, 113.7790, 'Forest edge near park HQ', 'pending_review', null, false, 2),
  ('Gonystylus bancanus', 2200, 'Tall tree, smooth grey bark, buttress roots absent.',
     3.8221, 113.7702, 'Peat swamp area, north trail', 'approved', null, true, 28),
  ('Gonystylus bancanus', 1600, 'Medium tree, healthy crown, minor bark damage at base.',
     3.8235, 113.7688, 'Peat swamp area, north trail', 'approved', null, true, 25),
  ('Gonystylus bancanus', 350, 'Young tree, about 3.5 m, leaves glossy.',
     3.8204, 113.7721, 'Peat swamp area, off-trail', 'pending_review', null, false, 3),
  ('Nepenthes ampullaria', 40, 'Cluster of round ground pitchers, green with red speckles.',
     3.8107, 113.7853, 'Damp shaded ground near the river', 'approved', null, false, 21),
  ('Nepenthes ampullaria', 35, 'Small ground pitchers, partly covered by leaf litter.',
     3.8112, 113.7861, 'Damp shaded ground near the river', 'rejected',
     'Photo too blurry to confirm the species. Please re-record.', false, 15),
  ('Nepenthes bicalcarata', 300, 'Climbing vine with upper pitchers, two fangs clearly visible.',
     3.8188, 113.7744, 'Swamp forest, climbing a small tree', 'approved', null, true, 18),
  ('Nepenthes bicalcarata', 250, 'Lower pitchers present, fangs visible on most.',
     3.8193, 113.7751, 'Swamp forest, near the boardwalk', 'pending_review', null, false, 1),
  ('Nepenthes rafflesiana', 120, 'Funnel-shaped upper pitchers, cream with purple spots.',
     3.8165, 113.7802, 'Open scrub along the main trail', 'approved', null, false, 12),
  ('Nepenthes rafflesiana', 90, 'Lower pitchers, rounded, heavily spotted.',
     3.8166, 113.7803, 'Open scrub along the main trail', 'rejected',
     'Duplicate of an existing record at the same spot.', false, 9),
  ('Nepenthes rafflesiana', 100, 'Mixed lower and upper pitchers on one plant.',
     3.8171, 113.7795, 'Open scrub, west side of the trail', 'pending_review', null, false, 4)
) as v(scientific_name, height_cm, notes, lat, lng, location, status,
       rejection_reason, monitored, days_ago)
join species s on s.scientific_name = v.scientific_name
cross join (
  select p.id from profiles p join auth.users u on u.id = p.id
  where u.email = 'botanists@test.com'
) botanist
cross join (
  select p.id from profiles p join auth.users u on u.id = p.id
  where u.email = 'conservation_officer@test.com'
) officer;