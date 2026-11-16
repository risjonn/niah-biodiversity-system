import {
  Box,
  Paper,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from '@mui/material'
import { visuallyHidden } from '../lib/visuallyHidden'

// Varied bar widths, so the placeholder rows look like text rather than a grid
const WIDTHS = ['70%', '45%', '85%', '60%', '75%']

// Placeholder rows shown while a table loads, in place of a spinner. Uses the table's real
// headings, so the page doesn't jump when the data arrives.
// - columns: heading strings, or { label, sx } to match a column's own styles (e.g. one hidden
//   below a breakpoint)
// - label: what screen readers hear while it loads, e.g. "Loading users"
// - outlined: false inside a panel that already has its own border
export default function TableSkeleton({ columns, label, rows = 5, size, outlined = true }) {
  const cells = columns.map((column) => (typeof column === 'string' ? { label: column } : column))

  return (
    <TableContainer
      component={outlined ? Paper : 'div'}
      variant={outlined ? 'outlined' : undefined}
      aria-busy="true"
    >
      <Box component="span" role="status" sx={visuallyHidden}>
        {label}
      </Box>
      <Table size={size} aria-hidden="true">
        <TableHead>
          <TableRow>
            {cells.map((cell, index) => (
              <TableCell key={index} sx={cell.sx}>
                {cell.label}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {Array.from({ length: rows }, (_, row) => (
            <TableRow key={row}>
              {cells.map((cell, index) => (
                <TableCell key={index} sx={cell.sx}>
                  <Skeleton width={WIDTHS[(row + index) % WIDTHS.length]} />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  )
}
