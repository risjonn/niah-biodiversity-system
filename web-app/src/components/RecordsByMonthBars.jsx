import { Bar, BarChart, BarStack, CartesianGrid, Legend, Tooltip, XAxis, YAxis } from 'recharts'
import { chartTick, chartTooltipProps } from '../lib/chartStyles'
import { STACKED_REVIEW_STATUSES } from '../lib/recordMonths'
import { formatMonth } from '../lib/reportExport'
import { reviewStatusLabels } from '../lib/reviewStatus'
import { chartTokens, tokens } from '../theme/theme'

// Plant records per month, stacked by review status, for a ChartCard (it sizes the chart).
// `data` is rows from lib/recordMonths.js. Up to 12 months the axis shows month names; past that
// it shows the year too, so months in different years can't be mixed up.
export default function RecordsByMonthBars({ data }) {
  const tickFormatter =
    data.length > 12 ? (value) => formatMonth(value) : (value) => formatMonth(value).split(' ')[0]

  return (
    <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid vertical={false} stroke={chartTokens.grid} />
      <XAxis dataKey="month" tick={chartTick} stroke={chartTokens.axis} tickFormatter={tickFormatter} />
      <YAxis tick={chartTick} stroke={chartTokens.axis} allowDecimals={false} width={40} />
      <Tooltip {...chartTooltipProps} labelFormatter={(value) => formatMonth(value)} />
      <Legend
        wrapperStyle={{ fontSize: chartTokens.fontSize.label, fontFamily: chartTokens.fontFamily }}
        formatter={(value) => <span style={{ color: chartTokens.label }}>{value}</span>}
      />
      {/* Rounds only the top of each month's stack, whichever status is on top */}
      <BarStack radius={[chartTokens.barRadius, chartTokens.barRadius, 0, 0]}>
        {STACKED_REVIEW_STATUSES.map((status) => (
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
  )
}
