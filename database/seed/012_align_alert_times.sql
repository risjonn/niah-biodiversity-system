-- Moves each alert to the time of the reading that raised it. Part of #19 (demo data).
--
-- Run in the Supabase SQL Editor, the whole file at once, right AFTER the simulator backfill
-- (database/seed/README.md, step 5).
--
-- Why: check_reading_thresholds (009) and create_device_alert (018) insert each alert with
-- created_at = now(), the moment the reading arrived. A backfill sends readings with past recorded_at times, so every alert it raises
-- is stamped with the time of the backfill and shows as "just now" on the Sensors page and in
-- reports. This sets created_at to the reading's recorded_at instead.
--
-- Only moves an alert back in time, never forward: an alert from a live reading already has a
-- created_at just after its reading and is left as it is (within the device clock's error), and
-- acknowledged_at stays after created_at. Alerts with no reading (sensor_reading_id null) are not
-- touched. Safe to run again: alerts already moved don't change.
-- alerts has no update trigger, and the SQL Editor isn't limited by RLS.

begin;

update alerts a
set created_at = r.recorded_at
from sensor_readings r
where r.id = a.sensor_reading_id
  and r.recorded_at < a.created_at;

commit;

-- Every alert with its time now. After the demo backfill with --with-events: 6 rows, 3 per node
-- (temperature, humidity, motion), on different days, all with matches_reading = true.
-- alert_code is the device code for device alerts (018), empty for threshold alerts.
select
  n.node_identifier,
  a.alert_type,
  a.alert_code,
  a.severity,
  to_char(a.created_at at time zone 'Asia/Kuching', 'YYYY-MM-DD HH24:MI') as created_sarawak_time,
  a.created_at = r.recorded_at as matches_reading,
  a.is_acknowledged,
  a.message
from alerts a
join sensor_nodes n on n.id = a.sensor_node_id
left join sensor_readings r on r.id = a.sensor_reading_id
order by a.created_at;
