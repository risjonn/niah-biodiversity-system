-- IoT device alerts (#43, I1). The gateway's extra fields on each reading, the alert codes the
-- Forest Node works out by itself, and alerts raised from those codes.
--
-- Source of truth: docs/iot/gateway-contract.md (the IoT team's contract), sections 1, 2, 4 and 5.
-- Run after 001-017. Tests: database/tests/018_device_alerts_test.sql.
--
-- Hand-made columns: on the live project, sensor_readings.tamper_detected, tilt_angle,
-- soil_moisture, is_raining and alert_status were added by hand in the dashboard, outside these
-- migrations, with defaults and no constraints. The gateway has never sent those fields, so the
-- values in them came from the defaults. 018 now owns these columns: it adds them where they are
-- missing, sets their types, removes the defaults, clears the default-filled values and adds the
-- checks (see the sensor_readings section). Change them only through migrations from now on.
--
-- What changes:
--   1. device_alert_codes: the 16 codes in the contract, each code's severity, and which codes
--      raise an alert. The one place that mapping lives; nothing in the apps repeats it.
--   2. sensor_readings: tilt_angle, plant_tilt_angle, soil_moisture, is_raining, tamper_detected,
--      human_detected and alert_status. All nullable: the gateway only sends them once it sets
--      SEND_EXTRA_FIELDS = true, and readings sent before that have none. Also latitude and
--      longitude: the box's GPS fix for that reading.
--   3. alerts: alert_type gets a new value 'device_alert', and alert_code says which code.
--   4. A trigger raises a device alert for each WARNING or CRITICAL reading, at most one open
--      alert per node per code.
--   5. check_reading_thresholds (009) no longer raises motion_detected for a reading that has an
--      alert_status: the node's own logic has already judged the motion. Temperature and humidity
--      limits still apply to every reading.
--   6. Signed-in users can only acknowledge an alert, nothing else (guard_alert_updates).
--   7. Renames NIAH-NODE-01 and NIAH-NODE-02 to NODE-01 and NODE-02, the names the gateway uses.
--
-- Node position: sensor_nodes.latitude and longitude are where the node was installed, set by
-- staff and the seeds. Until now ingest-reading overwrote them with every GPS fix, so a stolen
-- box's track moved the node on the Sensors page. GPS fixes are now kept on each reading
-- instead, and ingest-reading no longer updates the node's position (it still updates
-- battery_level).
--
-- Device alerts vs threshold alerts: alert_type = 'device_alert' (extending the enum) rather than
-- a separate source column. alert_type is NOT NULL, so with a source column a device alert would
-- still need some alert_type, and every existing value means something else. Reusing
-- 'motion_detected', say, would make check_reading_thresholds (009) treat an open device alert as
-- an open motion alert and stop raising real motion alerts. One new enum value keeps every
-- existing reader working unchanged. Every place that reads alert_type:
--   - 009 check_reading_thresholds (replaced below, same alert_type checks): looks for its own
--     three types only, so device alerts never block a threshold alert, and threshold alerts never
--     block a device alert.
--   - 012 report_sensor_summary: counts all alerts per node, and severity = 'high' as high alerts.
--     Device alerts are counted too, CRITICAL ones as high. No alert_type filter, so no change.
--   - web-app/src/lib/alerts.js labels and icons, used by RecentActivity.jsx and
--     SensorDashboard.jsx with a fallback for unknown types. 'device_alert' is added there.
--   - database/seed/012_align_alert_times.sql: shows alert_type; now shows alert_code as well.
--   - iot-firmware/simulator/simulate.js: alert type names in a printed hint only.
--   - mobile-app: does not read alerts.
--
-- Severity: alerts.severity stays the alert_severity enum from 001 (low, medium, high), which the
-- web app and the 012 reports already understand. WARNING is 'medium' and CRITICAL is 'high', the
-- same as the threshold alerts (out-of-range values are medium, long motion is high). INFO codes
-- are saved on the reading and raise no alert.
--
-- Grants and RLS follow 009, 014 and 016: Supabase gives anon and authenticated full access to
-- every new table and function in public by default, so that is taken away again here. Nothing
-- new is writable by anon or authenticated. Readings still come in only through ingest-reading,
-- which uses the secret key.
--
-- ALTER TYPE ... ADD VALUE can run inside a transaction (Postgres 12 and later), but the new value
-- can't be used until it is committed. Nothing below uses 'device_alert' as an enum value when it
-- runs: the check constraint compares alert_type as text, and the trigger function only uses it
-- when a reading arrives later.

-- ---------- alert_type ----------
alter type alert_type add value if not exists 'device_alert';

-- ---------- device_alert_codes ----------
-- severity is the contract's own word (INFO, WARNING or CRITICAL). alert_severity is the severity
-- of the alert a reading with this code raises, or null when it raises none. The check makes the
-- two agree, so the rule "WARNING and CRITICAL raise alerts, INFO doesn't" is kept in this table.
create table device_alert_codes (
  code text primary key,
  severity text not null,
  alert_severity alert_severity,
  description text not null,
  constraint device_alert_codes_code_format check (code ~ '^[A-Z][A-Z_]*[A-Z]$'),
  constraint device_alert_codes_severity check (severity in ('INFO', 'WARNING', 'CRITICAL'))
);

-- The severity mapping check, as its own step that only adds it when it is absent. The same step
-- is in 019, which brings it to databases that already ran an earlier version of 018.
-- The earlier version, device_alert_codes_alert_severity, compared with = and so let a WARNING or
-- CRITICAL code with a null alert_severity through: the check came out null, and a null check
-- passes. It is dropped if present. "is not distinct from" is never null, so this one can't be
-- slipped past that way.
alter table device_alert_codes drop constraint if exists device_alert_codes_alert_severity;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.device_alert_codes'::regclass
      and conname = 'device_alert_codes_alert_severity_matches'
  ) then
    alter table public.device_alert_codes
      add constraint device_alert_codes_alert_severity_matches check (
        alert_severity is not distinct from case severity
          when 'INFO' then null::alert_severity
          when 'WARNING' then 'medium'::alert_severity
          when 'CRITICAL' then 'high'::alert_severity
        end
      );
  end if;
