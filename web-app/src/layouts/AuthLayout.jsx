import { Outlet } from 'react-router-dom'
import { Box, Card, CardContent, Typography } from '@mui/material'
import { alpha, keyframes } from '@mui/material/styles'
import AddLocationAltOutlinedIcon from '@mui/icons-material/AddLocationAltOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import PublicOutlinedIcon from '@mui/icons-material/PublicOutlined'
import SensorsOutlinedIcon from '@mui/icons-material/SensorsOutlined'
import ContourPattern from '../components/ContourPattern'
import { tokens } from '../theme/theme'

// The record flow, in order. Monitor runs alongside it rather than being a step.
const STEPS = [
  {
    icon: AddLocationAltOutlinedIcon,
    title: 'Record',
    description: 'Botanists record plants on the mobile app with GPS, a photo and a QR tag.',
  },
  {
    icon: FactCheckOutlinedIcon,
    title: 'Review',
    description: 'Conservation officers check each record before it is shown to the public.',
  },
  {
    icon: PublicOutlinedIcon,
    title: 'Publish',
    description: 'Approved plants appear to guests on the Niah Biodiversity mobile app.',
  },
]

const MONITOR = {
  icon: SensorsOutlinedIcon,
  title: 'Monitor',
  description:
    'Sensor nodes in the park report temperature, humidity and motion, and raise alerts when readings go out of range.',
}

// Width of the hero, card and flow when they are stacked (below md)
const STACKED_MAX_WIDTH = 520
// Width of the sign-in card, and the guest note under it, on desktop
const CARD_MAX_WIDTH = 440
// Matches the 44px minimum touch target, so the step icons line up with buttons
const STEP_ICON_SIZE = 44

const GUEST_NOTE =
  'Visiting the park? Browse approved plants as a guest on the Niah Biodiversity mobile app.'
const CREDIT =
  'COS30049 project, Swinburne University of Technology Sarawak, with Sarawak Forestry Corporation and NeuonAI'

const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)'
const HOVER = '@media (hover: hover)'

const fadeUp = keyframes`
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: none; }
`

// Fade-up entrance, staggered by `order` (hero 0, card 1, flow 2). `both` keeps the block hidden
// until its delay is up.
function entranceSx(order) {
  return {
    animation: `${fadeUp} 400ms ease-out ${order * 100}ms both`,
    [REDUCED_MOTION]: { animation: 'none' },
  }
}

