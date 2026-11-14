# Design System

Shared design tokens for the mobile app (React Native) and web app (React + MUI).
Both apps pull from these same values so the product feels consistent across platforms.
Don't hardcode colours, fonts, or spacing in components, reference the theme instead.

## Palette — "Riverstone"

| Token             | Hex       | Use                                       |
|-------------------|-----------|-------------------------------------------|
| `primary`         | `#3F5F68` | Main actions, active nav, links           |
| `primaryDark`     | `#2E464D` | Hover/pressed states                      |
| `secondary`       | `#6F8F52` | Secondary actions, success accents        |
| `alert`           | `#D9A24B` | Warnings, IoT sensor alerts               |
| `error`           | `#C0392B` | Errors, rejected status                   |
| `success`         | `#4C7A3D` | Approved status (distinct from primary)   |
| `surface`         | `#F1F0EC` | Page/card background                      |
| `surfaceWhite`    | `#FFFFFF` | Card background on top of surface         |
| `textPrimary`     | `#22282A` | Main text                                 |
| `textSecondary`   | `#5C6669` | Muted/secondary text                      |
| `border`          | `#D8D6CF` | Dividers, input borders                   |
| `nearThreatened`  | `#5BC99E` | Near threatened status (chips and charts) |
| `criticallyEndangered` | `#751E26` | Critically endangered status (chips and charts) |

## Typography

Font: **Inter**

| Token         | Size | Weight | Use                          |
|---------------|------|--------|------------------------------|
| `heading1`    | 28px | 600    | Page titles                  |
| `heading2`    | 22px | 600    | Section headers              |
| `heading3`    | 18px | 500    | Card/subsection titles       |
| `body`        | 16px | 400    | Default text                 |
| `bodySmall`   | 14px | 400    | Secondary text, table cells  |
| `caption`     | 12px | 400    | Timestamps, hints, metadata  |

Only weights 400, 500, and 600 are used, avoid 300 (light) and 700 (bold).

## Spacing

Fixed scale, in px: `4, 8, 12, 16, 24, 32, 48`

## Other

- **Border radius**: `8px` default (cards, inputs, buttons), `16px`+ only for deliberately pill-shaped elements
- **Button height**: `44px` minimum (accessibility touch target)

## Where this lives in code

- Web: `web-app/src/theme/theme.js`
- Mobile: `mobile-app/src/theme/theme.js`
- Mobile shared components (Button, etc.): `mobile-app/src/components/`

## Usage

### Web (MUI)

Import tokens directly if you need raw values, or use MUI's `sx` prop with theme-aware shortcuts:

```jsx
import { Box, Typography, Button } from '@mui/material'

function Example() {
  return (
    <Box sx={{ p: 2, bgcolor: 'background.paper' }}>
      <Typography variant="h2">Heading</Typography>
      <Button variant="contained">Action</Button>
    </Box>
  )
}
```

MUI components automatically pick up colours, fonts, and border radius from the
theme, no need to import `tokens` directly unless you're styling something
outside MUI's components (a plain `<div>`, for example).

### Mobile (React Native)

Import the `theme` object and the shared `Button` component:

```js
import { View, Text, StyleSheet } from 'react-native'
import { theme } from '../theme/theme'
import Button from '../components/Button'

export default function Example() {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Heading</Text>
      <Button title="Action" onPress={() => {}} />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { padding: theme.spacing.lg },
  heading: {
    fontFamily: 'Inter_600SemiBold',
    fontSize: theme.typography.heading2.fontSize,
    color: theme.colors.textPrimary,
  },
})
```

## Charts

Every chart on web and mobile uses the same colours, type and card, so a chart reads the
same on both platforms.

