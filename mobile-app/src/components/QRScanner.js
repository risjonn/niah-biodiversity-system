import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, AppState, Linking, StyleSheet, Text, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useIsFocused } from '@react-navigation/native'
import Button from './Button'
import { theme } from '../theme/theme'

const BARCODE_SETTINGS = { barcodeTypes: ['qr'] }

// Camera frame with permission handling. The parent decides when scanning is paused and what to
// do with the code. `typeHint` is added to the permission/camera messages when the screen has a
// code box to fall back on.
export default function QrScanner({ scanning, onScan, onUsableChange, typeHint = '' }) {
  const isFocused = useIsFocused()
  const [permission, requestPermission, getPermission] = useCameraPermissions()
  const [cameraError, setCameraError] = useState(null)
  const askedPermissionRef = useRef(false)

  // Ask for the camera once when the scanner opens, if the phone still lets the app ask
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
            settings, find this app and allow Camera.{typeHint}
          </Text>
          {permission.canAskAgain ? <Button title="Allow camera" onPress={requestPermission} /> : null}
          <Button title="Open settings" variant="secondary" onPress={() => Linking.openSettings()} />
        </View>
      ) : null}
      {permission?.granted && cameraError ? (
        <View style={styles.permissionBox}>
          <Text style={styles.body}>
            {cameraError}
            {typeHint}
          </Text>
        </View>
      ) : null}
      {usable ? (
        <View style={styles.cameraFrame}>
          {/* Only mounted while the screen is showing, so the camera turns off when it isn't */}
          {isFocused ? (
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              active={scanning}
              barcodeScannerSettings={BARCODE_SETTINGS}
              onBarcodeScanned={scanning ? ({ data }) => onScan(data) : undefined}
              onMountError={() => setCameraError("The camera couldn't start.")}
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
  cameraMessage: { alignItems: 'center', justifyContent: 'center' },
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