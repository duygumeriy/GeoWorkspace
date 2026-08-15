import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext.jsx'
import useMediaQuery from '../../hooks/useMediaQuery.js'
import IconButton from '../ui/IconButton.jsx'
import {
  PinIcon,
  MapIcon,
  ChevronIcon,
  ListIcon,
  LayersIcon,
  SettingsIcon,
  InfoIcon,
  LogoutIcon,
  ClockIcon,
  ShieldIcon,
} from '../ui/icons/index.js'
import './Sidebar.css'

/**
 * Primary navigation.
 *
 * Every entry here does something real: "Harita" closes the open panels and
 * returns focus to the map, the middle three open their panels, and the last
 * two open informational sheets. No decorative rows.
 */
export default function Sidebar({
  collapsed,
  onToggleCollapse,
  mobileOpen,
  onCloseMobile,
  activePanel,
  onSelectPanel,
  username,
  remaining,
  onLogout,
}) {
  const navigate = useNavigate()
  const { isAdmin } = useAuth()
  const asideRef = useRef(null)
  const isMobile = useMediaQuery('(max-width: 640px)')

  useEffect(() => {
    if (!mobileOpen) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onCloseMobile?.()
    }
    const handlePointerDown = (event) => {
      if (asideRef.current && !asideRef.current.contains(event.target)) {
        onCloseMobile?.()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [mobileOpen, onCloseMobile])

  const items = [
    { id: null, label: 'Harita', Icon: MapIcon },
    { id: 'drawings', label: 'Çizimler', Icon: ListIcon },
    { id: 'layers', label: 'Katmanlar', Icon: LayersIcon },
    ...(isAdmin ? [{ id: 'admin-users', label: 'Kullanıcı Yönetimi', Icon: ShieldIcon }] : []),
    { id: 'settings', label: 'Ayarlar', Icon: SettingsIcon },
    { id: 'about', label: 'Hakkında', Icon: InfoIcon },
  ]

  const handleSelect = (panelId) => {
    if (panelId === 'admin-users') {
      navigate('/admin/users')
      if (isMobile) onCloseMobile?.()
      return
    }
    onSelectPanel(panelId)
    if (isMobile) onCloseMobile?.()
  }

  return (
    <>
      {mobileOpen && <div className="sidebar-scrim" aria-hidden="true" />}
      <aside
        ref={asideRef}
        className={`map-sidebar ${collapsed ? 'is-collapsed' : ''} ${mobileOpen ? 'is-mobile-open' : ''}`}
        aria-hidden={isMobile && !mobileOpen ? 'true' : undefined}
      >
        <div className="map-sidebar-brand">
          <span className="map-sidebar-brand-icon">
            <PinIcon size={22} />
          </span>
          {!collapsed && <span className="map-sidebar-brand-name">Staj Harita Uygulaması</span>}
        </div>

        <nav className="map-sidebar-nav" aria-label="Ana gezinme">
          {items.map(({ id, label, Icon }) => {
            const isActive = activePanel === id
            return (
              <button
                key={label}
                type="button"
                className={`map-sidebar-nav-item ${isActive ? 'is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                aria-expanded={id ? isActive : undefined}
                title={label}
                onClick={() => handleSelect(id)}
              >
                <Icon size={19} />
                {!collapsed && <span>{label}</span>}
              </button>
            )
          })}
        </nav>

        <div className="map-sidebar-footer">
          <div className="map-sidebar-user">
            {!collapsed && (
              <>
                <span className="map-sidebar-username">{username || '—'}</span>
                {remaining && (
                  <span className="map-sidebar-session" title="Kalan oturum süresi">
                    <ClockIcon size={13} />
                    Oturum: {remaining}
                  </span>
                )}
              </>
            )}

            <button
              type="button"
              className="map-sidebar-logout"
              onClick={onLogout}
              title="Çıkış Yap"
              aria-label="Çıkış Yap"
            >
              <LogoutIcon size={16} />
              {!collapsed && <span>Çıkış Yap</span>}
            </button>
          </div>

          <IconButton
            label={collapsed ? 'Kenar çubuğunu genişlet' : 'Kenar çubuğunu daralt'}
            aria-expanded={!collapsed}
            onClick={onToggleCollapse}
            className={`map-sidebar-collapse-btn ${collapsed ? 'is-collapsed' : ''}`}
          >
            <ChevronIcon size={16} />
          </IconButton>
        </div>
      </aside>
    </>
  )
}
