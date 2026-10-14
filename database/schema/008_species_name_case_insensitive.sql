-- Scientific names can't repeat with different capitalisation ("Nepenthes ampullaria" and
-- "nepenthes ampullaria"). The original unique constraint on scientific_name stays as it is.
create unique index species_scientific_name_lower_key
  on species (lower(scientific_name));
