-- Keeps updated_at current on every edit. Reusable by any table with an updated_at column.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_species_set_updated_at
  before update on species
  for each row execute function set_updated_at();

-- Reference photos for species pages. Public, so guests can view them by URL without signing in.
-- Only conservation officers and admins can add, change, remove or list them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('species-photos', 'species-photos', true, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "species_photos_insert_staff"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'species-photos'
    and current_user_role() in ('conservation_officer', 'admin')
  );

create policy "species_photos_update_staff"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'species-photos'
    and current_user_role() in ('conservation_officer', 'admin')
  )
  with check (
    bucket_id = 'species-photos'
    and current_user_role() in ('conservation_officer', 'admin')
  );

create policy "species_photos_delete_staff"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'species-photos'
    and current_user_role() in ('conservation_officer', 'admin')
  );

-- Storage needs select as well as delete to remove a file. Staff only, so
-- guests can view photos by URL but can't list the bucket.
create policy "species_photos_select_staff"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'species-photos'
    and current_user_role() in ('conservation_officer', 'admin')
  );