// Desktop: the hero and flow sit in the left panel with the credit line at its bottom, and the
// card is centred on the right with the guest note under it. The two 1fr rows share the spare
// height, which centres the left column's text.
// Below md: one column in DOM order (hero, card, flow, footer), so the reading order is the same
// at every width. The footer then holds the guest note and the credit line.
const gridSx = {
  display: 'grid',
  minHeight: '100vh',
  bgcolor: 'background.default',
  gridTemplateColumns: { xs: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' },
  gridTemplateRows: { xs: 'auto auto auto 1fr', md: '1fr auto auto 1fr auto' },
  gridTemplateAreas: {
    xs: '"hero" "card" "features" "footer"',
    md: '". card" "hero card" "features card" ". card" "footer card"',
  },
}

// Same width and centring for each stacked block, and on the left column on desktop
const contentSx = { width: '100%', maxWidth: STACKED_MAX_WIDTH, mx: 'auto' }

// A soft panel-coloured patch behind a block of text on the panel, so the contour lines stay
// full-panel but fade out under the words. It reaches 48px past the text and fades to nothing
// at its edges. `desktopOnly` for a block that is only on the panel from md up.
function scrimSx({ desktopOnly = false } = {}) {
  return (theme) => {
    const reach = theme.spacing(6)
    const fade = (direction) =>
      `linear-gradient(${direction}, transparent, black ${reach}, black calc(100% - ${reach}), transparent)`

    return {
      position: 'relative',
      // Keeps the scrim (z-index -1) behind this block's text but above the panel
      isolation: 'isolate',
      '&::before': {
        content: '""',
        display: desktopOnly ? { xs: 'none', md: 'block' } : 'block',
        position: 'absolute',
        inset: theme.spacing(-6),
        zIndex: -1,
        backgroundColor: alpha(tokens.primary, 0.8),
        maskImage: `${fade('to right')}, ${fade('to bottom')}`,
        maskComposite: 'intersect',
      },
    }
  }
}

export default function AuthLayout() {
  return (
    <Box component="main" sx={gridSx}>
      <Box
        aria-hidden="true"
        sx={{
          // The whole left column on desktop, a band behind the hero when stacked
          gridArea: { xs: 'hero', md: '1 / 1 / -1 / 2' },
          position: 'relative',
          overflow: 'hidden',
          bgcolor: 'primary.main',
          // For a photo later: import it from src/assets and set backgroundImage here, e.g.
          // `linear-gradient(${overlay}, ${overlay}), url(${photo})` with
          // overlay = alpha(tokens.primaryDark, 0.7). The overlay keeps the white text readable
          // on top of the photo. Remove <ContourPattern /> if it clashes.
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        <ContourPattern />
      </Box>

      <Box
        sx={{
          gridArea: 'hero',
          // Above the panel, which shares this grid area
          position: 'relative',
          // Stacked, the scrim would spill out of the band onto the page background
          overflow: { xs: 'hidden', md: 'visible' },
          px: { xs: 2, sm: 4, md: 6 },
          pt: { xs: 4, md: 6 },
          pb: { xs: 4, md: 3 },
          color: 'primary.contrastText',
        }}
      >
        <Box sx={[contentSx, scrimSx(), entranceSx(0)]}>
          <Typography variant="display" component="h1" sx={{ mb: 1 }}>
            Niah Biodiversity
          </Typography>
          <Typography variant="h3" component="p">
            Plant records and field monitoring for Niah National Park, Sarawak.
          </Typography>
        </Box>
      </Box>

      <Box
        sx={{
          gridArea: 'card',
          alignSelf: 'center',
          px: { xs: 2, sm: 4, md: 6 },
          pt: { xs: 3, md: 6 },
          pb: { md: 6 },
        }}
      >
        <Card
          sx={[
            contentSx,
            {
              maxWidth: { xs: STACKED_MAX_WIDTH, md: CARD_MAX_WIDTH },
              position: 'relative',
              // Accent bar along the top. The card's own overflow: hidden rounds its corners.
              '&::before': {
                content: '""',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: (theme) => theme.spacing(0.5),
                background: `linear-gradient(90deg, ${tokens.primary}, ${tokens.secondary})`,
              },
            },
            entranceSx(1),
          ]}
        >
          <CardContent sx={{ p: { xs: 3, sm: 4 } }}>
            <Outlet />
          </CardContent>
        </Card>
        {/* Desktop copy of the guest note. Stacked, it is in the footer at the bottom instead.
            display: none also hides the unused copy from screen readers, so only one is read. */}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{
            display: { xs: 'none', md: 'block' },
            maxWidth: CARD_MAX_WIDTH,
            mx: 'auto',
            mt: 2,
            textAlign: 'center',
          }}
        >
          {GUEST_NOTE}
        </Typography>
      </Box>

      <HowItWorks />

      <Box
        component="footer"
        sx={{
          gridArea: 'footer',
          alignSelf: 'end',
          // On the panel on desktop, so above it like the hero and flow
          position: 'relative',
          px: { xs: 2, sm: 4, md: 6 },
          py: 3,
          textAlign: { xs: 'center', md: 'left' },
        }}
      >
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ display: { xs: 'block', md: 'none' }, mb: 1 }}
        >
          {GUEST_NOTE}
        </Typography>
        <Typography
          variant="caption"
          component="p"
          sx={{
            ...contentSx,
            color: { xs: 'text.secondary', md: 'primary.contrastText' },
          }}
        >
          {CREDIT}
        </Typography>
      </Box>
    </Box>
  )
}

