import { useCallback, useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import PrintLabels from '../components/PrintLabels'

// Prints plant tag labels with the browser's own print dialog, in this page (no new window, so
// nothing for a pop-up blocker to stop).
//
//   const { printLabels, printElement } = usePrintLabels()
//   <Button onClick={() => printLabels([{ qrCode, scientificName }])}>Print label</Button>
//   {printElement}
//
// printLabels must be called from the click handler itself. It puts the labels into the page
// synchronously (flushSync) and then calls window.print() in the same click: no effect or timer
// in between, which is what stopped the dialog before (React's strict mode re-ran the effect and
// its cleanup cancelled the timer, so window.print was never called). Each call replaces the
// labels, so a browser that never fires afterprint can't block the next print.
export function usePrintLabels() {
  const [labels, setLabels] = useState(null)

  // Taken out of the page once the dialog is closed (printed or cancelled)
  useEffect(() => {
    const clear = () => setLabels(null)
    window.addEventListener('afterprint', clear)
    return () => window.removeEventListener('afterprint', clear)
  }, [])

  const printLabels = useCallback((nextLabels) => {
    flushSync(() => setLabels(nextLabels))
    window.print()
  }, [])

  return { printLabels, printElement: labels ? <PrintLabels labels={labels} /> : null }
}
