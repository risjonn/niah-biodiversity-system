export const theme = {
  colors: {
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
  },
  typography: {
    heading1: { fontSize: 28, fontWeight: '600' },
    heading2: { fontSize: 22, fontWeight: '600' },
    heading3: { fontSize: 18, fontWeight: '500' },
    body: { fontSize: 16, fontWeight: '400' },
    bodySmall: { fontSize: 14, fontWeight: '400' },
    caption: { fontSize: 12, fontWeight: '400' },
  },
  // Loaded in App.js. Fonts with no family token here are still named directly in styles.
  fontFamily: {
    italic: 'Inter_400Regular_Italic',
  },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: 8,
  buttonHeight: 44,
}