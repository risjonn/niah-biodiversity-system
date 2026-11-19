import { useState } from 'react'
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import * as ImagePicker from 'expo-image-picker'
import Button from './Button'
import { MAX_PHOTOS, preparePhoto } from '../lib/photos'
import { theme } from '../theme/theme'

const PICKER_OPTIONS = { mediaTypes: ['images'], exif: false, quality: 1 }

const SOURCES = {
  camera: {
    requestPermission: ImagePicker.requestCameraPermissionsAsync,
    launch: () => ImagePicker.launchCameraAsync(PICKER_OPTIONS),
    deniedMessage:
      'Camera access is needed to take a photo. To turn it on, open your phone settings, find this app and allow Camera.',
  },
  library: {
    requestPermission: ImagePicker.requestMediaLibraryPermissionsAsync,
    // Several at once, up to the number of photos still allowed, in the order they were chosen
    launch: (remaining) =>
      ImagePicker.launchImageLibraryAsync({
        ...PICKER_OPTIONS,
        allowsMultipleSelection: true,
        selectionLimit: remaining,
        orderedSelection: true,
      }),
    deniedMessage:
      'Photo library access is needed to choose photos. To turn it on, open your phone settings, find this app and allow Photos.',
  },
}

// Each tile is as wide as its three 44px buttons; the photo above them is 4:3
const TILE_WIDTH = theme.buttonHeight * 3
const TILE_PHOTO_HEIGHT = Math.round((TILE_WIDTH * 3) / 4)

