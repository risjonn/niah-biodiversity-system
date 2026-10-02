create or replace function generate_plant_qr_code()
returns trigger
language plpgsql
as $$
declare
  new_code text;
  attempts int := 0;
begin
  if new.qr_code is not null then
    return new;
  end if;

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

create trigger trg_generate_plant_qr_code
  before insert on plants
  for each row execute function generate_plant_qr_code();