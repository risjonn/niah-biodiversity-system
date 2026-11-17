import { StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import Button from './Button'
import { theme } from '../theme/theme'

// What a list shows when it has nothing in it: an icon, one sentence and an optional button.
// - icon: an Ionicons name
// - message: the sentence
// - action: optional { title, onPress } for a button under it
export default function EmptyState({ icon = 'leaf-outline', message, action }) {
  return (
    <View style={styles.card}>
      <View style={styles.iconTile}>
        <Ionicons name={icon} size={28} color={theme.colors.primary} accessibilityElementsHidden />
      </View>
      <Text style={styles.message}>{message}</Text>
      {action ? (
        <View style={styles.action}>
          <Button title={action.title} onPress={action.onPress} />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.xl,
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },
  iconTile: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.colors.surface,
  },
  message: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    lineHeight: 22,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  action: {
    alignSelf: 'stretch',
  },
})
