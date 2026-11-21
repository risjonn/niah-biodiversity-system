import { useEffect, useMemo, useState } from 'react'
import { Grid, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import {
  Bar,
  BarChart,
  BarStack,
  CartesianGrid,
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
import { deviceCodeLabel } from '../lib/alerts'
import {
  chartRanges,
  chartWindow,
  formatBucket,
  formatEveryThirdSarawakHour,
  formatSarawakDay,
  formatSarawakHour,
  lineTicks,
  nodeSeries,
  seriesWithReadings,
  toAverageRows,
  toDeviceAlertRows,
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

// A device alert code's severity (device_alert_codes, 018) as a mark beside its label on the
// Device alerts chart. Each severity has its own shape as well as its status colour, and its name
// is in the subtitle and the tooltip, so it never relies on colour alone.
const severityMarks = {
  CRITICAL: { label: 'Critical', shape: 'circle', color: tokens.error },
  WARNING: { label: 'Warning', shape: 'triangle', color: tokens.alert },
  INFO: { label: 'Info', shape: 'ring', color: tokens.textSecondary },
}
// Room for the longest code label ("Fire or canopy breach · 999") and its severity mark, in px
const DEVICE_ALERT_AXIS_WIDTH = 190
// Height per code on the Device alerts chart, and the least the chart is drawn at, in px
const DEVICE_ALERT_ROW_HEIGHT = 36
const DEVICE_ALERT_MIN_HEIGHT = 300

// Temperature, humidity, motion and device alert charts for the sensor dashboard. `nodes` is the
// page's sensor_node_latest rows: they give each node its name and colour. The readings come
// grouped by hour or day from report_sensor_chart (016); the device alerts are counted from the
// alerts raised in the same period (getDeviceAlertsInPeriod). They reload when the time range changes, whenever `refreshKey` changes (the page's Refresh button),
// and when the page's automatic refresh brings a newer reading (the newest last_received_at in
// `nodes` changes). Not on every automatic refresh: each reload makes the database group up to a
// week of readings again, which is wasted when nothing new has arrived. Each load's period ends at
// the moment it runs, so without the reload on new readings, anything that arrived after the page
// opened (even in the current hour) would be left out of the charts and sparklines.
// `onHourlyReadings` (optional, should be stable, e.g. a state setter) is called after each load
// with { rows, now }: the hourly rows and the time the period ends, or null if they failed to
// load. The page builds the node cards' sparklines from them, so they need no query of their own.
// `onThresholds` (optional, should be stable) is called once the alert limits load, with
// getAlertThresholds' { data, error }. The node cards' gauges shade each node's limits from it.
export default function SensorCharts({ nodes, refreshKey, onHourlyReadings, onThresholds }) {
  const { getChartReadings, getDeviceAlertsInPeriod, getAlertThresholds } = useSensors()
  const [range, setRange] = useState('24h')
  // Kept with the range and refresh it was loaded for, so a new range shows as loading rather
  // than showing the previous range's charts
  const [result, setResult] = useState(null)
  const [thresholds, setThresholds] = useState(null)
  const requestKey = `${range}|${refreshKey}`
  // When the server last got a reading from any node. A change means new readings, so the charts
  // reload in the background: the current charts stay on screen until the new ones are back,
  // rather than showing as loading on every new reading. It isn't part of requestKey for that reason.
  const newestReceivedAt = nodes.reduce(
    (newest, node) =>
      node.last_received_at && (!newest || node.last_received_at > newest) ? node.last_received_at : newest,
    null,
  )

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
    const deviceAlerts = getDeviceAlertsInPeriod(span)

    Promise.all([hourly, motion, deviceAlerts]).then(([hourlyResult, motionResult, deviceAlertsResult]) => {
      if (cancelled) return
      onHourlyReadings?.(hourlyResult.error ? null : { rows: hourlyResult.data, now: period.to })
      setResult({
        key: `${range}|${refreshKey}`,
        period,
        hourly: hourlyResult.data,
        motion: motionResult.data,
        error: hourlyResult.error ?? motionResult.error,
        // Kept apart, so a failure here doesn't take the reading charts down with it
        deviceAlerts: deviceAlertsResult.data,
        deviceAlertsError: deviceAlertsResult.error,
      })
    })
    return () => {
      cancelled = true
    }
    // newestReceivedAt isn't read inside: it is only here to reload when new readings arrive
  }, [range, refreshKey, newestReceivedAt, getChartReadings, getDeviceAlertsInPeriod, onHourlyReadings])

  // Loaded once: alert limits rarely change
  useEffect(() => {
    let cancelled = false
    getAlertThresholds().then((nextResult) => {
      if (cancelled) return
      setThresholds(nextResult)
      onThresholds?.(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [getAlertThresholds, onThresholds])

  const current = result?.key === requestKey ? result : null
  const seriesByNode = useMemo(
    () => nodeSeries(nodes, chartTokens.series, chartTokens.other),
    [nodes],
  )

  const deviceAlertChart = useMemo(() => {
    if (!current || current.deviceAlertsError) return null
    return toDeviceAlertRows(current.deviceAlerts, seriesByNode, deviceCodeLabel)
  }, [current, seriesByNode])

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
          <Typography variant="body2" color="textSecondary">
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
          <DeviceAlertsChart
            data={deviceAlertChart}
            range={range}
            loading={loading}
            error={current?.deviceAlertsError ?? null}
          />
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

// Device alerts raised in the period (alerts with alert_type device_alert, acknowledged or not),
// one horizontal bar per code, most raised first, stacked by node in the same colours as the other
// charts. Each code's label has its count after it, so the total reads without hovering, and its
// severity mark beside it. `data` is toDeviceAlertRows' { rows, series }, or null while loading or
// if it failed.
function DeviceAlertsChart({ data, range, loading, error }) {
  const rows = data?.rows ?? []
  const series = data?.series ?? []
  const rowsByCode = new Map(rows.map((row) => [row.code, row]))
  // Every code keeps a readable bar however many there are, up to all 16
  const height = Math.max(DEVICE_ALERT_MIN_HEIGHT, rows.length * DEVICE_ALERT_ROW_HEIGHT + 64)

  return (
    <ChartCard
      title="Device alerts"
      subtitle={`Alerts raised by the nodes themselves, ${chartRanges[range].label.toLowerCase()}, by code and node. The mark by each code is its severity: ● critical, ▲ warning, ○ info.`}
      loading={loading}
      error={error}
      empty={rows.length === 0}
      emptyMessage="No device alerts in this period."
      height={height}
    >
      <BarChart data={rows} layout="vertical" margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid horizontal={false} stroke={chartTokens.grid} />
        <XAxis type="number" allowDecimals={false} tick={tick} stroke={chartTokens.axis} />
        <YAxis
          type="category"
          dataKey="code"
          width={DEVICE_ALERT_AXIS_WIDTH}
          stroke={chartTokens.axis}
          tickLine={false}
          interval={0}
          tick={<DeviceCodeTick rowsByCode={rowsByCode} />}
        />
        <Tooltip
          {...tooltipStyle}
          cursor={{ fill: chartTokens.grid }}
          labelFormatter={(code) => {
            const row = rowsByCode.get(code)
            if (!row) return code
            const severity = severityMarks[row.severity]?.label
            return [row.label, severity ? `${severity} severity` : null, `${row.total} in total`]
              .filter(Boolean)
              .join(' · ')
          }}
        />
        <Legend {...legendProps} />
        {/* Rounds only the end of each stack, whichever node is last */}
        <BarStack radius={[0, chartTokens.barRadius, chartTokens.barRadius, 0]}>
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={s.color}
              maxBarSize={24}
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

// A code's label on the Device alerts chart: "Critical fall · 3", with its severity mark between
// the label and the bars. Recharts passes x and y (the tick's anchor, just left of the axis) and
// payload.value (the code).
function DeviceCodeTick({ x, y, payload, rowsByCode }) {
  const row = rowsByCode.get(payload.value)
  if (!row) return null
  const mark = severityMarks[row.severity]

  return (
    <g transform={`translate(${x},${y})`}>
      <text
        x={-16}
        dy="0.355em"
        textAnchor="end"
        fill={chartTokens.label}
        fontSize={chartTokens.fontSize.tick}
        fontFamily={chartTokens.fontFamily}
      >
        {row.label}
        <tspan fill={tokens.textPrimary} fontWeight={600}>
          {` · ${row.total}`}
        </tspan>
      </text>
      {mark ? <SeverityMark mark={mark} cx={-6} /> : null}
    </g>
  )
}

// A severityMarks entry drawn about 8 px across, centred on (cx, 0)
function SeverityMark({ mark, cx }) {
  const r = 4
  let shape = <circle cx={cx} cy={0} r={r} fill={mark.color} />
  if (mark.shape === 'triangle') {
    shape = <path d={`M${cx},${-r - 0.5} L${cx + r + 0.5},${r} L${cx - r - 0.5},${r} Z`} fill={mark.color} />
  } else if (mark.shape === 'ring') {
    shape = <circle cx={cx} cy={0} r={r - 0.75} fill="none" stroke={mark.color} strokeWidth={1.5} />
  }
  return (
    <g>
      <title>{`${mark.label} severity`}</title>
      {shape}
    </g>
  )
}
