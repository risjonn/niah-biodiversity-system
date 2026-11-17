import { useEffect, useRef, useState } from 'react'
import { Box, ButtonBase, CircularProgress, Skeleton, Stack, Typography } from '@mui/material'
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined'
import OpenInFullOutlinedIcon from '@mui/icons-material/OpenInFullOutlined'
import PhotoViewer from './PhotoViewer'
import { tokens } from '../theme/theme'

// Thumbnail width and height in px, 48 on the spacing scale (as in the record and species lists)
const THUMBNAIL_SIZE = 48

// A large photo with a row of thumbnails under it (click one to show it) and a "2 of 4" counter.
// The large photo opens PhotoViewer full screen, with previous/next and the arrow keys. With one
// photo there are no thumbnails or counter; with none, `empty` is shown instead.
// - photos: [{ key, url, alt }], cover first. url is null for a photo that couldn't be signed.
// - loading: the photos are still loading
// - empty: shown when there are no photos (it brings its own frame)
// - broken: shown inside the frame when the current photo won't load
// - fit: 'contain' shows the whole photo, as tall as maxHeight (plant records); 'cover' crops it
//   to a 4:3 frame (species)
// - onViewerOpenChange(open): told when the full-screen viewer opens and closes, so a page can
//   pause its own keyboard shortcuts (Plant review)
export default function PhotoGallery({
  photos,
  loading = false,
  empty,
  broken,
  fit = 'contain',
  maxHeight = { xs: '40vh', md: '60vh' },
  onViewerOpenChange,
  sx,
}) {
  const [selected, setSelected] = useState(0)
  const [viewerOpen, setViewerOpen] = useState(false)

  // Reports closed when the gallery goes (e.g. another record is shown), so the page never stays
  // paused. The ref keeps the latest callback without re-running the clean-up.
  const reportRef = useRef(onViewerOpenChange)
  useEffect(() => {
    reportRef.current = onViewerOpenChange
  })
  useEffect(() => () => reportRef.current?.(false), [])

  function changeViewerOpen(open) {
    setViewerOpen(open)
    onViewerOpenChange?.(open)
  }

  if (loading) return <Box sx={sx}><LoadingFrame fit={fit} /></Box>
  if (photos.length === 0) return <Box sx={sx}>{empty}</Box>

  const count = photos.length
  // Kept in range if the list gets shorter
  const index = Math.min(selected, count - 1)
  const current = photos[index]
  const position = count > 1 ? `${index + 1} of ${count}` : null
  const showPrevious = index > 0 ? () => setSelected(index - 1) : null
  const showNext = index < count - 1 ? () => setSelected(index + 1) : null

  return (
    <Box sx={sx}>
      {/* Keyed by photo, so each one starts from a fresh load */}
      <MainPhoto
        key={current.key}
        photo={current}
        fit={fit}
        maxHeight={maxHeight}
        position={position}
        broken={broken}
        onOpen={() => changeViewerOpen(true)}
      />

      {count > 1 ? (
        <Stack
          direction="row"
          spacing={1}
          useFlexGap
          role="group"
          aria-label="Photos"
          sx={{ mt: 1, flexWrap: 'wrap' }}
        >
          {photos.map((photo, photoIndex) => (
            <Thumbnail
              key={photo.key}
              photo={photo}
              label={`Show photo ${photoIndex + 1} of ${count}`}
              selected={photoIndex === index}
              onClick={() => setSelected(photoIndex)}
            />
          ))}
        </Stack>
      ) : null}

      <PhotoViewer
        open={viewerOpen}
        onClose={() => changeViewerOpen(false)}
        position={position}
        onPrevious={showPrevious}
        onNext={showNext}
      >
        <ViewerPhoto key={current.key} photo={current} />
      </PhotoViewer>
    </Box>
  )
}

// The frame the large photo sits in: a grey box as tall as the photo ('contain'), or a fixed 4:3
// box with a border ('cover')
function frameSx(fit) {
  return fit === 'cover'
    ? {
        position: 'relative',
        width: '100%',
        aspectRatio: '4 / 3',
        overflow: 'hidden',
        borderRadius: 1,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.default',
      }
    : {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'background.default',
      }
}

function LoadingFrame({ fit }) {
  if (fit === 'cover') {
    return <Skeleton variant="rounded" aria-label="Loading photos" sx={{ width: '100%', height: 'auto', aspectRatio: '4 / 3' }} />
  }
  return (
    <Box sx={frameSx(fit)}>
      <Stack sx={{ alignItems: 'center', py: 4 }}>
        <CircularProgress aria-label="Loading photos" />
      </Stack>
    </Box>
  )
}

