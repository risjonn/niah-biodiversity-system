import { Link as RouterLink } from 'react-router-dom'
import { Alert, Box, Card, CardActionArea, CardContent, Skeleton, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import { visuallyHidden } from '../lib/visuallyHidden'

// One headline number: an icon in a tile of `color` (a theme palette name: primary, secondary,
// success, warning or error), the label, the value and an optional caption.
// - loading: a skeleton in place of the value
// - error: an inline error in place of the value
// - to: the whole card links there and lifts slightly on hover
// - trend: an optional short line under the value, e.g. "+5 this month", shown once it's loaded
export default function StatCard({
  icon: Icon,
  color = 'primary',
  label,
  value,
  caption,
  to,
  trend,
  loading = false,
  error = null,
}) {
  const content = (
    <CardContent sx={{ height: '100%' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Box
          sx={(theme) => ({
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(theme.palette[color].main, 0.12),
            // The dark shade keeps the icon clear on the pale tile, even for amber
            color: theme.palette[color].dark,
          })}
        >
          <Icon aria-hidden="true" />
        </Box>
        <Stack spacing={0.5} sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body2" component="h2" color="textSecondary" sx={{ fontWeight: 500 }}>
            {label}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {!error && loading ? (
            <Typography variant="h1" component="p">
              <Skeleton width="50%" aria-hidden="true" />
              <Box component="span" sx={visuallyHidden}>
                Loading {label}
              </Box>
            </Typography>
          ) : null}
          {!error && !loading ? (
            <Typography variant="h1" component="p">
              {value}
            </Typography>
          ) : null}
          {!error && !loading && trend ? (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'success.main' }}>
              <TrendingUpIcon fontSize="small" aria-hidden="true" />
              <Typography variant="caption" sx={{ fontWeight: 600 }}>
                {trend}
              </Typography>
            </Stack>
          ) : null}
          {caption ? (
            <Typography variant="caption" color="textSecondary">
              {caption}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
    </CardContent>
  )

  return (
    <Card
      variant="outlined"
      sx={(theme) => ({
        height: '100%',
        ...(to && {
          transition: theme.transitions.create(['transform', 'box-shadow'], {
            duration: theme.transitions.duration.shorter,
          }),
          '@media (hover: hover)': {
            '&:hover': { transform: 'translateY(-2px)', boxShadow: theme.shadows[3] },
          },
          '@media (prefers-reduced-motion: reduce)': {
            transition: 'none',
            '&:hover': { transform: 'none' },
          },
        }),
      })}
    >
      {to ? (
        <CardActionArea component={RouterLink} to={to} sx={{ height: '100%' }}>
          {content}
        </CardActionArea>
      ) : (
        content
      )}
    </Card>
  )
}
