import { useCallback, useEffect, useState } from 'react'
import { Grid, Stack } from '@mui/material'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlined'
import FactCheckOutlinedIcon from '@mui/icons-material/FactCheckOutlined'
import LocalFloristOutlinedIcon from '@mui/icons-material/LocalFloristOutlined'
import NotificationsActiveOutlinedIcon from '@mui/icons-material/NotificationsActiveOutlined'
import {
  Bar,
  BarChart,
  BarStack,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import PageHeader from '../components/PageHeader'
import ChartCard from '../components/ChartCard'
import StatCard from '../components/StatCard'
import { useAuth } from '../context/AuthContext'
import { usePlants } from '../hooks/usePlants'
import { useReports } from '../hooks/useReports'
import { useSensors } from '../hooks/useSensors'
import { useSpecies } from '../hooks/useSpecies'
import { conservationStatusLabels } from '../lib/conservationStatus'
import { formatMonth } from '../lib/reportExport'
import { roleLabels } from '../lib/roles'
import { chartTokens, theme, tokens } from '../theme/theme'

const MONTHS_SHOWN = 12

// review_status values in stacking order (approved at the bottom, pending between approved and
// rejected), see "Status colours" in docs/design-system.md
const REVIEW_STATUSES = Object.keys(chartTokens.reviewStatus)

const reviewStatusLabels = {
  approved: 'Approved',
  pending_review: 'Pending review',
  rejected: 'Rejected',
}

// Months are counted in Sarawak time, like report_records_by_month, so the chart's months line
// up with the function's whatever the viewer's own timezone is
const kuchingYearMonth = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kuching',
  year: 'numeric',
  month: '2-digit',
})

const tick = {
  fill: chartTokens.label,
  fontSize: chartTokens.fontSize.tick,
  fontFamily: chartTokens.fontFamily,
}

const valueLabel = {
  fill: tokens.textPrimary,
  fontSize: chartTokens.fontSize.label,
  fontFamily: chartTokens.fontFamily,
}

