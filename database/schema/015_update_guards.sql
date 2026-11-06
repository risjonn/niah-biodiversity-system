-- Security fixes F-01, F-13 and F-14 (#30). RLS can't compare a row's old and new values, so these
-- rules are BEFORE UPDATE triggers.

-- ---------- plants ----------
-- F-13: plants_update_own_pending lets an officer into their own pending record, and
-- plants_update_officer_admin accepts the new row once recorded_by names someone else, so one
-- update could approve a record and hand it to another user.
-- F-14: qr_code was only protected on insert, so a botanist could change it on a pending record.
create or replace function public.guard_plant_updates()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  acting_user uuid := auth.uid();
begin
  -- No signed-in user means the service role or the SQL Editor, used for admin maintenance.
  -- Anonymous requests also have no user, but no update policy on plants lets them reach a row.
  if acting_user is null then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Plant record IDs cannot be changed';
  end if;
  if new.qr_code is distinct from old.qr_code then
    raise exception 'QR codes cannot be changed';
  end if;
  if new.recorded_by is distinct from old.recorded_by then
    raise exception 'The person who recorded a plant cannot be changed';
  end if;
  if new.recorded_at is distinct from old.recorded_at then
    raise exception 'The time a plant was recorded cannot be changed';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'The time a plant record was created cannot be changed';
  end if;

  -- is_monitored decides whether plants_public rounds a plant's coordinates.
  -- "is not true" so a missing role (null) is refused too.
  if new.is_monitored is distinct from old.is_monitored
    and (current_user_role() in ('conservation_officer', 'admin')) is not true
  then
    raise exception 'Only conservation officers and admins can change whether a plant is monitored';
  end if;

  if new.review_status is distinct from old.review_status
    or new.reviewed_by is distinct from old.reviewed_by
    or new.reviewed_at is distinct from old.reviewed_at
    or new.rejection_reason is distinct from old.rejection_reason
  then
    -- "is not true" so a missing role (null) is refused too
    if (current_user_role() in ('conservation_officer', 'admin')
        and old.recorded_by <> acting_user) is not true
    then
      raise exception 'Only a conservation officer or admin who did not record this plant can review it';
    end if;

    if new.review_status is distinct from old.review_status
      and new.reviewed_by is distinct from acting_user
    then
      raise exception 'A review must be recorded under the name of the person making it';
    end if;
  end if;

  return new;
end;
$$;

create trigger trg_guard_plant_updates
  before update on public.plants
  for each row execute function public.guard_plant_updates();

-- ---------- profiles ----------
-- F-01: admins could change their own role, which could leave the system with no admin.
-- Replaces the function from 001. Its trigger trg_prevent_role_self_escalation stays in place.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.role is not distinct from old.role then
    return new;
  end if;

  -- No signed-in user means the service role or the SQL Editor, used for admin maintenance.
  -- Anonymous requests also have no user, but no update policy on profiles lets them reach a row.
  if auth.uid() is null then
    return new;
  end if;

  if old.id = auth.uid() then
    raise exception 'You cannot change your own role';
  end if;
  if current_user_role() is distinct from 'admin' then
    raise exception 'Only admins can change roles';
  end if;

  return new;
end;
$$;
