drop policy "plants_update_officer_admin" on plants;

create policy "plants_update_officer_admin"
  on plants for update
  using (
    current_user_role() in ('conservation_officer', 'admin')
    and recorded_by <> auth.uid()
  );