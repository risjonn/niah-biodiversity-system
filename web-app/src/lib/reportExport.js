import { conservationStatusLabels } from './conservationStatus'
import { formatDate, formatDateTime } from './formatDateTime'
import { tokens } from '../theme/theme'

// Shared by the reports page and its CSV and PDF exports, so all three always show the same
// columns. Each column's format(row) gives a number, a string, or null for "no value"; the page
// shows null as '—' and the exports leave it empty. A column with display(row) shows that on the
// page instead, while the exports still use format(row). Numbers stay numbers (units are in the label)
// so spreadsheets can still sum them and a negative temperature isn't mistaken for a formula.

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Reports are about Niah, so times read the same wherever the viewer's browser is
const kuchingDateTime = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Kuching',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

// e.g. "16 Oct 2026, 14:30". Built from parts so it doesn't depend on how a browser punctuates en-GB.
export function formatKuchingDateTime(value) {
  if (value == null) return null
  const parts = Object.fromEntries(
    kuchingDateTime.formatToParts(new Date(value)).map((part) => [part.type, part.value]),
  )
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`
}

// 'YYYY-MM-DD' to "Oct 2026". Read straight from the string: new Date() would parse it as UTC
// midnight, which is the previous month in any timezone west of UTC.
export function formatMonth(date) {
  if (!date) return null
  const [year, month] = date.split('-')
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`
}

// 'YYYY-MM-DD' to "16 Oct 2026", for the date pickers' plain calendar days
function formatDay(date) {
  const [year, month, day] = date.split('-')
  return `${Number(day)} ${MONTH_NAMES[Number(month) - 1]} ${year}`
}

// Checked before Number(), which turns null into 0. PostgREST can send numeric columns as strings.
function toNumber(value) {
  return value == null ? null : Number(value)
}

// PDF column widths in mm, sized for the 8 pt table text and its 1.5 mm cell padding. A column
// without pdfWidth shares the width that is left (text columns, which can wrap). The PDF puts a
// unit in brackets on its own header line, so these only need to fit the longest other line.
const PDF_COUNT_WIDTH = 18 // "Approved"
const PDF_DATE_WIDTH = 23 // "First recorded" over "28 Sep 2026"
const PDF_DATE_TIME_WIDTH = 27.5 // "16 Oct 2026, 14:30" on one line

function textColumn(key, label) {
  return { key, label, format: (row) => row[key] ?? null }
}

function numberColumn(key, label, { pdfWidth = PDF_COUNT_WIDTH } = {}) {
  return { key, label, numeric: true, format: (row) => toNumber(row[key]), pdfWidth }
}

// format() is the export value ("16 Oct 2026, 14:30"). The page shows display() instead, in the
// app's date format: "16 Oct 2026, 2:30 pm", or "16 Oct 2026" with dateOnly to save width. With
// dateOnly the PDF also shows the date only (pdfFormat), like the page; the CSV keeps the time.
function dateTimeColumn(key, label, { dateOnly = false } = {}) {
  const formatForPage = dateOnly ? formatDate : formatDateTime
  return {
    key,
    label,
    format: (row) => formatKuchingDateTime(row[key]),
    display: (row) => formatForPage(row[key]),
    ...(dateOnly ? { pdfFormat: (row) => formatDate(row[key]) } : {}),
    pdfWidth: dateOnly ? PDF_DATE_WIDTH : PDF_DATE_TIME_WIDTH,
    noWrap: true,
  }
}

export const speciesSummaryReport = {
  title: 'Species summary',
  filePrefix: 'niah-species-summary',
  columns: [
    textColumn('scientific_name', 'Scientific name'),
    textColumn('common_name', 'Common name'),
    textColumn('family', 'Family'),
    {
      key: 'conservation_status',
      label: 'Conservation status',
      format: (row) =>
        conservationStatusLabels[row.conservation_status] ?? row.conservation_status ?? null,
    },
    numberColumn('total_records', 'Total'),
    numberColumn('approved', 'Approved'),
    numberColumn('pending_review', 'Pending'),
    numberColumn('rejected', 'Rejected'),
    dateTimeColumn('first_recorded_at', 'First recorded', { dateOnly: true }),
    dateTimeColumn('last_recorded_at', 'Last recorded', { dateOnly: true }),
  ],
}