end $$;

-- Section 2 of the contract, in its order. Safe to run again: existing rows are updated.
insert into device_alert_codes (code, severity, alert_severity, description) values
  ('NORMAL', 'INFO', null, 'Everything settled, no issue'),
  ('MOTION_ONLY', 'INFO', null, 'Only the motion sensor triggered, likely wildlife'),
  ('TILT_ONLY', 'INFO', null, 'Only the box or plant tilted, no motion'),
  ('WEATHER_STORM', 'INFO', null, 'Tilt and motion with rain or a soil change, likely natural'),
  ('MAINTENANCE_MODE', 'INFO', null, 'Ranger maintenance is active'),
  ('POACHING_RISK', 'WARNING', 'medium', 'Suspicious activity: tilt and motion while dry, or a person seen in daytime'),
  ('IMPACT_DETECTED', 'WARNING', 'medium', '3 strong knocks or vibrations within 10 s on the box or plant'),
  ('LOITERING', 'WARNING', 'medium', 'Continuous motion for 120 s or more'),
  ('REPEATED_DISTURBANCE', 'WARNING', 'medium', 'Several motion or tilt events within 10 minutes'),
  ('NIGHT_POACHING_RISK', 'CRITICAL', 'high', 'Suspicious activity at night'),
  ('CRITICAL_FALL', 'CRITICAL', 'high', 'Box tilted 75° or more, almost fallen'),
  ('PLANT_STOLEN_MOVING', 'CRITICAL', 'high', 'Box GPS moved more than 15 m with box tilt or motion'),
  ('GPS_SHIELDED_OR_JAMMED', 'CRITICAL', 'high', 'GPS lost right after movement, possibly in a bag or vehicle'),
  ('FIRE_OR_CANOPY_BREACH', 'CRITICAL', 'high', 'Rapid heat rise with a humidity drop, or extreme heat'),
  ('TAMPER_LID_OPENED', 'CRITICAL', 'high', 'Enclosure lid opened'),
  ('POWER_LOSS', 'CRITICAL', 'high', 'Battery critically low (last-gasp message)')
