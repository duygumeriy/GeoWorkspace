import LoginVisualPane from './LoginVisualPane.jsx'
import GlassPanel from '../components/ui/GlassPanel.jsx'
import ThemeToggle from '../components/ui/ThemeToggle.jsx'
import LanguagePill from '../components/ui/LanguagePill.jsx'
import './LoginPage.css'
import './AuthShell.css'

/**
 * Shared frame for every auth screen other than login (register, forgot /
 * reset password, e-mail confirmation).
 *
 * It deliberately reuses the login page's own classes — `.login-page`,
 * `.login-card`, `.login-eyebrow` — so these screens inherit that design
 * exactly rather than re-implementing it. The only addition is
 * `.auth-card--compact`, which drops the login card's fixed 740px min-height:
 * these forms are shorter and would otherwise float in an oversized card.
 */
export default function AuthShell({ eyebrow, title, children }) {
  return (
    <div className="login-page">
      <div className="login-page-stars" aria-hidden="true" />

      <LoginVisualPane />

      <div className="login-page-top-controls">
        <ThemeToggle />
        <LanguagePill />
      </div>

      <div className="login-form-wrap">
        <GlassPanel className="login-card auth-card--compact" as="div">
          <p className="login-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <span className="login-title-accent" aria-hidden="true" />

          {children}
        </GlassPanel>
      </div>
    </div>
  )
}
