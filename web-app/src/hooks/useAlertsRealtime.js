import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

// Events arriving within this long of the first one cause a single onChange call
const BATCH_WINDOW_MS = 500

// Every subscription gets a channel name of its own. supabase.channel(name) hands back the
// existing channel when that name is still registered, so reusing one (two components on the same
// page, resubscribing after the tab is shown, or React's dev double-mount) could pick up a channel
// that is being removed.
let channelCount = 0

// Calls `onChange` soon after an alert is added or changed (acknowledged), through a Supabase
// Realtime subscription on public.alerts (database/schema/022). Returns the connection status:
// 'connecting', 'live' (subscribed) or 'offline' (error, timed out, closed, or tab hidden).
// - The event's payload isn't used: onChange should rerun the page's own loader, the same one
//   usePolling runs, which stays as the fallback. Like usePolling, onChange is called with
//   { isCurrent }, false once the component has unmounted.
// - Events within BATCH_WINDOW_MS of the first one give one onChange call, at most that long
//   after the first event.
// - `onChange` needn't be stable: the latest one is kept in a ref and the channel is set up once,
//   on mount, so a re-render never resubscribes.
// - While the tab is hidden there is no channel. Coming back subscribes again, without a reload of
//   its own: usePolling already reloads when the tab is shown.
// - When the channel drops and then comes back (CHANNEL_ERROR, TIMED_OUT or CLOSED, then
//   SUBSCRIBED), onChange runs once, since events in the gap were missed. Not on the first
//   subscribe or after the tab is shown.
// - Realtime applies the alerts RLS policies to every event, so only officers and admins get any.
export function useAlertsRealtime(onChange) {
  const onChangeRef = useRef(onChange)
  // A tab opened in the background doesn't subscribe until it is shown
  const [status, setStatus] = useState(() => (document.hidden ? 'offline' : 'connecting'))

  // Before the effect below, so the first event already reaches the latest function
  useLayoutEffect(() => {
    onChangeRef.current = onChange
  })

  useEffect(() => {
    let channel = null
    let batchTimer = null
    let unmounted = false
    // True once the current channel has dropped, so coming back calls onChange
    let dropped = false
    const isCurrent = () => !unmounted

    function notify() {
      batchTimer = null
      Promise.resolve(onChangeRef.current({ isCurrent })).catch((error) => {
        console.error('Realtime alert reload failed', error)
      })
    }

    function handleEvent() {
      if (!batchTimer) batchTimer = setTimeout(notify, BATCH_WINDOW_MS)
    }

    // Status is set from the subscribe callback, never synchronously here, so this can run
    // straight from the effect
    function subscribe() {
      dropped = false
      const thisChannel = supabase
        .channel(`alerts-changes-${++channelCount}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, handleEvent)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'alerts' }, handleEvent)
      channel = thisChannel
      thisChannel.subscribe((channelStatus) => {
        // A late callback from a channel that has since been removed
        if (channel !== thisChannel) return
        if (channelStatus === 'SUBSCRIBED') {
          setStatus('live')
          if (dropped) {
            dropped = false
            handleEvent()
          }
        } else if (['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'].includes(channelStatus)) {
          setStatus('offline')
          dropped = true
        }
      })
    }

    function unsubscribe() {
      clearTimeout(batchTimer)
      batchTimer = null
      if (!channel) return
      const old = channel
      // Cleared first, so the CLOSED that removing it causes is ignored above
      channel = null
      supabase.removeChannel(old)
    }

    function handleVisibilityChange() {
      if (document.hidden) {
        unsubscribe()
        setStatus('offline')
      } else if (!channel) {
        setStatus('connecting')
        subscribe()
      }
    }

    if (!document.hidden) subscribe()
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      unmounted = true
      unsubscribe()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  return status
}
