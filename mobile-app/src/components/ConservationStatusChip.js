import { StyleSheet, Text, View } from 'react-native'
import { conservationStatusLabels } from '../lib/conservationStatus'
import { theme } from '../theme/theme'

// Chip background for each conservation_status. Statuses not listed use the neutral border colour.
const chipColors = {
  least_concern: theme.colors.success,
  near_threatened: theme.colors.secondary,
  vulnerable: theme.colors.alert,
  endangered: theme.colors.error,
  critically_endangered: theme.colors.error,
}

// The alert colour is too light for white text, so it (and the neutral chip) uses dark text
const darkTextColors = [theme.colors.alert, theme.colors.border]

// A species' conservation status as a small coloured label. `status` is a conservation_status value.
export default function ConservationStatusChip({ status, style }) {
  const backgroundColor = chipColors[status] ?? theme.colors.border
  const color = darkTextColors.includes(backgroundColor)
    ? theme.colors.textPrimary
    : theme.colors.surfaceWhite

  return (
    <View style={[styles.chip, { backgroundColor }, style]}>
      <Text style={[styles.text, { color }]}>{conservationStatusLabels[status] ?? status}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: theme.radius * 2,
  },
  text: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.caption.fontSize,
  },
})
