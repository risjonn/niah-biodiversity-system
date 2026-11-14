import { alpha, createTheme } from '@mui/material/styles'

export const tokens = {
  primary: '#3F5F68',
  primaryDark: '#2E464D',
  secondary: '#6F8F52',
  alert: '#D9A24B',
  error: '#C0392B',
  success: '#4C7A3D',
  surface: '#F1F0EC',
  surfaceWhite: '#FFFFFF',
  textPrimary: '#22282A',
  textSecondary: '#5C6669',
  border: '#D8D6CF',
  // Conservation statuses with no colour of their own in the palette above. Chosen so each
  // status stays distinguishable from its neighbours for colour-blind readers.
  nearThreatened: '#5BC99E',
  criticallyEndangered: '#751E26',
}

// Fills in the light, dark and contrastText shades MUI needs for a custom palette colour
const { augmentColor } = createTheme().palette

export const theme = createTheme({
  palette: {
    primary: { main: tokens.primary, dark: tokens.primaryDark },
    secondary: { main: tokens.secondary },
    error: { main: tokens.error },
    success: { main: tokens.success },
    warning: { main: tokens.alert },
    // Conservation status chip colours, see lib/conservationStatus.js
    nearThreatened: augmentColor({
      color: { main: tokens.nearThreatened, contrastText: tokens.textPrimary },
      name: 'nearThreatened',
    }),
    criticallyEndangered: augmentColor({
      color: { main: tokens.criticallyEndangered, contrastText: tokens.surfaceWhite },
      name: 'criticallyEndangered',
    }),
    background: { default: tokens.surface, paper: tokens.surfaceWhite },
    text: { primary: tokens.textPrimary, secondary: tokens.textSecondary },
  },
  typography: {
    fontFamily: 'Inter, sans-serif',
    h1: { fontSize: 28, fontWeight: 600 },
    h2: { fontSize: 22, fontWeight: 600 },
    h3: { fontSize: 18, fontWeight: 500 },
    body1: { fontSize: 16, fontWeight: 400 },
    body2: { fontSize: 14, fontWeight: 400 },
    caption: { fontSize: 12, fontWeight: 400 },
  },
  shape: {
    borderRadius: 8,
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 44,
          textTransform: 'none',
          fontWeight: 500,
          variants: [
            {
              // Buttons on the primary header (the outlined log out button and the text nav
              // links) use color="inherit" to pick up its white text, and MUI keeps an outlined
              // border as currentColor (white). The default hover tint is based on the dark text
              // colour, so darken with primaryDark instead.
              props: ({ color, variant }) =>
                color === 'inherit' && (variant === 'outlined' || variant === 'text'),
              style: {
                '@media (hover: hover)': {
                  '&:hover': {
                    backgroundColor: alpha(tokens.primaryDark, 0.5),
                  },
                },
              },
            },
          ],
        },
      },
    },
  },
})

// Chart colours and type. mobile-app/src/theme/theme.js has the same values as `theme.chart`.
// See "Charts" in docs/design-system.md.
export const chartTokens = {
  // Series colours for charts where colour only says which series is which. Use them in this
  // order and never cycle: the order keeps neighbouring series apart for colour-blind readers.
  // Past six series, group the smallest into one "Other" series coloured `other`.
  series: ['#1288A1', '#D39837', '#3C6C2A', '#47AEC7', '#B63325', '#759E4C'],
  other: '#9EA6A9',
  // review_status values, in the order to stack them. Same colours as the status chips. Keep
  // pending between approved and rejected, because green and red look alike to red-green
  // colour-blind readers.
  reviewStatus: {
    approved: tokens.success,
    pending_review: tokens.alert,
    rejected: tokens.error,
  },
  // conservation_status values, least to most threatened. Same colours as the chips.
  conservationStatus: {
    least_concern: tokens.success,
    near_threatened: tokens.nearThreatened,
    vulnerable: tokens.alert,
    endangered: tokens.error,
    critically_endangered: tokens.criticallyEndangered,
  },
  axis: tokens.border,
  grid: '#E9E8E3',
  label: tokens.textSecondary,
  // Rounds the end of a bar away from the baseline
  barRadius: 4,
  fontFamily: theme.typography.fontFamily,
  fontSize: {
    tick: theme.typography.caption.fontSize,
    label: theme.typography.body2.fontSize,
  },
}
