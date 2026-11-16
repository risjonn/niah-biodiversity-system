import { Box, Stack, Typography } from '@mui/material'

// The heading block at the top of every signed-in page: the page's h1, an optional line under
// it, and an optional action (a button, or a small group of controls) on the right. On a narrow
// screen the action wraps under the title.
export default function PageHeader({ title, subtitle, action }) {
  return (
    <Stack
      direction="row"
      spacing={2}
      useFlexGap
      sx={{ alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
    >
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography variant="h1">{title}</Typography>
        {subtitle ? (
          <Typography variant="body1" color="text.secondary">
            {subtitle}
          </Typography>
        ) : null}
      </Stack>
      {action ? <Box>{action}</Box> : null}
    </Stack>
  )
}
