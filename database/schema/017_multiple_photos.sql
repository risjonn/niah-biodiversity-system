-- Multiple photos per plant record and per species, up to 5 each (#45, part 1: database only).
--
-- plant_photos and species_photos hold the photos; position 0 is the cover. The old single-photo
-- columns stay and always hold the cover, so app versions that only know plants.photo_url and
-- species.reference_photo_url keep working:
--   - plant_photos/species_photos -> cover column: triggers below copy the lowest position's path
--     or URL into it whenever photos are added, removed or reordered. New apps write only the
--     photo tables, never the cover columns.
--   - cover column -> photo tables, for old app versions that still write the cover column:
--     plants.photo_url is mirrored on insert only, because that is the only time current app
--     versions write it (the mobile sync queue). species.reference_photo_url is mirrored on insert
--     and update, because the current web app sets, replaces and clears it when editing a species.
-- A plant whose photo_url is changed by a direct update (no current app does this) is not mirrored:
-- plant_photos stays the source of truth, and the next photo change overwrites photo_url.
--
-- Guests (anon) and every signed-in user can see a plant's photos, and sign URLs for the files in
-- the private plant-photos bucket, only while the plant is approved and not monitored. The bucket
-- stays private.

-- ---------- tables ----------
create table plant_photos (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references plants(id) on delete cascade,
  -- Path inside the private plant-photos bucket, the same format as plants.photo_url
  storage_path text not null check (storage_path <> ''),
  -- 0 is the cover. Five positions and one photo per position is what limits a plant to 5 photos,
  -- even when two uploads arrive at once; the trigger below only gives a clearer message.
  position integer not null check (position between 0 and 4),
  created_at timestamptz not null default now(),
  uploaded_by uuid references profiles(id) default auth.uid(),
  -- deferrable so one update can swap positions (checked at the end of the statement, not per row)
  constraint plant_photos_plant_id_position_key unique (plant_id, position)
    deferrable initially immediate,
  -- A file belongs to one plant only. Otherwise the same file attached to an approved plant and to
  -- a monitored one would make the monitored plant's photo public.
  constraint plant_photos_storage_path_key unique (storage_path)
);

create table species_photos (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references species(id) on delete cascade,
  -- Public URL in the species-photos bucket, the same format as species.reference_photo_url
  photo_url text not null check (photo_url <> ''),
  position integer not null check (position between 0 and 4),
  created_at timestamptz not null default now(),
  constraint species_photos_species_id_position_key unique (species_id, position)
    deferrable initially immediate
);

-- ---------- backfill ----------
-- Before the triggers below exist, so nothing is synced back while copying. Runs as the owner,
-- so RLS doesn't apply. Empty strings are treated as no photo.
insert into plant_photos (plant_id, storage_path, position, uploaded_by, created_at)
select id, photo_url, 0, recorded_by, created_at
from plants
where photo_url is not null and photo_url <> '';

insert into species_photos (species_id, photo_url, position, created_at)
select id, reference_photo_url, 0, created_at
from species
where reference_photo_url is not null and reference_photo_url <> '';

-- ---------- who can see a plant's photos without being its recorder or staff ----------
-- security definer: guests can't read plants at all (005 dropped the public policy so exact
-- coordinates stay hidden), so a security invoker check would always be false for them. It only
-- answers yes or no for one plant, and whether a plant is approved and not monitored is already
-- public through plants_public (id, is_monitored).
create or replace function public.plant_is_public(p_plant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from plants
    where id = p_plant_id and review_status = 'approved' and not is_monitored
  );
$$;

-- ---------- at most 5 photos, with a readable message ----------
-- tg_argv[0] is the column naming the plant or species, tg_argv[1] the word used in the message.
-- security invoker: counts the rows the caller can see, which for anyone allowed to insert is all
-- of them.
create or replace function public.limit_photos_per_record()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  photo_count integer;
begin
  execute format('select count(*) from %I.%I where %I = $1',
    tg_table_schema, tg_table_name, tg_argv[0])
    into photo_count
    using (to_jsonb(new) ->> tg_argv[0])::uuid;

  if photo_count >= 5 then
    raise exception 'A % can have at most 5 photos', tg_argv[1] using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger trg_limit_plant_photos
  before insert on plant_photos
  for each row execute function public.limit_photos_per_record('plant_id', 'plant record');

