import { Box } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { gaugePercent, labelRows } from '../lib/rangeGauge'

// Track and marker sizes in px, for the compact gauge on a node card and the larger one with
// labels in the Alert limits section
const SIZES = {
  small: { track: 8, marker: 16, markerWidth: 3, bandEdge: 2 },
  medium: { track: 10, marker: 22, markerWidth: 4, bandEdge: 2 },
}
// Height of one row of marker labels, in px
const LABEL_ROW_HEIGHT = 20
// Labels closer together than this (in percent of the gauge's width) go on separate rows
const LABEL_GAP_PERCENT = 22
// Within this far of either end, a label is lined up with its marker's edge rather than centred
// on it, so it doesn't run off the gauge
const EDGE_PERCENT = 12

// What colour a marker is drawn in, by its `tone`
const markerColors = {
  // Inside the band, or a gauge with no band
  normal: 'text.primary',
  // Outside the band. Callers also say so in words or with an icon, never by colour alone.
  outside: 'error.main',
  // A reading that may be out of date, e.g. from an offline node
  muted: 'text.disabled',
}

// A horizontal gauge: a grey track over `scale` ({ min, max }, see gaugeScale in lib/rangeGauge),
// the `band` ([low, high]) shaded in green as the safe range, and a marker at each value.
// - markers: [{ key, value, tone, label }], tone one of markerColors' keys. A `label` (text or an
//   element) is written below the marker, with a short line up to it; labels that would overlap
//   go on separate rows.
// - bandLabels: [lowText, highText], written above the band's two ends
// - description: a sentence saying what the gauge shows, for screen readers. Without one the
//   gauge is hidden from them, and the caller must give the same information as text.
// - labelGap: how close (in percent of the width) two labels can be before they go on separate
//   rows. Wider for a narrow gauge, where the same text takes up more of it.
// - isBandMuted: shade the band in grey rather than green, e.g. for an offline node whose reading
//   may be out of date. The band is drawn the same way at every size, so a node card's gauges
//   match the Alert limits bars.
// Markers glide to a new value on refresh, except when reduced motion is asked for.
export default function RangeGauge({
  scale,
  band,
  markers,
  bandLabels,
  description,
  labelGap = LABEL_GAP_PERCENT,
  isBandMuted = false,
  size = 'small',
}) {
  const { track, marker, markerWidth, bandEdge } = SIZES[size]
  const placed = markers.map((item) => ({ ...item, percent: gaugePercent(item.value, scale) }))
  const labelled = placed.filter((item) => item.label != null)
  const rows = labelRows(
    labelled.map((item) => item.percent),
    labelGap,
  )
  const rowCount = rows.length > 0 ? Math.max(...rows) + 1 : 0
  const bandPercents = band ? [gaugePercent(band[0], scale), gaugePercent(band[1], scale)] : null

  return (
    <Box
      {...(description ? { role: 'img', 'aria-label': description } : { 'aria-hidden': true })}
      sx={{ width: '100%', minWidth: 0 }}
    >
      {bandPercents && bandLabels ? (
        <Box sx={{ position: 'relative', height: LABEL_ROW_HEIGHT }}>
          {bandLabels.map((text, index) => (
            <EdgeAlignedText key={index} percent={bandPercents[index]} sx={{ color: 'text.secondary' }}>
              {text}
            </EdgeAlignedText>
          ))}
        </Box>
      ) : null}

      {/* The track, with room above and below for the markers, which are taller than it */}
      <Box sx={{ py: `${(marker - track) / 2}px` }}>
        <Box
          sx={(theme) => ({
            position: 'relative',
            height: track,
            borderRadius: `${track / 2}px`,
            bgcolor: alpha(theme.palette.text.secondary, 0.15),
          })}
        >
          {bandPercents ? (
            <Box
              sx={(theme) => {
                const bandColor = isBandMuted ? theme.palette.text.secondary : theme.palette.success.main
                return {
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: `${bandPercents[0]}%`,
                  width: `${bandPercents[1] - bandPercents[0]}%`,
                  // Edges inside the width, so the band covers exactly its span
                  boxSizing: 'border-box',
                  bgcolor: alpha(bandColor, 0.35),
                  // The band's ends are where alerts start, so they are drawn as clear edges
                  borderLeft: `${bandEdge}px solid ${bandColor}`,
                  borderRight: `${bandEdge}px solid ${bandColor}`,
                }
              }}
            />
          ) : null}
          {placed.map((item) => (
            <Box
              key={item.key}
              sx={(theme) => ({
                position: 'absolute',
                top: '50%',
                left: `${item.percent}%`,
                width: markerWidth,
                height: marker,
                transform: 'translate(-50%, -50%)',
                borderRadius: `${markerWidth}px`,
                bgcolor: markerColors[item.tone] ?? markerColors.normal,
                // A white edge keeps the marker clear where it sits on the green band
                boxShadow: `0 0 0 1.5px ${theme.palette.background.paper}`,
                transition: theme.transitions.create('left', {
                  duration: theme.transitions.duration.standard,
                }),
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              })}
            />
          ))}
        </Box>
      </Box>

      {rowCount > 0 ? (
        <Box sx={{ position: 'relative', height: rowCount * LABEL_ROW_HEIGHT + 4 }}>
          {labelled.map((item, index) => (
            <Box key={item.key}>
              {/* A short line from the marker down to its label's row */}
              <Box
                sx={{
                  position: 'absolute',
                  top: 0,
                  left: `${item.percent}%`,
                  width: '1px',
                  height: rows[index] * LABEL_ROW_HEIGHT + 4,
                  bgcolor: 'divider',
                }}
              />
              <EdgeAlignedText
                percent={item.percent}
                sx={{ top: rows[index] * LABEL_ROW_HEIGHT + 4 }}
              >
                {item.label}
              </EdgeAlignedText>
            </Box>
          ))}
        </Box>
      ) : null}
    </Box>
  )
}

// A line of caption text at `percent` along the gauge: centred on it, or lined up with it near
// either end so it stays within the gauge
function EdgeAlignedText({ percent, sx, children }) {
  let transform = 'translateX(-50%)'
  if (percent < EDGE_PERCENT) transform = 'none'
  else if (percent > 100 - EDGE_PERCENT) transform = 'translateX(-100%)'

  return (
    <Box
      component="span"
      sx={{
        position: 'absolute',
        top: 0,
        left: `${percent}%`,
        transform,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.25,
        typography: 'caption',
        lineHeight: `${LABEL_ROW_HEIGHT}px`,
        whiteSpace: 'nowrap',
        ...sx,
      }}
    >
      {children}
    </Box>
  )
}
