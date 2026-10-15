-- Threshold alerts (#20) and the database side of the readings endpoint (#25).
--
-- Change from 001: its comment says the ESP32 devices write using the Supabase secret key.
-- That is no longer the plan. The gateway sends readings to the ingest-reading Edge Function
-- with an x-device-key header, and only the function holds the secret key. The secret key
-- must never be on a field device.

-- How long the node saw movement, measured on the device. Null when not sent.
alter table sensor_readings
  add column motion_duration_seconds numeric;

-- ---------- alert_thresholds ----------
-- A row with a sensor_node_id holds that node's own limits. The single row with
-- sensor_node_id null is the global default, used by every node without its own row.
create table alert_thresholds (
  id uuid primary key default gen_random_uuid(),
  sensor_node_id uuid references sensor_nodes(id) on delete cascade,
  temperature_min numeric not null,
  temperature_max numeric not null,
  humidity_min numeric not null,
  humidity_max numeric not null,
  motion_window_seconds integer not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  constraint alert_thresholds_sensor_node_id_key unique (sensor_node_id),
  constraint alert_thresholds_temperature_range check (temperature_min < temperature_max),
  constraint alert_thresholds_humidity_range check (humidity_min < humidity_max),
  constraint alert_thresholds_motion_window_positive check (motion_window_seconds > 0)
);

-- The unique constraint above allows any number of nulls. Every row in this partial index
-- has the same value (true), so only one global row can exist.
create unique index alert_thresholds_one_global_row
  on alert_thresholds ((sensor_node_id is null))
  where sensor_node_id is null;

create trigger trg_alert_thresholds_set_updated_at
  before update on alert_thresholds
  for each row execute function set_updated_at();

-- Placeholder defaults until the IoT team confirms real values.
insert into alert_thresholds
  (sensor_node_id, temperature_min, temperature_max, humidity_min, humidity_max, motion_window_seconds)
select null, 18, 35, 50, 100, 10
where not exists (select 1 from alert_thresholds where sensor_node_id is null);

-- ---------- alert_thresholds policies ----------
alter table alert_thresholds enable row level security;

create policy "alert_thresholds_select_staff"
  on alert_thresholds for select
  using (current_user_role() in ('conservation_officer', 'admin'));

create policy "alert_thresholds_insert_admin"
  on alert_thresholds for insert
  with check (current_user_role() = 'admin');

create policy "alert_thresholds_update_admin"
  on alert_thresholds for update
  using (current_user_role() = 'admin')
  with check (current_user_role() = 'admin');

create policy "alert_thresholds_delete_admin"
  on alert_thresholds for delete
  using (current_user_role() = 'admin');

-- ---------- threshold check on each new reading ----------
-- security definer because alerts has no insert policy.
-- One alert per type per node at a time: a new alert is skipped while the node still has an
-- unacknowledged alert of the same type. Null temperature or humidity is never an alert.
create or replace function check_reading_thresholds()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t alert_thresholds%rowtype;
  node_name text;
  temperature_out boolean;
  humidity_out boolean;
  long_motion boolean;
begin
  -- The node's own row if it has one, otherwise the global row.
  select * into t
  from alert_thresholds
  where sensor_node_id = new.sensor_node_id or sensor_node_id is null
  order by sensor_node_id nulls last
  limit 1;

  if not found then
    return new;
  end if;

  temperature_out := new.temperature is not null
    and (new.temperature < t.temperature_min or new.temperature > t.temperature_max);
  humidity_out := new.humidity is not null
    and (new.humidity < t.humidity_min or new.humidity > t.humidity_max);
  long_motion := new.motion_detected
    and coalesce(new.motion_duration_seconds, 0) >= t.motion_window_seconds;

  if not (temperature_out or humidity_out or long_motion) then
    return new;
  end if;

  -- Two readings from the same node arriving together must not both pass the
  -- "no unacknowledged alert yet" check, so serialise per node until commit.
  perform pg_advisory_xact_lock(hashtext('check_reading_thresholds:' || new.sensor_node_id::text));

  select node_identifier into node_name from sensor_nodes where id = new.sensor_node_id;

  if temperature_out and not exists (
    select 1 from alerts
    where sensor_node_id = new.sensor_node_id
      and alert_type = 'temperature_anomaly'
      and not is_acknowledged
  ) then
    insert into alerts (sensor_node_id, sensor_reading_id, alert_type, severity, message)
    values (
      new.sensor_node_id, new.id, 'temperature_anomaly', 'medium',
      case when new.temperature > t.temperature_max
        then format('Temperature %s °C is above the %s °C limit at node %s',
          trim_scale(new.temperature), trim_scale(t.temperature_max), node_name)
        else format('Temperature %s °C is below the %s °C limit at node %s',
          trim_scale(new.temperature), trim_scale(t.temperature_min), node_name)
      end
    );
  end if;

  if humidity_out and not exists (
    select 1 from alerts
    where sensor_node_id = new.sensor_node_id
      and alert_type = 'humidity_anomaly'
      and not is_acknowledged
  ) then
    insert into alerts (sensor_node_id, sensor_reading_id, alert_type, severity, message)
    values (
      new.sensor_node_id, new.id, 'humidity_anomaly', 'medium',
      case when new.humidity > t.humidity_max
        then format('Humidity %s %% is above the %s %% limit at node %s',
          trim_scale(new.humidity), trim_scale(t.humidity_max), node_name)
        else format('Humidity %s %% is below the %s %% limit at node %s',
          trim_scale(new.humidity), trim_scale(t.humidity_min), node_name)
      end
    );
  end if;

  if long_motion and not exists (
    select 1 from alerts
    where sensor_node_id = new.sensor_node_id
      and alert_type = 'motion_detected'
      and not is_acknowledged
  ) then
    insert into alerts (sensor_node_id, sensor_reading_id, alert_type, severity, message)
    values (
      new.sensor_node_id, new.id, 'motion_detected', 'high',
      format('Motion lasting %s s detected at node %s (limit %s s)',
        trim_scale(new.motion_duration_seconds), node_name, t.motion_window_seconds)
    );
  end if;

  return new;
end;
$$;

create trigger trg_check_reading_thresholds
  after insert on sensor_readings
  for each row execute function check_reading_thresholds();
