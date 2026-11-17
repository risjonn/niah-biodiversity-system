import { StyleSheet } from 'react-native'
import Svg, { Path } from 'react-native-svg'
import { theme } from '../theme/theme'

// Decorative contour lines, the same pattern as the web app's ContourPattern
// (web-app/src/components/ContourPattern.jsx), static. Fills its parent, which should have
// overflow: 'hidden'. Drawn for a primary-coloured background: white and green lines.

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
  const [lastX, lastY] = points[points.length - 1]
  return `${path}L${lastX},${lastY}`
}

export default function ContourPattern() {
  return (
    <Svg
      viewBox="0 0 800 1000"
      preserveAspectRatio="xMidYMid slice"
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {CONTOUR_LINES.map((path, index) => (
        <Path
          key={index}
          d={path}
          fill="none"
          // Alternating green and faint white lines, as on the web's primary panels
          stroke={index % 2 ? theme.colors.secondary : theme.colors.surfaceWhite}
          strokeOpacity={index % 2 ? 0.4 : 0.14}
          // Every fourth line is heavier, like the index contours on a map
          strokeWidth={index % 4 === 0 ? 2 : 1.25}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </Svg>
  )
}
