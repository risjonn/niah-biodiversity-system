import { createContext, useContext, useEffect, useState } from 'react'
import { AccessibilityInfo, Animated, StyleSheet, View } from 'react-native'
import { theme } from '../theme/theme'

// Loading placeholders: grey shapes where content is about to appear, pulsing gently. The pulse
// is off when the phone asks for reduced motion.

// The pulse every block inside one SkeletonGroup shares, so they fade together
const PulseContext = createContext(null)

// Wrap a set of SkeletonBlocks. Screen readers hear `label` (e.g. "Loading your records") once,
// instead of the blocks.
export function SkeletonGroup({ label, children, style }) {
  // Created once and kept for the life of the group
  const [opacity] = useState(() => new Animated.Value(1))

  useEffect(() => {
    let animation = null
    let cancelled = false
    AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled || reduceMotion) return
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(opacity, { toValue: 0.5, duration: 700, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 700, useNativeDriver: true }),
        ]),
      )
      animation.start()
    })
    return () => {
      cancelled = true
      animation?.stop()
    }
  }, [opacity])

  return (
    <PulseContext.Provider value={opacity}>
      <View
        style={style}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={label}
      >
        {children}
      </View>
    </PulseContext.Provider>
  )
}

// One grey shape. `width` and `height` in px (or a percentage string for width).
export function SkeletonBlock({ width = '100%', height = theme.typography.body.fontSize, radius = theme.radius / 2, style }) {
  const opacity = useContext(PulseContext) ?? 1
  return (
    <Animated.View
      style={[styles.block, { width, height, borderRadius: radius, opacity }, style]}
    />
  )
}

// Placeholder list rows: a square thumbnail and two lines of text, `count` times, in a card
export default function SkeletonRows({ count = 3, label = 'Loading' }) {
  return (
    <SkeletonGroup label={label} style={styles.card}>
      {Array.from({ length: count }, (_, index) => (
        <View key={index} style={[styles.row, index > 0 && styles.rowDivider]}>
          <SkeletonBlock width={THUMBNAIL_SIZE} height={THUMBNAIL_SIZE} radius={theme.radius} />
          <View style={styles.lines}>
            <SkeletonBlock width="70%" />
            <SkeletonBlock width="40%" height={theme.typography.caption.fontSize} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  )
}

// The same size as Home's record thumbnails, so nothing moves when they load
const THUMBNAIL_SIZE = 56

const styles = StyleSheet.create({
  block: {
    backgroundColor: theme.colors.border,
  },
  card: {
    backgroundColor: theme.colors.surfaceWhite,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.md,
    padding: theme.spacing.md,
  },
  rowDivider: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  lines: {
    flex: 1,
    gap: theme.spacing.sm,
  },
})