create trigger trg_limit_species_photos
  before insert on species_photos
  for each row execute function public.limit_photos_per_record('species_id', 'species');

-- ---------- plant photos -> plants.photo_url ----------
-- security definer: the cover has to follow every photo change, but an admin removing a photo
-- from a plant they recorded themselves, once it is reviewed, has no update policy on plants
-- (004). This only ever sets photo_url to the plant's own lowest-position photo, which the person
-- who changed plant_photos was already allowed to change, so it gives nobody a new ability.
-- trg_guard_plant_updates (015) still runs on the update.
create or replace function public.sync_plant_cover_photo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  changed_plants uuid[];
begin
  changed_plants := case tg_op
    when 'INSERT' then array[new.plant_id]
    when 'DELETE' then array[old.plant_id]
    else array[old.plant_id, new.plant_id]
  end;

  update plants p
  set photo_url = cover.storage_path
  from (
    select pl.id, (
      select pp.storage_path from plant_photos pp
      where pp.plant_id = pl.id
      order by pp.position
      limit 1
    ) as storage_path
    from plants pl
    where pl.id = any (changed_plants)
  ) cover
  where p.id = cover.id
    and p.photo_url is distinct from cover.storage_path;

  return null;
end;
$$;

create trigger trg_sync_plant_cover_photo
  after insert or update or delete on plant_photos
  for each row execute function public.sync_plant_cover_photo();

-- ---------- plants.photo_url -> plant photos, for old app versions ----------
-- security invoker on purpose: the row goes through the same insert policy as a photo added by a
-- new app version, so photo_url can't be used to attach a file from someone else's folder. A new
-- plant from the mobile app is always pending, recorded by the caller, with its photo in the
-- caller's folder, so this passes for every current app version.
create or replace function public.add_plant_cover_from_photo_url()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into plant_photos (plant_id, storage_path, position, uploaded_by)
  values (new.id, new.photo_url, 0, new.recorded_by);
  return null;
end;
$$;

create trigger trg_add_plant_cover_from_photo_url
  after insert on plants
  for each row
  when (new.photo_url is not null and new.photo_url <> '')
  execute function public.add_plant_cover_from_photo_url();

-- ---------- species photos -> species.reference_photo_url ----------
-- security invoker: only conservation officers and admins can change species_photos, and they can
-- update species too (species_write_officer_admin), so no extra rights are needed.
create or replace function public.sync_species_cover_photo()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  changed_species uuid[];
begin
  changed_species := case tg_op
    when 'INSERT' then array[new.species_id]
    when 'DELETE' then array[old.species_id]
    else array[old.species_id, new.species_id]
  end;

  update species s
  set reference_photo_url = cover.photo_url
  from (
    select sp.id, (
      select ph.photo_url from species_photos ph
      where ph.species_id = sp.id
      order by ph.position
      limit 1
    ) as photo_url
    from species sp
    where sp.id = any (changed_species)
  ) cover
  where s.id = cover.id
    and s.reference_photo_url is distinct from cover.photo_url;

  return null;
end;
$$;

create trigger trg_sync_species_cover_photo
  after insert or update or delete on species_photos
  for each row execute function public.sync_species_cover_photo();

-- ---------- species.reference_photo_url -> species photos, for the current web app ----------
-- Setting the column replaces the cover photo (or adds one at position 0 when there are no
-- photos). Clearing it removes the cover; if the species has other photos, the next one becomes
-- the cover. When the cover already matches, nothing happens, which also stops the two sync
-- triggers from calling each other forever. security invoker, for the same reason as above.
create or replace function public.sync_species_photos_from_cover()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  cover_id uuid;
  cover_url text;
begin
  select id, photo_url into cover_id, cover_url
  from species_photos
  where species_id = new.id
  order by position
  limit 1;

  if new.reference_photo_url is null or new.reference_photo_url = '' then
    if cover_id is not null then
      delete from species_photos where id = cover_id;
    end if;
  elsif cover_id is null then
    insert into species_photos (species_id, photo_url, position)
    values (new.id, new.reference_photo_url, 0);
  elsif cover_url is distinct from new.reference_photo_url then
    update species_photos set photo_url = new.reference_photo_url where id = cover_id;
  end if;

  return null;
end;
$$;

create trigger trg_species_photos_from_cover_insert
  after insert on species
  for each row
  when (new.reference_photo_url is not null and new.reference_photo_url <> '')
  execute function public.sync_species_photos_from_cover();

