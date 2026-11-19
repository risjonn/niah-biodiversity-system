// Date display for the whole web app. Every time is shown in Sarawak time (Asia/Kuching), where
// the plants and sensors are, so a record reads the same wherever the viewer's browser is.
// CSV and PDF exports keep their own format, see formatKuchingDateTime in reportExport.js.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Numeric parts only. The strings are put together below, so they don't depend on how a browser
// spells or punctuates a locale (some give "Sept", "PM" or a different separator).
const kuchingParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuching',
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
})

// The Sarawak date and time parts of `value` (a Date, timestamp or ISO string), or null when
// there is no value or it isn't a valid date
function partsOf(value) {
  if (value == null) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const parts = Object.fromEntries(
    kuchingParts.formatToParts(date).map((part) => [part.type, part.value]),
  )
  return {
    day: Number(parts.day),
    month: MONTH_NAMES[Number(parts.month) - 1],
    year: parts.year,
    hour: Number(parts.hour),
    minute: parts.minute,
  }
}

function dateText({ day, month, year }) {
  return `${day} ${month} ${year}`
}

function timeText({ hour, minute }) {
  return `${hour % 12 || 12}:${minute} ${hour < 12 ? 'am' : 'pm'}`
}

// "15 Oct 2026, 11:21 pm", or null for no value
export function formatDateTime(value) {
  const parts = partsOf(value)
  return parts ? `${dateText(parts)}, ${timeText(parts)}` : null
}

// "15 Oct 2026", or null for no value
export function formatDate(value) {
  const parts = partsOf(value)
  return parts ? dateText(parts) : null
}

// "11:21 pm", or null for no value. For the end of a time range whose start shows the date.
export function formatTime(value) {
  const parts = partsOf(value)
  return parts ? timeText(parts) : null
}

// The weekday in Sarawak, e.g. "Tuesday" (en-GB weekday names are the same in every browser)
const kuchingWeekday = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kuching', weekday: 'long' })

// "Tuesday, 17 Nov 2026", or null for no value
export function formatLongDate(value) {
  const parts = partsOf(value)
  return parts ? `${kuchingWeekday.format(new Date(value))}, ${dateText(parts)}` : null
}

// The hour in Sarawak, 0 to 23, e.g. for a greeting by time of day
export function sarawakHourOf(value) {
  return partsOf(value)?.hour ?? null
}

// The month in Sarawak as 'YYYY-MM', e.g. for counting records per month, or null for no value
export function sarawakMonthKeyOf(value) {
  const parts = partsOf(value)
  if (!parts) return null
  return `${parts.year}-${String(MONTH_NAMES.indexOf(parts.month) + 1).padStart(2, '0')}`
}

// The day in Sarawak as 'YYYY-MM-DD', the format of a date input, or null for no value
export function sarawakDateKeyOf(value) {
  const parts = partsOf(value)
  if (!parts) return null
  const month = String(MONTH_NAMES.indexOf(parts.month) + 1).padStart(2, '0')
  return `${parts.year}-${month}-${String(parts.day).padStart(2, '0')}`
}

// "2 pm", the hour on its own, or null for no value. For chart axes, where the minutes are
// always :00.
export function formatHour(value) {
  const parts = partsOf(value)
  return parts ? `${parts.hour % 12 || 12} ${parts.hour < 12 ? 'am' : 'pm'}` : null
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// How long before `now` (a Date.now() value) `value` was, e.g. "just now", "2 min ago",
// "3 h ago", "5 days ago". Older than a week falls back to the full date, unless `longAges` is set:
// then it carries on in weeks, months and years ("3 weeks ago"), for lists sorted by how long
// something has waited. A time slightly in the future (a device clock running ahead) reads as
// "just now".
export function formatRelativeTime(value, now, { longAges = false } = {}) {
  const elapsed = now - new Date(value).getTime()

  if (elapsed < MINUTE_MS) return 'just now'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`
  if (elapsed < 7 * DAY_MS) return ago(Math.floor(elapsed / DAY_MS), 'day')
  if (!longAges) return formatDateTime(value)
  if (elapsed < 30 * DAY_MS) return ago(Math.floor(elapsed / (7 * DAY_MS)), 'week')
  // At most 11: 360-364 days is still "11 months", not "12 months"
  if (elapsed < 365 * DAY_MS) return ago(Math.min(11, Math.floor(elapsed / (30 * DAY_MS))), 'month')
  return ago(Math.floor(elapsed / (365 * DAY_MS)), 'year')
}

function ago(count, unit) {
  return `${count} ${unit}${count === 1 ? '' : 's'} ago`
}
