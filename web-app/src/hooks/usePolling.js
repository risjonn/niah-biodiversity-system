import { useEffect, useLayoutEffect, useRef } from 'react'

// How often the alert lists, the open alerts card and the sidebar badge reload while their page
// is open and the browser tab is visible
export const POLL_INTERVAL_MS = 5 * 1000

// Runs `poll` once on mount, then again `intervalMs` after each run finishes, for as long as the
// component is mounted.
// - A new run never starts while the previous one is still going: the next one is only scheduled
//   once it has finished.
// - While the browser tab is hidden nothing is scheduled. Coming back to the tab polls at once,
//   since the data may be well out of date by then.
// - `poll` needn't be stable: the latest one is kept in a ref, and the timer and listener are only
//   set up on mount (or if `intervalMs` changes), so a re-render never triggers an extra fetch.
// - `poll` is called with { isCurrent }: isCurrent() is false once the component has unmounted, so
//   it can skip setting state from a late answer.
// - A poll that throws is logged and polling carries on. Polls should catch their own errors and
//   show them (the hooks in hooks/ resolve to { data, error } rather than throwing).
export function usePolling(poll, intervalMs = POLL_INTERVAL_MS) {
  const pollRef = useRef(poll)

  // Before the effect below, so the first poll is already the latest function
  useLayoutEffect(() => {
    pollRef.current = poll
  })

  useEffect(() => {
    let timer = null
    let running = false
    let unmounted = false
    const isCurrent = () => !unmounted

    async function run() {
      timer = null
      if (running) return
      running = true
      try {
        await pollRef.current({ isCurrent })
      } catch (error) {
        console.error('Polling failed', error)
      } finally {
        running = false
      }
      if (!unmounted && !document.hidden) timer = setTimeout(run, intervalMs)
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        clearTimeout(timer)
        timer = null
      } else if (!timer && !running) {
        run()
      }
    }

    // The first load runs even in a hidden tab, so the page has data when it is shown
    run()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      unmounted = true
      clearTimeout(timer)
      timer = null
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [intervalMs])
}
