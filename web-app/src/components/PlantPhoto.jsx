import { Alert, Box, Stack, Typography } from '@mui/material'
import ImageNotSupportedOutlinedIcon from '@mui/icons-material/ImageNotSupportedOutlined'
import PhotoGallery from './PhotoGallery'
import { usePlantPhotos } from '../hooks/usePlantPhotos'

// A plant record's photos as a gallery, cover first, shared by the review panel and the record
// panel. Read-only: nobody adds or removes plant photos on the web. `maxHeight` caps the large
// photo (any sx value), so a tall photo doesn't push the rest of its panel out of view.
// onViewerOpenChange: see PhotoGallery.
export default function PlantPhotos({ plant, maxHeight, onViewerOpenChange }) {
  const { photos, error, loading } = usePlantPhotos(plant)

  if (error) return <Alert severity="error">{error}</Alert>

  const total = photos.length
  return (
    <PhotoGallery
      photos={photos.map((photo, index) => ({
        key: photo.id ?? photo.path,
        url: photo.url,
        alt:
          total > 1
            ? `Photo ${index + 1} of ${total} of ${plant.qr_code}`
            : `Photo of ${plant.qr_code}`,
      }))}
      loading={loading}
      empty={<NoPhoto />}
      broken={
        <Message icon={<ImageNotSupportedOutlinedIcon aria-hidden="true" />}>
          This photo could not be displayed. Try again later.
        </Message>
      }
      maxHeight={maxHeight}
      onViewerOpenChange={onViewerOpenChange}
    />
  )
}

// The placeholder for a record without a photo. `fill` stretches it to its container's height
// (e.g. a card's fixed-ratio photo area).
export function NoPhoto({ fill = false }) {
  return (
    <PhotoFrame fill={fill}>
      <Message icon={<ImageNotSupportedOutlinedIcon aria-hidden="true" />}>
        No photo with this record
      </Message>
    </PhotoFrame>
  )
}

// "+3" on a list's cover thumbnail when a record has more photos than the cover. Place it inside
// a box with position: relative; `sx` sets where. Nothing for one photo or none. Read as
// "4 photos", since "+3" on its own means little to a screen reader.
export function MorePhotosBadge({ count, sx }) {
  if (!count || count < 2) return null
  return (
    <Box
      role="img"
      aria-label={`${count} photos`}
      sx={{
        position: 'absolute',
        right: 4,
        bottom: 4,
        px: 0.5,
        borderRadius: 0.5,
        bgcolor: 'background.paper',
        color: 'text.primary',
        typography: 'caption',
        fontWeight: 500,
        lineHeight: 1.5,
        boxShadow: 1,
        pointerEvents: 'none',
        ...sx,
      }}
    >
      +{count - 1}
    </Box>
  )
}

function Message({ icon, children }) {
  return (
    <Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary', py: 4, px: 2 }}>
      {icon}
      <Typography variant="body2" sx={{ textAlign: 'center' }}>
        {children}
      </Typography>
    </Stack>
  )
}

// The grey box the placeholder sits in, the same as PhotoGallery's frame
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
