import { useState } from 'react'
import { IconButton, InputAdornment, TextField } from '@mui/material'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'

// A password TextField with a show/hide button, the same as the login page's. Takes any TextField
// props. The button is named after the field ("Show new password"), so screen reader users can
// tell several apart in one form.
export default function PasswordField({ label, disabled, ...props }) {
  const [shown, setShown] = useState(false)
  const name = label.toLowerCase()

  return (
    <TextField
      {...props}
      label={label}
      type={shown ? 'text' : 'password'}
      disabled={disabled}
      slotProps={{
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <IconButton
                aria-label={shown ? `Hide ${name}` : `Show ${name}`}
                onClick={() => setShown((current) => !current)}
                // Keeps focus in the field, so typing can carry on after toggling
                onMouseDown={(event) => event.preventDefault()}
                disabled={disabled}
                edge="end"
              >
                {shown ? <VisibilityOffIcon /> : <VisibilityIcon />}
              </IconButton>
            </InputAdornment>
          ),
        },
      }}
    />
  )
}
