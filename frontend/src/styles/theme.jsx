import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'

const STORAGE_KEY = 'staj-map-theme'
const ThemeContext = createContext(null)

function getSystemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function readStoredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system'
}

/**
 * Theme ownership for the whole app.
 *
 * There are two distinct concepts here and keeping them apart is the point:
 *
 *   - `theme` / `resolvedTheme` — the signed-in user's PREFERENCE for the map
 *     workspace. It is the only thing persisted, and it is the only thing the
 *     theme control writes to.
 *   - the *presentation* actually painted on `<html data-theme>`. Normally that
 *     is the preference, but a screen may pin it (see `useFixedThemePresentation`).
 *
 * The split exists because the authentication screens are not themeable: they
 * are a fixed dark hero (starfield, earth photo, dark glass card) whose colours
 * are written into `LoginPage.css` directly. Letting the map preference reach
 * them could only ever make them inconsistent — a "light" preference used to
 * repaint `--text-primary` dark navy while the login's input surfaces stayed
 * hardcoded dark, i.e. dark text on a dark field. Pinning the presentation while
 * an auth screen is mounted keeps those screens looking exactly as designed, and
 * — crucially — does NOT touch the stored preference, so the map still comes
 * back in whatever the user chose.
 */
export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme)
  const [resolvedTheme, setResolvedTheme] = useState(() =>
    theme === 'system' ? (getSystemPrefersDark() ? 'dark' : 'light') : theme
  )

  /* Screens that pin the presentation. A counter rather than a boolean so a
     remount (React StrictMode mounts effects twice in development, and one auth
     screen can navigate straight to another) cannot leave the lock stuck on or
     release it early. */
  const [pinnedTheme, setPinnedTheme] = useState(null)
  const pinCountRef = useRef(0)

  const setTheme = useCallback((next) => {
    setThemeState(next)
    localStorage.setItem(STORAGE_KEY, next)
  }, [])

  /**
   * Pins the painted presentation while the caller is mounted. Returns the
   * release function. The stored preference is deliberately left alone.
   */
  const pinPresentation = useCallback((value) => {
    pinCountRef.current += 1
    setPinnedTheme(value)

    return () => {
      pinCountRef.current -= 1
      if (pinCountRef.current <= 0) {
        pinCountRef.current = 0
        setPinnedTheme(null)
      }
    }
  }, [])

  // Resolve 'system' to a concrete value and keep it live-updated while active.
  useEffect(() => {
    if (theme !== 'system') {
      setResolvedTheme(theme)
      return
    }

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    setResolvedTheme(media.matches ? 'dark' : 'light')

    const handleChange = (event) => setResolvedTheme(event.matches ? 'dark' : 'light')
    media.addEventListener('change', handleChange)
    return () => media.removeEventListener('change', handleChange)
  }, [theme])

  /* Layout effect, not a passive one: this runs before the browser paints, so
     navigating between a pinned screen and the map never shows one frame of the
     wrong palette. */
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', pinnedTheme ?? resolvedTheme)
  }, [pinnedTheme, resolvedTheme])

  const value = useMemo(
    () => ({ theme, resolvedTheme, setTheme, pinPresentation, isPinned: pinnedTheme !== null }),
    [theme, resolvedTheme, setTheme, pinPresentation, pinnedTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}

/**
 * Pins the painted theme for as long as the calling screen is mounted.
 *
 * Used by the authentication screens, whose visual identity is fixed rather than
 * themeable. The user's saved map preference is untouched: log out from a dark
 * map and the login looks exactly as designed, log back in and the map is dark
 * again.
 *
 * @param {'dark'|'light'} presentation
 */
export function useFixedThemePresentation(presentation) {
  const { pinPresentation } = useTheme()

  useLayoutEffect(() => pinPresentation(presentation), [pinPresentation, presentation])
}
