# Web end-to-end test results (issue #29)

**Run on:** 6 November 2026, web app (`localhost:5173`) against the live Supabase project
**Tested by:** Lidiya Karmila Binti Sedi
**Method:** manual end-to-end testing in Chrome, one screenshot per test in
[`e2e-screenshots/`](e2e-screenshots/)
**Result:** 25 of 25 passed. 3 low-priority findings (see below).

## Scope

The issue asks for testing of species browsing, plant review, user management and
reporting. Each test follows a full user task in the web app, from logging in to
checking the result, using the test accounts:

- **Officer:** `conservation_officer@test.com`
- **Admin:** `admin@test.com`
- **Botanist:** `botanists@test.com` (only used to check web access is refused)

### Test data

The plant review tests used 4 pending records created only for this test run, so the
team's seed data was not touched. Their notes started with `[e2e]` and their locations
were labelled "E2E test: ...":

| QR code | Height | Recorded by | Used for |
|---|---|---|---|
| NIAH-90A58E | 11 cm | botanist | E2E-13, E2E-14 (approve) |
| NIAH-D3791E | 22 cm | botanist | E2E-15, E2E-16 (reject) |
| NIAH-43DCC3 | 33 cm | botanist | Spare, not used |
| NIAH-0BFE68 | 44 cm | officer | E2E-17 (own record) |

Counts before testing: 34 plant records, 15 pending, 14 approved, 5 species, 4 accounts.

## Results

### Login and access

| ID | Who | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| E2E-01 | Officer | Log in | Dashboard with name and counts, no Users link | "Welcome, Test Officer", counts 19 / 5 / 14, no Users link | PASS |
| E2E-02 | Botanist | Try to log in to the web app | Refused | "This dashboard is for conservation officers and admins. Botanists should use the Niah Biodiversity mobile app." | PASS |
| E2E-03 | Officer | Go to `/users` in the address bar | No access to user management | Redirected to `/dashboard` | PASS |
| E2E-04 | Logged out | Go to `/users` and `/` | Sent to login | Both went to `/login` | PASS |

E2E-03 confirms the Sprint 1 gap ("/users route is not admin-restricted") is fixed.

### Species browsing and management

| ID | Who | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| E2E-05 | Officer | Search "rafflesiana" | Only *Nepenthes rafflesiana* | Only *Nepenthes rafflesiana* | PASS |
| E2E-06 | Officer | Search "pitcher" (common name) | The 3 *Nepenthes* species | The 3 *Nepenthes* species | PASS |
| E2E-07 | Officer | Filter by status "Vulnerable" | Only *Nepenthes bicalcarata* | Only *Nepenthes bicalcarata* | PASS |
| E2E-08 | Officer | Open *Eusideroxylon zwageri* | Detail page with full information | Photo, common name, family, status, description and cultural significance shown | PASS |
| E2E-09 | Officer | Add species "Liliana Techronous" | Saved and shown | Saved, detail page shown | PASS |
| E2E-10 | Officer | Add "Liliana TECHRONOUS" (same name, different capitals) | Refused | "A species with this scientific name already exists." | PASS |
| E2E-11 | Officer | Edit the common name | Change saved | Shows "E2E test plant (edited)", last updated time changed | PASS |
| E2E-12 | Officer | Delete the test species | Removed | Confirmation dialog, then the list was back to the original 5 species | PASS |

### Plant review

| ID | Who | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| E2E-13 | Officer | Click the NIAH-90A58E row | Details shown | Dialog with species, status, recorded and synced times, recorded by, coordinates, location and height | PASS |
| E2E-14 | Officer | Approve NIAH-90A58E | Leaves the list, counts update | "Approved NIAH-90A58E", pending 19 to 18, approved 14 to 15 | PASS |
| E2E-16 | Officer | Reject NIAH-D3791E without a reason | Can't confirm | "Reject record" button stays disabled until a reason is typed | PASS |
| E2E-15 | Officer | Reject NIAH-D3791E with a reason | Leaves the list, reason saved | "Rejected NIAH-D3791E", pending 18 to 17 | PASS |
| E2E-17 | Officer | Approve NIAH-0BFE68 (recorded by the same officer) | Refused clearly | Approve and Reject disabled: "You submitted this record, another officer or admin needs to review it." | PASS |

### User management

| ID | Who | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| E2E-18 | Admin | Open Users | All accounts with roles | 4 accounts with name, email, role and created date. Dashboard Users count also 4. | PASS |
| E2E-19 | Admin | Add user "Liliana E2E Test" as botanist | Account created and listed | One-time temporary password shown, list went to 5 accounts | PASS (finding F-2) |
| E2E-20 | Admin | Change Test Officer 1 to Botanist, then back | Role updated | "Test Officer 1 is now Botanist", then changed back to Conservation officer | PASS |
| E2E-21 | Admin | Change own role | Refused | Own dropdown disabled: "You can't change your own role" | PASS |

### Reporting

| ID | Who | Steps | Expected | Actual | Result |
|---|---|---|---|---|---|
| E2E-22 | Admin | Open Reports, compare with a database count | Totals match | Report 38 / 15 / 17 / 6, database 38 / 15 / 17 / 6 | PASS |
| E2E-23 | Admin | Export CSV (species summary) | File downloads and opens | `niah-species-summary_all-dates.csv` opened in Excel, one row per species, numbers match the page | PASS |
| E2E-24 | Admin | Download PDF report | File downloads and opens | `niah-biodiversity-report_all-dates.pdf` with species summary, records by month and sensor summary | PASS |
| E2E-25 | Admin | Filter 1 to 6 Nov 2026 | Only that period counted | Report total 14, database count for the same dates 14 | PASS |

## Findings

None of these stop the workflows from working. They are worth fixing in Sprint 2.

| ID | Severity | Where | Finding | Suggested fix |
|---|---|---|---|---|
| F-1 | Low | Plant review details dialog | "Recorded by" shows the user ID (`cb2e406f-...`) instead of the botanist's name, so officers can't tell who recorded a plant | Show the recorder's full name from `profiles` |
| F-2 | Low | Users page | A newly added account shows **"Invalid Date"** in the Created column | Check the created date the page uses for new accounts, likely missing or in a different format |
| F-3 | Info | Admin dashboard | Before testing, the dashboard once showed **5** users while the Users page showed **4**. It did not happen again during E2E-18, so it could not be reproduced | Keep an eye on it; check both use the same count |

## Clean-up

After testing, the test plant records and the test account were removed:

```sql
delete from plants where morphological_notes like '[e2e]%';
delete from auth.users where email = 'lilianae2e@test.com';
```

The test species was deleted in E2E-12, and Test Officer 1 was set back to
Conservation officer in E2E-20. The database was back to 34 plant records, 15 pending
and 4 accounts afterwards.

The screenshot of the temporary password from E2E-19 was not added to the repo.

## Not covered

- Sensors page (not listed in the issue)
- Photos in the plant review dialog (none of the test records had a photo)
- Mobile app workflows (covered by the mobile end-to-end testing issue)
