import process from 'node:process'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

function supabaseOrigin(url) {
  // Without a real URL the policy would block every Supabase request
  if (!URL.canParse(url)) {
    throw new Error('VITE_SUPABASE_URL must be set to the Supabase project URL (see .env.example)')
  }
  return new URL(url).origin
}

function securityHeaders(supabase, { scriptSrc = [], connectSrc = [] } = {}) {
  const realtime = supabase.replace(/^http/, 'ws')

  const contentSecurityPolicy = [
    "default-src 'self'",
    ["script-src 'self'", ...scriptSrc].join(' '),
    // MUI/emotion injects style tags at runtime
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: ${supabase}`,
    "font-src 'self' data:",
    ["connect-src 'self'", supabase, realtime, ...connectSrc].join(' '),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ')

  return {
    'Content-Security-Policy': contentSecurityPolicy,
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  const supabase = supabaseOrigin(env.VITE_SUPABASE_URL)

  return {
    plugins: [react()],
    server: {
      // Dev only: hot reload needs an inline React Refresh script and its own websocket
      headers: securityHeaders(supabase, {
        scriptSrc: ["'unsafe-inline'"],
        connectSrc: ['ws://localhost:*'],
      }),
    },
    preview: {
      headers: securityHeaders(supabase),
    },
  }
})
