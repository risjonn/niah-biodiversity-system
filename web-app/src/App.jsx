import { useEffect, useState } from 'react'
import Typography from '@mui/material/Typography'
import { supabase } from './supabaseClient'

function App() {
  const [status, setStatus] = useState('Checking connection...')

  useEffect(() => {
    supabase
      .from('species')
      .select('*')
      .then(({ error }) => {
        if (error) {
          setStatus(`Connection error: ${error.message}`)
        } else {
          setStatus('Connected to Supabase successfully!')
        }
      })
  }, [])

  return (
    <div style={{ padding: '2rem' }}>
      <Typography variant="h4" gutterBottom>
        Niah Biodiversity System
      </Typography>
      <Typography>{status}</Typography>
    </div>
  )
}

export default App