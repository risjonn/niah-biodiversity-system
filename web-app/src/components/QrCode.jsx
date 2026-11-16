import { useMemo } from 'react'
import { Box } from '@mui/material'
import { QR_COLOURS, QR_MARGIN, qrPath } from '../lib/qrCode'

// A plant tag's QR code as inline SVG, encoded exactly like the mobile app's (see lib/qrCode.js).
// `size` is any CSS length: px on screen, mm on a printed label. Sharp at every size, since each
// module is a square in the SVG's own units.
export default function QrCode({ value, size = 160, margin = QR_MARGIN }) {
  const { path, viewBox } = useMemo(() => qrPath(value, margin), [value, margin])

  return (
    <Box
      component="svg"
      viewBox={`0 0 ${viewBox} ${viewBox}`}
      role="img"
      aria-label={`QR code ${value}`}
      shapeRendering="crispEdges"
      sx={{ width: size, height: size, display: 'block' }}
    >
      <rect width={viewBox} height={viewBox} fill={QR_COLOURS.light} />
      <path d={path} fill={QR_COLOURS.dark} />
    </Box>
  )
}
