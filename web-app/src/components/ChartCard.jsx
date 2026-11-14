import { Alert, Box, Card, CardContent, CircularProgress, Stack, Typography } from '@mui/material'
import { ResponsiveContainer } from 'recharts'

// A card holding one chart, so every chart shares the same title, loading, error and empty
// states. `children` is a single Recharts chart (BarChart, LineChart, PieChart, ...), sized to
// fill the card's width and `height`. `error` is a message string. The chart area keeps the same
// height in every state, so the page doesn't jump when the data arrives.
export default function ChartCard({
  title,
  subtitle,
  loading = false,
  error = null,
  empty = false,
  emptyMessage = 'No data to show yet.',
  height = 300,
  children,
}) {
  const showChart = !loading && !error && !empty

  return (
    <Card variant="outlined" sx={{ height: '100%' }}>
      <CardContent>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="h3" component="h2">
              {title}
            </Typography>
            {subtitle ? (
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            ) : null}
          </Stack>

          <Box
            aria-busy={loading}
            sx={{
              height,
              ...(!showChart && {
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }),
            }}
          >
            {loading ? <CircularProgress size={24} aria-label={`Loading ${title}`} /> : null}
            {!loading && error ? (
              <Alert severity="error" sx={{ width: '100%' }}>
                {error}
              </Alert>
            ) : null}
            {!loading && !error && empty ? (
              <Typography variant="body2" color="text.secondary">
                {emptyMessage}
              </Typography>
            ) : null}
            {showChart ? (
              <ResponsiveContainer width="100%" height="100%">
                {children}
              </ResponsiveContainer>
            ) : null}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  )
}