export const recordsByMonthReport = {
  title: 'Records by month',
  filePrefix: 'niah-records-by-month',
  columns: [
    {
      key: 'record_month',
      label: 'Month',
      format: (row) => formatMonth(row.record_month),
      pdfWidth: 22, // "Sep 2026"
    },
    numberColumn('total_records', 'Total'),
    numberColumn('approved', 'Approved'),
    numberColumn('pending_review', 'Pending'),
    numberColumn('rejected', 'Rejected'),
  ],
}

export const sensorSummaryReport = {
  title: 'Sensor summary',
  filePrefix: 'niah-sensor-summary',
  columns: [
    textColumn('node_identifier', 'Node'),
    textColumn('plant_qr_code', 'Plant QR'),
    textColumn('scientific_name', 'Species'),
    // Narrower than the record tables' counts so the 14 columns fit beside the node and species.
    // Motion events and High alerts wrap onto two header lines, like the units do.
    numberColumn('readings', 'Readings', { pdfWidth: 16.5 }),
    numberColumn('avg_temperature', 'Avg temp (°C)', { pdfWidth: 16.5 }),
    numberColumn('min_temperature', 'Min temp (°C)', { pdfWidth: 16.5 }),
    numberColumn('max_temperature', 'Max temp (°C)', { pdfWidth: 16.5 }),
    numberColumn('avg_humidity', 'Avg humidity (%)', { pdfWidth: 21.5 }),
    numberColumn('min_humidity', 'Min humidity (%)', { pdfWidth: 21.5 }),
    numberColumn('max_humidity', 'Max humidity (%)', { pdfWidth: 21.5 }),
    numberColumn('motion_events', 'Motion events', { pdfWidth: 13 }),
    numberColumn('alerts', 'Alerts', { pdfWidth: 12 }),
    numberColumn('high_alerts', 'High alerts', { pdfWidth: 13 }),
    dateTimeColumn('last_reading_at', 'Last reading'),
  ],
}

// e.g. "niah-species-summary_2026-10-01_to_today.csv" or "niah-species-summary_all-dates.csv"
export function reportFilename(prefix, { from, to }, extension) {
  const range = from || to ? `${from || 'start'}_to_${to || 'today'}` : 'all-dates'
  return `${prefix}_${range}.${extension}`
}

function describeRange({ from, to }) {
  if (from && to) return `${formatDay(from)} to ${formatDay(to)}`
  if (from) return `From ${formatDay(from)}`
  if (to) return `Up to ${formatDay(to)}`
  return 'All dates'
}

// Long enough for the browser to start the download before the URL stops working
const OBJECT_URL_LIFETIME_MS = 1000