on conflict (code) do update
set severity = excluded.severity,
    alert_severity = excluded.alert_severity,
    description = excluded.description;

alter table device_alert_codes enable row level security;

-- Staff can read the codes, like alert_thresholds (009). No insert, update or delete policy:
-- the codes change only with a migration, when the IoT team changes the contract.
create policy "device_alert_codes_select_staff"
  on device_alert_codes for select
  using (current_user_role() in ('conservation_officer', 'admin'));

revoke all on device_alert_codes from anon, authenticated;
grant select on device_alert_codes to authenticated;

-- ---------- sensor_readings ----------
-- Units from section 4 of the contract: angles in degrees, soil moisture in percent.
-- alert_status must be one of the codes above; a foreign key rather than a list in a check
-- constraint, so the codes are written down once. Null when the gateway doesn't send it.
-- A check passes when the value is null, so every column stays optional.
-- latitude and longitude are the same type as sensor_nodes' (001). Both or neither: one
-- coordinate on its own isn't a position. Both null when the box has no GPS fix.
--
-- Works on a fresh database and on the live project, where five of these columns were already
-- added by hand (see the top of this file). In four steps:
--   a. add whichever columns are missing, with no default
--   b. take away any default and NOT NULL, so a field the gateway leaves out is stored as null
--   c. clear the default-filled alert_status, tamper_detected and is_raining on existing rows
--   d. change any column that has a different type to the one wanted
-- and then add the foreign key and checks.

-- a. Missing columns
alter table sensor_readings
  add column if not exists tilt_angle numeric,
  add column if not exists plant_tilt_angle numeric,
  add column if not exists soil_moisture numeric,
  add column if not exists is_raining boolean,
  add column if not exists tamper_detected boolean,
  add column if not exists human_detected boolean,
  add column if not exists alert_status text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

do $$
declare
  col record;
  current_type text;
begin
  -- b. No defaults and no NOT NULL on any of the columns 018 owns. On a fresh database this
  -- changes nothing. On the live project, alert_status defaulted to 'NORMAL', which would have
  -- stored NORMAL for every reading the gateway sends without the field and so (with the motion
  -- change below) stopped motion_detected alerts for all of them.
  for col in
    select * from (values
      ('tilt_angle'), ('plant_tilt_angle'), ('soil_moisture'), ('is_raining'), ('tamper_detected'),
      ('human_detected'), ('alert_status'), ('latitude'), ('longitude')
    ) as c(name)
  loop
    execute format(
      'alter table public.sensor_readings alter column %I drop default, alter column %I drop not null',
      col.name, col.name
    );
  end loop;

  -- c. The gateway has never sent alert_status, tamper_detected or is_raining, so every value in
  -- them came from a column default, not from a device. They become null, as if left out.
  -- tilt_angle and soil_moisture are left as they are (null on the live project). Skipped once
  -- the foreign key below exists, so device data saved after 018 can never be wiped by running
  -- this part again.
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.sensor_readings'::regclass
      and conname = 'sensor_readings_alert_status_fkey'
  ) then
    update public.sensor_readings
    set alert_status = null, tamper_detected = null, is_raining = null
    where alert_status is not null or tamper_detected is not null or is_raining is not null;
  end if;

  -- d. Types. Only a column whose type differs is changed, so a fresh database (and live columns
  -- that already have the right type) isn't rewritten. Going through text works from any type
  -- whose values read as the new type ('12.5', 'true'); anything else fails here and stops the
  -- migration, rather than losing data.
  for col in
    select * from (values
      ('tilt_angle', 'numeric'), ('plant_tilt_angle', 'numeric'), ('soil_moisture', 'numeric'),
      ('is_raining', 'boolean'), ('tamper_detected', 'boolean'), ('human_detected', 'boolean'),
      ('alert_status', 'text'), ('latitude', 'double precision'), ('longitude', 'double precision')
    ) as c(name, wanted)
  loop
    select format_type(atttypid, atttypmod) into current_type
    from pg_attribute
    where attrelid = 'public.sensor_readings'::regclass and attname = col.name and not attisdropped;

    if current_type is distinct from col.wanted then
      raise notice 'sensor_readings.% was %, changing it to %', col.name, current_type, col.wanted;
      execute format(
        'alter table public.sensor_readings alter column %I type %s using %I::text::%s',
        col.name, col.wanted, col.name, col.wanted
      );
    end if;
  end loop;
