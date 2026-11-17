import { StyleSheet, Text, View } from 'react-native'
import { reviewStatusLabels } from '../lib/reviewStatus'
import { theme } from '../theme/theme'

// Chip background for each review_status, the same colours as the web app's status chips and the
// charts. A status not listed uses the neutral border colour.
const chipColors = theme.chart.reviewStatus

// Amber (pending) and the neutral border are too light for white text, so they use dark text,
// as the web chips do
const darkTextColors = [theme.colors.alert, theme.colors.border]

// A plant record's review status as a small coloured label. `status` is a review_status value.
export default function ReviewStatusChip({ status, style }) {
  const backgroundColor = chipColors[status] ?? theme.colors.border
  const color = darkTextColors.includes(backgroundColor)
    ? theme.colors.textPrimary
    : theme.colors.surfaceWhite

  return (
    <View style={[styles.chip, { backgroundColor }, style]}>
      <Text style={[styles.text, { color }]}>{reviewStatusLabels[status] ?? status}</Text>
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
