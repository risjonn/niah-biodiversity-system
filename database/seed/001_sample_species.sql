insert into species
  (scientific_name, common_name, family, description, conservation_status, cultural_significance)
values
  ('Nepenthes ampullaria',
   'Ampullaria pitcher plant',
   'Nepenthaceae',
   'Carnivorous pitcher plant of lowland Borneo forests. Forms clusters of small, round pitchers near the ground and is unusual among pitcher plants for catching fallen leaf litter as well as insects.',
   'least_concern',
   null),

  ('Nepenthes rafflesiana',
   'Raffles'' pitcher plant',
   'Nepenthaceae',
   'Carnivorous pitcher plant of lowland Borneo, found in open sandy or peaty habitats. Produces large pitchers and climbs as it matures.',
   'least_concern',
   null),

  ('Nepenthes bicalcarata',
   'Fanged pitcher plant',
   'Nepenthaceae',
   'Carnivorous pitcher plant of Borneo peat swamp and heath forests, named for the pair of sharp spines under the pitcher lid. Its hollow tendrils shelter a resident ant species.',
   'vulnerable',
   null),

  ('Eusideroxylon zwageri',
   'Bornean ironwood (belian)',
   'Lauraceae',
   'Large evergreen hardwood of lowland Borneo forests, growing up to 50 m. The timber is very dense and resists termites and decay, and the species has been heavily logged.',
   'vulnerable',
   'Belian timber has long been used in Borneo for house posts and roofing shingles because of its durability.'),

  ('Gonystylus bancanus',
   'Ramin',
   'Thymelaeaceae',
   'Tall tree of peat swamp forests, growing to over 40 m. Native to Borneo, Sumatra, Peninsular Malaysia and Singapore, and harvested heavily for its pale timber.',
   'critically_endangered',
   null)
on conflict (scientific_name) do update set
  common_name = excluded.common_name,
  family = excluded.family,
  description = excluded.description,
  conservation_status = excluded.conservation_status,
  cultural_significance = excluded.cultural_significance,
  updated_at = now();