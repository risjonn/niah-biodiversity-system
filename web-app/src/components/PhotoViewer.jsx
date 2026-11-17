import { Box, Dialog, IconButton } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import { tokens } from '../theme/theme'

// A photo full screen on a dark background, with a close button (Escape closes it too). Shared by
// the Plant review panel and Species detail. `children` is the photo, sized by the caller to fit
// the screen (a max height of about 88vh).
export default function PhotoViewer({ open, onClose, children }) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      slotProps={{ paper: { sx: { bgcolor: tokens.textPrimary } } }}
    >
      <IconButton
        aria-label="Close photo"
        onClick={onClose}
        sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1, color: tokens.surfaceWhite }}
      >
        <CloseIcon />
      </IconButton>
      <Box sx={{ flexGrow: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 1, sm: 4 } }}>
        <Box sx={{ width: '100%' }}>{children}</Box>
      </Box>
    </Dialog>
  )
}
