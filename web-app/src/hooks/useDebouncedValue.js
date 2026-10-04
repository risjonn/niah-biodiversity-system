import { useEffect, useState } from 'react'

// `value`, but only once it has stopped changing for `delay` ms. Used for search boxes so a query
// runs when the user pauses typing rather than on every keystroke.
export function useDebouncedValue(value, delay = 300) {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(timer)
  }, [value, delay])

  return debounced
}