// Up to MAX_PHOTOS photos for a form, cover first. `value` is an array of { uri, width, height }
// for resized JPEGs on the device (lib/photos.js); only those copies are ever passed to onChange,
// so an original is never uploaded. Empty, it is a large dashed box that opens the camera (with a
// link to choose from the photo library instead). With photos, a row of tiles (the first marked
// Cover) with move left, move right and remove, and buttons to add more until there are 5.
export default function PhotoField({ label, value, onChange, disabled = false, style }) {
  // { done, total } while chosen photos are being resized
  const [preparing, setPreparing] = useState(null)
  const [error, setError] = useState(null)
  // Set when permission was refused, so the message can offer a way to the phone settings
  const [permissionDenied, setPermissionDenied] = useState(false)

  const remaining = MAX_PHOTOS - value.length
  const busy = disabled || preparing !== null
  const full = remaining <= 0

  async function pick(sourceName) {
    if (busy || full) return
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
      result = await source.launch(remaining)
    } catch {
      setError(
        sourceName === 'camera'
          ? 'The camera could not be opened. Try again.'
          : 'Your photos could not be opened. Try again.',
      )
      return
    }
    if (result.canceled || !result.assets?.length) return

    // Some Android photo pickers ignore the selection limit
    const assets = result.assets.slice(0, remaining)
    const leftOut = result.assets.length - assets.length
    const prepared = []
    let failed = 0
    setPreparing({ done: 0, total: assets.length })
    for (const asset of assets) {
      try {
        prepared.push(await preparePhoto(asset.uri))
      } catch {
        failed++
      }
      setPreparing({ done: prepared.length + failed, total: assets.length })
    }
    setPreparing(null)

    if (prepared.length > 0) onChange([...value, ...prepared])
    const messages = []
    if (failed > 0) {
      messages.push(
        failed === 1
          ? "One photo couldn't be prepared. Try again or choose a different photo."
          : `${failed} photos couldn't be prepared. Try again or choose different photos.`,
      )
    }
    if (leftOut > 0) {
      messages.push(
        `A record can have ${MAX_PHOTOS} photos, so ${leftOut} ${leftOut === 1 ? 'was' : 'were'} not added.`,
      )
    }
    if (messages.length > 0) setError(messages.join(' '))
  }

  function handleRemove(index) {
    setError(null)
    onChange(value.filter((_, photoIndex) => photoIndex !== index))
  }

  // Moves a photo one place left (-1) or right (+1); the first photo is the cover
  function handleMove(index, step) {
    const target = index + step
    if (target < 0 || target >= value.length) return
    const next = [...value]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange(next)
  }

  const preparingText = preparing
    ? preparing.total > 1
      ? `Preparing photo ${Math.min(preparing.done + 1, preparing.total)} of ${preparing.total}…`
      : 'Preparing photo…'
    : null

  return (
    <View style={style}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      {value.length === 0 ? (
        <>
          <Pressable
            onPress={() => pick('camera')}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Take a photo"
            accessibilityState={{ disabled: busy, busy: preparing !== null }}
            style={({ pressed }) => [styles.dropBox, pressed && styles.pressed, disabled && styles.dimmed]}
          >
            {preparing ? (
              <>
                <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Preparing photos" />
                <Text style={styles.dropText}>{preparingText}</Text>
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
      ) : (
        <View style={styles.filled}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.tiles}
            accessibilityLabel="Photos, cover first"
          >
            {value.map((photo, index) => (
              <PhotoTile
                key={photo.uri}
                photo={photo}
                number={index + 1}
                total={value.length}
                disabled={busy}
                onMoveLeft={index > 0 ? () => handleMove(index, -1) : null}
                onMoveRight={index < value.length - 1 ? () => handleMove(index, 1) : null}
                onRemove={() => handleRemove(index)}
              />
            ))}
          </ScrollView>
          {preparing ? (
            <View style={styles.preparingRow}>
              <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Preparing photos" />
              <Text style={styles.note} accessibilityLiveRegion="polite">
                {preparingText}
              </Text>
            </View>
          ) : null}
          <View style={styles.addActions}>
            <View style={styles.addAction}>
              <Button title="Take photo" variant="secondary" onPress={() => pick('camera')} disabled={busy || full} />
            </View>
            <View style={styles.addAction}>
              <Button title="Choose photos" variant="secondary" onPress={() => pick('library')} disabled={busy || full} />
            </View>
          </View>
          <Text style={styles.note}>
            {full
              ? `That's the most a record can have (${MAX_PHOTOS}). Remove one to add another.`
              : `The first photo is the cover. You can add ${remaining} more.`}
          </Text>
        </View>
      )}
      {error ? (
        <View style={styles.errorBox}>
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
          {permissionDenied ? (
            <Button title="Open settings" variant="secondary" onPress={() => Linking.openSettings()} />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

// One chosen photo: the image ("Cover" on the first), then move left, move right and remove.
// onMoveLeft and onMoveRight are null at either end.
function PhotoTile({ photo, number, total, disabled, onMoveLeft, onMoveRight, onRemove }) {
  const isCover = number === 1
  return (
    <View style={styles.tile}>
      <View style={styles.tilePhoto}>
        <Image
          source={{ uri: photo.uri }}
          style={{ width: TILE_WIDTH, height: TILE_PHOTO_HEIGHT }}
          resizeMode="cover"
          accessibilityLabel={isCover ? `Photo 1 of ${total}, the cover` : `Photo ${number} of ${total}`}
          accessibilityIgnoresInvertColors
        />
        {isCover ? (
          <View style={styles.coverLabel}>
            <Text style={styles.coverText}>Cover</Text>
          </View>
        ) : null}
      </View>
      <View style={styles.tileActions}>
        <TileButton
          icon="chevron-back"
          label={`Move photo ${number} left`}
          onPress={onMoveLeft}
          disabled={disabled || !onMoveLeft}
        />
        <TileButton
          icon="chevron-forward"
          label={`Move photo ${number} right`}
          onPress={onMoveRight}
          disabled={disabled || !onMoveRight}
        />
        <TileButton
          icon="trash-outline"
          label={`Remove photo ${number}`}
          onPress={onRemove}
          disabled={disabled}
          danger
        />
      </View>
    </View>
  )
}

function TileButton({ icon, label, onPress, disabled, danger = false }) {
  const color = disabled ? theme.colors.border : danger ? theme.colors.error : theme.colors.primary
  return (
    <Pressable
      onPress={onPress ?? undefined}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [styles.tileButton, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={22} color={color} />
    </Pressable>
  )
}

const styles = StyleSheet.create({
  // Matches TextInput's label so the field sits in a form like any other
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
    marginBottom: theme.spacing.xs,
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
  filled: {
    gap: theme.spacing.md,
  },
  tiles: {
    gap: theme.spacing.md,
  },
  tile: {
    width: TILE_WIDTH,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    overflow: 'hidden',
    backgroundColor: theme.colors.surfaceWhite,
  },
  tilePhoto: {
    backgroundColor: theme.colors.border,
  },
  coverLabel: {
    position: 'absolute',
    top: theme.spacing.xs,
    left: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderRadius: theme.radius * 2,
    backgroundColor: theme.colors.primary,
  },
  coverText: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.surfaceWhite,
  },
  tileActions: {
    flexDirection: 'row',
  },
  tileButton: {
    width: theme.buttonHeight,
    height: theme.buttonHeight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preparingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  addActions: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  addAction: {
    flex: 1,
  },
  note: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
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
