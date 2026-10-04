import { useState } from 'react'
import { ActivityIndicator, Alert, Image, Linking, StyleSheet, Text, View } from 'react-native'
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
export default function PhotoField({ label, value, onChange, disabled = false, style }) {
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState(null)
  // Set when permission was refused, so the message can offer a way to the phone settings
  const [permissionDenied, setPermissionDenied] = useState(false)

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

  function handleAdd() {
    Alert.alert('Add photo', undefined, [
      { text: 'Take photo', onPress: () => pick('camera') },
      { text: 'Choose from library', onPress: () => pick('library') },
      { text: 'Cancel', style: 'cancel' },
    ])
  }

  function handleRemove() {
    setError(null)
    onChange(null)
  }

  return (
    <View style={style}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {value ? (
        <View style={styles.preview}>
          <Image
            source={{ uri: value.uri }}
            style={styles.thumbnail}
            resizeMode="cover"
            accessibilityLabel="Chosen photo"
          />
          <Button
            title="Remove photo"
            variant="secondary"
            onPress={handleRemove}
            disabled={disabled}
          />
        </View>
      ) : (
        <Button
          title={preparing ? 'Preparing photo…' : 'Add photo'}
          variant="secondary"
          onPress={handleAdd}
          disabled={disabled || preparing}
        />
      )}
      {preparing ? (
        <ActivityIndicator
          style={styles.spinner}
          color={theme.colors.primary}
          accessibilityLabel="Preparing photo"
        />
      ) : null}
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
    gap: theme.spacing.sm,
  },
  // A square crop, kept small so the rest of the form stays in view
  thumbnail: {
    width: '40%',
    aspectRatio: 1,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.border,
  },
  spinner: {
    marginTop: theme.spacing.sm,
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
