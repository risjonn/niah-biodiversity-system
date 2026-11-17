import { Box } from '@mui/material'
import { alpha } from '@mui/material/styles'
import { conservationStatusChipColor } from '../lib/conservationStatus'

// Stands in for a species without a photo (or whose photo won't load): a leaf drawing on a light
// tint of the species' conservation colour, filling its container. Decorative, since the name
// is always shown next to it.
export default function LeafPlaceholder({ conservationStatus }) {
  const chipColor = conservationStatusChipColor(conservationStatus)
  // A status with no colour of its own uses the primary colour
  const paletteName = chipColor === 'default' ? 'primary' : chipColor

  return (
    <Box
      aria-hidden="true"
      sx={(theme) => {
        const palette = theme.palette[paletteName]
        return {
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          bgcolor: alpha(palette.main, 0.12),
          // The dark shade keeps the drawing clear on the pale tint, even for amber
          color: palette.dark,
          '& svg': { width: '36%', maxWidth: 112, height: 'auto' },
        }
      }}
    >
      <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {/* The blade, lightly filled, pointing up and to the right */}
        <path d="M14 50C12 30 26 14 54 10C52 36 38 52 14 50Z" fill="currentColor" fillOpacity="0.14" />
        {/* Stalk and midrib */}
        <path d="M8 56L14 50L48 16" />
        {/* Side veins */}
        <path d="M22 42L20 33M22 42L31 43M30 34L29 25M30 34L39 35M38 26L38 19M38 26L45 27" />
      </svg>
    </Box>
  )
}