export function downloadCsv(filename, columns, rows) {
  const lines = [
    columns.map((column) => csvField(column.label)),
    ...rows.map((row) => columns.map((column) => csvField(column.format(row)))),
  ].map((fields) => fields.join(','))

  // The BOM tells Excel the file is UTF-8, otherwise it misreads characters like ° and accents
  const blob = new Blob(['﻿', lines.join('\r\n'), '\r\n'], {
    type: 'text/csv;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoking straight after click() can cancel the download in some browsers
  setTimeout(() => URL.revokeObjectURL(url), OBJECT_URL_LIFETIME_MS)
}

function csvField(value) {
  if (value == null) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''

  let text = String(value)
  // Spreadsheets run text starting with these as a formula (CSV injection), so make it plain text
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

// Page layout in mm, A4 landscape: the sensor summary's 14 columns don't fit portrait, and one
// orientation keeps every table, header and footer in the same place on every page
const PDF_MARGIN = 14
// Room under the tables for the footer, which sits PDF_FOOTER_OFFSET above the page edge
const PDF_MARGIN_BOTTOM = 18
const PDF_FOOTER_OFFSET = 9
const PDF_SECTION_GAP = 12
// Below this much room left, a section heading starts on a new page instead of sitting alone
const PDF_MIN_SECTION_SPACE = 30
const PDF_TITLE = 'Niah Biodiversity Report'

// The same for all three tables, so their rows, header bands and padding match
const PDF_FONT_SIZE = 8
const PDF_CELL_PADDING = 1.5
const PDF_HEADER_LINES = 2

// "Avg temp (°C)" to "Avg temp\n(°C)": every unit sits on its own header line, the same way in
// every column, instead of wherever the column width happens to break the label
function pdfLabel(label) {
  return label.replace(/ (\([^)]*\))$/, '\n$1')
}

// Text columns left, numbers right. columnStyles only reaches body cells, so header cells carry
// their own alignment to sit directly above their numbers.
function pdfTable(columns, rows) {
  const halign = (column) => (column.numeric ? 'right' : 'left')
  return {
    head: [columns.map((column) => ({ content: pdfLabel(column.label), styles: { halign: halign(column) } }))],
    body: rows.map((row) => columns.map((column) => (column.pdfFormat ?? column.format)(row) ?? '')),
    columnStyles: Object.fromEntries(
      columns.map((column, index) => [index, { halign: halign(column), cellWidth: column.pdfWidth ?? 'auto' }]),
    ),
    // A table whose columns all have widths (records by month) is only as wide as they add up
    // to, so its numbers sit under their headers instead of being spread across the page. The
    // others fill the width between the margins.
    tableWidth: columns.every((column) => column.pdfWidth != null)
      ? columns.reduce((total, column) => total + column.pdfWidth, 0)
      : 'auto',
  }
}

export async function downloadReportPdf({ from, to, speciesRows, monthRows, sensorRows }) {
  // Loaded only when someone downloads a PDF, so they stay out of the main bundle
  const [{ jsPDF }, { autoTable }] = await Promise.all([
    import('jspdf'),
    import('jspdf-autotable'),
  ])

  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const period = `Period: ${describeRange({ from, to })}`
  const generated = `Generated: ${formatKuchingDateTime(new Date())}`
  // Every header row is two lines tall, the most any label takes, so the bands match
  const lineHeight = (PDF_FONT_SIZE * doc.getLineHeightFactor()) / doc.internal.scaleFactor
  const headerHeight = PDF_HEADER_LINES * lineHeight + 2 * PDF_CELL_PADDING

  doc.setTextColor(tokens.textPrimary)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(18)
  doc.text(PDF_TITLE, PDF_MARGIN, 18)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(period, PDF_MARGIN, 26)
  doc.text(generated, PDF_MARGIN, 32)

  const sections = [
    { report: speciesSummaryReport, rows: speciesRows },
    { report: recordsByMonthReport, rows: monthRows },
    { report: sensorSummaryReport, rows: sensorRows },
  ]

  let y = 32 + PDF_SECTION_GAP
  for (const { report, rows } of sections) {
    if (y > pageHeight - PDF_MARGIN_BOTTOM - PDF_MIN_SECTION_SPACE) {
      doc.addPage()
      y = PDF_MARGIN + 4
    }

    doc.setTextColor(tokens.textPrimary)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.text(report.title, PDF_MARGIN, y)

    if (rows.length === 0) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.text('No data for this period', PDF_MARGIN, y + 7)
      y += 7 + PDF_SECTION_GAP
      continue
    }

    autoTable(doc, {
      ...pdfTable(report.columns, rows),
      startY: y + 3,
      margin: { top: PDF_MARGIN, right: PDF_MARGIN, bottom: PDF_MARGIN_BOTTOM, left: PDF_MARGIN },
      styles: {
        font: 'helvetica',
        fontSize: PDF_FONT_SIZE,
        cellPadding: PDF_CELL_PADDING,
        textColor: tokens.textPrimary,
        valign: 'top',
      },
      // Labels sit on the band's bottom line, right above the first row's values
      headStyles: {
        fillColor: tokens.primary,
        textColor: tokens.surfaceWhite,
        fontStyle: 'bold',
        valign: 'bottom',
        minCellHeight: headerHeight,
      },
    })
    y = doc.lastAutoTable.finalY + PDF_SECTION_GAP
  }

  // Drawn last, once the page count is known
  const pageCount = doc.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page)
    doc.setTextColor(tokens.textSecondary)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(PDF_FONT_SIZE)
    const footerY = pageHeight - PDF_FOOTER_OFFSET
    doc.text(`${PDF_TITLE}  ·  ${period}  ·  ${generated}`, PDF_MARGIN, footerY)
    doc.text(`Page ${page} of ${pageCount}`, pageWidth - PDF_MARGIN, footerY, { align: 'right' })
  }

  doc.save(reportFilename('niah-biodiversity-report', { from, to }, 'pdf'))
}
