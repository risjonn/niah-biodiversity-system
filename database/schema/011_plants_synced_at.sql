-- Records when each plant reached the server. The mobile app saves registrations on the phone
-- first and syncs them later, so recorded_at (set on the phone) can be well before this.
alter table plants alter column synced_at set default now();