// Tooltip text stays in the text colours; the series name says which bar it is
const tooltipProps = {
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

// Recharts doesn't draw a bar with a value of 0, and so doesn't draw its value label either. Every
// status must show its value, so a 0 is drawn as a sliver on the baseline with "0" beside it.
const ZERO_BAR_SIZE = 2

export default function Dashboard() {
  const { fullName, role } = useAuth()
  const { countPendingReviews, countApprovedPlants } = usePlants()
  const { countSpecies, countSpeciesByConservationStatus } = useSpecies()
  const { countOpenAlerts } = useSensors()
  const { fetchRecordsByMonth } = useReports()

  // One call with no date range feeds both record charts: the last 12 months for the monthly
  // chart, and every month added up for the all-time review status breakdown
  const loadRecordCharts = useCallback(async () => {
    const result = await fetchRecordsByMonth({})
    if (result.error) return { data: null, error: result.error }
    return {
      data: {
        months: toMonthlyRows(result.data, lastMonthKeys(MONTHS_SHOWN)),
        statusTotals: toStatusTotals(result.data),
      },
      error: null,
    }
  }, [fetchRecordsByMonth])

  const recordCharts = useLoaded(loadRecordCharts)
  const conservation = useLoaded(countSpeciesByConservationStatus)

  return (
    <Stack spacing={4}>
      <PageHeader
        title={fullName ? `Welcome, ${fullName}` : 'Welcome'}
        subtitle={`Signed in as ${roleLabels[role]}`}
      />

      <Grid container spacing={3}>
        <CountCard
          title="Pending reviews for you"
          caption="Records by other people"
          to="/review"
          icon={FactCheckOutlinedIcon}
          color="warning"
          loadCount={countPendingReviews}
        />
        <CountCard
          title="Approved plants"
          caption="Visible to the public"
          to="/species"
          icon={CheckCircleOutlineIcon}
          color="success"
          loadCount={countApprovedPlants}
        />
        <CountCard
          title="Species"
          caption="In the catalogue"
          to="/species"
          icon={LocalFloristOutlinedIcon}
          color="secondary"
          loadCount={countSpecies}
        />
        <CountCard
          title="Open alerts"
          caption="Not yet acknowledged"
          to="/sensors"
          icon={NotificationsActiveOutlinedIcon}
          color="error"
          loadCount={countOpenAlerts}
        />
      </Grid>

      <Grid container spacing={3}>
        <Grid size={12}>
          <RecordsByMonthChart result={recordCharts} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ReviewStatusChart result={recordCharts} />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <ConservationStatusChart result={conservation} />
        </Grid>
      </Grid>
    </Stack>
  )
}

// Runs `load` (a stable function resolving to { data, error }) and resolves to its result, or
// null while it is still loading. Each card and chart loads on its own, so a slow or failed query
// doesn't hold up the others.
function useLoaded(load) {
  const [result, setResult] = useState(null)

  useEffect(() => {
    let cancelled = false
    load().then((nextResult) => {
      if (!cancelled) setResult(nextResult)
    })
    return () => {
      cancelled = true
    }
  }, [load])

  return result
}

// A clickable card showing one total, loaded on its own
function CountCard({ title, caption, to, icon, color, loadCount }) {
  const result = useLoaded(loadCount)

  return (
    <Grid size={{ xs: 12, sm: 6, md: 3 }}>
      <StatCard
        icon={icon}
        color={color}
        label={title}
        caption={caption}
        to={to}
        loading={!result}
        error={result?.error ?? null}
        value={result && !result.error ? formatCount(result.data) : null}
      />
    </Grid>
  )
}

// Plant records per month for the last 12 months, stacked by review status
function RecordsByMonthChart({ result }) {
  const months = result?.data?.months ?? []
  const subtitle =
    months.length > 0
      ? `Last ${MONTHS_SHOWN} months, ${formatMonth(months[0].month)} to ${formatMonth(months[months.length - 1].month)}`
      : `Last ${MONTHS_SHOWN} months`

  return (
    <ChartCard
      title="Records per month"
      subtitle={subtitle}
      loading={!result}
      error={result?.error}
      empty={months.every((row) => row.total === 0)}
      emptyMessage={`No plant records in the last ${MONTHS_SHOWN} months.`}
    >
      <BarChart data={months} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={chartTokens.grid} />
        <XAxis
          dataKey="month"
          tick={tick}
          stroke={chartTokens.axis}
          tickFormatter={(value) => formatMonth(value).split(' ')[0]}
        />
        <YAxis tick={tick} stroke={chartTokens.axis} allowDecimals={false} width={40} />
        <Tooltip {...tooltipProps} labelFormatter={(value) => formatMonth(value)} />
        <Legend
          wrapperStyle={{ fontSize: chartTokens.fontSize.label, fontFamily: chartTokens.fontFamily }}
          formatter={(value) => <span style={{ color: chartTokens.label }}>{value}</span>}
        />
        {/* Rounds only the top of each month's stack, whichever status is on top */}
        <BarStack radius={[chartTokens.barRadius, chartTokens.barRadius, 0, 0]}>
          {REVIEW_STATUSES.map((status) => (
            <Bar
              key={status}
              dataKey={status}
              name={reviewStatusLabels[status]}
              fill={chartTokens.reviewStatus[status]}
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

// Every plant record by review status, one labelled bar each
function ReviewStatusChart({ result }) {
  const rows = result?.data?.statusTotals ?? []

  return (
    <ChartCard
      title="Review status"
      subtitle="All plant records"
      loading={!result}
      error={result?.error}
      empty={rows.every((row) => row.count === 0)}
      emptyMessage="No plant records yet."
    >
      <StatusBarChart
        rows={rows}
        colors={chartTokens.reviewStatus}
        labels={reviewStatusLabels}
        labelWidth={110}
      />
    </ChartCard>
  )
}

// Species per conservation status, least concern to critically endangered
function ConservationStatusChart({ result }) {
  const rows = result?.data ?? []

  return (
    <ChartCard
      title="Species by conservation status"
      subtitle="Least concern to critically endangered"
      loading={!result}
      error={result?.error}
      empty={rows.every((row) => row.count === 0)}
      emptyMessage="No species in the database yet."
    >
      <StatusBarChart
        rows={rows}
        colors={chartTokens.conservationStatus}
        labels={conservationStatusLabels}
        labelWidth={150}
      />
    </ChartCard>
  )
}

// Horizontal bars, one per { status, count } row in the order given, coloured by status and
// with every value labelled at the end of its bar. Status names sit on the left, so the long
// conservation status names fit without wrapping.
function StatusBarChart({ rows, colors, labels, labelWidth }) {
  const data = rows.map((row) => ({ ...row, label: labels[row.status] ?? row.status }))

  return (
    <BarChart data={data} layout="vertical" margin={{ top: 0, right: 48, left: 0, bottom: 0 }}>
      {/* Every bar is labelled with its value, so the value axis would only repeat them */}
      <XAxis type="number" hide allowDecimals={false} />
      <YAxis
        type="category"
        dataKey="label"
        width={labelWidth}
        tick={tick}
        stroke={chartTokens.axis}
        tickLine={false}
      />
      <Tooltip {...tooltipProps} />
      <Bar
        dataKey="count"
        name="Total"
        maxBarSize={36}
        minPointSize={ZERO_BAR_SIZE}
        radius={[0, chartTokens.barRadius, chartTokens.barRadius, 0]}
      >
        {data.map((row) => (
          <Cell key={row.status} fill={colors[row.status] ?? chartTokens.other} />
        ))}
        <LabelList dataKey="count" position="right" formatter={formatCount} {...valueLabel} />
      </Bar>
    </BarChart>
  )
}

// The last `count` months up to and including the current one in Sarawak time, oldest first, as
// 'YYYY-MM' keys
function lastMonthKeys(count) {
  const parts = Object.fromEntries(
    kuchingYearMonth.formatToParts(new Date()).map((part) => [part.type, part.value]),
  )
  const year = Number(parts.year)
  const monthIndex = Number(parts.month) - 1
  // Date.UTC rolls a negative month back into the previous year
  return Array.from({ length: count }, (_, index) =>
    new Date(Date.UTC(year, monthIndex - (count - 1 - index), 1)).toISOString().slice(0, 7),
  )
}

// One row per month in `monthKeys`, with 0 for months that have no records. Rows from
// report_records_by_month outside those months are left out.
function toMonthlyRows(reportRows, monthKeys) {
  const byMonth = new Map(reportRows.map((row) => [row.record_month.slice(0, 7), row]))
  return monthKeys.map((key) => {
    const row = byMonth.get(key)
    const counts = Object.fromEntries(
      REVIEW_STATUSES.map((status) => [status, Number(row?.[status] ?? 0)]),
    )
    return { month: `${key}-01`, ...counts, total: Number(row?.total_records ?? 0) }
  })
}

// Every month added up into one { status, count } row per review status
function toStatusTotals(reportRows) {
  return REVIEW_STATUSES.map((status) => ({
    status,
    count: reportRows.reduce((sum, row) => sum + Number(row[status] ?? 0), 0),
  }))
}

function formatCount(value) {
  return Number(value).toLocaleString('en-MY')
}