// Loading lasts until the image itself has arrived. Once loaded, the whole photo is a button that
// opens it full screen.
function MainPhoto({ photo, fit, maxHeight, position, broken, onOpen }) {
  const [state, setState] = useState(photo.url ? 'loading' : 'error')
  const isCover = fit === 'cover'

  return (
    <Box sx={frameSx(fit)}>
      {state === 'loading' ? (
        isCover ? (
          <Skeleton
            variant="rectangular"
            aria-label="Loading photo"
            sx={{ position: 'absolute', inset: 0, height: '100%' }}
          />
        ) : (
          <Stack sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress aria-label="Loading photo" />
          </Stack>
        )
      ) : null}
      {state === 'error' ? broken : null}
      {photo.url ? (
        <Box
          component="img"
          src={photo.url}
          alt={photo.alt}
          onLoad={() => setState('loaded')}
          onError={() => setState('error')}
          sx={{
            display: state === 'loaded' ? 'block' : 'none',
            objectFit: fit,
            ...(isCover
              ? { width: '100%', height: '100%' }
              : { maxWidth: '100%', maxHeight }),
          }}
        />
      ) : null}
      {state === 'loaded' ? (
        <ButtonBase
          onClick={onOpen}
          aria-label={position ? `View photo ${position} full screen` : 'View photo full screen'}
          sx={{
            position: 'absolute',
            inset: 0,
            // Drawn inside the frame, which clips anything outside it
            '&.Mui-focusVisible': { outline: 3, outlineColor: 'primary.main', outlineOffset: -3 },
          }}
        >
          <Box
            aria-hidden="true"
            sx={{
              position: 'absolute',
              right: 8,
              bottom: 8,
              display: 'flex',
              p: 0.5,
              borderRadius: 1,
              bgcolor: 'background.paper',
              color: 'text.primary',
              boxShadow: 1,
            }}
          >
            <OpenInFullOutlinedIcon fontSize="small" />
          </Box>
        </ButtonBase>
      ) : null}
      {position ? (
        <Typography
          variant="caption"
          sx={{
            position: 'absolute',
            top: 8,
            left: 8,
            px: 1,
            borderRadius: 1,
            bgcolor: 'background.paper',
            color: 'text.primary',
            boxShadow: 1,
            fontWeight: 500,
            // The button underneath still takes the click
            pointerEvents: 'none',
          }}
        >
          {position}
        </Typography>
      ) : null}
    </Box>
  )
}

function Thumbnail({ photo, label, selected, onClick }) {
  const [failed, setFailed] = useState(false)

  return (
    <ButtonBase
      onClick={onClick}
      aria-label={label}
      aria-current={selected ? 'true' : undefined}
      sx={{
        width: THUMBNAIL_SIZE,
        height: THUMBNAIL_SIZE,
        flexShrink: 0,
        borderRadius: 1,
        overflow: 'hidden',
        bgcolor: 'background.default',
        color: 'text.secondary',
        border: 2,
        borderColor: selected ? 'primary.main' : 'transparent',
        opacity: selected ? 1 : 0.8,
        '&:hover': { opacity: 1 },
        '&.Mui-focusVisible': { outline: 2, outlineColor: 'primary.main', outlineOffset: 2 },
      }}
    >
      {photo.url && !failed ? (
        <Box
          component="img"
          src={photo.url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <ImageNotSupportedOutlinedIcon fontSize="small" aria-hidden="true" />
      )}
    </ButtonBase>
  )
}

// The current photo full screen, as large as the screen allows
function ViewerPhoto({ photo }) {
  const [state, setState] = useState(photo.url ? 'loading' : 'error')

  if (state === 'error') {
    return (
      <Typography variant="body1" sx={{ color: tokens.surfaceWhite, textAlign: 'center' }}>
        This photo could not be displayed.
      </Typography>
    )
  }
  return (
    <>
      {state === 'loading' ? (
        <Stack sx={{ alignItems: 'center', color: tokens.surfaceWhite }}>
          <CircularProgress color="inherit" aria-label="Loading photo" />
        </Stack>
      ) : null}
      <Box
        component="img"
        src={photo.url}
        alt={photo.alt}
        onLoad={() => setState('loaded')}
        onError={() => setState('error')}
        sx={{
          display: state === 'loaded' ? 'block' : 'none',
          mx: 'auto',
          maxWidth: '100%',
          maxHeight: '88vh',
          objectFit: 'contain',
        }}
      />
    </>
  )
}
