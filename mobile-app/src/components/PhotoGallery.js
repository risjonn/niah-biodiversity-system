import { useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { theme } from '../theme/theme'

// The photos at the top of a detail screen: full width, 4:3, swiped sideways from one to the next,
// with "2 of 4" in the corner when there are several. Tapping a loaded photo opens them full
// screen, where they can be swiped too.
// - photos: [{ key, uri, alt }], cover first. uri is null for a photo that couldn't be signed.
//   `alt` is read out by screen readers.
// - loading: the photos are still being looked up
// Without photos (or for one that won't load) it shows a leaf on a light tint of `tint` with
// `emptyText` under it.
export default function PhotoGallery({ photos, loading = false, tint, emptyText = 'No photo' }) {
  const [width, setWidth] = useState(0)
  const [index, setIndex] = useState(0)
  const [viewerOpen, setViewerOpen] = useState(false)
  const scrollRef = useRef(null)
  const height = Math.round((width * 3) / 4)
  const count = photos.length
  // Kept in range if the list gets shorter
  const current = Math.min(index, Math.max(count - 1, 0))

  function showPhoto(next, animated = true) {
    const clamped = Math.max(0, Math.min(next, count - 1))
    setIndex(clamped)
    scrollRef.current?.scrollTo({ x: clamped * width, animated })
  }

  const showPlaceholder = !loading && count === 0

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
      {loading ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Loading photos" />
        </View>
      ) : null}
      {showPlaceholder ? <Placeholder tint={tint} text={emptyText} /> : null}

      {!loading && count > 0 && width > 0 ? (
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          // Only one photo: nothing to swipe to
          scrollEnabled={count > 1}
          onMomentumScrollEnd={(event) =>
            setIndex(Math.round(event.nativeEvent.contentOffset.x / width))
          }
        >
          {photos.map((photo, photoIndex) => (
            <GalleryPage
              // Keyed by the source, so a different photo starts from a fresh load
              key={`${photo.key}|${photo.uri ?? ''}`}
              photo={photo}
              width={width}
              height={height}
              tint={tint}
              position={count > 1 ? `${photoIndex + 1} of ${count}` : null}
              onOpen={() => setViewerOpen(true)}
              onPrevious={photoIndex > 0 ? () => showPhoto(photoIndex - 1) : null}
              onNext={photoIndex < count - 1 ? () => showPhoto(photoIndex + 1) : null}
            />
          ))}
        </ScrollView>
      ) : null}

      {!loading && count > 1 ? (
        <View style={styles.counter} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Text style={styles.counterText}>
            {current + 1} of {count}
          </Text>
        </View>
      ) : null}

      {viewerOpen ? (
        <PhotoViewer
          photos={photos}
          initialIndex={current}
          onClose={(lastIndex) => {
            setViewerOpen(false)
            // The large photo follows to wherever the viewer was swiped
            if (lastIndex !== current) showPhoto(lastIndex, false)
          }}
        />
      ) : null}
    </View>
  )
}

// One photo in the strip. The photo itself is the button that opens it full screen (once it has
// loaded). Screen readers get "Next photo" and "Previous photo" actions instead of swiping.
function GalleryPage({ photo, width, height, tint, position, onOpen, onPrevious, onNext }) {
  const [state, setState] = useState(photo.uri ? 'loading' : 'error')
  const actions = [
    ...(onNext ? [{ name: 'next', label: 'Next photo' }] : []),
    ...(onPrevious ? [{ name: 'previous', label: 'Previous photo' }] : []),
  ]

  return (
    <View style={{ width, height }}>
      {photo.uri && state !== 'error' ? (
        <Pressable
          onPress={onOpen}
          disabled={state !== 'loaded'}
          accessibilityRole="button"
          accessibilityLabel={position ? `${photo.alt}, photo ${position}` : photo.alt}
          accessibilityHint="Opens the photo full screen"
          accessibilityActions={actions}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'next') onNext?.()
            if (event.nativeEvent.actionName === 'previous') onPrevious?.()
          }}
        >
          <Image
            source={{ uri: photo.uri }}
            style={{ width, height }}
            resizeMode="cover"
            onLoad={() => setState('loaded')}
            onError={() => setState('error')}
            accessibilityIgnoresInvertColors
          />
        </Pressable>
      ) : null}
      {state === 'loading' ? (
        <View style={styles.overlay} pointerEvents="none">
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Loading photo" />
        </View>
      ) : null}
      {state === 'error' ? (
        <View style={[StyleSheet.absoluteFill, tint && { backgroundColor: `${tint}1F` }]}>
          <Placeholder tint={tint} text="This photo couldn't be loaded" />
        </View>
      ) : null}
      {/* A small badge in the corner. Taps pass through it to the photo underneath. */}
      {state === 'loaded' ? (
        <View style={styles.expand} pointerEvents="none" accessibilityElementsHidden>
          <Ionicons name="expand-outline" size={18} color={theme.colors.textPrimary} />
        </View>
      ) : null}
    </View>
  )
}

