import { useEffect, useMemo, useState } from 'react'
import { Grid, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import {
  Bar,
  BarChart,
  BarStack,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import ChartCard from './ChartCard'
import { useSensors } from '../hooks/useSensors'
import {
  batteryLevel,
  chartRanges,
  chartWindow,
  formatBucket,
  formatEveryThirdSarawakHour,
  formatSarawakDay,
  formatSarawakHour,
  LOW_BATTERY_PERCENT,
  BATTERY_WARNING_PERCENT,
  lineTicks,
  nodeSeries,
  seriesWithReadings,
  toAverageRows,
  toMotionRows,
} from '../lib/sensorCharts'
import { chartTokens, theme, tokens } from '../theme/theme'

const HOUR_MS = 60 * 60 * 1000

const tick = {
  fill: chartTokens.label,
  fontSize: chartTokens.fontSize.tick,
  fontFamily: chartTokens.fontFamily,
}

// Tooltip text stays in the text colours; the series name says which node it is
const tooltipStyle = {
  contentStyle: {
    fontSize: chartTokens.fontSize.label,
    fontFamily: chartTokens.fontFamily,
    borderColor: chartTokens.axis,
    borderRadius: theme.shape.borderRadius,
  },
  labelStyle: { color: tokens.textPrimary },
  itemStyle: { color: tokens.textPrimary },
}

const legendProps = {
  wrapperStyle: { fontSize: chartTokens.fontSize.label, fontFamily: chartTokens.fontFamily },
  formatter: (value) => <span style={{ color: chartTokens.label }}>{value}</span>,
}

// Alert limits are reference marks, not data, so they are drawn in the label colour
const limitLine = {
  stroke: chartTokens.label,
  strokeDasharray: '6 4',
  ifOverflow: 'extendDomain',
}

const batteryColors = { low: tokens.error, warning: tokens.alert, ok: tokens.success }
const batteryLevelLabels = { low: 'Low', warning: 'Getting low', ok: null }

// Recharts doesn't draw a 0 bar, and so not its label either. A 0 % battery is drawn as a
// sliver on the baseline so its value still shows.
const ZERO_BAR_SIZE = 2

// Temperature, humidity, motion and battery charts for the sensor dashboard. `nodes` is the
// page's sensor_node_latest rows: they give each node its name and colour, and the battery chart
// its values. The readings come grouped by hour or day from report_sensor_chart (016). They
// reload when the time range changes and whenever `refreshKey` changes (the page's Refresh
// button), but not on the page's automatic refresh: hourly averages barely move in 15 seconds,
// and each reload makes the database group up to a week of readings again.
export default function SensorCharts({ nodes, refreshKey }) {
  const { getChartReadings, getAlertThresholds } = useSensors()
  const [range, setRange] = useState('24h')
  // Kept with the range and refresh it was loaded for, so a new range shows as loading rather
  // than showing the previous range's charts
  const [result, setResult] = useState(null)
  const [thresholds, setThresholds] = useState(null)
  const requestKey = `${range}|${refreshKey}`

  // Hourly rows feed the temperature and humidity lines, and motion for 24h. For 7d, motion is
  // per day, so a second, daily call runs alongside.
  useEffect(() => {
    let cancelled = false
    const period = chartWindow(range, Date.now())
    const span = {
      from: new Date(period.from).toISOString(),
      to: new Date(period.to).toISOString(),
    }
    const hourly = getChartReadings({ ...span, bucket: 'hour' })
    const motion =
      period.motionBucket === 'hour' ? hourly : getChartReadings({ ...span, bucket: period.motionBucket })

    Promise.all([hourly, motion]).then(([hourlyResult, motionResult]) => {
      if (cancelled) return
      setResult({
        key: `${range}|${refreshKey}`,
        period,
        hourly: hourlyResult.data,
        motion: motionResult.data,
        error: hourlyResult.error ?? motionResult.error,
      })
    })
    return () => {
      cancelled = true
    }
  }, [range, refreshKey, getChartReadings])

  // Loaded once: alert limits rarely change
  useEffect(() => {
    let cancelled = false
    getAlertThresholds().then((nextResult) => {
      if (!cancelled) setThresholds(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [getAlertThresholds])

  const current = result?.key === requestKey ? result : null
  const seriesByNode = useMemo(
    () => nodeSeries(nodes, chartTokens.series, chartTokens.other),
    [nodes],
  )

  const charts = useMemo(() => {
    if (!current || current.error) return null
    const { period, hourly, motion } = current
    return {
      period,
      series: seriesWithReadings(hourly, seriesByNode),
      temperature: toAverageRows(hourly, 'avg_temperature', period.lineBuckets, HOUR_MS, seriesByNode),
      humidity: toAverageRows(hourly, 'avg_humidity', period.lineBuckets, HOUR_MS, seriesByNode),
      motion: toMotionRows(motion, period.motionBuckets, period.motionBucketMs, seriesByNode),
    }
  }, [current, seriesByNode])

  const limits = limitsInfo(thresholds, nodes)
  const loading = !current
  const error = current?.error ?? null

  return (
    <Stack spacing={2}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={2}
        sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', sm: 'center' } }}
      >
        <Stack spacing={0.5}>
          <Typography variant="h2">Readings</Typography>
          <Typography variant="body2" color="text.secondary">
            Times are Sarawak time (UTC+8).
          </Typography>
        </Stack>
        <ToggleButtonGroup
          exclusive
          value={range}
          // Clicking the selected option gives null; keep the current range instead
          onChange={(_event, value) => {
            if (value) setRange(value)
          }}
          aria-label="Time range"
        >
          {Object.entries(chartRanges).map(([value, { label }]) => (
            <ToggleButton key={value} value={value} sx={{ textTransform: 'none' }}>
              {label}
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
      </Stack>

      <Grid container spacing={3}>
        <Grid size={12}>
          <MeasurementChart
            title="Temperature"
            unit="°C"
            rows={charts?.temperature}
            charts={charts}
            loading={loading}
            error={error}
            limits={limits.global && [limits.global.temperature_min, limits.global.temperature_max]}
            limitsNote={limits.note}
            padding={1}
          />
        </Grid>
        <Grid size={12}>
          <MeasurementChart
            title="Humidity"
            unit="%"
            rows={charts?.humidity}
            charts={charts}
            loading={loading}
            error={error}
            limits={limits.global && [limits.global.humidity_min, limits.global.humidity_max]}
            limitsNote={limits.note}
            padding={5}
            max={100}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <MotionChart charts={charts} range={range} loading={loading} error={error} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <BatteryChart nodes={nodes} />
        </Grid>
      </Grid>
    </Stack>
  )
}

// The global limits for the reference lines, and a note for the subtitle. Nodes with their own
// limits are named, because the dashed lines don't apply to them.
function limitsInfo(thresholds, nodes) {
  if (!thresholds) return { global: null, note: null }
  if (thresholds.error) return { global: null, note: 'Alert limits could not be loaded.' }

  const global = thresholds.data.find((row) => row.sensor_node_id == null) ?? null
  const ownLimits = thresholds.data
    .filter((row) => row.sensor_node_id != null)
    .map((row) => nodes.find((node) => node.id === row.sensor_node_id)?.node_identifier)
    .filter(Boolean)
    .sort()

  const parts = []
  if (global) parts.push('Dashed lines are the default alert limits.')
  if (ownLimits.length > 0) {
    parts.push(
      `${ownLimits.join(', ')} ${ownLimits.length === 1 ? 'has its' : 'have their'} own limits, not shown.`,
    )
  }
  return { global, note: parts.join(' ') || null }
}

// Hourly average per node as one line each, with the alert limits as dashed lines
function MeasurementChart({ title, unit, rows, charts, loading, error, limits, limitsNote, padding, max }) {
  const series = charts?.series ?? []
  const hasValues = Boolean(rows?.some((row) => series.some((s) => row[s.key] != null)))
  const period = charts?.period
  const isDays = period?.range === '7d'

  return (
    <ChartCard
      title={title}
      subtitle={['Hourly average per node.', limitsNote].filter(Boolean).join(' ')}
      loading={loading}
      error={error}
      empty={!hasValues}
      emptyMessage={`No ${title.toLowerCase()} readings in this period.`}
    >
      <LineChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={chartTokens.grid} />
        <XAxis
          dataKey="time"
          type="number"
          scale="time"
          domain={period ? [period.lineBuckets[0], period.lineBuckets.at(-1)] : undefined}
          ticks={period ? lineTicks(period) : undefined}
          tickFormatter={isDays ? formatSarawakDay : formatSarawakHour}
          tick={tick}
          stroke={chartTokens.axis}
        />
        <YAxis
          tick={tick}
          stroke={chartTokens.axis}
          unit={` ${unit}`}
          width={64}
          allowDecimals={false}
          domain={[
            (dataMin) => Math.floor(dataMin - padding),
            (dataMax) => Math.min(max ?? Infinity, Math.ceil(dataMax + padding)),
          ]}
        />
        <Tooltip
          {...tooltipStyle}
          cursor={{ stroke: chartTokens.axis }}
          labelFormatter={(time) => formatBucket(time, HOUR_MS)}
          formatter={(value) => `${value} ${unit}`}
        />
        <Legend {...legendProps} />
        {limits ? (
          <>
            {/* A max at the chart's ceiling (humidity at 100 %) can't be passed, so it isn't drawn */}
            {max == null || Number(limits[1]) < max ? (
              <ReferenceLine
                y={Number(limits[1])}
                {...limitLine}
                label={limitLabel(`Max ${Number(limits[1])} ${unit}`, 'insideTopRight')}
              />
            ) : null}
            <ReferenceLine
              y={Number(limits[0])}
              {...limitLine}
              label={limitLabel(`Min ${Number(limits[0])} ${unit}`, 'insideBottomRight')}
            />
          </>
        ) : null}
        {series.map((s) => (
          <Line
            key={s.key}
            type="linear"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            // A gap means no readings that hour, so the line breaks instead of bridging it
            connectNulls={false}
            dot={isolatedPointDot(rows, s.key, s.color)}
            activeDot={{ r: 4, stroke: tokens.surfaceWhite, strokeWidth: 2 }}
          />
        ))}
      </LineChart>
    </ChartCard>
  )
}

function limitLabel(value, position) {
  return { value, position, fill: chartTokens.label, fontSize: chartTokens.fontSize.tick }
}

// Lines have no dots, except for an hour with no reading on either side, which would otherwise
// not show at all
function isolatedPointDot(rows, key, color) {
  return function renderDot({ cx, cy, index }) {
    const isolated =
      rows?.[index]?.[key] != null &&
      rows?.[index - 1]?.[key] == null &&
      rows?.[index + 1]?.[key] == null
    if (!isolated || cx == null || cy == null) return <g key={`${key}-${index}`} />
    return <circle key={`${key}-${index}`} cx={cx} cy={cy} r={3} fill={color} />
  }
}

// Readings with motion per hour (24h) or per day (7d), stacked by node
function MotionChart({ charts, range, loading, error }) {
  const series = charts?.series ?? []
  const rows = charts?.motion ?? []
  const bucketMs = charts?.period.motionBucketMs ?? HOUR_MS
  const isDays = range === '7d'

  return (
    <ChartCard
      title="Motion events"
      subtitle={`Readings with motion detected, ${chartRanges[range].motionLabel}, by node.`}
      loading={loading}
      error={error}
      empty={rows.every((row) => row.total === 0)}
      emptyMessage="No motion detected in this period."
    >
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={chartTokens.grid} />
        <XAxis
          dataKey="time"
          tick={tick}
          stroke={chartTokens.axis}
          interval={0}
          tickLine={false}
          // 24 hourly bars are too many to label, so only every third hour is
          tickFormatter={(time) =>
            isDays ? formatSarawakDay(time) : formatEveryThirdSarawakHour(time)
          }
        />
        <YAxis tick={tick} stroke={chartTokens.axis} allowDecimals={false} width={40} />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: chartTokens.grid }}
          labelFormatter={(time) => formatBucket(time, bucketMs)}
        />
        <Legend {...legendProps} />
        {/* Rounds only the top of each stack, whichever node is on top */}
        <BarStack radius={[chartTokens.barRadius, chartTokens.barRadius, 0, 0]}>
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={s.color}
              // A thin gap between stacked segments keeps neighbouring colours apart
              stroke={tokens.surfaceWhite}
              strokeWidth={1}
            />
          ))}
        </BarStack>
      </BarChart>
    </ChartCard>
  )
}

// The latest battery level of each active node, from the page's node list
function BatteryChart({ nodes }) {
  const active = nodes.filter((node) => node.is_active)
  const rows = active
    .filter((node) => node.battery_level != null)
    .map((node) => {
      const percent = Number(node.battery_level)
      return { id: node.id, name: node.node_identifier, percent, level: batteryLevel(percent) }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const missing = active.length - rows.length

  const subtitle = [
    `Active nodes. Below ${BATTERY_WARNING_PERCENT} % is getting low, below ${LOW_BATTERY_PERCENT} % is low.`,
    missing > 0 ? `${missing} ${missing === 1 ? 'node has' : 'nodes have'} not reported a level.` : null,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <ChartCard
      title="Battery level"
      subtitle={subtitle}
      empty={rows.length === 0}
      emptyMessage="No active node has reported a battery level yet."
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
        {/* Every bar is labelled with its value, so the value axis would only repeat them */}
        <XAxis type="number" hide domain={[0, 100]} />
        <YAxis
          type="category"
          dataKey="name"
          width={110}
          tick={tick}
          stroke={chartTokens.axis}
          tickLine={false}
        />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: chartTokens.grid }}
          formatter={(value) => `${formatPercent(value)} %`}
        />
        <Bar
          dataKey="percent"
          name="Battery"
          maxBarSize={36}
          minPointSize={ZERO_BAR_SIZE}
          radius={[0, chartTokens.barRadius, chartTokens.barRadius, 0]}
        >
          {rows.map((row) => (
            <Cell key={row.id} fill={batteryColors[row.level]} />
          ))}
          {/* The level is written out too, so it never relies on colour alone */}
          <LabelList
            dataKey="percent"
            position="right"
            formatter={(value) =>
              [`${formatPercent(value)} %`, batteryLevelLabels[batteryLevel(value)]]
                .filter(Boolean)
                .join(' · ')
            }
            fill={tokens.textPrimary}
            fontSize={chartTokens.fontSize.label}
            fontFamily={chartTokens.fontFamily}
          />
        </Bar>
      </BarChart>
    </ChartCard>
  )
}

function formatPercent(value) {
  return Number(value).toLocaleString('en-MY', { maximumFractionDigits: 0 })
}
