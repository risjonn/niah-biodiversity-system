// The sums behind components/RangeGauge.jsx: the span a gauge covers, where a value sits on it,
// and how its labels are spread out so they don't overlap.

// A value's position along a gauge, as a percentage of its span clamped to 0–100
export function gaugePercent(value, { min, max }) {
  if (max <= min) return 50
  return Math.min(Math.max(((value - min) / (max - min)) * 100, 0), 100)
}

// The span a gauge covers. With a band ([low, high], e.g. the alert limits), the band plus half
// its width again on either side, so it sits in the middle third; without one, `fallback`. Then
// widened to take in every value, with a little room past the furthest so its marker isn't on
// the very end, and kept within `floor` and `ceiling` (e.g. 0 and 100 for a percentage).
export function gaugeScale({ band, values = [], fallback, floor = -Infinity, ceiling = Infinity }) {
  let [min, max] = band
    ? [band[0] - (band[1] - band[0]) / 2, band[1] + (band[1] - band[0]) / 2]
    : fallback
  const present = values.filter((value) => value != null).map(Number)
  const lowest = Math.min(min, ...present)
  const highest = Math.max(max, ...present)
  const room = (highest - lowest) * 0.05
  if (lowest < min) min = lowest - room
  if (highest > max) max = highest + room
  return { min: Math.max(min, floor), max: Math.min(max, ceiling) }
}

// Which row each label goes in, for labels at these percentages along a gauge (in any order).
// Labels are placed from left to right, each in the first row whose last label is at least `gap`
// percent to its left, so neighbours that are close together go on separate rows.
export function labelRows(percents, gap) {
  const order = percents.map((percent, index) => ({ percent, index })).sort((a, b) => a.percent - b.percent)
  // The position of the last label placed in each row
  const rowEnds = []
  const rows = new Array(percents.length)
  for (const { percent, index } of order) {
    let row = rowEnds.findIndex((end) => percent - end >= gap)
    if (row === -1) row = rowEnds.length
    rowEnds[row] = percent
    rows[index] = row
  }
  return rows
}
