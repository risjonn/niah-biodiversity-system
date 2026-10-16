import { useRef, useState } from 'react'
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native'
import Button from './Button'
import QrScanner from './QRScanner'
import { usePlantLookup } from '../hooks/usePlantLookup'
import { theme } from '../theme/theme'

const REVIEW_STATUS_LABELS = {
  approved: 'Approved',
  pending_review: 'Pending review',
  rejected: 'Rejected',
}

// Scan a tag as a signed-in botanist. Says whether the tag is already registered, and if so its
// review status. Render it only while open, so its state starts fresh each time.
export default function ScanTagModal({ onClose }) {
  const lookUp = usePlantLookup()
  const [scanning, setScanning] = useState(true)
  // What the last scan found: { plant } or { message }; null while scanning
  const [result, setResult] = useState(null)
  const [checking, setChecking] = useState(false)
  const scanLockedRef = useRef(false)

  async function handleScanned(data) {
    if (scanLockedRef.current) return
    scanLockedRef.current = true
    setScanning(false)
    setChecking(true)
    const found = await lookUp(data)
    setChecking(false)
    setResult(found)
  }

  function scanAnother() {
    setResult(null)
    scanLockedRef.current = false
    setScanning(true)
  }

  return (
    <Modal animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={styles.container}>
        <Text style={styles.heading}>Scan a plant tag</Text>
        <QrScanner scanning={scanning} onScan={handleScanned} />

        {checking ? <ActivityIndicator color={theme.colors.primary} accessibilityLabel="Checking" /> : null}
        {result ? (
          <View style={styles.card} accessibilityLiveRegion="polite">
            {result.plant ? (
              <>
                <Text style={styles.body}>Already registered: {result.plant.qr_code}</Text>
                <Text style={styles.status}>
                  {REVIEW_STATUS_LABELS[result.plant.review_status]}
                </Text>
              </>
            ) : (
              <Text style={styles.body}>{result.message}</Text>
            )}
          </View>
        ) : null}
        {result ? <Button title="Scan another" onPress={scanAnother} /> : null}
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
  status: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
    marginTop: theme.spacing.xs,
  },
})