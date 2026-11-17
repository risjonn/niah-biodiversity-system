// Dates and times in Sarawak time (Asia/Kuching), where the botanists work, whatever timezone the
// phone is set to. Sarawak is UTC+8 all year (no daylight saving), so the offset is added by hand
// instead of relying on Intl timezone support, which differs between Hermes builds.
const SARAWAK_OFFSET_MS = 8 * 60 * 60 * 1000

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

// The Sarawak date and time parts of `value` (a Date, timestamp or ISO string), or null when it
// isn't a valid date
function sarawakParts(value) {
  if (value == null) return null
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return null
  const shifted = new Date(time + SARAWAK_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth(),
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
  }
}

// "Good morning" before noon, "Good afternoon" until 6 pm, "Good evening" after
export function greetingFor(now) {
  const hour = sarawakParts(now)?.hour ?? 12
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

// "17 Nov 2026", or null for no value
export function formatDate(value) {
  const parts = sarawakParts(value)
  return parts ? `${parts.day} ${MONTHS[parts.month]} ${parts.year}` : null
}

// "Tuesday, 17 Nov 2026", or null for no value
export function formatLongDate(value) {
  const parts = sarawakParts(value)
  return parts ? `${WEEKDAYS[parts.weekday]}, ${formatDate(value)}` : null
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// How long before `now` `value` was: "just now", "5 min ago", "3 h ago", "2 days ago",
// "3 weeks ago", then the date ("15 Oct 2026") after about a month. A time slightly in the
// future (the phone's clock running behind) reads "just now".
export function formatRelativeTime(value, now) {
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return null
  const elapsed = now - time
  if (elapsed < MINUTE_MS) return 'just now'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`
  const days = Math.floor(elapsed / DAY_MS)
  if (days < 7) return days === 1 ? '1 day ago' : `${days} days ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return weeks === 1 ? '1 week ago' : `${weeks} weeks ago`
  return formatDate(value)
}
