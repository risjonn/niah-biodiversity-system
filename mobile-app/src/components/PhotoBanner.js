import { useEffect, useState } from 'react'
import { ActivityIndicator, Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { usePlantPhoto } from '../hooks/usePlantPhoto'
import { theme } from '../theme/theme'

// The large photo at the top of a detail screen (full width, 4:3). Once loaded, tapping it opens
// the photo full screen. Give it one of:
// - photoPath: a plant record's photo_url in the private bucket, signed as elsewhere in the app
// - uri: an image the app can load directly (a species' public reference photo)
// `alt` is read out by screen readers. Without a photo (or if it won't load) it shows a leaf on a
// light tint of `tint` with `emptyText` under it.
export default function PhotoBanner({ photoPath, uri, alt, tint, emptyText = 'No photo' }) {
  if (photoPath) return <SignedBanner key={photoPath} photoPath={photoPath} alt={alt} tint={tint} />
  return <Banner key={uri ?? ''} uri={uri} alt={alt} tint={tint} emptyText={emptyText} loading={false} />
}

function SignedBanner({ photoPath, alt, tint }) {
  const { getPlantPhotoUrl } = usePlantPhoto()
  // { uri } once signed, or { error } when it couldn't be
  const [signed, setSigned] = useState(null)

  useEffect(() => {
    let cancelled = false
    getPlantPhotoUrl(photoPath).then((result) => {
      if (!cancelled) setSigned(result.error ? { error: true } : { uri: result.data })
    })
    return () => {
      cancelled = true
    }
    // getPlantPhotoUrl is a new function on every render; only a new path needs a new URL
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoPath])

  return (
    <Banner
      uri={signed?.uri}
      alt={alt}
      tint={tint}
      loading={!signed}
      emptyText="The photo can't be shown right now"
    />
  )
}

// The image always gets an explicit size in px: the frame's measured width and 3/4 of it. It is
// only rendered once that width is known. Sizing it only by absolute insets against a frame whose
// height came from aspectRatio left it blank on an iPhone (it loaded, but drew nothing).
function Banner({ uri, alt, tint, loading, emptyText }) {
  const [width, setWidth] = useState(0)
  const [state, setState] = useState('loading')
  const [viewerOpen, setViewerOpen] = useState(false)
  const height = Math.round((width * 3) / 4)
  const hasImage = Boolean(uri) && state !== 'error'
  const showSpinner = loading || (hasImage && state === 'loading')
  const showPlaceholder = !loading && !hasImage

  return (
    <View
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      style={[
        styles.frame,
        // Until the width is measured, aspectRatio holds the space so nothing jumps
        width > 0 ? { height } : styles.frameUnmeasured,
        showPlaceholder && tint && { backgroundColor: `${tint}1F` },
      ]}
    >
      {hasImage && width > 0 ? (
        // The photo itself is the button that opens it full screen (once it has loaded)
        <Pressable
          onPress={() => setViewerOpen(true)}
          disabled={state !== 'loaded'}
          accessibilityRole="button"
          accessibilityLabel={alt}
          accessibilityHint="Opens the photo full screen"
        >
          <Image
            source={{ uri }}
            style={{ width, height }}
            resizeMode="cover"
            onLoad={() => setState('loaded')}
            onError={() => setState('error')}
            accessibilityIgnoresInvertColors
          />
        </Pressable>
      ) : null}
      {/* Only while loading or when there is no photo: never over a loaded image */}
      {showSpinner ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Loading photo" />
        </View>
      ) : null}
      {showPlaceholder ? (
        <View style={styles.overlay}>
          <Ionicons
            name="leaf-outline"
            size={48}
            color={tint ?? theme.colors.textSecondary}
            accessibilityElementsHidden
          />
          <Text style={styles.emptyText}>{!uri ? emptyText : "This photo couldn't be loaded"}</Text>
        </View>
      ) : null}
      {/* A small badge in the corner. Taps pass through it to the photo underneath. */}
      {state === 'loaded' && hasImage ? (
        <View style={styles.expand} pointerEvents="none" accessibilityElementsHidden>
          <Ionicons name="expand-outline" size={18} color={theme.colors.textPrimary} />
        </View>
      ) : null}
      {viewerOpen ? <PhotoViewer uri={uri} alt={alt} onClose={() => setViewerOpen(false)} /> : null}
    </View>
  )
}

// The photo full screen on a dark background, whole (not cropped), with a close button.
// Android's back button closes it too.
export function PhotoViewer({ uri, alt, onClose }) {
  const insets = useSafeAreaInsets()

  return (
    <Modal animationType="fade" onRequestClose={onClose} statusBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.viewer}>
        <Image
          source={{ uri }}
          style={styles.viewerImage}
          resizeMode="contain"
          accessibilityLabel={alt}
          accessibilityIgnoresInvertColors
        />
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close photo"
          style={({ pressed }) => [
            styles.close,
            { top: insets.top + theme.spacing.sm, right: insets.right + theme.spacing.sm },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name="close" size={28} color={theme.colors.surfaceWhite} />
        </Pressable>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  frame: {
    alignSelf: 'stretch',
    overflow: 'hidden',
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surface,
  },
  frameUnmeasured: {
    aspectRatio: 4 / 3,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
    textAlign: 'center',
  },
  expand: {
    position: 'absolute',
    right: theme.spacing.sm,
    bottom: theme.spacing.sm,
    padding: theme.spacing.xs,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  viewer: {
    flex: 1,
    backgroundColor: theme.colors.textPrimary,
  },
  viewerImage: {
    flex: 1,
  },
  close: {
    position: 'absolute',
    width: theme.buttonHeight,
    height: theme.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.7,
  },
})