// Record -> Review -> Publish as connected steps, with Monitor alongside. White on the panel on
// desktop, normal text on the page background when stacked.
function HowItWorks() {
  return (
    <Box
      component="section"
      aria-labelledby="how-it-works-heading"
      sx={{
        gridArea: 'features',
        position: 'relative',
        px: { xs: 2, sm: 4, md: 6 },
        pt: { xs: 4, md: 3 },
        pb: { xs: 2, md: 6 },
        color: { xs: 'text.primary', md: 'primary.contrastText' },
      }}
    >
      {/* Stacked, this block is on the page background, so it needs no scrim */}
      <Box sx={[contentSx, scrimSx({ desktopOnly: true }), entranceSx(2)]}>
        <Typography id="how-it-works-heading" variant="h2" sx={{ mb: 2 }}>
          How it works
        </Typography>
        <Box
          component="ol"
          sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexDirection: 'column', gap: 1 }}
        >
          {STEPS.map((step, index) => (
            <Step key={step.title} {...step} component="li" connected={index < STEPS.length - 1} />
          ))}
        </Box>
        <Typography
          variant="body2"
          component="p"
          sx={{ mt: 2, mb: 1, color: { xs: 'text.secondary', md: 'primary.contrastText' } }}
        >
          Running alongside
        </Typography>
        <Step
          {...MONITOR}
          sx={{
            border: 1,
            borderStyle: 'dashed',
            borderColor: { xs: tokens.border, md: alpha(tokens.surfaceWhite, 0.35) },
          }}
        />
      </Box>
    </Box>
  )
}

// One step in the flow. Highlights on mouse hover only: the steps aren't interactive, so they
// aren't focusable or tab stops. `connected` draws the line down to the next step.
function Step({ icon: Icon, title, description, component = 'div', connected = false, sx }) {
  return (
    <Box component={component} sx={[stepSx(connected), sx]}>
      <Box className="step-icon" sx={stepIconSx}>
        <Icon aria-hidden="true" />
      </Box>
      <Box>
        <Typography variant="h3" sx={{ mb: 0.5 }}>
          {title}
        </Typography>
        <Typography
          variant="body2"
          sx={{ color: { xs: 'text.secondary', md: 'primary.contrastText' } }}
        >
          {description}
        </Typography>
      </Box>
    </Box>
  )
}

function stepSx(connected) {
  return (theme) => {
    const padding = theme.spacing(1.5)
    const highlight = {
      bgcolor: { xs: alpha(tokens.primary, 0.08), md: alpha(tokens.surfaceWhite, 0.1) },
      '& .step-icon': { bgcolor: 'secondary.main' },
    }

    return {
      position: 'relative',
      display: 'flex',
      gap: 2,
      p: 1.5,
      borderRadius: 1,
      transition: theme.transitions.create('background-color', {
        duration: theme.transitions.duration.shorter,
      }),
      [HOVER]: { '&:hover': highlight },
      [REDUCED_MOTION]: { transition: 'none' },
      // Line from the bottom of this step's icon to the top of the next one, across the gap
      ...(connected && {
        '&::after': {
          content: '""',
          position: 'absolute',
          left: `calc(${padding} + ${STEP_ICON_SIZE / 2 - 1}px)`,
          top: `calc(${padding} + ${STEP_ICON_SIZE}px + ${theme.spacing(0.5)})`,
          bottom: `calc(${theme.spacing(0.5)} - ${theme.spacing(1)} - ${padding})`,
          width: 2,
          borderRadius: 1,
          bgcolor: { xs: tokens.border, md: alpha(tokens.surfaceWhite, 0.35) },
        },
      }),
    }
  }
}

function stepIconSx(theme) {
  return {
    flexShrink: 0,
    width: STEP_ICON_SIZE,
    height: STEP_ICON_SIZE,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    bgcolor: { xs: 'primary.main', md: 'primary.dark' },
    color: 'primary.contrastText',
    transition: theme.transitions.create('background-color', {
      duration: theme.transitions.duration.shorter,
    }),
    [REDUCED_MOTION]: { transition: 'none' },
  }
}
