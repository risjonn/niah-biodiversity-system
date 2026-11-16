import { Suspense, useEffect, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import {
  AppBar,
  Box,
  Container,
  Drawer,
  IconButton,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import MenuIcon from '@mui/icons-material/Menu'
import AppSidebar, { SIDEBAR_RAIL_WIDTH, SIDEBAR_WIDTH } from '../components/AppSidebar'
import ChangePasswordDialog from '../components/ChangePasswordDialog'
import PageLoader from '../components/PageLoader'
import { NavCountsProvider } from '../context/NavCountsContext'
import { ToastProvider, useToast } from '../context/ToastContext'

const COLLAPSED_STORAGE_KEY = 'niah.sidebarCollapsed'

// Remembered per browser. Storage can be unavailable (private windows, blocked site data), so
// both reading and writing fall back quietly to the expanded sidebar.
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

function writeCollapsed(collapsed) {
  try {
    localStorage.setItem(COLLAPSED_STORAGE_KEY, String(collapsed))
  } catch {
    // Not remembered this time; the sidebar still works
  }
}

// The signed-in app: toasts and sidebar badge counts for every page, then the shell
export default function AppLayout() {
  return (
    <ToastProvider>
      <NavCountsProvider>
        <AppShell />
      </NavCountsProvider>
    </ToastProvider>
  )
}

// md and up: a permanent sidebar, collapsible to an icon rail. Below md: a slim top bar whose menu
// button opens the same sidebar as a temporary drawer.
function AppShell() {
  const theme = useTheme()
  const toast = useToast()
  // noSsr: read the real width on the first render, so desktop never flashes the phone layout
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'), { noSsr: true })
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [changePasswordOpen, setChangePasswordOpen] = useState(false)
  const pageRef = usePageFadeIn()

  function toggleCollapsed() {
    setCollapsed((current) => {
      writeCollapsed(!current)
      return !current
    })
  }

  const sidebarWidth = collapsed ? SIDEBAR_RAIL_WIDTH : SIDEBAR_WIDTH

  return (
    <Box sx={{ display: 'flex', minHeight: '100vh', bgcolor: 'background.default' }}>
      {isDesktop ? (
        <Drawer
          variant="permanent"
          sx={{
            width: sidebarWidth,
            flexShrink: 0,
            transition: theme.transitions.create('width', {
              duration: theme.transitions.duration.shorter,
            }),
            '& .MuiDrawer-paper': {
              width: sidebarWidth,
              boxSizing: 'border-box',
              overflowX: 'hidden',
              transition: theme.transitions.create('width', {
                duration: theme.transitions.duration.shorter,
              }),
            },
            '@media (prefers-reduced-motion: reduce)': {
              transition: 'none',
              '& .MuiDrawer-paper': { transition: 'none' },
            },
          }}
        >
          <AppSidebar
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
            onChangePassword={() => setChangePasswordOpen(true)}
          />
        </Drawer>
      ) : (
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          sx={{ '& .MuiDrawer-paper': { width: SIDEBAR_WIDTH, boxSizing: 'border-box' } }}
        >
          <AppSidebar
            onNavigate={() => setMobileOpen(false)}
            onChangePassword={() => {
              setMobileOpen(false)
              setChangePasswordOpen(true)
            }}
          />
        </Drawer>
      )}

      <Box sx={{ flexGrow: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        {isDesktop ? null : (
          <AppBar position="sticky" color="primary" elevation={0}>
            <Toolbar variant="dense" sx={{ gap: 1 }}>
              <IconButton
                color="inherit"
                edge="start"
                aria-label="Open navigation menu"
                aria-expanded={mobileOpen ? 'true' : 'false'}
                onClick={() => setMobileOpen(true)}
              >
                <MenuIcon />
              </IconButton>
              <Typography variant="h3" component="div" noWrap>
                Niah Biodiversity
              </Typography>
            </Toolbar>
          </AppBar>
        )}
        {/* The page area. PageHeader's band is positioned against it (position: relative), so the
            band spans the full width beside the sidebar; isolation keeps the band (z-index -1)
            behind the page's content but above this area's background. */}
        <Box sx={{ position: 'relative', isolation: 'isolate', flexGrow: 1 }}>
          {/* lg on every page: no page sets its own width */}
          <Container ref={pageRef} component="main" maxWidth="lg" sx={{ py: 4 }}>
            <Suspense fallback={<PageLoader />}>
              <Outlet />
            </Suspense>
          </Container>
        </Box>
      </Box>

      {changePasswordOpen ? (
        <ChangePasswordDialog
          onChanged={() => {
            setChangePasswordOpen(false)
            toast.success('Your password has been changed')
          }}
          onClose={() => setChangePasswordOpen(false)}
        />
      ) : null}
    </Box>
  )
}

// A short fade-in of the page area on every route change. Played with the Web Animations API on
// the existing element, so pages aren't remounted (their state and loading are untouched), and
// skipped for people who ask for reduced motion.
function usePageFadeIn() {
  const theme = useTheme()
  const ref = useRef(null)
  const { pathname } = useLocation()

  useEffect(() => {
    const element = ref.current
    if (!element?.animate) return undefined
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined

    const animation = element.animate(
      [
        { opacity: 0, transform: `translateY(${theme.spacing(0.5)})` },
        { opacity: 1, transform: 'none' },
      ],
      { duration: theme.transitions.duration.shorter, easing: 'ease-out' },
    )
    return () => animation.cancel()
  }, [pathname, theme])

  return ref
}