end $$;

-- Foreign key and checks, now that the values above are null or device data. The foreign key's
-- name is the one ingest-reading and the tests look for.
alter table sensor_readings
  add constraint sensor_readings_alert_status_fkey
    foreign key (alert_status) references device_alert_codes(code),
  add constraint sensor_readings_tilt_angle_range check (tilt_angle between 0 and 180),
  add constraint sensor_readings_plant_tilt_angle_range check (plant_tilt_angle between 0 and 180),
  add constraint sensor_readings_soil_moisture_range check (soil_moisture between 0 and 100),
  add constraint sensor_readings_latitude_range check (latitude between -90 and 90),
  add constraint sensor_readings_longitude_range check (longitude between -180 and 180),
  add constraint sensor_readings_position_pair check ((latitude is null) = (longitude is null));

-- sensor_readings has no insert or update policy (001), so authenticated users still can't write
-- these columns. Only ingest-reading, with the secret key, adds readings.

-- ---------- alerts ----------
-- if not exists, like the sensor_readings columns above, in case this one was also added by hand.
-- The foreign key is added separately under the name the tests look for. A hand-made column of
-- another type, or with values that aren't codes, makes this fail rather than guess.
alter table alerts
  add column if not exists alert_code text;
alter table alerts
  alter column alert_code drop default,
  add constraint alerts_alert_code_fkey foreign key (alert_code) references device_alert_codes(code);

-- A device alert always has its code, and only device alerts have one. Compared as text because
-- the new enum value can't be used before this migration commits (see the top of this file).
alter table alerts
  add constraint alerts_alert_code_only_on_device_alerts
  check ((alert_type::text = 'device_alert') = (alert_code is not null));

-- At most one unacknowledged alert per node per code. The trigger below relies on this index
-- (insert ... on conflict do nothing), so two readings with the same code arriving at the same
-- moment can't both raise an alert. Acknowledging frees the slot for the next one.
create unique index alerts_one_open_device_alert_per_code
  on alerts (sensor_node_id, alert_code)
  where alert_code is not null and not is_acknowledged;

-- alerts_update_staff (010) lets staff update an unacknowledged alert as long as the new row is
-- acknowledged by them. It doesn't stop other columns changing in the same update, so an officer
-- could rewrite the message or severity, change alert_code, or turn a threshold alert into a
-- device alert while acknowledging it. Acknowledging is the only change staff make (the web app
-- sends just the three acknowledgement fields), so every other column must stay as it was. The
-- row is compared as JSON without those three fields, so a column added to alerts later is
-- covered too. Same pattern as the guards in 015: no signed-in user means the service role or
-- the SQL Editor (e.g. database/seed/012_align_alert_times.sql moves created_at), which may
-- change anything.
create or replace function public.guard_alert_updates()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  acknowledgement_fields constant text[] := array['is_acknowledged', 'acknowledged_by', 'acknowledged_at'];
  new_rest jsonb;
  old_rest jsonb;
  changed text;
