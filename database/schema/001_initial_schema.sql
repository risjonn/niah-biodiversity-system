-- =========================================
-- Niah Biodiversity System — Initial Schema
-- =========================================

-- ---------- Enums ----------
create type user_role as enum ('botanist', 'conservation_officer', 'admin');
create type conservation_status as enum ('least_concern', 'near_threatened', 'vulnerable', 'endangered', 'critically_endangered');
create type plant_review_status as enum ('pending_review', 'approved', 'rejected');
create type alert_type as enum ('motion_detected', 'temperature_anomaly', 'humidity_anomaly', 'node_offline');
create type alert_severity as enum ('low', 'medium', 'high');

-- ---------- profiles ----------
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role user_role not null default 'botanist',
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- species ----------
create table species (
  id uuid primary key default gen_random_uuid(),
  scientific_name text unique not null,
  common_name text,
  family text,
  description text,
  conservation_status conservation_status not null default 'least_concern',
  cultural_significance text,
  reference_photo_url text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------- plants ----------
create table plants (
  id uuid primary key default gen_random_uuid(),
  species_id uuid not null references species(id),
  qr_code text unique not null,
  height_cm numeric,
  morphological_notes text,
  photo_url text,
  latitude double precision not null,
  longitude double precision not null,
  location_description text,
  review_status plant_review_status not null default 'pending_review',
  reviewed_by uuid references profiles(id),
  reviewed_at timestamptz,
  rejection_reason text,
  is_monitored boolean not null default false,
  recorded_by uuid not null references profiles(id),
  recorded_at timestamptz not null default now(),
  synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_plants_species_id on plants(species_id);
create index idx_plants_review_status on plants(review_status);
create index idx_plants_recorded_by on plants(recorded_by);

-- ---------- sensor_nodes ----------
create table sensor_nodes (
  id uuid primary key default gen_random_uuid(),
  plant_id uuid not null references plants(id),
  node_identifier text unique not null,
  latitude double precision not null,
  longitude double precision not null,
  installed_at timestamptz not null default now(),
  installed_by uuid references profiles(id),
  is_active boolean not null default true,
  battery_level numeric,
  created_at timestamptz not null default now()
);

create index idx_sensor_nodes_plant_id on sensor_nodes(plant_id);

-- ---------- sensor_readings ----------
create table sensor_readings (
  id uuid primary key default gen_random_uuid(),
  sensor_node_id uuid not null references sensor_nodes(id),
  temperature numeric,
  humidity numeric,
  motion_detected boolean not null default false,
  recorded_at timestamptz not null,
  received_at timestamptz not null default now()
);

create index idx_sensor_readings_node_time on sensor_readings(sensor_node_id, recorded_at desc);

-- ---------- alerts ----------
create table alerts (
  id uuid primary key default gen_random_uuid(),
  sensor_node_id uuid not null references sensor_nodes(id),
  sensor_reading_id uuid references sensor_readings(id),
  alert_type alert_type not null,
  message text,
  severity alert_severity not null default 'medium',
  is_acknowledged boolean not null default false,
  acknowledged_by uuid references profiles(id),
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_alerts_is_acknowledged on alerts(is_acknowledged);

-- =========================================
-- Helper function for RLS role checks
-- =========================================
create or replace function current_user_role()
returns user_role
language sql
security definer
stable
as $$
  select role from profiles where id = auth.uid();
$$;

-- Prevent non-admins from changing their own role via a direct profile update
create or replace function prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.role is distinct from old.role and current_user_role() is distinct from 'admin' then
    raise exception 'Only admins can change roles';
  end if;
  return new;
end;
$$;

create trigger trg_prevent_role_self_escalation
  before update on profiles
  for each row execute function prevent_role_self_escalation();

-- =========================================
-- Enable Row Level Security
-- =========================================
alter table profiles enable row level security;
alter table species enable row level security;
alter table plants enable row level security;
alter table sensor_nodes enable row level security;
alter table sensor_readings enable row level security;
alter table alerts enable row level security;

-- ---------- profiles policies ----------
create policy "profiles_select_own_or_admin"
  on profiles for select
  using (auth.uid() = id or current_user_role() = 'admin');

create policy "profiles_insert_admin_only"
  on profiles for insert
  with check (current_user_role() = 'admin');

create policy "profiles_update_own_or_admin"
  on profiles for update
  using (auth.uid() = id or current_user_role() = 'admin');

-- ---------- species policies ----------
-- Public read access (guest/visitor mode, no login required)
create policy "species_select_public"
  on species for select
  using (true);

create policy "species_write_officer_admin"
  on species for all
  using (current_user_role() in ('conservation_officer', 'admin'))
  with check (current_user_role() in ('conservation_officer', 'admin'));

-- ---------- plants policies ----------
-- Approved records are publicly visible (guest/visitor mode)
create policy "plants_select_approved_public"
  on plants for select
  using (review_status = 'approved');

-- Botanists can see their own submissions regardless of status
create policy "plants_select_own"
  on plants for select
  using (auth.uid() = recorded_by);

-- Officers and admins can see everything
create policy "plants_select_officer_admin"
  on plants for select
  using (current_user_role() in ('conservation_officer', 'admin'));

-- Field staff can submit new records, only as themselves
create policy "plants_insert_field_staff"
  on plants for insert
  with check (
    current_user_role() in ('botanist', 'conservation_officer', 'admin')
    and recorded_by = auth.uid()
  );

-- Botanists can edit their own record only while still pending review
create policy "plants_update_own_pending"
  on plants for update
  using (auth.uid() = recorded_by and review_status = 'pending_review');

-- Officers/admins can update any record (the review action itself)
create policy "plants_update_officer_admin"
  on plants for update
  using (current_user_role() in ('conservation_officer', 'admin'));

-- ---------- sensor_nodes / sensor_readings / alerts policies ----------
-- Staff-only: exact sensor locations and readings are not public,
-- to avoid exposing monitoring positions for endangered species.
-- The ESP32 devices write via the Supabase secret key, which bypasses
-- RLS entirely, so no insert policy is needed for the sensor tables.

create policy "sensor_nodes_select_staff"
  on sensor_nodes for select
  using (current_user_role() in ('conservation_officer', 'admin'));

create policy "sensor_nodes_write_staff"
  on sensor_nodes for all
  using (current_user_role() in ('conservation_officer', 'admin'))
  with check (current_user_role() in ('conservation_officer', 'admin'));

create policy "sensor_readings_select_staff"
  on sensor_readings for select
  using (current_user_role() in ('conservation_officer', 'admin'));

create policy "alerts_select_staff"
  on alerts for select
  using (current_user_role() in ('conservation_officer', 'admin'));

create policy "alerts_update_staff"
  on alerts for update
  using (current_user_role() in ('conservation_officer', 'admin'));
