// Time windows, buckets and labels for the sensor charts (components/SensorCharts.jsx). Plain
// functions with no React or theme imports. Every time is a millisecond timestamp.

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
// The sensors are in Niah. Sarawak is UTC+8 all year (no daylight saving), so a fixed offset is
// exact, the same as SARAWAK_OFFSET in hooks/useReports.js.
const SARAWAK_OFFSET_MS = 8 * HOUR_MS

// Battery levels (in %) below LOW are shown in the error colour, below WARNING in the warning
// colour. Display only, there are no low-battery alerts.
export const LOW_BATTERY_PERCENT = 20
export const BATTERY_WARNING_PERCENT = 40

export function batteryLevel(percent) {
  if (percent < LOW_BATTERY_PERCENT) return 'low'
  if (percent < BATTERY_WARNING_PERCENT) return 'warning'
  return 'ok'
}

export const chartRanges = {
  '24h': { label: 'Last 24 hours', motionLabel: 'per hour' },
  '7d': { label: 'Last 7 days', motionLabel: 'per day' },
}

// The period a range covers, ending at `now`:
// - 24h: the current hour and the 23 before it.
// - 7d: today and the 6 days before it, from Sarawak midnight.
// Temperature and humidity are averaged per hour in both. Motion is counted per hour for 24h
// and per day for 7d (motionBucket is the report_sensor_chart p_bucket for it). `from` and `to`
// are the report's p_from and p_to; both ranges are well inside its 31-day limit.
export function chartWindow(range, now) {
  const currentHour = Math.floor(now / HOUR_MS) * HOUR_MS
  if (range === '24h') {
    const from = currentHour - 23 * HOUR_MS
    return {
      range,
      from,
      to: now,
      lineBuckets: bucketStarts(from, currentHour, HOUR_MS),
      motionBucket: 'hour',
      motionBucketMs: HOUR_MS,
      motionBuckets: bucketStarts(from, currentHour, HOUR_MS),
    }
  }

  const todayStart = startOfSarawakDay(now)
  const from = todayStart - 6 * DAY_MS
  return {
    range,
    from,
    to: now,
    lineBuckets: bucketStarts(from, currentHour, HOUR_MS),
    motionBucket: 'day',
    motionBucketMs: DAY_MS,
    motionBuckets: bucketStarts(from, todayStart, DAY_MS),
  }
}

// Axis ticks for the line charts: every 3 hours for 24h, each Sarawak midnight for 7d
export function lineTicks(window) {
  if (window.range === '24h') {
    return window.lineBuckets.filter((time) => sarawakHour(time) % 3 === 0)
  }
  return window.motionBuckets
}

// Which series each node is drawn as. `nodes` should be every node, not only those with readings
// in the period, so a node keeps its colour whichever range is chosen. Colours go to nodes in
// node_identifier order. Past `colors.length` nodes, the first ones keep their colour and the
// rest share one "Other" series in `otherColor` (docs/design-system.md, Series colours).
// Returns a Map of node id to { key, name, color }.
export function nodeSeries(nodes, colors, otherColor) {
  const sorted = [...nodes].sort((a, b) => a.node_identifier.localeCompare(b.node_identifier))
  const grouped = sorted.length > colors.length
  const other = { key: 'other', name: 'Other nodes', color: otherColor }

  return new Map(
    sorted.map((node, index) => [
      node.id,
      grouped && index >= colors.length - 1
        ? other
        : { key: `node_${node.id}`, name: node.node_identifier, color: colors[index] },
    ]),
  )
}

// The rows below are report_sensor_chart rows (database/schema/016): one per node per bucket,
// { sensor_node_id, bucket_start, avg_temperature, avg_humidity, motion_events, readings }.

