import { Box, Dialog, IconButton, Typography } from '@mui/material'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import { tokens } from '../theme/theme'

// A photo full screen on a dark background, with a close button (Escape closes it too). Used by
// PhotoGallery. `children` is the photo, sized by the caller to fit the screen (a max height of
// about 88vh).
// For several photos, pass `position` ("2 of 4") and onPrevious/onNext (null at either end): the
// buttons and the left/right arrow keys move between them. The arrow keys are always handled here
// while the viewer is open, even at either end, so they never reach a page shortcut underneath
// (Plant review's previous/next record): the event is marked handled, which ReviewPanel checks.
export default function PhotoViewer({ open, onClose, children, position, onPrevious, onNext }) {
  function handleKeyDown(event) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    if (event.key === 'ArrowLeft') onPrevious?.()
    else onNext?.()
  }

  const hasSeveral = Boolean(position)
  const navButtonSx = {
    position: 'absolute',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: 1,
    color: tokens.surfaceWhite,
    '&.Mui-disabled': { color: tokens.textSecondary },
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      onKeyDown={handleKeyDown}
      fullScreen
      slotProps={{ paper: { sx: { bgcolor: tokens.textPrimary } } }}
    >
      {hasSeveral ? (
        <Typography
          variant="body2"
          aria-live="polite"
          sx={{ position: 'absolute', top: 16, left: 16, zIndex: 1, color: tokens.surfaceWhite }}
        >
          {position}
        </Typography>
      ) : null}
      <IconButton
        aria-label="Close photo"
        onClick={onClose}
        sx={{ position: 'absolute', top: 8, right: 8, zIndex: 1, color: tokens.surfaceWhite }}
      >
        <CloseIcon />
      </IconButton>
      {hasSeveral ? (
        <>
          <IconButton
            aria-label="Previous photo"
            onClick={onPrevious ?? undefined}
            disabled={!onPrevious}
            size="large"
            sx={{ ...navButtonSx, left: 8 }}
          >
            <ChevronLeftIcon fontSize="large" />
          </IconButton>
          <IconButton
            aria-label="Next photo"
            onClick={onNext ?? undefined}
            disabled={!onNext}
            size="large"
            sx={{ ...navButtonSx, right: 8 }}
          >
            <ChevronRightIcon fontSize="large" />
          </IconButton>
        </>
      ) : null}
      {/* Wider side padding with several photos, so the photo never sits under the buttons */}
      <Box
        sx={{
          flexGrow: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: { xs: 1, sm: 4 },
          px: hasSeveral ? { xs: 7, sm: 9 } : { xs: 1, sm: 4 },
        }}
      >
        <Box sx={{ width: '100%' }}>{children}</Box>
      </Box>
    </Dialog>
  )
}
