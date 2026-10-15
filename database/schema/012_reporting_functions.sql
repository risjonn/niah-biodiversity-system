-- Reporting queries for the biodiversity report page (#18).
-- security invoker: each function runs with the caller's own RLS, so officers and admins see
-- every plant and sensor row, and botanists only their own plants. Guests can't call them.
-- Date filters: p_from is inclusive, p_to is exclusive (pass the day AFTER the last day wanted).
-- Leave either as null for no limit.

-- One row per species, with counts of its plant records by review status
create or replace function report_species_summary(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  species_id uuid,
  scientific_name text,
  common_name text,
  family text,
  conservation_status conservation_status,
  total_records bigint,
  approved bigint,
  pending_review bigint,
  rejected bigint,
  first_recorded_at timestamptz,
  last_recorded_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    s.id, s.scientific_name, s.common_name, s.family, s.conservation_status,
    count(p.id),
    count(p.id) filter (where p.review_status = 'approved'),
    count(p.id) filter (where p.review_status = 'pending_review'),
    count(p.id) filter (where p.review_status = 'rejected'),
    min(p.recorded_at),
    max(p.recorded_at)
  from species s
  left join plants p
    on p.species_id = s.id
   and (p_from is null or p.recorded_at >= p_from)
   and (p_to is null or p.recorded_at < p_to)
  group by s.id
  order by s.scientific_name;
$$;

-- One row per month (Sarawak time) with plant records by review status
create or replace function report_records_by_month(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  record_month date,
  total_records bigint,
  approved bigint,
  pending_review bigint,
  rejected bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    date_trunc('month', p.recorded_at at time zone 'Asia/Kuching')::date,
    count(*),
    count(*) filter (where p.review_status = 'approved'),
    count(*) filter (where p.review_status = 'pending_review'),
    count(*) filter (where p.review_status = 'rejected')
  from plants p
  where (p_from is null or p.recorded_at >= p_from)
    and (p_to is null or p.recorded_at < p_to)
  group by 1
  order by 1;
$$;

-- One row per sensor node: reading statistics and alert counts for the period
create or replace function report_sensor_summary(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  sensor_node_id uuid,
  node_identifier text,
  plant_qr_code text,
  scientific_name text,
  readings bigint,
  avg_temperature numeric,
  min_temperature numeric,
  max_temperature numeric,
  avg_humidity numeric,
  min_humidity numeric,
  max_humidity numeric,
  motion_events bigint,
  alerts bigint,
  high_alerts bigint,
  last_reading_at timestamptz
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    n.id, n.node_identifier, p.qr_code, s.scientific_name,
    r.readings, r.avg_t, r.min_t, r.max_t, r.avg_h, r.min_h, r.max_h,
    r.motion_events, a.alerts, a.high_alerts, r.last_reading_at
  from sensor_nodes n
  join plants p on p.id = n.plant_id
  join species s on s.id = p.species_id
  left join lateral (
    select
      count(*) as readings,
      round(avg(sr.temperature), 1) as avg_t,
      min(sr.temperature) as min_t,
      max(sr.temperature) as max_t,
      round(avg(sr.humidity), 1) as avg_h,
      min(sr.humidity) as min_h,
      max(sr.humidity) as max_h,
      count(*) filter (where sr.motion_detected) as motion_events,
      max(sr.recorded_at) as last_reading_at
    from sensor_readings sr
    where sr.sensor_node_id = n.id
      and (p_from is null or sr.recorded_at >= p_from)
      and (p_to is null or sr.recorded_at < p_to)
  ) r on true
  left join lateral (
    select
      count(*) as alerts,
      count(*) filter (where al.severity = 'high') as high_alerts
    from alerts al
    where al.sensor_node_id = n.id
      and (p_from is null or al.created_at >= p_from)
      and (p_to is null or al.created_at < p_to)
  ) a on true
  order by n.node_identifier;
$$;

-- Supabase grants new functions to anon by default; reports are for signed-in users only
revoke execute on function report_species_summary(timestamptz, timestamptz) from public, anon;
revoke execute on function report_records_by_month(timestamptz, timestamptz) from public, anon;
revoke execute on function report_sensor_summary(timestamptz, timestamptz) from public, anon;
grant execute on function report_species_summary(timestamptz, timestamptz) to authenticated;
grant execute on function report_records_by_month(timestamptz, timestamptz) to authenticated;
grant execute on function report_sensor_summary(timestamptz, timestamptz) to authenticated;