// The series that have at least one row in `rows`, in legend order
export function seriesWithReadings(rows, seriesByNode) {
  const keys = new Set(rows.map((row) => seriesByNode.get(row.sensor_node_id)?.key).filter(Boolean))
  const unique = new Map()
  for (const series of seriesByNode.values()) {
    if (keys.has(series.key)) unique.set(series.key, series)
  }
  return [...unique.values()]
}

// One row per chart bucket: { time, [series key]: `field` (avg_temperature or avg_humidity), or
// null when the series has no value then }. Rows outside the buckets, or from nodes missing from
// `seriesByNode`, are left out. The "Other nodes" series combines several nodes' averages,
// weighted by their reading counts.
export function toAverageRows(rows, field, buckets, bucketMs, seriesByNode) {
  const sums = buckets.map(() => new Map())

  for (const row of rows) {
    const value = row[field]
    const series = seriesByNode.get(row.sensor_node_id)
    const index = bucketIndex(row.bucket_start, buckets, bucketMs)
    if (value == null || !series || index === -1) continue

    const weight = Number(row.readings) || 1
    const entry = sums[index].get(series.key) ?? { total: 0, count: 0 }
    entry.total += Number(value) * weight
    entry.count += weight
    sums[index].set(series.key, entry)
  }

  const keys = [...new Set([...seriesByNode.values()].map((series) => series.key))]
  return buckets.map((time, index) =>
    Object.fromEntries([
      ['time', time],
      ...keys.map((key) => {
        const entry = sums[index].get(key)
        return [key, entry ? Math.round((entry.total / entry.count) * 10) / 10 : null]
      }),
    ]),
  )
}

// One row per chart bucket: { time, total, [series key]: readings with motion detected }, with 0
// for buckets the report has no row for
export function toMotionRows(rows, buckets, bucketMs, seriesByNode) {
  const keys = [...new Set([...seriesByNode.values()].map((series) => series.key))]
  const chartRows = buckets.map((time) =>
    Object.fromEntries([['time', time], ['total', 0], ...keys.map((key) => [key, 0])]),
  )

  for (const row of rows) {
    const events = Number(row.motion_events) || 0
    const series = seriesByNode.get(row.sensor_node_id)
    const index = bucketIndex(row.bucket_start, buckets, bucketMs)
    if (events === 0 || !series || index === -1) continue
    chartRows[index][series.key] += events
    chartRows[index].total += events
  }
  return chartRows
}

const sarawakTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuching',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})
const sarawakWeekdayDay = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuching',
  weekday: 'short',
  day: 'numeric',
})
const sarawakDayMonth = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuching',
  weekday: 'short',
  day: 'numeric',
  month: 'short',
})

// "14:00"
export function formatSarawakHour(time) {
  return sarawakTime.format(time)
}

// "Mon 9"
export function formatSarawakDay(time) {
  return sarawakWeekdayDay.format(time)
}

// Tooltip heading for a bucket: "Mon 9 Nov, 14:00–15:00" for an hour, "Mon 9 Nov" for a day
export function formatBucket(time, bucketMs) {
  const day = sarawakDayMonth.format(time)
  if (bucketMs >= DAY_MS) return day
  return `${day}, ${sarawakTime.format(time)}–${sarawakTime.format(time + bucketMs)}`
}

function bucketStarts(first, last, size) {
  const starts = []
  for (let time = first; time <= last; time += size) starts.push(time)
  return starts
}

// Buckets are evenly spaced from buckets[0], so the index is worked out rather than searched.
// Works for any time inside a bucket, not only its start.
function bucketIndex(timestamp, buckets, bucketMs) {
  const time = new Date(timestamp).getTime()
  const index = Math.floor((time - buckets[0]) / bucketMs)
  return index >= 0 && index < buckets.length ? index : -1
}

function startOfSarawakDay(time) {
  return Math.floor((time + SARAWAK_OFFSET_MS) / DAY_MS) * DAY_MS - SARAWAK_OFFSET_MS
}

function sarawakHour(time) {
  return new Date(time + SARAWAK_OFFSET_MS).getUTCHours()
}
