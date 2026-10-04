// Shared by the data hooks in src/hooks/, which all resolve to { data, error } with `error` as a
// message ready to show on screen

// Messages for the Postgres/PostgREST errors any table can return. Each hook checks the codes that
// mean something specific for its own table first, then falls back to this.
export function queryErrorMessage(error) {
  switch (error.code) {
    // Request never reached the database (offline, server unreachable)
    case '':
    case undefined:
      return 'Unable to reach the server. Check your connection and try again.'
    // Row-level security refused the write
    case '42501':
      return 'Your account is not allowed to make this change.'
    // A NOT NULL column was left empty
    case '23502': {
      const column = error.message.match(/column "(\w+)"/)?.[1]
      return column ? `Missing a required value: ${column}.` : 'A required value is missing.'
    }
    // Malformed value, e.g. an id that isn't a UUID or a status outside the enum
    case '22P02':
      return 'One of the values is not in the right format.'
    default:
      return error.message
  }
}

// Runs a select made with { count: 'exact', head: true } and resolves to { data: count, error }.
// A head request gets no response body, so when the database refuses one the error has no code or
// message to go on. Only a network failure (code '') can be told apart from that.
export async function countResult(query) {
  const { count, error } = await query
  if (!error) return { data: count ?? 0, error: null }
  if (error.code === '') return { data: null, error: queryErrorMessage(error) }
  return { data: null, error: 'This total could not be loaded. Try refreshing the page.' }
}

// A PostgREST `or` filter matching rows where any of `columns` contains `search`, ignoring case,
// or null when there is nothing to search for. The search text is escaped so that %, _ and the
// characters PostgREST treats as filter syntax (commas, brackets, quotes) match literally.
export function containsAnyFilter(columns, search) {
  const term = search?.trim()
  if (!term) return null

  const pattern = term.replace(/[\\%_]/g, '\\$&')
  const quoted = `"%${pattern.replace(/[\\"]/g, '\\$&')}%"`
  return columns.map((column) => `${column}.ilike.${quoted}`).join(',')
}
