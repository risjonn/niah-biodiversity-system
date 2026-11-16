import { Box } from '@mui/material'
import { keyframes } from '@mui/material/styles'
import { tokens } from '../theme/theme'

// Decorative contour lines. Put it inside a box with position: relative and overflow: hidden,
// which it fills.
// - variant "onDark" (default): white and green lines for a primary-coloured panel (the landing
//   page's left panel, the sidebar header)
// - variant "onTint": white lines for the light primary tint of the page header band. White only
//   ever lightens the tint, so text over the lines never has less contrast than over the tint
//   itself; see PageHeader.
// - animated: the slow drift; false for a static pattern

const drift = keyframes`
  from { transform: translate3d(-3%, 0, 0); }
  to { transform: translate3d(3%, -2%, 0); }
`

// Layered ridge lines, like the contours of Niah's limestone hills. Each line is the same
// baseline pushed up by a few steep peaks; lower lines take less of each peak, so the ridges
// flatten towards the bottom. Worked out once, when the module loads.
const CONTOUR_PEAKS = [
  { x: 80, height: 170, width: 70 },
  { x: 250, height: 260, width: 55 },
  { x: 430, height: 150, width: 85 },
  { x: 600, height: 280, width: 50 },
  { x: 760, height: 190, width: 70 },
]

const CONTOUR_LINES = Array.from({ length: 18 }, (_, line) => {
  const points = []
  for (let x = -40; x <= 840; x += 20) {
    let y = 140 + line * 60
    CONTOUR_PEAKS.forEach((peak, index) => {
      const share = 1 - line * 0.035 + 0.08 * Math.sin(line * 0.9 + index * 1.7)
      const distance = (x - peak.x - line * 4) / peak.width
      y -= peak.height * share * Math.exp(-distance * distance)
    })
    points.push([x, Math.round(y * 10) / 10])
  }
  return smoothPath(points)
})

// A smooth path through `points`: quadratic curves with each point as the control point and the
// midpoints between points as the ends
function smoothPath(points) {
  let path = `M${points[0][0]},${points[0][1]}`
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i]
    const [nextX, nextY] = points[i + 1]
    path += `Q${x},${y} ${(x + nextX) / 2},${Math.round(((y + nextY) / 2) * 10) / 10}`
  }
  const [lastX, lastY] = points.at(-1)
  return `${path}L${lastX},${lastY}`
}

// Stroke colour and opacity for line `index`. Every fourth line is an "index contour", as on a map.
const STROKES = {
  onDark: (index) =>
    index % 2 ? [tokens.secondary, 0.4] : [tokens.surfaceWhite, 0.14],
  // Index lines nearly opaque, the rest softer, so the contours read clearly on the tint
  onTint: (index) => (index % 4 === 0 ? [tokens.surfaceWhite, 0.95] : [tokens.surfaceWhite, 0.65]),
}

// Inline SVG, so nothing is loaded from outside (CSP). Slightly larger than its box so the slow
// drift never shows an edge. The drift stops for people who ask for reduced motion.
export default function ContourPattern({ variant = 'onDark', animated = true, sx }) {
  const stroke = STROKES[variant]
  return (
    <Box
      component="svg"
      viewBox="0 0 800 1000"
      preserveAspectRatio="xMidYMid slice"
      focusable="false"
      aria-hidden="true"
      sx={{
        position: 'absolute',
        top: '-5%',
        left: '-5%',
        width: '110%',
        height: '110%',
        pointerEvents: 'none',
        ...(animated && {
          animation: `${drift} 90s ease-in-out infinite alternate`,
          '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
        }),
        ...sx,
      }}
    >
      {CONTOUR_LINES.map((path, index) => {
        const [colour, opacity] = stroke(index)
        return (
          <path
            key={index}
            d={path}
            fill="none"
            stroke={colour}
            strokeOpacity={opacity}
            // Every fourth line is heavier, like the index contours on a map
            strokeWidth={index % 4 === 0 ? 2 : 1.25}
            vectorEffect="non-scaling-stroke"
          />
        )
      })}
    </Box>
  )
}