| Platform | Library | Tokens | Card |
|----------|---------|--------|------|
| Web | [Recharts](https://recharts.github.io/) | `chartTokens` in `web-app/src/theme/theme.js` | `web-app/src/components/ChartCard.jsx` |
| Mobile | [react-native-gifted-charts](https://gifted-charts.netlify.app/) (draws with `react-native-svg`, works in Expo Go) | `theme.chart` in `mobile-app/src/theme/theme.js` | `mobile-app/src/components/ChartCard.js` |

Both token sets have the same names and values. Below, `series` means `chartTokens.series`
on web and `theme.chart.series` on mobile.

### Series colours

For charts where colour only tells series apart (species, sites, months). They are stronger
steps of the Riverstone hues, because the brand colours themselves are too grey to tell apart
in a chart.

| Slot | Hex       | From          |
|------|-----------|---------------|
| 1    | `#1288A1` | `primary`     |
| 2    | `#D39837` | `alert`       |
| 3    | `#3C6C2A` | `success`     |
| 4    | `#47AEC7` | `primary`, lighter |
| 5    | `#B63325` | `error`       |
| 6    | `#759E4C` | `secondary`   |
| `other` | `#9EA6A9` | grey, for the "Other" group |

- **Use the slots in order: `series[0]`, then `series[1]`, and so on. Never skip slots or start
  part-way through.** The order is what keeps neighbouring colours distinguishable for
  colour-blind readers, checked under simulated protanopia and deuteranopia.
- More than six series: keep the five biggest and group the rest as "Other" in `other`. Don't
  invent a seventh colour or reuse a slot.
- A series keeps its colour when filters change. If a species is slot 2 in one chart, keep it
  slot 2 in every chart on that page.
- Slots 2 and 4 are below 3:1 contrast on white. When you use them, show the values as data
  labels or in a table next to the chart.
- Scatter plots and maps, where any two colours can end up side by side: use at most the first
  three slots.
- Text (labels, values, legend text) uses the text colours, never a series colour.

### Status colours

When a chart is *about* a status, use these instead of the series colours. Never mix status
and series colours in one chart. The keys are the database enum values.

**Review status** (`reviewStatus`) uses the same colours as the status chips:

| Key              | Token     | Hex       |
|------------------|-----------|-----------|
| `approved`       | `success` | `#4C7A3D` |
| `pending_review` | `alert`   | `#D9A24B` |
| `rejected`       | `error`   | `#C0392B` |

Stack them in this order, so pending sits between approved and rejected. Approved green and
rejected red look alike to red-green colour-blind readers, so in a pie or donut, where they
touch, label every slice.

**Conservation status** (`conservationStatus`), least to most threatened:

| Key                     | Token                  | Hex       |
|-------------------------|------------------------|-----------|
| `least_concern`         | `success`              | `#4C7A3D` |
| `near_threatened`       | `nearThreatened`       | `#5BC99E` |
| `vulnerable`            | `alert`                | `#D9A24B` |
| `endangered`            | `error`                | `#C0392B` |
| `critically_endangered` | `criticallyEndangered` | `#751E26` |

The chips use the same colours: `ConservationStatusChip` on mobile, and
`conservationStatusChipColor()` on web, which maps to custom MUI palette colours for the two
statuses without a Riverstone colour of their own. Keep the order above. Every status is
distinguishable from the ones next to it, including for colour-blind readers. Near threatened is
a lighter, bluer green so it stays apart from both least concern and the amber of vulnerable.
Things to watch:

- Least concern and endangered (green and red) look alike to red-green colour-blind readers.
  They are never next to each other in this order, but in a pie or donut, label every slice.
- Near threatened and vulnerable are below 3:1 contrast on white, so show the values as data
  labels or in a table.
- Chip text is dark on near threatened and vulnerable, and white on the others.

### Axes, gridlines and text

| Token        | Value                      | Use                             |
|--------------|----------------------------|---------------------------------|
| `axis`       | `border` (`#D8D6CF`)       | Axis lines and tick marks       |
| `grid`       | `#E9E8E3`                  | Gridlines (horizontal only)     |
| `label`      | `textSecondary` (`#5C6669`)| Tick labels, legend text        |
| `barRadius`  | 4                          | Rounds the end of a bar away from the baseline |
| `fontFamily` | Inter                      | All chart text                  |
| `fontSize.tick`  | 12 (`caption`)         | Tick labels                     |
| `fontSize.label` | 14 (`bodySmall`)       | Axis titles, legend, tooltip    |

Keep axes and gridlines quiet: horizontal gridlines only, no chart border, no background
fill. Bars get `barRadius` on the end away from the baseline.

### ChartCard

Wrap every chart in `ChartCard`. It gives the chart a title, optional subtitle, and the
loading, error and empty states. The chart area keeps the same height in every state, so the
page doesn't jump when the data arrives.

| Prop           | Default                  | Notes |
|----------------|--------------------------|-------|
| `title`        | required                 | Card heading |
| `subtitle`     | none                     | One line under the title, e.g. the date range |
| `loading`      | `false`                  | Shows a spinner |
| `error`        | `null`                   | Message string; shown instead of the chart |
| `empty`        | `false`                  | Shows `emptyMessage` instead of the chart |
| `emptyMessage` | `'No data to show yet.'` | |
| `height`       | `300` web, `240` mobile  | Chart area height (minimum height on mobile) |
| `children`     | required                 | The chart. See each platform below |

#### Web

Pass one Recharts chart as the child. `ChartCard` wraps it in a `ResponsiveContainer`, so
don't set a width or height on the chart.

```jsx
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import ChartCard from '../components/ChartCard'
import { chartTokens } from '../theme/theme'

const tick = { fill: chartTokens.label, fontSize: chartTokens.fontSize.tick }

function RecordsByMonth({ result }) {
  return (
    <ChartCard
      title="Records by month"
      subtitle="Last 6 months"
      loading={!result}
      error={result?.error}
      empty={result?.data?.length === 0}
    >
      <BarChart data={result?.data}>
        <CartesianGrid vertical={false} stroke={chartTokens.grid} />
        <XAxis dataKey="month" tick={tick} stroke={chartTokens.axis} />
        <YAxis tick={tick} stroke={chartTokens.axis} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: chartTokens.fontSize.label }} />
        <Bar
          dataKey="count"
          name="Records"
          fill={chartTokens.series[0]}
          radius={[chartTokens.barRadius, chartTokens.barRadius, 0, 0]}
        />
      </BarChart>
    </ChartCard>
  )
}
```

Recharts colours legend text with the series colour by default. Keep it in the label colour,
so the coloured marker shows which series is which:

```jsx
<Legend
  wrapperStyle={{ fontSize: chartTokens.fontSize.label }}
  formatter={(value) => <span style={{ color: chartTokens.label }}>{value}</span>}
/>
```

#### Mobile

Gifted charts need a width in pixels, so pass a function as the child. `ChartCard` calls it
with the chart area's width once it has been measured.

```js
import { BarChart } from 'react-native-gifted-charts'
import ChartCard from '../components/ChartCard'
import { theme } from '../theme/theme'

const { chart } = theme
const tickStyle = {
  fontFamily: chart.fontFamily,
  fontSize: chart.fontSize.tick,
  color: chart.label,
}

function RecordsByStatus({ counts, loading, error }) {
  const data = Object.entries(chart.reviewStatus).map(([status, color]) => ({
    label: status === 'pending_review' ? 'Pending' : status[0].toUpperCase() + status.slice(1),
    value: counts?.[status] ?? 0,
    frontColor: color,
  }))

  return (
    <ChartCard
      title="Records by status"
      loading={loading}
      error={error}
      empty={!loading && data.every((item) => item.value === 0)}
    >
      {(width) => (
        <BarChart
          data={data}
          // Leave room for the y-axis labels
          width={width - theme.spacing.xxxl}
          barBorderTopLeftRadius={chart.barRadius}
          barBorderTopRightRadius={chart.barRadius}
          xAxisColor={chart.axis}
          yAxisColor={chart.axis}
          rulesColor={chart.grid}
          rulesType="solid"
          yAxisTextStyle={tickStyle}
          xAxisLabelTextStyle={tickStyle}
        />
      )}
    </ChartCard>
  )
}
```