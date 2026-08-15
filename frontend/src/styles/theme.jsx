import { createContext, useCallback, useContext, useEffect, useState } from 'react'

const STORAGE_KEY = 'staj-map-theme'
const ThemeContext = createContext(null)

function getSystemPrefersDark() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

function readStoredTheme() {
  const stored = localStorage.getItem(STORAGE_KEY)
  return stored === 'dark' || stored === 'light' || stored === 'system' ? stored : 'system'
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readStoredTheme)
  const [resolvedTheme, setResolvedTheme] = useState(() =>
    theme === 'system' ? (getSystemPrefersDark() ? 'dark' : 'light') : theme
  )

  const setTheme = useCallback((next) => {
    setThemeState(next)
    localStorage.setItem(STORAGE_KEY, next)
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

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolvedTheme)
  }, [resolvedTheme])

  const value = { theme, resolvedTheme, setTheme }

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}
