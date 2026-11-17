import { Box, Tooltip } from '@mui/material'
import { formatDateTime, formatRelativeTime } from '../lib/formatDateTime'

// "2 min ago" / "3 days ago", with the full date and time on hover. `now` is a Date.now() value,
// usually when the data was loaded, so every time on a page is measured from the same moment.
// `longAges`: past a week, "3 weeks ago" / "2 months ago" rather than the full date.
export default function RelativeTime({ value, now, longAges = false }) {
  return (
    <Tooltip title={formatDateTime(value)}>
      <Box component="time" dateTime={new Date(value).toISOString()}>
        {formatRelativeTime(value, now, { longAges })}
      </Box>
    </Tooltip>
  )
}
