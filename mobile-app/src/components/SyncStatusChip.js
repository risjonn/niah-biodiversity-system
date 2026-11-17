import { StyleSheet, Text, View } from 'react-native'
import Ionicons from '@expo/vector-icons/Ionicons'
import { theme } from '../theme/theme'

const LABELS = {
  pending: 'Waiting to sync',
  syncing: 'Syncing…',
  failed: "Couldn't sync",
}

// A record still on the phone, in place of its review status chip. `status` is the queue status:
// 'pending', 'syncing' or 'failed'.
export default function SyncStatusChip({ status, style }) {
  const failed = status === 'failed'
  return (
    <View style={[styles.chip, failed && styles.chipFailed, style]}>
      <Ionicons
        name={failed ? 'alert-circle-outline' : 'cloud-upload-outline'}
        size={14}
        color={failed ? theme.colors.surfaceWhite : theme.colors.textPrimary}
        accessibilityElementsHidden
      />
      <Text style={[styles.text, failed && styles.textFailed]}>{LABELS[status] ?? LABELS.pending}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius * 2,
    backgroundColor: theme.colors.surface,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipFailed: {
    backgroundColor: theme.colors.error,
    borderColor: theme.colors.error,
  },
  text: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.caption.fontSize,
    color: theme.colors.textPrimary,
  },
  textFailed: {
    color: theme.colors.surfaceWhite,
  },
})
