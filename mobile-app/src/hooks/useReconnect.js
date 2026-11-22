import { useEffect, useRef } from 'react'
import NetInfo from '@react-native-community/netinfo'
import { isOnline } from '../lib/network'

// Calls onReconnect whenever the phone goes from offline to online, e.g. to reload a list that
// was showing saved data. Always calls the latest onReconnect.
export function useReconnect(onReconnect) {
  const latest = useRef(onReconnect)
  useEffect(() => {
    latest.current = onReconnect
  })

  useEffect(() => {
    let wasOnline = null
    return NetInfo.addEventListener((state) => {
      const online = isOnline(state)
      if (online && wasOnline === false) latest.current()
      wasOnline = online
    })
  }, [])
}
