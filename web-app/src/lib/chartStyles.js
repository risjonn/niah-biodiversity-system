import { chartTokens, theme, tokens } from '../theme/theme'

// Recharts styling shared by the dashboard and Species detail charts, from chartTokens (see
// "Charts" in docs/design-system.md)

export const chartTick = {
  fill: chartTokens.label,
  fontSize: chartTokens.fontSize.tick,
  fontFamily: chartTokens.fontFamily,
}

export const chartValueLabel = {
  fill: tokens.textPrimary,
  fontSize: chartTokens.fontSize.label,
  fontFamily: chartTokens.fontFamily,
}

// "1,234"
export function formatCount(value) {
  return Number(value).toLocaleString('en-MY')
}

// Tooltip text stays in the text colours; the series name says which bar it is
export const chartTooltipProps = {
  contentStyle: {
    fontSize: chartTokens.fontSize.label,
    fontFamily: chartTokens.fontFamily,
    borderColor: chartTokens.axis,
    borderRadius: theme.shape.borderRadius,
  },
  labelStyle: { color: tokens.textPrimary },
  itemStyle: { color: tokens.textPrimary },
  cursor: { fill: chartTokens.grid },
  formatter: (value) => formatCount(value),
}
