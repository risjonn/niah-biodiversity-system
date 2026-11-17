import { useEffect, useState } from 'react'
import { Alert, Box, CircularProgress, Stack, Typography } from '@mui/material'
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined'
import { usePlants } from '../hooks/usePlants'

// A plant record's photo, shared by the review dialog and the record panel. `path` is the record's
// photo_url, or null when it has none. `maxHeight` caps the photo (any sx value), so a tall photo
// doesn't push the rest of its dialog or panel out of view.
export default function PlantPhoto({ path, alt, maxHeight = { xs: '40vh', md: '60vh' } }) {
  if (!path) return <NoPhoto />
  // Keyed by path, so another record's photo starts from a fresh load
  return <SignedPhoto key={path} path={path} alt={alt} maxHeight={maxHeight} />
}

// The placeholder for a record without a photo. `fill` stretches it to its container's height
// (e.g. a card's fixed-ratio photo area).
export function NoPhoto({ fill = false }) {
  return (
    <PhotoFrame fill={fill}>
      <Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary', py: 4 }}>
        <ImageNotSupportedOutlinedIcon aria-hidden="true" />
        <Typography variant="body2">No photo with this record</Typography>
      </Stack>
    </PhotoFrame>
  )
}

// The grey box the photo (or its loading, error or missing state) sits in
function PhotoFrame({ children, fill = false }) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: fill ? 0 : 1,
        bgcolor: 'background.default',
        overflow: 'hidden',
        height: fill ? '100%' : undefined,
      }}
    >
      {children}
    </Box>
  )
}

// photo_url is a path in the private plant-photos bucket, so the image is shown through a signed
// URL. Loading lasts until both the URL and the image itself have arrived. The whole photo is
// always shown (contained, not cropped).
function SignedPhoto({ path, alt, maxHeight }) {
  const { getPlantPhotoUrl } = usePlants()
  const [result, setResult] = useState(null)
  const [imageState, setImageState] = useState(null)

  useEffect(() => {
    let cancelled = false
    getPlantPhotoUrl(path).then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [getPlantPhotoUrl, path])

  const url = result?.data ?? null

  if (result?.error) return <Alert severity="error">{result.error}</Alert>
  if (imageState === 'error') {
    return <Alert severity="error">This photo could not be displayed. Try again later.</Alert>
  }

  return (
    <PhotoFrame>
      {imageState !== 'loaded' ? (
        <Stack sx={{ alignItems: 'center', py: 4 }}>
          <CircularProgress aria-label="Loading photo" />
        </Stack>
      ) : null}
      {url ? (
        <Box
          component="img"
          src={url}
          alt={alt}
          onLoad={() => setImageState('loaded')}
          onError={() => setImageState('error')}
          sx={{
            display: imageState === 'loaded' ? 'block' : 'none',
            maxWidth: '100%',
            maxHeight,
            objectFit: 'contain',
          }}
        />
      ) : null}
    </PhotoFrame>
  )
}
