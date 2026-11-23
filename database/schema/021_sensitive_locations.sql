-- Hide the locations of threatened species from guests (tutor feedback).
--
-- Until now plants_public gave guests exact coordinates for every unmonitored plant, and rounded
-- coordinates for monitored ones, so the position of a critically endangered plant was public as
-- long as nobody had put a sensor on it. From this migration:
--
--   sensitive plant  = monitored, OR its species is vulnerable, endangered or critically
--                      endangered. Decided in one place: plant_location_is_sensitive() below.
--
--   plants_public    sensitive:      latitude, longitude, morphological_notes null;
--                                    location_withheld true
--                    not sensitive:  latitude, longitude rounded to 2 decimals (about 1.1 km);
--                                    location_withheld false
--                    every plant:    location_label 'Niah National Park'.
--                    location_description is not in the view at all (it never was, since 005),
--                    so guests can't read it for any plant; see the note at the view.
--
--   photos           plant_is_public() is false for sensitive plants, so guests can't read their
--                    plant_photos rows or sign URLs for their files (both policies from 017 call
--                    it). has_photos and photo_url in plants_public follow the same rule.
--
-- Only what guests see changes. The plants table, its policies (001, 005), and the recorder and
-- staff policies on plant_photos and storage (006, 017) are untouched, so conservation officers,
-- admins and the person who recorded a plant still read its exact coordinates,
-- location_description and every photo from plants and plant_photos directly.
--
-- Also affects signed-in botanists looking at plants they did NOT record: they already read those
-- through plants_public (005 dropped the public policy on plants) and through the "public" photo
-- policies, which apply to anon and authenticated alike, so they now get the guest view too.
--
-- Who can change whether a plant is sensitive: is_monitored only officers and admins (015 guard),
-- species.conservation_status only officers and admins (species_write_officer_admin, 001).

-- ---------- the one place that decides sensitivity ----------
-- Takes the two facts that decide it rather than a plant id, so the view can call it per row
-- without another lookup, and plant_is_public can call it inside its own query. Both facts are
-- already public (plants_public.is_monitored, species.conservation_status), so the function
-- reveals nothing and runs as the caller (security invoker).
-- Fails closed: a missing value counts as sensitive, so a future nullable column or a new enum
-- value doesn't quietly publish a location. Enum values are the ones from 001:
-- least_concern, near_threatened, vulnerable, endangered, critically_endangered.
create or replace function public.plant_location_is_sensitive(
  p_is_monitored boolean,
  p_conservation_status conservation_status
)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_is_monitored is not false
    or p_conservation_status is null
    or p_conservation_status not in ('least_concern', 'near_threatened');
$$;

-- ---------- who can see a plant's photos without being its recorder or staff ----------
-- Same as 017 (security definer, stable, search_path = public, same grants below), with one more
-- condition: the plant is not sensitive. Still security definer for the reason given in 017:
-- guests can't read plants, so a security invoker check would always be false for them. It still
-- only answers yes or no for one plant, from facts guests can already read through plants_public
-- (id, species_id, is_monitored) and species (conservation_status).
create or replace function public.plant_is_public(p_plant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from plants p
    join species s on s.id = p.species_id
    where p.id = p_plant_id
      and p.review_status = 'approved'
      and not public.plant_location_is_sensitive(p.is_monitored, s.conservation_status)
  );
$$;

-- ---------- plants_public ----------
-- Same view as 017, still without security_invoker (it runs as its owner, because guests can't
-- read plants; see 005 and 013), still approved plants only. Changes:
--   - latitude/longitude: null when sensitive, otherwise rounded to 2 decimals for every plant
--     (before, only monitored plants were rounded). Cast back to double precision, the type these
--     columns already have, because create or replace view can't change a column's type.
--   - morphological_notes: null for sensitive plants. Field notes often say where the plant is
--     ("beside the trail", "by the river"), which would undo hiding the coordinates. Kept for
--     least concern and near threatened plants.
--   - photo_url, has_photos: hidden for sensitive plants (before: for monitored plants), matching
--     plant_is_public, so has_photos is never true for a plant whose photos guests can't open.
--   - location_withheld, location_label: new, added last as create or replace view requires.
--     location_label is the same for every plant; it is a column so the apps don't hardcode the
--     park name and a future change (e.g. a zone name for non-sensitive plants) needs no app update.
--   - location_description: deliberately NOT added. The task asks for it to be null for every
--     plant; leaving the column out gives guests the same nothing, without a column that is
--     always null. The mobile guest screens never asked for it.
-- The join to species makes the view no longer automatically updatable; it was already
-- select-only for anon and authenticated since 013, so nothing that worked stops working.
create or replace view plants_public as
select
  p.id,
  p.species_id,
  p.qr_code,
  p.height_cm,
  case when sens.withheld then null else p.morphological_notes end as morphological_notes,
  case when sens.withheld then null else p.photo_url end as photo_url,
  case when sens.withheld then null
    else round(p.latitude::numeric, 2)::double precision end as latitude,
  case when sens.withheld then null
    else round(p.longitude::numeric, 2)::double precision end as longitude,
  p.is_monitored,
  p.recorded_at,
  not sens.withheld
    and exists (select 1 from plant_photos pp where pp.plant_id = p.id) as has_photos,
  sens.withheld as location_withheld,
  'Niah National Park'::text as location_label
from plants p
join species s on s.id = p.species_id
cross join lateral (
  select public.plant_location_is_sensitive(p.is_monitored, s.conservation_status) as withheld
) sens
where p.review_status = 'approved';

-- =========================================
-- Grants
-- =========================================
-- plants_public: same as 013 and 017, in case the view's grants were changed when it was replaced
revoke all on plants_public from anon, authenticated;
grant select on plants_public to anon, authenticated;

-- plant_is_public: same as 017 (create or replace keeps grants, restated so this file stands alone)
revoke all on function public.plant_is_public(uuid) from public, anon, authenticated;
grant execute on function public.plant_is_public(uuid) to anon, authenticated;

-- New function. anon and authenticated need execute: plants_public is not security_invoker, but
-- Postgres still checks execute on the functions a view calls against the user querying the view,
-- not the view owner. It is a pure function of its two arguments, so this exposes nothing.
-- PUBLIC is revoked first, as for every function since 014, so the grant list is explicit.
revoke all on function public.plant_location_is_sensitive(boolean, conservation_status)
  from public, anon, authenticated;
grant execute on function public.plant_location_is_sensitive(boolean, conservation_status)
  to anon, authenticated;
