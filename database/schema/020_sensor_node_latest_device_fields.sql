-- Sensors page device data (#43, I2): the latest reading's device fields on sensor_node_latest.
-- Run after 001-019. Tests: database/tests/020_sensor_node_latest_device_fields_test.sql.
--
-- 018 added the gateway's extra fields to sensor_readings, but sensor_node_latest (010) still
-- only shows temperature, humidity and motion from each node's latest reading. The node cards
-- need the rest: the device state (alert_status), box and plant tilt, soil moisture, rain,
-- whether a person was seen, and the reading's GPS fix (to tell when a box has been moved from
-- where it was installed).
--
-- What changes: the same view, with new columns added at the end. Every existing column keeps
-- its name, type, position and meaning, so create or replace works and nothing that reads the
-- view needs to change. The new columns, all from the same latest reading as temperature and
-- humidity (latest by recorded_at), and all null when that reading doesn't have them:
--   alert_status, tilt_angle, plant_tilt_angle, soil_moisture, is_raining, human_detected
--   reading_latitude, reading_longitude: the reading's GPS fix. Named apart from latitude and
--     longitude, which stay the node's installed position (sensor_nodes, see 018).
--   alert_status_severity, alert_status_description: alert_status's severity (INFO, WARNING or
--     CRITICAL) and meaning from device_alert_codes (018), so the app doesn't repeat the mapping.
--
-- Security is the same as 010: security_invoker, so RLS on sensor_nodes, sensor_readings, plants,
-- species and now device_alert_codes applies to whoever queries the view. Every one of those is
-- readable by conservation officers and admins only (device_alert_codes since 018), so the view
-- still shows nothing to anyone else. device_alert_codes is joined with a left join: if its rows
-- were hidden, the two code columns would be null rather than the node disappearing.
-- create or replace keeps the view's grants, but they are set again below, the same as 010, so
-- the result is the same whatever state the view was in.
--
-- Not applied by this commit. Apply it in the SQL Editor, then run the test file.

create or replace view sensor_node_latest
with (security_invoker = true) as
select
  n.id,
  n.node_identifier,
  n.is_active,
  n.battery_level,
  n.latitude,
  n.longitude,
  n.plant_id,
  p.qr_code,
  s.scientific_name,
  r.id as reading_id,
  r.temperature,
  r.humidity,
  r.motion_detected,
  r.motion_duration_seconds,
  r.recorded_at,
  (
    select max(received_at)
    from sensor_readings
    where sensor_node_id = n.id
  ) as last_received_at,
  -- New in 020, after every column from 010
  r.alert_status,
  c.severity as alert_status_severity,
  c.description as alert_status_description,
  r.tilt_angle,
  r.plant_tilt_angle,
  r.soil_moisture,
  r.is_raining,
  r.human_detected,
  r.latitude as reading_latitude,
  r.longitude as reading_longitude
from sensor_nodes n
join plants p on p.id = n.plant_id
join species s on s.id = p.species_id
-- Left join so a node with no readings yet still has a row, with the reading columns null
left join lateral (
  select
    id, temperature, humidity, motion_detected, motion_duration_seconds, recorded_at,
    alert_status, tilt_angle, plant_tilt_angle, soil_moisture, is_raining, human_detected,
    latitude, longitude
  from sensor_readings
  where sensor_node_id = n.id
  order by recorded_at desc
  limit 1
) r on true
left join device_alert_codes c on c.code = r.alert_status;

-- The same grants as 010: signed-in users can read, anon can't. RLS on the tables then limits
-- rows to conservation officers and admins.
revoke all on sensor_node_latest from anon, authenticated;
grant select on sensor_node_latest to authenticated;
