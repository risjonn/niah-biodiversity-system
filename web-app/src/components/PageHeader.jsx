import { Box, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import ContourPattern from './ContourPattern'
import { tokens } from '../theme/theme'

// Height of the decorative band behind the header, in px
const BAND_HEIGHT = 160

// How strong the primary tint is at the top of the band. The most it can be while secondary text
// (text.secondary) on it still meets WCAG AA (4.5:1): about 4.6:1 at the top, rising towards the
// bottom as the tint fades. The white contour lines only lighten it.
const BAND_TINT = 0.08

// The heading block at the top of every signed-in page: the page's h1, an optional line under
// it, and an optional action (a button, or a small group of controls) on the right. On a narrow
// screen the action wraps under the title.
//
// Behind it, a band across the top of the page area: a light primary tint with white contour
// lines, fading into the page background. It is positioned against AppLayout's page area
// (position: relative, isolation: isolate), so it spans the full width beside the sidebar and sits
// behind everything on the page. Cards below are opaque, so the band can fade out under their tops.
export default function PageHeader({ title, subtitle, action }) {
  return (
    <Stack
      direction="row"
      spacing={2}
      // Gap rather than margins: a page's own Stack would give the band a top margin if it were
      // a sibling of this header there, which would push it down from the top of the page area
      useFlexGap
      sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
    >
      {/* Absolutely positioned against the page area, so it takes no space in this row */}
      <HeaderBand />
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography variant="h1">{title}</Typography>
        {subtitle ? (
          <Typography variant="body1" color="text.secondary">
            {subtitle}
          </Typography>
        ) : null}
      </Stack>
      {action ? (
        <Box
          sx={{
            // Outlined buttons are transparent, which would put their text on the tint, where
            // red (Delete) falls below AA. On white they keep full contrast; the hover tint is
            // drawn over the white so it can't bring the band back through.
            '& .MuiButton-outlined': {
              bgcolor: 'background.paper',
              '&:hover': {
                bgcolor: 'background.paper',
                backgroundImage: `linear-gradient(${alpha(tokens.primary, 0.04)}, ${alpha(tokens.primary, 0.04)})`,
              },
            },
          }}
        >
          {action}
        </Box>
      ) : null}
    </Stack>
  )
}

// The tint fades from BAND_TINT at the top to nothing at the bottom, and the lines fade out with
// it, so the band runs into the page background. Static: no drift.
function HeaderBand() {
  return (
    <Box
      aria-hidden="true"
      sx={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: BAND_HEIGHT,
        // Behind the page's content, inside the page area's stacking context
        zIndex: -1,
        overflow: 'hidden',
        pointerEvents: 'none',
        background: `linear-gradient(to bottom, ${alpha(tokens.primary, BAND_TINT)}, ${alpha(tokens.primary, 0)})`,
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          maskImage: 'linear-gradient(to bottom, black 30%, transparent)',
        }}
      >
        <ContourPattern variant="onTint" animated={false} />
      </Box>
    </Box>
  )
}
