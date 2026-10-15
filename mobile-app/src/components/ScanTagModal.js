import { useRef, useState } from 'react'
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native'
import Button from './Button'
import QrScanner from './QRScanner'
import { usePlantLookup } from '../hooks/usePlantLookup'
import { theme } from '../theme/theme'

// Scan a tag as a signed-in botanist. Opens the record if found, otherwise says why not.
// Render it only while open, so its state starts fresh each time.
export default function ScanTagModal({ onClose, onFound }) {
  const lookUp = usePlantLookup()
  const [scanning, setScanning] = useState(true)
  const [message, setMessage] = useState(null)
  const [checking, setChecking] = useState(false)
  const scanLockedRef = useRef(false)

  async function handleScanned(data) {
    if (scanLockedRef.current) return
    scanLockedRef.current = true
    setScanning(false)
    setChecking(true)
    const result = await lookUp(data)
    setChecking(false)
    if (result.plant) onFound(result.plant)
    else setMessage(result.message)
  }

  function scanAnother() {
    setMessage(null)
    scanLockedRef.current = false
    setScanning(true)
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <Text style={styles.heading}>Scan a plant tag</Text>
        <QrScanner scanning={scanning} onScan={handleScanned} />

        {checking ? <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Checking" /> : null}
        {message ? (
          <View style={styles.card}>
            <Text style={styles.body} accessibilityLiveRegion="polite">
              {message}
            </Text>
          </View>
        ) : null}
        {message ? <Button title="Scan another" onPress={scanAnother} /> : null}
        <Button title="Close" variant="secondary" onPress={onClose} />
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: theme.spacing.lg,
    gap: theme.spacing.md,
    backgroundColor: theme.colors.surface,
  },
  heading: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.textPrimary,
  },
  card: {
    padding: theme.spacing.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
})