import { Box, CircularProgress } from '@mui/material'

// Shown while a page's code is still downloading (the lazy routes in router.jsx)
export default function PageLoader() {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress aria-label="Loading page" />
    </Box>
  )
}
