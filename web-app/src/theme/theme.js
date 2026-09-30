import { createTheme } from '@mui/material/styles'

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
}

export const theme = createTheme({
  palette: {
    primary: { main: tokens.primary, dark: tokens.primaryDark },
    secondary: { main: tokens.secondary },
    error: { main: tokens.error },
    success: { main: tokens.success },
    warning: { main: tokens.alert },
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
        },
      },
    },
  },
})