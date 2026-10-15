-- Sensor dashboard (#17): one row per sensor node with its latest reading, and a tighter
-- update policy on alerts so acknowledging is the only change staff can make.

-- Lets last_received_at below find each node's newest arrival without scanning all its readings.
create index idx_sensor_readings_node_received on sensor_readings(sensor_node_id, received_at desc);

-- ---------- sensor_node_latest ----------
-- security_invoker so the staff-only policies on sensor_nodes, sensor_readings and plants still
-- apply to whoever queries the view. Without it the view would run as its owner and skip RLS.
--
-- The reading columns are the node's latest reading by recorded_at (the device's own time), shown
-- on the dashboard. last_received_at is when the server last got any reading from the node, used
-- for Online/Offline: it doesn't depend on the device clock being right, and a node sending a
-- backlog of older readings still counts as online.
create view sensor_node_latest
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
  ) as last_received_at
from sensor_nodes n
join plants p on p.id = n.plant_id
join species s on s.id = p.species_id
-- Left join so a node with no readings yet still has a row, with the reading columns null
left join lateral (
  select id, temperature, humidity, motion_detected, motion_duration_seconds, recorded_at
  from sensor_readings
  where sensor_node_id = n.id
  order by recorded_at desc
  limit 1
) r on true;

-- Supabase's default privileges grant every new object in public to anon and authenticated, so
-- take those away first and give back read access to signed-in users only. RLS on the underlying
-- tables then limits rows to conservation officers and admins.
revoke all on sensor_node_latest from anon, authenticated;
grant select on sensor_node_latest to authenticated;

-- ---------- alerts update policy ----------
-- The policy from 001 had no WITH CHECK, so any officer could set acknowledged_by to someone
-- else, un-acknowledge an alert, or rewrite its message or severity. The only update staff need
-- is acknowledging, so the updated row must be acknowledged, and by the person making the change.
-- Only unacknowledged alerts can be updated, so an alert can only be acknowledged once and nobody
-- can later put their own name on an alert someone else acknowledged.
drop policy "alerts_update_staff" on alerts;

create policy "alerts_update_staff"
  on alerts for update
  using (
    current_user_role() in ('conservation_officer', 'admin')
    and is_acknowledged = false
  )
  with check (
    current_user_role() in ('conservation_officer', 'admin')
    and is_acknowledged = true
    and acknowledged_by = auth.uid()
  );
