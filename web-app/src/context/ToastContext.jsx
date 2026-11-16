import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import { Alert, Snackbar } from '@mui/material'

const ToastContext = createContext(null)

// One snackbar for the signed-in app. Pages call useToast().success(message) after an action
// works. useToast().error(message) is only for errors that were already shown as a snackbar;
// errors shown inline on the page stay inline. Lives above the routes (in AppLayout), so a toast
// shown just before navigating, e.g. "Species saved", stays on screen on the next page.
export function ToastProvider({ children }) {
  // The message stays set while the snackbar fades out, so only `open` is cleared on close
  const [toast, setToast] = useState({ open: false })

  // A new key per message restarts the auto-hide timer when one message replaces another
  const show = useCallback((severity, message) => {
    setToast((current) => ({ open: true, severity, message, key: (current.key ?? 0) + 1 }))
  }, [])

  const value = useMemo(
    () => ({
      success: (message) => show('success', message),
      error: (message) => show('error', message),
    }),
    [show],
  )

  function close() {
    setToast((current) => ({ ...current, open: false }))
  }

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Bottom right, clear of the sidebar's user card in the bottom left */}
      <Snackbar
        key={toast.key}
        open={toast.open}
        autoHideDuration={5000}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        onClose={(_event, reason) => {
          if (reason !== 'clickaway') close()
        }}
      >
        <Alert severity={toast.severity} variant="filled" onClose={close} sx={{ width: '100%' }}>
          {toast.message}
        </Alert>
      </Snackbar>
    </ToastContext.Provider>
  )
}

// Same pattern as useAuth in AuthContext.jsx
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
