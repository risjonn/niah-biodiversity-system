import { Link as RouterLink } from 'react-router-dom'
import { Alert, Box, Card, CardActionArea, CardContent, Skeleton, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import { hoverLiftSx } from '../lib/hoverLift'
import { visuallyHidden } from '../lib/visuallyHidden'

// One headline number: an icon in a tile of `color` (a theme palette name: primary, secondary,
// success, warning or error), the label, the value and an optional caption.
// - loading: a skeleton in place of the value
// - error: an inline error in place of the value
// - to: the whole card links there and lifts slightly on hover
// - trend: an optional short line under the value, e.g. "+5 this month", shown once it's loaded
// - size: 'small' for a compact card (smaller tile and value), e.g. inside a page section
// - labelComponent: the label's heading level, h2 by default; h3 under a section's h2
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
  size = 'medium',
  labelComponent = 'h2',
}) {
  const isSmall = size === 'small'
  const tileSize = isSmall ? 36 : 44
  const valueVariant = isSmall ? 'h2' : 'h1'

  const content = (
    <CardContent sx={{ height: '100%' }}>
      <Stack direction="row" spacing={2} sx={{ alignItems: 'flex-start' }}>
        <Box
          sx={(theme) => ({
            flexShrink: 0,
            width: tileSize,
            height: tileSize,
            borderRadius: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: alpha(theme.palette[color].main, 0.12),
            // The dark shade keeps the icon clear on the pale tile, even for amber
            color: theme.palette[color].dark,
          })}
        >
          <Icon aria-hidden="true" fontSize={isSmall ? 'small' : 'medium'} />
        </Box>
        <Stack spacing={0.5} sx={{ minWidth: 0, flexGrow: 1 }}>
          <Typography variant="body2" component={labelComponent} color="textSecondary" sx={{ fontWeight: 500 }}>
            {label}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {!error && loading ? (
            <Typography variant={valueVariant} component="p">
              <Skeleton width="50%" aria-hidden="true" />
              <Box component="span" sx={visuallyHidden}>
                Loading {label}
              </Box>
            </Typography>
          ) : null}
          {!error && !loading ? (
            <Typography variant={valueVariant} component="p">
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
      sx={(theme) => ({ height: '100%', ...(to && hoverLiftSx(theme)) })}
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
