create view plants_public as
select
  id,
  species_id,
  qr_code,
  height_cm,
  morphological_notes,
  photo_url,
  case when is_monitored then round(latitude::numeric, 2) else latitude end as latitude,
  case when is_monitored then round(longitude::numeric, 2) else longitude end as longitude,
  is_monitored,
  recorded_at
from plants
where review_status = 'approved';

grant select on plants_public to anon, authenticated;

drop policy "plants_select_approved_public" on plants;