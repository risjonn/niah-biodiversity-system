-- Two sample sensor nodes, NODE-01 and NODE-02, for testing the ingest-reading
-- function and the simulator. Each goes on a different approved plant that has no node yet,
-- oldest record first, using that plant's coordinates.
--
-- Needs at least two approved plants. Safe to run again: existing nodes are left alone, and
-- any node that couldn't be placed last time is added once more plants are approved.

with missing_nodes as (
  select node_identifier, row_number() over (order by node_identifier) as n
  from (values ('NODE-01'), ('NODE-02')) as wanted(node_identifier)
  where not exists (
    select 1 from sensor_nodes sn where sn.node_identifier = wanted.node_identifier
  )
),
free_plants as (
  select p.id, p.latitude, p.longitude, row_number() over (order by p.recorded_at, p.id) as n
  from plants p
  where p.review_status = 'approved'
    and not exists (select 1 from sensor_nodes sn where sn.plant_id = p.id)
)
insert into sensor_nodes (plant_id, node_identifier, latitude, longitude, battery_level)
select f.id, m.node_identifier, f.latitude, f.longitude, 100
from missing_nodes m
join free_plants f on f.n = m.n
on conflict (node_identifier) do nothing;

update plants
set is_monitored = true
where not is_monitored
  and id in (
    select plant_id from sensor_nodes
    where node_identifier in ('NODE-01', 'NODE-02')
  );

do $$
declare
  node_count int;
begin
  select count(*) into node_count
  from sensor_nodes
  where node_identifier in ('NODE-01', 'NODE-02');

  if node_count < 2 then
    raise notice 'Only % of 2 sample sensor nodes exist. Approve more plants and run this file again.', node_count;
  else
    raise notice 'Sample sensor nodes NODE-01 and NODE-02 are ready.';
  end if;
end $$;
