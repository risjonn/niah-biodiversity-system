# RLS policy test results (issue #27)

**Run on:** 6 November 2026, live Supabase project (`niah-biodiversity-system`)
**Tested by:** Lidiya Karmila
**Test file:** [`rls_policy_tests.sql`](rls_policy_tests.sql)
**Result:** 28 of 29 passed. 1 failed (RLS-28, see Finding below).

## What was tested

The test checks that each role can only do what it is supposed to, using the test
accounts (`botanists@`, `conservation_officer@`, `admin@test.com`) and the seed data
from `database/seed/`. It covers the RLS policies and the extra guards added in
migrations 001 to 015.

Each test runs a query as one user, with the same database rules the mobile and
web apps get, then undoes everything. No real data was changed by the test run.

- **Expected `denied`** passes when the database refused the action with an error
  (`blocked`) or when the action changed 0 rows. Either way the user could not do it.
- **Expected number** passes when the query returned exactly that value. Counts such
  as "all plants" are worked out from the live data each time the test is run.

Roles: **guest** = not logged in (`anon`), **botanist**, **officer** =
conservation officer, **admin**.

## Results

| ID | Who | Test | Expected | Actual | Result | Database message |
|---|---|---|---|---|---|---|
| RLS-01 | guest | Read the plants table directly | 0 | 0 | PASS | |
| RLS-02 | guest | Read plants_public: approved plants only | 14 | 14 | PASS | |
| RLS-03 | guest | Monitored plant GPS in plants_public is rounded to 2 decimals (count of unrounded) | 0 | 0 | PASS | |
| RLS-04 | guest | Edit an approved plant through plants_public | denied | blocked | PASS | permission denied for view plants_public |
| RLS-05 | botanist | Read plants recorded by someone else | 0 | 0 | PASS | |
| RLS-06 | botanist | Register a pending plant as themselves | 1 | 1 | PASS | |
| RLS-07 | botanist | Register a plant that is already approved | denied | blocked | PASS | new row violates row-level security policy for table "plants" |
| RLS-08 | botanist | Register a plant under the officer's name | denied | blocked | PASS | new row violates row-level security policy for table "plants" |
| RLS-09 | botanist | Approve their own pending plant | denied | blocked | PASS | Only a conservation officer or admin who did not record this plant can review it |
| RLS-10 | botanist | Change the QR code of their own pending plant | denied | blocked | PASS | QR codes cannot be changed |
| RLS-11 | botanist | Edit their own plant after it was approved | denied | 0 | PASS | |
| RLS-12 | officer | Read all plants | 34 | 34 | PASS | |
| RLS-13 | officer | Approve a botanist's pending plant | 1 | 1 | PASS | |
| RLS-14 | officer | Approve a plant they recorded themselves | denied | blocked | PASS | Only a conservation officer or admin who did not record this plant can review it |
| RLS-15 | officer | Approve a plant with the admin named as reviewer | denied | blocked | PASS | A review must be recorded under the name of the person making it |
| RLS-16 | guest | Read species | 5 | 5 | PASS | |
| RLS-17 | botanist | Edit a species | denied | 0 | PASS | |
| RLS-18 | officer | Edit a species | 1 | 1 | PASS | |
| RLS-19 | botanist | Read all profiles (should see only their own) | 1 | 1 | PASS | |
| RLS-20 | botanist | Make themselves admin | denied | blocked | PASS | You cannot change your own role |
| RLS-21 | admin | Read all profiles | 4 | 4 | PASS | |
| RLS-22 | admin | Change their own role | denied | blocked | PASS | You cannot change your own role |
| RLS-23 | officer | Create a new profile | denied | blocked | PASS | new row violates row-level security policy for table "profiles" |
| RLS-24 | botanist | Read sensor nodes, readings and alerts | 0 | 0 | PASS | |
| RLS-25 | officer | Read sensor nodes | 2 | 2 | PASS | |
| RLS-26 | officer | Change the global alert thresholds | denied | 0 | PASS | |
| RLS-27 | admin | Change the global alert thresholds | 1 | 1 | PASS | |
| RLS-28 | guest | Insert a fake sensor reading | denied | 1 | **FAIL** | |
| RLS-29 | guest | Run a report function | denied | blocked | PASS | permission denied for function report_species_summary |

## Finding: anyone can insert sensor readings (RLS-28)

**Severity:** High

The live database has an RLS policy on `sensor_readings` called
**"Enable insert for anonymous users"** (INSERT, `with check (true)`). It is not in any
migration file in `database/schema/`, so it was most likely added through the Supabase
dashboard during IoT testing.

**Impact:** anyone with the app's public (anon) key can insert sensor readings without
logging in. The public key ships inside the mobile and web apps, so it is not a secret.
Every new reading also runs the threshold check from `009_sensor_alerts.sql`, so fake
readings can create fake temperature, humidity or motion alerts on the officer dashboard,
or bury real ones.

This also goes against the design in `009_sensor_alerts.sql`: readings should only come
in through the `ingest-reading` Edge Function, which checks the device key.

**Recommendation:** once the IoT gateway sends readings through the `ingest-reading`
Edge Function, drop the policy in a new migration and run this test file again.
RLS-28 should then pass:

```sql
drop policy "Enable insert for anonymous users" on sensor_readings;
```

Not fixed as part of this issue, because the IoT prototype may still depend on it.
Raised with Haris to agree the fix with the IoT team.

## Not covered

- **Photo storage** (`plant-photos` and `species-photos` buckets). Upload rules are
  easier to check through the apps than from SQL, so they should be tested manually.
- **Alert acknowledgement** (`alerts_update_staff`). Needs an existing unacknowledged
  alert, which depends on live sensor data.

## How to run again

1. Open the Supabase SQL Editor.
2. Paste the whole of `rls_policy_tests.sql` and click **Run**. If Supabase warns about
   a destructive operation, continue. Nothing is changed.
3. The result table lists every test with PASS, FAIL or SKIP.
