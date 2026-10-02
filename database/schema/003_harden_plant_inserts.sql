drop policy "plants_insert_field_staff" on plants;

create policy "plants_insert_field_staff"
  on plants for insert
  with check (
    current_user_role() in ('botanist', 'conservation_officer', 'admin')
    and recorded_by = auth.uid()
    and review_status = 'pending_review'
  );

create or replace function generate_plant_qr_code()
returns trigger
language plpgsql
as $$
declare
  new_code text;
  attempts int := 0;
begin
  loop
    new_code := 'NIAH-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    exit when not exists (select 1 from plants where qr_code = new_code);
    attempts := attempts + 1;
    if attempts > 10 then
      raise exception 'Could not generate a unique QR code after 10 attempts';
    end if;
  end loop;

  new.qr_code := new_code;
  return new;
end;
$$;