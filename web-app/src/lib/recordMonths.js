import { sarawakMonthKeyOf } from './formatDateTime'
import { chartTokens } from '../theme/theme'

// Plant records per month for the stacked "records per month" charts (Dashboard, Species detail).
// Months are counted in Sarawak time, like report_records_by_month, whatever the viewer's own
// timezone is.

// review_status values in stacking order (approved at the bottom, pending between approved and
// rejected), see "Status colours" in docs/design-system.md
export const STACKED_REVIEW_STATUSES = Object.keys(chartTokens.reviewStatus)

// 'YYYY-MM' keys from `first` to `last` (both 'YYYY-MM'), oldest first
export function monthKeysBetween(first, last) {
  const keys = []
  let [year, month] = first.split('-').map(Number)
  const [lastYear, lastMonth] = last.split('-').map(Number)
  while (year < lastYear || (year === lastYear && month <= lastMonth)) {
    keys.push(`${year}-${String(month).padStart(2, '0')}`)
    month += 1
    if (month > 12) {
      month = 1
      year += 1
    }
  }
  return keys
}

// `count` months ending with `last` ('YYYY-MM'), oldest first
export function monthKeysEndingAt(last, count) {
  const [year, month] = last.split('-').map(Number)
  // Date.UTC rolls a negative month back into the previous year
  const first = new Date(Date.UTC(year, month - count, 1)).toISOString().slice(0, 7)
  return monthKeysBetween(first, last)
}

// The last `count` months up to and including the one `now` falls in, oldest first
export function lastMonthKeys(count, now = Date.now()) {
  return monthKeysEndingAt(sarawakMonthKeyOf(now), count)
}

// Chart rows, one per month in `monthKeys`: { month: 'YYYY-MM-01', approved, pending_review,
// rejected, total }, with 0 for a month that has no records

// From report_records_by_month rows. Rows outside `monthKeys` are left out.
export function monthlyRowsFromReport(reportRows, monthKeys) {
  const byMonth = new Map(reportRows.map((row) => [row.record_month.slice(0, 7), row]))
  return monthKeys.map((key) => {
    const row = byMonth.get(key)
    const counts = Object.fromEntries(
      STACKED_REVIEW_STATUSES.map((status) => [status, Number(row?.[status] ?? 0)]),
    )
    return { month: `${key}-01`, ...counts, total: Number(row?.total_records ?? 0) }
  })
}

// From plant records ({ recorded_at, review_status }), by the month each was recorded in.
// Records outside `monthKeys` are left out.
export function monthlyRowsFromPlants(plants, monthKeys) {
  const zeros = Object.fromEntries(STACKED_REVIEW_STATUSES.map((status) => [status, 0]))
  const byMonth = new Map(monthKeys.map((key) => [key, { month: `${key}-01`, ...zeros, total: 0 }]))
  for (const plant of plants) {
    const row = byMonth.get(sarawakMonthKeyOf(plant.recorded_at))
    if (!row) continue
    if (plant.review_status in zeros) row[plant.review_status] += 1
    row.total += 1
  }
  return [...byMonth.values()]
}
