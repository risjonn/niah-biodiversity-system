import { Box, Stack, Typography } from '@mui/material'
import { tokens } from '../theme/theme'

// What a list or table shows when it has nothing in it: a small drawing, one sentence, and an
// optional `action` (usually a Button). `dense` for use inside a panel that already has padding.
export default function EmptyState({ message, action, dense = false }) {
  return (
    <Stack spacing={2} sx={{ alignItems: 'center', textAlign: 'center', py: dense ? 3 : 6 }}>
      <EmptyDrawing />
      <Typography variant="body1" color="textSecondary">
        {message}
      </Typography>
      {action ?? null}
    </Stack>
  )
}

// Two hills with contour lines and a leaf, in the theme colours. Decorative only.
function EmptyDrawing() {
  return (
    <Box
      component="svg"
      viewBox="0 0 120 80"
      focusable="false"
      aria-hidden="true"
      sx={{ width: 120, height: 80, display: 'block' }}
    >
      <ellipse cx="60" cy="72" rx="52" ry="6" fill={tokens.border} />
      <path d="M10 72 C 28 30, 44 30, 58 72 Z" fill={tokens.surface} stroke={tokens.border} strokeWidth="2" />
      <path d="M40 72 C 60 18, 82 18, 104 72 Z" fill={tokens.surfaceWhite} stroke={tokens.border} strokeWidth="2" />
      <path d="M54 60 C 64 38, 80 38, 90 60" fill="none" stroke={tokens.border} strokeWidth="1.5" />
      <path d="M62 50 C 68 40, 76 40, 82 50" fill="none" stroke={tokens.border} strokeWidth="1.5" />
      {/* Leaf with its stem */}
      <path d="M78 20 C 86 8, 100 6, 108 8 C 106 18, 96 28, 80 26 Z" fill={tokens.secondary} />
      <path d="M80 26 C 88 20, 96 14, 104 10" fill="none" stroke={tokens.surfaceWhite} strokeWidth="1.5" />
      <path d="M80 26 C 78 30, 76 32, 72 34" fill="none" stroke={tokens.secondary} strokeWidth="2" strokeLinecap="round" />
    </Box>
  )
}
