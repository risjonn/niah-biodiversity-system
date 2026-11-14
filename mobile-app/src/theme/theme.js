const colors = {
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

const typography = {
  heading1: { fontSize: 28, fontWeight: '600' },
  heading2: { fontSize: 22, fontWeight: '600' },
  heading3: { fontSize: 18, fontWeight: '500' },
  body: { fontSize: 16, fontWeight: '400' },
  bodySmall: { fontSize: 14, fontWeight: '400' },
  caption: { fontSize: 12, fontWeight: '400' },
}

export const theme = {
  colors,
  typography,
  // Loaded in App.js. Fonts with no family token here are still named directly in styles.
  fontFamily: {
    italic: 'Inter_400Regular_Italic',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: 8,
  buttonHeight: 44,
  // Chart colours and type. web-app/src/theme/theme.js has the same values as `chartTokens`.
  // See "Charts" in docs/design-system.md.
  chart: {
    // Series colours for charts where colour only says which series is which. Use them in this
    // order and never cycle: the order keeps neighbouring series apart for colour-blind readers.
    // Past six series, group the smallest into one "Other" series coloured `other`.
    series: ['#1288A1', '#D39837', '#3C6C2A', '#47AEC7', '#B63325', '#759E4C'],
    other: '#9EA6A9',
    // review_status values, in the order to stack them. Same colours as the status chips. Keep
    // pending between approved and rejected, because green and red look alike to red-green
    // colour-blind readers.
    reviewStatus: {
      approved: colors.success,
      pending_review: colors.alert,
      rejected: colors.error,
    },
    // conservation_status values, least to most threatened. ConservationStatusChip uses these
    // too.
    conservationStatus: {
      least_concern: colors.success,
      near_threatened: colors.nearThreatened,
      vulnerable: colors.alert,
      endangered: colors.error,
      critically_endangered: colors.criticallyEndangered,
    },
    axis: colors.border,
    grid: '#E9E8E3',
    label: colors.textSecondary,
    // Rounds the end of a bar away from the baseline
    barRadius: 4,
    fontFamily: 'Inter_400Regular',
    fontSize: {
      tick: typography.caption.fontSize,
      label: typography.bodySmall.fontSize,
    },
  },
}
