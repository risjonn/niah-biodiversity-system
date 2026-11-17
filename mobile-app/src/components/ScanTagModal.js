import { useEffect, useRef, useState } from 'react'
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native'
import Button from './Button'
import QrScanner from './QRScanner'
import ReviewStatusChip from './ReviewStatusChip'
import ScientificName from './ScientificName'
import { usePlantLookup } from '../hooks/usePlantLookup'
import { useSpecies } from '../hooks/useSpecies'
import { theme } from '../theme/theme'

// Scan a tag as a signed-in botanist. Says whether the tag is already registered, and if so its
// species and review status. Render it only while open, so its state starts fresh each time.
export default function ScanTagModal({ onClose }) {
  const lookUp = usePlantLookup()
  const { fetchSpecies } = useSpecies()
  const [scanning, setScanning] = useState(true)
  // What the last scan found: { plant } or { message }; null while scanning
  const [result, setResult] = useState(null)
  const [checking, setChecking] = useState(false)
  // Species by id, for the name on the result. The list falls back to the copy saved on the phone.
  const [speciesById, setSpeciesById] = useState(null)
  const scanLockedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    fetchSpecies().then((speciesResult) => {
      if (!cancelled) setSpeciesById(new Map(speciesResult.data.map((species) => [species.id, species])))
    })
    return () => {
      cancelled = true
    }
    // fetchSpecies is a module function, the same on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const species = result?.plant ? speciesById?.get(result.plant.species_id) : null

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
                <Text style={styles.label}>Already registered</Text>
                {species ? (
                  <ScientificName style={styles.speciesName}>{species.scientific_name}</ScientificName>
                ) : (
                  <Text style={styles.speciesName}>Unknown species</Text>
                )}
                {species?.common_name ? <Text style={styles.commonName}>{species.common_name}</Text> : null}
                <View style={styles.meta}>
                  <ReviewStatusChip status={result.plant.review_status} />
                  <Text style={styles.qrCode} selectable>
                    {result.plant.qr_code}
                  </Text>
                </View>
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
    gap: theme.spacing.xs,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
    backgroundColor: theme.colors.surfaceWhite,
  },
  label: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textSecondary,
  },
  speciesName: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },
  commonName: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  qrCode: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textPrimary,
  },
  body: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
})
