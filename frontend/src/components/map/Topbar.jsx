import IconButton from '../ui/IconButton.jsx'
import ThemeToggle from '../ui/ThemeToggle.jsx'
import { MenuIcon, ClockIcon, LogoutIcon } from '../ui/icons/index.js'
import './Topbar.css'

export default function Topbar({ username, remaining, onLogout, onOpenMobileMenu, mobileMenuOpen }) {
  return (
    <header className="map-topbar">
      <div className="map-topbar-left">
        <IconButton
          label="Menüyü aç"
          aria-expanded={mobileMenuOpen}
          className="map-topbar-menu-btn"
          onClick={onOpenMobileMenu}
        >
          <MenuIcon size={20} />
        </IconButton>
        <h1 className="map-topbar-title">Staj Harita Uygulaması</h1>
      </div>

      <div className="map-topbar-right">
        <ThemeToggle />

        <div className="map-topbar-profile">
          {username && <span className="map-topbar-username">{username}</span>}
          {remaining && (
            <span className="map-topbar-timer" aria-label={`Oturum süresi: ${remaining}`} title="Oturum süresi">
              <ClockIcon size={14} />
              {remaining}
            </span>
          )}
          <button type="button" className="map-topbar-logout" onClick={onLogout}>
            <LogoutIcon size={16} />
            <span>Çıkış Yap</span>
          </button>
        </div>
      </div>
    </header>
  )
}