function Placeholder({ tint, text }) {
  return (
    <View style={styles.overlay}>
      <Ionicons
        name="leaf-outline"
        size={48}
        color={tint ?? theme.colors.textSecondary}
        accessibilityElementsHidden
      />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  )
}

// The photos full screen on a dark background, whole (not cropped), swiped sideways, with "2 of
// 4" and a close button. Android's back button closes it too. onClose is given the index it was
// left on.
function PhotoViewer({ photos, initialIndex, onClose }) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  const [index, setIndex] = useState(initialIndex)
  const listRef = useRef(null)
  const count = photos.length
  const viewable = photos.filter((photo) => photo.uri)

  function showPhoto(next) {
    const clamped = Math.max(0, Math.min(next, count - 1))
    setIndex(clamped)
    listRef.current?.scrollToIndex({ index: clamped, animated: true })
  }

  return (
    <Modal
      animationType="fade"
      onRequestClose={() => onClose(index)}
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.viewer}>
        <FlatList
          // Laid out again when the phone is turned, at the photo being looked at
          key={width}
          ref={listRef}
          data={photos}
          keyExtractor={(photo) => photo.key}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          initialScrollIndex={index}
          getItemLayout={(_, itemIndex) => ({ length: width, offset: width * itemIndex, index: itemIndex })}
          onMomentumScrollEnd={(event) => setIndex(Math.round(event.nativeEvent.contentOffset.x / width))}
          renderItem={({ item, index: itemIndex }) => (
            <View style={{ width, height }}>
              {item.uri ? (
                <Image
                  source={{ uri: item.uri }}
                  style={{ width, height }}
                  resizeMode="contain"
                  accessible
                  accessibilityLabel={count > 1 ? `${item.alt}, photo ${itemIndex + 1} of ${count}` : item.alt}
                  accessibilityActions={[
                    ...(itemIndex < count - 1 ? [{ name: 'next', label: 'Next photo' }] : []),
                    ...(itemIndex > 0 ? [{ name: 'previous', label: 'Previous photo' }] : []),
                  ]}
                  onAccessibilityAction={(event) => {
                    if (event.nativeEvent.actionName === 'next') showPhoto(itemIndex + 1)
                    if (event.nativeEvent.actionName === 'previous') showPhoto(itemIndex - 1)
                  }}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <View style={styles.overlay}>
                  <Text style={styles.viewerMessage}>This photo couldn&apos;t be loaded</Text>
                </View>
              )}
            </View>
          )}
        />
        {count > 1 ? (
          <Text
            style={[styles.viewerCounter, { top: insets.top + theme.spacing.md, left: insets.left + theme.spacing.lg }]}
            accessibilityLiveRegion="polite"
          >
            {index + 1} of {count}
          </Text>
        ) : null}
        <Pressable
          onPress={() => onClose(index)}
          accessibilityRole="button"
          accessibilityLabel={viewable.length > 1 ? 'Close photos' : 'Close photo'}
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
  counter: {
    position: 'absolute',
    top: theme.spacing.sm,
    left: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  counterText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textPrimary,
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
  viewerCounter: {
    position: 'absolute',
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.surfaceWhite,
  },
  viewerMessage: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.surfaceWhite,
    textAlign: 'center',
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
