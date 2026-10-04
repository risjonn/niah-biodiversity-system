insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('plant-photos', 'plant-photos', false, 5242880, array['image/jpeg', 'image/png'])
on conflict (id) do nothing;

create policy "plant_photos_insert_own_folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and current_user_role() in ('botanist', 'conservation_officer', 'admin')
  );

create policy "plant_photos_select_own"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'plant-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "plant_photos_select_staff"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'plant-photos'
    and current_user_role() in ('conservation_officer', 'admin')
  );