import { Outlet } from 'react-router-dom'
import { Box, Card, CardContent, Typography } from '@mui/material'

export default function AuthLayout() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        p: 2,
      }}
    >
      <Card sx={{ width: '100%', maxWidth: 400 }}>
        <CardContent sx={{ p: 4 }}>
          <Typography variant="h1" color="primary" sx={{ mb: 3 }}>
            Niah Biodiversity
          </Typography>
          <Outlet />
        </CardContent>
      </Card>
    </Box>
  )
}
