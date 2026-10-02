import { useState } from 'react'
import { View, Text, StyleSheet } from 'react-native'
import Button from '../components/Button'
import { usePlants } from '../hooks/usePlants'
import { theme } from '../theme/theme'

// TEMPORARY (issue #2): test values for checking usePlants end to end. Remove this, the test
// button and the result text below once #7-#9 build the real registration form.
// species_id is "Nepenthes ampullaria" (Test Pitcher Plant) in Supabase; the coordinates are
// roughly the Niah National Park HQ.
const TEST_PLANT = {
  species_id: 'fe3c006a-c54c-4482-9618-4bbeee58b233',
  height_cm: 42,
  morphological_notes: 'Test record from the usePlants test button',
  photo_url: null,
  latitude: 3.8155,
  longitude: 113.7814,
  location_description: 'Test location near park HQ',
}

export default function FieldRegistrationScreen() {
  const { submitPlant } = usePlants()
  // TEMPORARY (issue #2): test submission state, remove with the test button
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  async function handleTestSubmit() {
    if (submitting) return
    setSubmitting(true)
    setResult(await submitPlant(TEST_PLANT))
    setSubmitting(false)
  }

  return (
    <View style={styles.container}>
      <Text>Field registration — coming soon</Text>

      {/* TEMPORARY (issue #2): remove once #7-#9 build the real form */}
      <Button
        title={submitting ? 'Submitting…' : 'Submit test plant'}
        variant="secondary"
        onPress={handleTestSubmit}
      />
      {result?.data ? (
        <Text style={styles.success}>Saved. QR code: {result.data.qr_code}</Text>
      ) : null}
      {result?.error ? <Text style={styles.error}>{result.error}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.lg, gap: theme.spacing.lg },
  success: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.success,
  },
  error: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
  },
})
