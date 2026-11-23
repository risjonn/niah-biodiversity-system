# Seed data

| File | What it is |
|---|---|
| `001_sample_species.sql` | The 5 species. Safe to run again (updates them in place). |
| `002_sample_sensor_nodes.sql` | NODE-01 and NODE-02, for development. Not needed for the demo. |
| `003_sample_plants.sql` | 12 `[seed]` test plants, for development. **Don't run it on the demo database.** |
| `010_demo_reset.sql` | **Destructive.** Replaces every plant record with the demo data and deletes every plant photo row, sensor reading and alert. |
| `012_align_alert_times.sql` | After the simulator backfill: moves each alert to the time of its reading. |
| `strip_photo_metadata.py` | Local helper, not SQL: removes GPS and all other metadata from photos uploaded by hand. See [step 6b](#6b-remove-location-metadata-from-hand-uploaded-photos). |

Both demo files are run by hand in the Supabase SQL Editor, the whole file at once.
`010_demo_reset.sql` looks people up by email: `botanists@test.com`,
`conservation_officer@test.com` and `admin@test.com` must exist with those roles.

## Demo-day run order

Allow about 30 minutes plus time for photos. Do the steps in this order: each one depends on the
one before.

### 0. Before you start

- Nobody else should use the apps or the simulator until step 5 is done.
- On every phone that has been used as the botanist, open the mobile app, let anything queued
  sync, then sign out. A record still queued on a phone would be uploaded after the reset and
  show up among the demo records.
- Note each sensor node's battery level, for the backfill in step 4. Run this in the SQL Editor
  (read only):

  ```sql
  select node_identifier, battery_level, is_active from sensor_nodes order by node_identifier;
  ```

  Both nodes must have `is_active = true`, or the backfill gets 409 for them. They must be called
  `NODE-01` and `NODE-02`: migration 018 renames the old `NIAH-NODE-01` and `NIAH-NODE-02`, and
  the reset refuses to run until it has.

### 1. CSV backups

In the Table Editor, for each of these tables: open it, Export, Export table as CSV. Keep the
files somewhere outside the repo.

- `plants`, `plant_photos`, `sensor_readings`, `alerts` (these are deleted)
- `sensor_nodes`, `profiles`, `species`, `species_photos`, `alert_thresholds` (kept, but changed
  or useful if something goes wrong)

In Storage, download any files from the `plant-photos` bucket you want to keep. See
[Undo](#undo-restoring-the-backup) before relying on the CSVs.

### 2. Reset: `010_demo_reset.sql`

Paste the whole file into the SQL Editor and Run. It adds the 40 demo records, reviews them,
moves both sensor nodes to the two monitored plants, then deletes the old plants, readings and
alerts, all in one transaction. The result should be:

| item | records | approved | pending_review | rejected | monitored |
|---|---|---|---|---|---|
| 2026-08 | 5 | 4 | 0 | 1 | 0 |
| 2026-09 | 8 | 7 | 0 | 1 | 2 |
| 2026-10 | 12 | 8 | 1 | 3 | 0 |
| 2026-11 | 15 | 5 | 9 | 1 | 0 |
| Total | 40 | 24 | 10 | 6 | 2 |
| Deleted: old plants | *n* | | | | |
| Deleted: their plant_photos rows | *n* | | | | |
| Deleted: sensor readings | *n* | | | | |
| Deleted: alerts | *n* | | | | |
| Files left in the plant-photos bucket: empty it in the dashboard now | *n* | | | | |

It changes nothing and shows an error instead if:

- it has already been run (the demo records are already there), so it can't be run twice;
- another table has a foreign key to `plants`;
- there are sensor nodes other than NODE-01 and NODE-02;
- an account, a species or one of the two nodes is missing.

### 3. Empty the `plant-photos` bucket

Storage, `plant-photos`, select every folder, Delete. The demo records have no photos yet, so
every file there belonged to a deleted plant.

**Only `plant-photos`.** Don't touch `species-photos`: the species photos are kept.

### 4. Sensor history: simulator backfill

From `iot-firmware/simulator` (setup in its README: Node 24, `.env` with `INGEST_URL` and
`DEVICE_INGEST_KEY`), with the battery levels from step 0:

```
node simulate.js --backfill 14d NODE-01 NODE-02 --every 30m --with-events --battery NODE-01=<level> --battery NODE-02=<level>
```

About 673 readings per node, a few minutes. The summary should say 673 saved and
`3 alert(s) raised (3 expected from the events)` for each node: one temperature, one humidity and
one motion alert per node, created by the real trigger. The batteries drain a few percent over the
14 days and end below the levels you gave.

Run it **once**. A second run adds a second set of readings over the same days. To start the
sensor history again without touching plants, run this in the SQL Editor, then step 4 again:

```sql
delete from alerts;
delete from sensor_readings;
```

### 5. Alert times: `012_align_alert_times.sql`

Paste the whole file into the SQL Editor and Run, right after the backfill. Alerts are stamped
with the time the database created them, so without this all 6 show as "just now". This moves each
one to the time of the reading that raised it.

The result should list 6 alerts, 3 per node, on different days, all with
`matches_reading = true`. Safe to run again.

### 6. Photos, by hand

The reset adds no photos. Add them to about 8 records. Run this (read only) to get each
record's QR code:

```sql
select
  to_char(p.recorded_at at time zone 'Asia/Kuching', 'YYYY-MM-DD') as recorded,
  s.scientific_name, p.qr_code, p.review_status, p.is_monitored, p.location_description
from plants p join species s on s.id = p.species_id
order by p.recorded_at;
```

Use your own photos, or ones whose licence allows it, of the right species. JPEG or PNG, at most
5 MB each.

| Status | Recorded | Species | Why |
|---|---|---|---|
| Approved | 2026-08-11 | *Nepenthes rafflesiana* (Pangkalan Batu) | Guest view: photo and approximate location (least concern) |
| Approved | 2026-09-17 | *Nepenthes bicalcarata* (peat swamp) | Guest view: location withheld, no plant photo, species photo instead (vulnerable, 021) |
| Approved, monitored | 2026-09-03 | *Gonystylus bancanus* (NODE-01) | Staff see the photo, guests don't (017, 021) |
| Approved, monitored | 2026-09-10 | *Eusideroxylon zwageri* (NODE-02) | Staff see the photo, guests don't (017, 021) |
| Rejected, "Photo unclear" | 2026-10-07 | *Nepenthes bicalcarata* | A deliberately blurry photo, so the reason makes sense |
| Rejected, "Photo unclear" | 2026-11-06 | *Nepenthes ampullaria* | A deliberately blurry photo, so the reason makes sense |
| Pending | 2026-11-17 | *Gonystylus bancanus* | Review demo (notes mention a cut stump) |
| Pending | 2026-11-19 | *Nepenthes bicalcarata* | Review demo (notes say "re-recorded with a clearer photo") |

**Pending records:** sign in to the mobile app as the botanist and add the photos to the record,
the normal way. The database only lets the recorder add photos while a record is pending.

**Approved and rejected records** can't get photos through the apps. Add them by hand instead:

1. Get the botanist's folder name (read only):
   `select id from auth.users where email = 'botanists@test.com';`
2. Storage, `plant-photos`: create a folder with exactly that id, and upload the photos into it.
3. In the SQL Editor, attach each photo to its record. Position 0 is the cover; use 1 to 4 for
   more photos of the same record. `photo_url` updates itself (017).

   ```sql
   insert into plant_photos (plant_id, storage_path, position, uploaded_by)
   select p.id, p.recorded_by || '/<file name>.jpg', 0, p.recorded_by
   from plants p
   where p.qr_code = '<QR code>';
   ```

### 6b. Remove location metadata from hand-uploaded photos

Photos from a phone or camera usually carry the GPS position where they were taken, in the file
itself. Guests can open the photos of least concern and near threatened plants (021), and anyone
who can open a file can read its metadata, so a photo uploaded with its GPS would give away a
more exact position than the approximate location the app shows. Photos added through the mobile
app are already clean (the app re-encodes them before upload); this step is for the files you
uploaded by hand in step 6, or at any other time through the dashboard.

Needs Python 3 and Pillow on your own computer (`python -m pip install pillow`). Nothing is added
to the apps, no keys are used, and the script never uploads anything.

1. **Download.** Storage, `plant-photos`, open the botanist's folder (the id from step 6), select
   the files you uploaded by hand, Download. Put them in an empty folder, e.g. `photos-original`.
   Keep the file names exactly as they are: `plant_photos.storage_path` points at them.
2. **Clean.** From the repo root:

   ```
   python database/seed/strip_photo_metadata.py photos-original photos-clean
   ```

   It writes a clean copy of each JPEG, with the same name, into `photos-clean` (created if
   missing; the originals are not changed). Each line says what was removed; lines starting with
   `GPS` are the photos that had a position. The summary lists them, plus any files it skipped
   (not JPEG, e.g. PNG: those are **not** cleaned, so convert them to JPEG and run it again, or
   don't use them) or couldn't clean. It exits with an error if any file failed.
3. **Re-upload with the same names.** In the same folder in Storage, delete the originals you
   downloaded, then upload the files from `photos-clean`. The names must match exactly
   (including `.jpg` vs `.JPG`), or the photo rows will point at files that no longer exist.
   Nothing in the database needs changing.
4. **Check.** Open one of the plants in the guest view of the mobile app: the photo still shows,
   the right way up. Download one cleaned file again into an empty folder and run the script on
   that folder: it should say `removed nothing (no metadata)`.
5. Delete `photos-original` from your computer when you're done: it still holds the positions.

### 7. Change passwords

After everything else, since the steps above use the test accounts. Change all three through the
apps:

- Officer and admin: sign in to the web app, open the user menu at the bottom of the sidebar,
  Change password.
- Botanist: sign in to the mobile app, Settings tab, Change password.

Then sign in again on the demo phones and laptops with the new passwords.

## Undo: restoring the backup

The CSVs from step 1 can be imported with the Table Editor. The demo plants have to go, but the
sensor nodes point at two of them and `sensor_nodes.plant_id` can't be empty, so the nodes are
moved back to their old plants before the demo plants are deleted.

**Four insert triggers have to be off during the import.** Otherwise every plant gets a **new**
QR code (003 generates one on every insert, so printed tags would stop matching), photos are
attached twice (017), and every out-of-range reading (009) or WARNING/CRITICAL device reading
(018) raises its alert again on top of the imported alerts.

1. In the SQL Editor:

   ```sql
   delete from alerts;
   delete from sensor_readings;
   -- Remember which plants are the demo ones, to delete them at the end
   create table public.demo_plant_ids as select id from plants;
   revoke all on public.demo_plant_ids from anon, authenticated;
   alter table plants disable trigger trg_generate_plant_qr_code;
   alter table plants disable trigger trg_add_plant_cover_from_photo_url;
   alter table sensor_readings disable trigger trg_check_reading_thresholds;
   alter table sensor_readings disable trigger trg_create_device_alert;
   ```

2. Import, in this order: `plants`, `plant_photos`, `sensor_readings`, `alerts`.
3. Move each node back to the plant it had, using `plant_id` from `sensor_nodes.csv`:

   ```sql
   update sensor_nodes set plant_id = '<plant_id from the CSV>' where node_identifier = 'NODE-01';
   update sensor_nodes set plant_id = '<plant_id from the CSV>' where node_identifier = 'NODE-02';
   ```

4. Delete the demo plants and turn the triggers back on:

   ```sql
   delete from plants where id in (select id from public.demo_plant_ids);
   drop table public.demo_plant_ids;
   alter table plants enable trigger trg_generate_plant_qr_code;
   alter table plants enable trigger trg_add_plant_cover_from_photo_url;
   alter table sensor_readings enable trigger trg_check_reading_thresholds;
   alter table sensor_readings enable trigger trg_create_device_alert;
   ```

Photo files have to be uploaded again to the same paths. The demo names stay on the three
accounts; restore `full_name` from `profiles.csv` if needed.
