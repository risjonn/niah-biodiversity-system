// sx for a clickable card that lifts slightly with a shadow on hover. Only on devices that can
// hover (a tap doesn't leave it lifted), and not at all when reduced motion is asked for.
// Shared by StatCard, the Plant review cards and the species gallery.
export function hoverLiftSx(theme) {
  return {
    transition: theme.transitions.create(['transform', 'box-shadow'], {
      duration: theme.transitions.duration.shorter,
    }),
    '@media (hover: hover)': {
      '&:hover': { transform: 'translateY(-2px)', boxShadow: theme.shadows[3] },
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      '&:hover': { transform: 'none' },
    },
  }
}
