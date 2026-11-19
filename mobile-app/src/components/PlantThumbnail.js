import { useEffect, useState } from 'react'
import { Image, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { usePlantPhoto } from '../hooks/usePlantPhoto'
import { theme } from '../theme/theme'

// A small square photo for list rows, decorative (the row says what it is). Give it one of:
// - photoPath: a plant record's photo_url in the private bucket, signed the way My Records does
// - uri: an image the app can load directly (a species' public reference photo, a queued photo)
// With neither, or when the photo won't load, a leaf drawing stands in, on a light tint of `tint`
// (e.g. a conservation colour) or on the plain surface colour.
// `count`: how many photos the record has. With more than one, a small "+2" sits in the corner;
// screen readers hear "3 photos".
export default function PlantThumbnail({ photoPath, uri, size = 64, tint, count = 0 }) {
  // Keyed by the source, so a different photo starts from a fresh load
  const thumbnail = photoPath ? (
    <SignedThumbnail key={photoPath} photoPath={photoPath} size={size} tint={tint} />
  ) : (
    <Thumbnail key={uri ?? ''} uri={uri} size={size} tint={tint} />
  )
  if (count < 2) return thumbnail
  return (
    <View>
      {thumbnail}
      <View style={styles.badge} accessible accessibilityLabel={`${count} photos`}>
        <Text style={styles.badgeText}>+{count - 1}</Text>
      </View>
    </View>
  )
}

function SignedThumbnail({ photoPath, size, tint }) {
  const { getPlantPhotoUrl } = usePlantPhoto()
  const [uri, setUri] = useState(null)

  useEffect(() => {
    let cancelled = false
    getPlantPhotoUrl(photoPath).then((result) => {
      if (!cancelled && !result.error) setUri(result.data)
    })
    return () => {
      cancelled = true
    }
    // getPlantPhotoUrl is a new function on every render; only a new path needs a new URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoPath])

  return <Thumbnail uri={uri} size={size} tint={tint} />
}

function Thumbnail({ uri, size, tint }) {
  const [failed, setFailed] = useState(false)
  const frame = { width: size, height: size }

  if (!uri || failed) {
    return (
      <View
        style={[
          styles.frame,
          styles.placeholder,
          frame,
          // An 8-digit hex colour: the tint at about 12% opacity
          tint && { backgroundColor: `${tint}1F` },
        ]}
      >
        <Ionicons
          name="leaf-outline"
          size={Math.round(size * 0.4)}
          color={tint ?? theme.colors.textSecondary}
          accessibilityElementsHidden
        />
      </View>
    )
  }
  return (
    <Image
      source={{ uri }}
      style={[styles.frame, frame]}
      resizeMode="cover"
      onError={() => setFailed(true)}
      accessibilityIgnoresInvertColors
    />
  )
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surface,
  },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: theme.spacing.xs,
    bottom: theme.spacing.xs,
    paddingHorizontal: theme.spacing.xs,
    borderRadius: theme.radius / 2,
    backgroundColor: theme.colors.surfaceWhite,
  },
  badgeText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textPrimary,
  },
})
