import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useIsFocused } from '@react-navigation/native'
import Button from './Button'
import { theme } from '../theme/theme'

// The format generate_plant_qr_code (database/schema/002) prints on plant tags
export const QR_CODE_PATTERN = /^NIAH-[0-9A-F]{6}$/

export const normaliseCode = (raw) => raw.trim().toUpperCase()

const BARCODE_SETTINGS = { barcodeTypes: ['qr'] }

// Camera and permission handling for scanning plant tags. The parent screen owns the result:
// it sets `scanning` to false after showing a result, and back to true for "Scan another".
// `onUsableChange(true/false)` tells the parent whether the camera is working, so it can
// choose between "Scan another" and "Look up another".
export default function TagScanner({ scanning, onScanned, onUsableChange }) {
  const isFocused = useIsFocused()
  const [permission, requestPermission, getPermission] = useCameraPermissions()
  const [cameraError, setCameraError] = useState(null)
  // Set the moment a code is read, since the camera can report the same code several times
  // before `scanning` updates. Cleared when the parent turns scanning back on.
  const lockedRef = useRef(false)
  const askedPermissionRef = useRef(false)

  useEffect(() => {
    if (scanning) lockedRef.current = false
  }, [scanning])

  // Ask for the camera once when the screen opens, if the phone still lets the app ask
  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain && !askedPermissionRef.current) {
      askedPermissionRef.current = true
      requestPermission()
    }
  }, [permission, requestPermission])

  // Picks up a permission turned on in the phone settings when the user comes back to the app
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') getPermission()
    })
    return () => subscription.remove()
  }, [getPermission])

  const usable = Boolean(permission?.granted) && !cameraError
  useEffect(() => {
    onUsableChange?.(usable)
  }, [usable, onUsableChange])

  function handleScanned({ data }) {
    if (lockedRef.current) return
    lockedRef.current = true
    onScanned(data)
  }

  return (
    <>
      {!permission ? (
        <View style={[styles.cameraFrame, styles.cameraMessage]}>
          <ActivityIndicator color={theme.colors.surfaceWhite} accessibilityLabel="Starting camera" />
        </View>
      ) : null}
      {permission && !permission.granted ? (
        <View style={styles.permissionBox}>
          <Text style={styles.body}>
            Camera access is off, so tags cannot be scanned. To turn it on, open your phone
            settings, find this app and allow Camera. You can still type the code from the tag
            below.
          </Text>
          {permission.canAskAgain ? (
            <Button title="Allow camera" onPress={requestPermission} />
          ) : null}
          <Button
            title="Open settings"
            variant="secondary"
            onPress={() => Linking.openSettings()}
          />
        </View>
      ) : null}
      {permission?.granted && cameraError ? (
        <View style={styles.permissionBox}>
          <Text style={styles.body}>{cameraError}</Text>
        </View>
      ) : null}
      {usable ? (
        <View style={styles.cameraFrame}>
          {/* Only mounted while this screen is showing, so the camera turns off when it isn't */}
          {isFocused ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              active={scanning}
              barcodeScannerSettings={BARCODE_SETTINGS}
              onBarcodeScanned={scanning ? handleScanned : undefined}
              onMountError={() =>
                setCameraError("The camera couldn't start. You can still type the code below.")
              }
            />
          ) : null}
          {!scanning ? (
            <View style={[StyleSheet.absoluteFill, styles.pausedOverlay]}>
              <Text style={styles.pausedText}>Scanning paused</Text>
            </View>
          ) : null}
        </View>
      ) : null}
    </>
  )
}

const styles = StyleSheet.create({
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
  cameraFrame: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: theme.radius,
    overflow: 'hidden',
    backgroundColor: theme.colors.textPrimary,
  },
  cameraMessage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pausedOverlay: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.primaryDark,
    opacity: 0.85,
  },
  pausedText: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.surfaceWhite,
  },
  permissionBox: {
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
})