begin
  if auth.uid() is null then
    return new;
  end if;

  new_rest := to_jsonb(new) - acknowledgement_fields;
  old_rest := to_jsonb(old) - acknowledgement_fields;
  if new_rest is distinct from old_rest then
    select string_agg(n.key, ', ' order by n.key)
    into changed
    from jsonb_each(new_rest) n
    where n.value is distinct from old_rest -> n.key;

    raise exception 'Only acknowledging an alert is allowed; these cannot be changed: %', changed;
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_alert_updates() from public, anon, authenticated;

create trigger trg_guard_alert_updates
  before update on public.alerts
  for each row execute function public.guard_alert_updates();

-- ---------- device alert on each new reading ----------
-- security definer because alerts has no insert policy, like check_reading_thresholds (009).
-- Runs alongside that trigger: one reading can raise both a threshold alert (e.g. 38 °C) and a
-- device alert (e.g. POACHING_RISK). An unknown code never gets here: the foreign key on
-- alert_status refuses the reading first.
create or replace function public.create_device_alert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  code_row device_alert_codes%rowtype;
  node_name text;
begin
  if new.alert_status is null then
    return new;
  end if;

  select * into code_row from device_alert_codes where code = new.alert_status;
  -- INFO codes have no alert severity: saved on the reading, no alert
  if not found or code_row.alert_severity is null then
    return new;
  end if;

  select node_identifier into node_name from sensor_nodes where id = new.sensor_node_id;

  -- Skipped while the node still has an unacknowledged alert with this code
  insert into alerts (sensor_node_id, sensor_reading_id, alert_type, alert_code, severity, message)
  values (
    new.sensor_node_id, new.id, 'device_alert', code_row.code, code_row.alert_severity,
    format('%s at node %s: %s', code_row.code, node_name, code_row.description)
  )
  on conflict (sensor_node_id, alert_code) where alert_code is not null and not is_acknowledged
  do nothing;

  return new;
end;
$$;

-- A trigger function can't be called through the API, but take away the default grants anyway,
-- as 014 and 016 do for every function they add.
revoke execute on function public.create_device_alert() from public, anon, authenticated;

create trigger trg_create_device_alert
  after insert on sensor_readings
  for each row execute function public.create_device_alert();

-- ---------- threshold alerts (009) ----------
-- The same function as in 009 with one change: long_motion is false when the reading has an
-- alert_status. The Forest Node's own logic (PIR plus tilt, impact, camera, the 120 s loitering
-- rule) has then already decided what the motion means, and raises LOITERING, POACHING_RISK and
-- so on itself, so a second motion_detected alert from the database's simple time limit would
-- only repeat it. Readings without alert_status (the gateway while SEND_EXTRA_FIELDS is false)
-- still get motion alerts as before. Temperature and humidity limits apply to every reading.
-- Its trigger, trg_check_reading_thresholds (009), stays as it is.
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
  -- Changed in 018: the node decides about motion when it sends an alert_status
  long_motion := new.alert_status is null
    and new.motion_detected
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

-- ---------- node rename ----------
-- The gateway sends NODE-01 (contract section 5), and NODE-02 follows the same pattern. Only rows
-- that still have the old name change, and only when the new name is free, so this is safe to
-- run twice: the second time there is nothing left to rename. Readings and alerts point at the
-- node's id, so they follow it. Messages of alerts raised before the rename keep the old name in
-- their text. Plant QR codes (NIAH-XXXXXX) are not touched.
update sensor_nodes sn
set node_identifier = r.new_name
from (values ('NIAH-NODE-01', 'NODE-01'), ('NIAH-NODE-02', 'NODE-02')) as r(old_name, new_name)
where sn.node_identifier = r.old_name
  and not exists (
    select 1 from sensor_nodes taken where taken.node_identifier = r.new_name
  );

do $$
declare
  left_over text;
begin
  select string_agg(node_identifier, ', ' order by node_identifier)
  into left_over
  from sensor_nodes
  where node_identifier in ('NIAH-NODE-01', 'NIAH-NODE-02');

  if left_over is not null then
    raise notice 'Not renamed, because a node with the new name already exists: %. Decide which node to keep, then rename or delete the other by hand.', left_over;
  end if;
end $$;
