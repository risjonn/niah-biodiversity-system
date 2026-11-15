-- Sensor dashboard charts (#40). Readings grouped by node and by hour or day on the server, so a
-- week of charts is at most 168 rows per node instead of every raw reading, which could go past
-- the API's 1000-row limit.
--
-- security invoker: runs with the caller's own RLS, so only conservation officers and admins get
-- rows (sensor_readings_select_staff in 001). A botanist gets no rows. Guests can't call it.
-- Range: p_from is inclusive, p_to is exclusive, like the functions in 012. Both are required,
-- and the range can be at most 31 days, so one call can't ask for every reading ever stored.
--
-- One row per node per bucket that has at least one reading. Buckets are Sarawak time
-- (Asia/Kuching): an hour bucket starts on the hour, a day bucket at Sarawak midnight.
-- bucket_start is a timestamptz, so the client gets the exact instant whatever its timezone.
create or replace function report_sensor_chart(
  p_from timestamptz,
  p_to timestamptz,
  p_bucket text default 'hour'
)
returns table (
  sensor_node_id uuid,
  bucket_start timestamptz,
  avg_temperature numeric,
  avg_humidity numeric,
  motion_events bigint,
  readings bigint
)
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  -- 22023 is invalid_parameter_value; the messages are shown to the user as they are
  if p_from is null or p_to is null then
    raise exception 'Choose both a start and an end time for the sensor charts'
      using errcode = '22023';
  end if;
  if p_bucket is null or p_bucket not in ('hour', 'day') then
    raise exception 'Sensor charts group readings by hour or day, not %', coalesce(p_bucket, 'null')
      using errcode = '22023';
  end if;
  if p_to < p_from then
    raise exception 'The end of the period is before the start'
      using errcode = '22023';
  end if;
  if p_to - p_from > interval '31 days' then
    raise exception 'Sensor charts can cover at most 31 days'
      using errcode = '22023';
  end if;

  return query
  select
    r.sensor_node_id,
    -- The three-argument date_trunc truncates in the given zone and returns a timestamptz
    date_trunc(p_bucket, r.recorded_at, 'Asia/Kuching') as bucket,
    round(avg(r.temperature), 1),
    round(avg(r.humidity), 1),
    count(*) filter (where r.motion_detected),
    count(*)
  from sensor_readings r
  where r.recorded_at >= p_from
    and r.recorded_at < p_to
  group by r.sensor_node_id, bucket
  order by bucket, r.sensor_node_id;
end;
$$;

-- Supabase's default privileges grant every new function in public to anon directly, not only
-- through PUBLIC, so revoking from PUBLIC alone would leave anon able to call it (see 014).
revoke execute on function report_sensor_chart(timestamptz, timestamptz, text) from public, anon;
grant execute on function report_sensor_chart(timestamptz, timestamptz, text) to authenticated;
