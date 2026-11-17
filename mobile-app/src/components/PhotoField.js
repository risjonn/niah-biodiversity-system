import { useState } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as ImagePicker from 'expo-image-picker'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'
import Button from './Button'
import { theme } from '../theme/theme'

// Photos are shrunk to this longest side and re-encoded before they are kept, which also drops
// embedded metadata such as the GPS position
const MAX_PHOTO_SIDE = 1600
const JPEG_QUALITY = 0.7

const PICKER_OPTIONS = { mediaTypes: ['images'], exif: false, quality: 1 }

const SOURCES = {
  camera: {
    requestPermission: ImagePicker.requestCameraPermissionsAsync,
    launch: ImagePicker.launchCameraAsync,
    deniedMessage:
      'Camera access is needed to take a photo. To turn it on, open your phone settings, find this app and allow Camera.',
  },
  library: {
    requestPermission: ImagePicker.requestMediaLibraryPermissionsAsync,
    launch: ImagePicker.launchImageLibraryAsync,
    deniedMessage:
      'Photo library access is needed to choose a photo. To turn it on, open your phone settings, find this app and allow Photos.',
  },
}

// Optional photo for a form. `value` is { uri, width, height } for the resized JPEG on the device,
// or null. Only the resized copy is ever passed to onChange, so the original is never uploaded.
// Empty, it is a large dashed box that opens the camera (with a link to choose from the photo
// library instead); with a photo, a preview with Retake and Remove.
export default function PhotoField({ label, value, onChange, disabled = false, style }) {
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState(null)
  // Set when permission was refused, so the message can offer a way to the phone settings
  const [permissionDenied, setPermissionDenied] = useState(false)
  // The preview's measured width in px, so the image always has an explicit size (an image sized
  // only by a percentage or aspectRatio stayed blank on an iPhone, see PhotoBanner)
  const [previewWidth, setPreviewWidth] = useState(0)

  async function pick(sourceName) {
    const source = SOURCES[sourceName]
    setError(null)
    setPermissionDenied(false)

    // Each permission is asked for only when that source is used
    const permission = await source.requestPermission()
    if (!permission.granted) {
      setError(source.deniedMessage)
      setPermissionDenied(true)
      return
    }

    let result
    try {
      result = await source.launch(PICKER_OPTIONS)
    } catch {
      setError(
        sourceName === 'camera'
          ? 'The camera could not be opened. Try again.'
          : 'Your photos could not be opened. Try again.',
      )
      return
    }
    if (result.canceled) return

    setPreparing(true)
    try {
      onChange(await shrinkPhoto(result.assets[0].uri))
    } catch {
      setError('The photo could not be prepared. Try again or choose a different photo.')
    } finally {
      setPreparing(false)
    }
  }

  function handleRemove() {
    setError(null)
    onChange(null)
  }

  const busy = disabled || preparing

  return (
    <View style={style}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {value ? (
        <View style={styles.preview}>
          <View
            style={styles.previewFrame}
            onLayout={(event) => setPreviewWidth(Math.round(event.nativeEvent.layout.width))}
          >
            {previewWidth > 0 ? (
              <Image
                source={{ uri: value.uri }}
                style={{ width: previewWidth, height: Math.round((previewWidth * 3) / 4) }}
                resizeMode="cover"
                accessibilityLabel="Chosen photo"
              />
            ) : null}
          </View>
          <View style={styles.previewActions}>
            <View style={styles.previewAction}>
              <Button
                title={preparing ? 'Preparing…' : 'Retake'}
                variant="secondary"
                onPress={() => pick('camera')}
                disabled={disabled}
                loading={preparing}
              />
            </View>
            <View style={styles.previewAction}>
              <Button title="Remove" variant="secondary" onPress={handleRemove} disabled={busy} />
            </View>
          </View>
        </View>
      ) : (
        <>
          <Pressable
            onPress={() => pick('camera')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
            accessibilityState={{ disabled: busy, busy: preparing }}
            style={({ pressed }) => [styles.dropBox, pressed && styles.pressed, disabled && styles.dimmed]}
          >
            {preparing ? (
              <>
                <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Preparing photo" />
                <Text style={styles.dropText}>Preparing photo…</Text>
              </>
            ) : (
              <>
                <Ionicons name="camera-outline" size={36} color={theme.colors.primary} />
                <Text style={styles.dropText}>Tap to take a photo</Text>
              </>
            )}
          </Pressable>
          <Pressable
            onPress={() => pick('library')}
            disabled={busy}
            accessibilityRole="button"
            hitSlop={theme.spacing.md}
            style={({ pressed }) => [styles.libraryLink, (pressed || busy) && styles.dimmed]}
          >
            <Text style={styles.libraryLinkText}>Or choose from your photos</Text>
          </Pressable>
        </>
      )}
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
          {permissionDenied ? (
            <Button
              title="Open settings"
              variant="secondary"
              onPress={() => Linking.openSettings()}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

// Resizes so the longest side is at most MAX_PHOTO_SIDE and saves a new JPEG. Always re-encodes,
// even when no resize is needed, so the saved copy never carries the original's metadata.
async function shrinkPhoto(uri) {
  const original = await ImageManipulator.manipulate(uri).renderAsync()
  let image = original
  if (Math.max(original.width, original.height) > MAX_PHOTO_SIDE) {
    image = await ImageManipulator.manipulate(original)
      .resize(
        original.width >= original.height ? { width: MAX_PHOTO_SIDE } : { height: MAX_PHOTO_SIDE },
      )
      .renderAsync()
  }
  const saved = await image.saveAsync({ compress: JPEG_QUALITY, format: SaveFormat.JPEG })
  return { uri: saved.uri, width: saved.width, height: saved.height }
}

const styles = StyleSheet.create({
  // Matches TextInput's label so the field sits in a form like any other
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
  },
  preview: {
    gap: theme.spacing.md,
  },
  previewFrame: {
    alignSelf: 'stretch',
    overflow: 'hidden',
    borderRadius: theme.radius,
    backgroundColor: theme.colors.border,
  },
  previewActions: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  previewAction: {
    flex: 1,
  },
  dropBox: {
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing.sm,
    padding: theme.spacing.lg,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: theme.colors.primary,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  dropText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.primary,
  },
  pressed: {
    opacity: 0.8,
  },
  dimmed: {
    opacity: 0.5,
  },
  libraryLink: {
    alignSelf: 'center',
    marginTop: theme.spacing.md,
  },
  libraryLinkText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.primary,
    textDecorationLine: 'underline',
  },
  errorBox: {
    marginTop: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  error: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
  },
})
