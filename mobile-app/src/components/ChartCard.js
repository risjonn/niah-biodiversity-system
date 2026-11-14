import { useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { theme } from '../theme/theme'

// A card holding one chart, so every chart shares the same title, loading, error and empty
// states. Same props as web-app/src/components/ChartCard.jsx. `error` is a message string.
//
// `children` is a react-native-gifted-charts chart, or a function `(width) => chart`. Gifted
// charts need an explicit width in pixels, so the function form is called with the chart area's
// width once it has been measured. `height` is the chart area's minimum height, so the card
// keeps its size while loading.
export default function ChartCard({
  title,
  subtitle,
  loading = false,
  error = null,
  empty = false,
  emptyMessage = 'No data to show yet.',
  height = 240,
  children,
}) {
  const [width, setWidth] = useState(0)
  const showChart = !loading && !error && !empty

  let chart = null
  if (showChart) {
    if (typeof children !== 'function') chart = children
    else if (width > 0) chart = children(width)
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>

      <View
        style={[styles.body, { minHeight: height }, !showChart && styles.centered]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessibilityState={{ busy: loading }}
      >
        {loading ? (
          <ActivityIndicator color={theme.colors.primary} accessibilityLabel={`Loading ${title}`} />
        ) : null}
        {!loading && error ? (
          <Text style={styles.errorText} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {!loading && !error && empty ? <Text style={styles.emptyText}>{emptyMessage}</Text> : null}
        {chart}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    padding: theme.spacing.lg,
    gap: theme.spacing.lg,
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },
  header: {
    gap: theme.spacing.xs,
  },
  title: {
    fontFamily: 'Inter_500Medium',
    fontSize: theme.typography.heading3.fontSize,
    color: theme.colors.textPrimary,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
  },
  body: {
    width: '100%',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.error,
    textAlign: 'center',
  },
  emptyText: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.bodySmall.fontSize,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
})