create trigger trg_species_photos_from_cover_update
  after update of reference_photo_url on species
  for each row
  when (old.reference_photo_url is distinct from new.reference_photo_url)
  execute function public.sync_species_photos_from_cover();

-- ---------- reordering ----------
-- PostgREST can only give every matched row the same new value, so swapping two positions needs a
-- function. p_photo_ids is every photo of the record once, cover first; positions become 0, 1, 2...
-- in that order, which also closes gaps left by removed photos. One update statement, so the
-- deferrable unique constraint allows the swap.
-- security invoker: the update policies below decide who may reorder.
create or replace function public.reorder_plant_photos(p_plant_id uuid, p_photo_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_ids uuid[];
  moved integer;
begin
  select array_agg(id order by id) into current_ids
  from plant_photos
  where plant_id = p_plant_id;

  if current_ids is null then
    raise exception 'There are no photos of this plant record that you can reorder'
      using errcode = '42501';
  end if;
  if p_photo_ids is null
    or current_ids is distinct from (select array_agg(x order by x) from unnest(p_photo_ids) x)
  then
    raise exception 'List every photo of this plant record once, in the new order'
      using errcode = '22023';
  end if;

  update plant_photos pp
  set position = o.ord - 1
  from unnest(p_photo_ids) with ordinality as o(id, ord)
  where pp.id = o.id and pp.plant_id = p_plant_id;
  get diagnostics moved = row_count;

  if moved <> cardinality(p_photo_ids) then
    raise exception 'Only the person who recorded this plant, while it is pending review, or an admin can reorder its photos'
      using errcode = '42501';
  end if;
end;
$$;

create or replace function public.reorder_species_photos(p_species_id uuid, p_photo_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_ids uuid[];
  moved integer;
begin
  select array_agg(id order by id) into current_ids
  from species_photos
  where species_id = p_species_id;

  if current_ids is null then
    raise exception 'This species has no photos to reorder'
      using errcode = '22023';
  end if;
  if p_photo_ids is null
    or current_ids is distinct from (select array_agg(x order by x) from unnest(p_photo_ids) x)
  then
    raise exception 'List every photo of this species once, in the new order'
      using errcode = '22023';
  end if;

  update species_photos sp
  set position = o.ord - 1
  from unnest(p_photo_ids) with ordinality as o(id, ord)
  where sp.id = o.id and sp.species_id = p_species_id;
  get diagnostics moved = row_count;

  if moved <> cardinality(p_photo_ids) then
    raise exception 'Only conservation officers and admins can reorder species photos'
      using errcode = '42501';
  end if;
end;
$$;

-- =========================================
-- Row Level Security
-- =========================================
alter table plant_photos enable row level security;
alter table species_photos enable row level security;

-- ---------- plant_photos policies ----------
create policy "plant_photos_select_recorder"
  on plant_photos for select to authenticated
  using (
    exists (
      select 1 from plants p
      where p.id = plant_photos.plant_id and p.recorded_by = auth.uid()
    )
  );

create policy "plant_photos_select_officer_admin"
  on plant_photos for select to authenticated
  using (current_user_role() in ('conservation_officer', 'admin'));

-- Guests and every signed-in user: approved, unmonitored plants only
create policy "plant_photos_select_public"
  on plant_photos for select to anon, authenticated
  using (public.plant_is_public(plant_id));

-- Only the recorder, only while pending, only files in their own folder, and only as themselves
create policy "plant_photos_insert_recorder_pending"
  on plant_photos for insert to authenticated
  with check (
    uploaded_by = auth.uid()
    and starts_with(storage_path, auth.uid()::text || '/')
    and exists (
      select 1 from plants p
      where p.id = plant_photos.plant_id
        and p.recorded_by = auth.uid()
        and p.review_status = 'pending_review'
    )
  );

-- Only position can be updated (column grant at the end), so this is reordering only
create policy "plant_photos_update_recorder_pending_or_admin"
  on plant_photos for update to authenticated
  using (
    current_user_role() = 'admin'
    or exists (
      select 1 from plants p
      where p.id = plant_photos.plant_id
        and p.recorded_by = auth.uid()
        and p.review_status = 'pending_review'
    )
  )
  with check (
    current_user_role() = 'admin'
    or exists (
      select 1 from plants p
      where p.id = plant_photos.plant_id
        and p.recorded_by = auth.uid()
        and p.review_status = 'pending_review'
    )
  );

create policy "plant_photos_delete_recorder_pending_or_admin"
  on plant_photos for delete to authenticated
  using (
    current_user_role() = 'admin'
    or exists (
      select 1 from plants p
      where p.id = plant_photos.plant_id
        and p.recorded_by = auth.uid()
        and p.review_status = 'pending_review'
    )
  );

-- ---------- species_photos policies ----------
-- The same as species itself (001): everyone reads, officers and admins write
create policy "species_photos_select_public"
  on species_photos for select to anon, authenticated
  using (true);

create policy "species_photos_write_officer_admin"
  on species_photos for all to authenticated
  using (current_user_role() in ('conservation_officer', 'admin'))
  with check (current_user_role() in ('conservation_officer', 'admin'));

-- ---------- plant-photos storage: guests ----------
-- Storage only signs a URL for a file the caller can select, so this is also what lets guests
-- create signed URLs. A file counts only when a plant_photos row the caller can see names it,
-- so it follows plant_photos_select_public: approved and unmonitored plants only. Files that are
-- in no plant_photos row stay private. The bucket itself stays private. The owner and staff
-- policies from 006 are unchanged.
create policy "plant_photos_storage_select_public"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'plant-photos'
    and exists (
      select 1 from public.plant_photos pp
      where pp.storage_path = objects.name
        and public.plant_is_public(pp.plant_id)
    )
  );

-- ---------- plants_public ----------
-- Guests read the photos themselves from plant_photos, where the policy above already limits them
-- to approved, unmonitored plants, so the photo paths are checked in one place. The view only adds
-- has_photos, so a plant list can show a placeholder without asking. photo_url, the cover path,
-- was already in the view; it is now hidden for monitored plants, whose photos guests can't open.
-- No app reads photo_url from this view. Columns stay in the same order, with the new one last,
-- as create or replace view requires.
create or replace view plants_public as
select
  id,
  species_id,
  qr_code,
  height_cm,
  morphological_notes,
  case when is_monitored then null else photo_url end as photo_url,
  case when is_monitored then round(latitude::numeric, 2) else latitude end as latitude,
  case when is_monitored then round(longitude::numeric, 2) else longitude end as longitude,
  is_monitored,
  recorded_at,
  not is_monitored
    and exists (select 1 from plant_photos pp where pp.plant_id = plants.id) as has_photos
from plants
where review_status = 'approved';

-- =========================================
-- Grants
-- =========================================
-- Supabase's default privileges give new tables and functions in public to anon and authenticated
-- directly, including write access and TRUNCATE, so start from nothing (see 013 and 014).

-- plants_public: same as 013, in case the view's grants were changed when it was replaced
revoke all on plants_public from anon, authenticated;
grant select on plants_public to anon, authenticated;

-- Guests only need what it takes to show a photo: which plant, which file, which position.
-- uploaded_by and created_at are staff details.
revoke all on plant_photos from anon, authenticated;
grant select (plant_id, storage_path, position) on plant_photos to anon;
grant select, insert, delete on plant_photos to authenticated;
-- Reordering only: the file and the plant a photo belongs to never change
grant update (position) on plant_photos to authenticated;

revoke all on species_photos from anon, authenticated;
grant select on species_photos to anon;
grant select, insert, update, delete on species_photos to authenticated;

-- Used inside the select policies, which run as the caller, so anon and authenticated need it
revoke all on function public.plant_is_public(uuid) from public, anon, authenticated;
grant execute on function public.plant_is_public(uuid) to anon, authenticated;

revoke all on function public.reorder_plant_photos(uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.reorder_species_photos(uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_plant_photos(uuid, uuid[]) to authenticated;
grant execute on function public.reorder_species_photos(uuid, uuid[]) to authenticated;

-- Trigger functions run when their trigger fires, without an execute check, so nobody needs to
-- call them directly
revoke all on function public.limit_photos_per_record() from public, anon, authenticated;
revoke all on function public.sync_plant_cover_photo() from public, anon, authenticated;
revoke all on function public.add_plant_cover_from_photo_url() from public, anon, authenticated;
revoke all on function public.sync_species_cover_photo() from public, anon, authenticated;
revoke all on function public.sync_species_photos_from_cover() from public, anon, authenticated;
