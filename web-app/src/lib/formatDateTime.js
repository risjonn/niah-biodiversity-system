// Day before month, e.g. "4 Oct 2026, 9:18 pm", whatever the browser's own locale is
export function formatDateTime(value) {
  return new Date(value).toLocaleString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

// How long before `now` (a Date.now() value) `value` was, e.g. "just now", "2 min ago",
// "3 h ago", "5 days ago". Older than a week falls back to the full date. A time slightly in the
// future (a device clock running ahead) reads as "just now".
export function formatRelativeTime(value, now) {
  const elapsed = now - new Date(value).getTime()

  if (elapsed < MINUTE_MS) return 'just now'
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`
  if (elapsed < 7 * DAY_MS) {
    const days = Math.floor(elapsed / DAY_MS)
    return `${days} ${days === 1 ? 'day' : 'days'} ago`
  }
  return formatDateTime(value)
}
