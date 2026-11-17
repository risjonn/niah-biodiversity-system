import { StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import ContourPattern from './ContourPattern'
import { theme } from '../theme/theme'

// A screen title on a primary-coloured band with the contour pattern behind it (static). For
// screens without a navigation header (Home, Login).
// - title: the screen's heading
// - subtitle: an optional line under it
// - children: anything else to show on the band, under the subtitle
// - safeTop: pad the top for the status bar and notch, when the band is the first thing on screen
export default function HeaderBand({ title, subtitle, children, safeTop = false, style }) {
  const insets = useSafeAreaInsets()

  return (
    <View style={[styles.band, safeTop && { paddingTop: insets.top + theme.spacing.xl }, style]}>
      <ContourPattern />
      <Text style={styles.title} accessibilityRole="header">
        {title}
      </Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {children}
    </View>
  )
}

const styles = StyleSheet.create({
  band: {
    overflow: 'hidden',
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.xl,
    gap: theme.spacing.xs,
  },
  // White on the primary colour, about 6.9:1; the faint lines behind it only lighten it slightly
  title: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading1.fontSize,
    color: theme.colors.surfaceWhite,
  },
  subtitle: {
    fontFamily: 'Inter_400Regular',
    fontSize: theme.typography.body.fontSize,
    lineHeight: 22,
    color: theme.colors.surfaceWhite,
  },
})
