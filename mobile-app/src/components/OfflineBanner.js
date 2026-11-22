import { StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import Button from './Button'
import { formatDateTime } from '../lib/sarawakTime'
import { theme } from '../theme/theme'

// Above a list showing data saved on the phone because the server couldn't be reached.
// - savedAt: optional ISO time the saved data was loaded
// - onRetry: loads again; retrying shows the button as busy
export default function OfflineBanner({ savedAt, onRetry, retrying = false }) {
  return (
    <View style={styles.banner} accessibilityRole="summary">
      <View style={styles.textRow}>
        <Ionicons
          name="cloud-offline-outline"
          size={20}
          color={theme.colors.textPrimary}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <View style={styles.text}>
          <Text style={styles.title} accessibilityLiveRegion="polite">
            Offline – showing saved data
          </Text>
          {savedAt ? <Text style={styles.detail}>Last updated {formatDateTime(savedAt)}</Text> : null}
        </View>
      </View>
      <Button
        title={retrying ? 'Retrying…' : 'Retry'}
        variant="secondary"
        onPress={onRetry}
        loading={retrying}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  // The alert colour as a left edge, on white so the text keeps full contrast
  banner: {
    gap: theme.spacing.md,
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderLeftWidth: theme.spacing.xs,
    borderLeftColor: theme.colors.alert,
    borderRadius: theme.radius,
  },
  textRow: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  text: {
    flex: 1,
    gap: theme.spacing.xs,
  },
  title: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.body.fontSize,
    color: theme.colors.textPrimary,
  },
  detail: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
})
