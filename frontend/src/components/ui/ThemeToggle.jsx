import { useTheme } from '../../styles/theme.jsx'
import { SunIcon, MoonIcon } from './icons/index.js'
import './ThemeToggle.css'

const ORDER = ['system', 'dark', 'light']
const LABELS = { system: 'Sistem', dark: 'Koyu', light: 'Açık' }

export default function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()

  const handleClick = () => {
    const next = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length]
    setTheme(next)
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={`Tema: ${LABELS[theme]} (değiştirmek için tıklayın)`}
      title={`Tema: ${LABELS[theme]}`}
      onClick={handleClick}
    >
      <SunIcon size={14} className="theme-toggle-icon theme-toggle-icon-sun" />
      <span className={`theme-toggle-track ${resolvedTheme === 'dark' ? 'is-dark' : 'is-light'}`}>
        <span className="theme-toggle-knob" />
      </span>
      <MoonIcon size={14} className="theme-toggle-icon theme-toggle-icon-moon" />
    </button>
  )
}
