import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermissions } from '../../auth/permissionStore.js'
import { ADMIN_ENTRY_PERMISSIONS, PERMISSIONS } from '../../auth/permissionCodes.js'
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
  TrashIcon,
  AnalysisIcon,
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
  /* Çöp Kutusu artık çizimleri VE POI'leri gösterir; satırın görünürlüğü bu
     yüzden tek bir yetki çiftinden değil, "geri yükleyebileceği bir şey var
     mı" sorusundan türetilir. Hesap MapPage'dedir (etkin yetkiler oradaki
     yetki katmanından okunur); burada yalnızca sonucu tüketilir. */
  canOpenTrash = false,
  /* "POI'lerim" ayrı bir yetkiyle açılır (poi.view) ve Çizimlerim'den
     BAĞIMSIZDIR: çizim yetkisi olmayan biri de kendi POI'lerini görebilmelidir.
     Hesap MapPage'deki yetki katmanındadır; burada yalnızca sonucu tüketilir. */
  canOpenMyPois = false,
  username,
  remaining,
  onLogout,
}) {
  const navigate = useNavigate()
  /* Görünürlük kararı ETKİN YETKİ KODLARINDAN gelir, rol adından değil: yetki
     satırı kaldırılmış bir "Administrator" burada da giriş görmemelidir, buna
     karşılık özel bir rol ya da kullanıcıya özel bir yetki kendiliğinden
     çalışmalıdır. */
  const { can, canAny } = usePermissions()
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

  /* Her satır AÇTIĞI ekranın yetkisini ister. Yetkisi olmayan satır hiç
     çizilmez — devre dışı bir satır bırakmak, kişiyi yalnızca hata gösterecek
     bir panele davet etmek olurdu ve klavye sırasında da yer kaplardı.
     `Harita`, `Ayarlar` ve `Hakkında` korumalı değildir: ilki paneli kapatır,
     diğer ikisi kişinin kendi hesabını ve uygulama bilgisini gösterir. */
  const items = [
    { id: null, label: 'Harita', Icon: MapIcon },
    ...(can(PERMISSIONS.DRAWINGS_VIEW) ? [{ id: 'drawings', label: 'Çizimlerim', Icon: ListIcon }] : []),
    // Çizimlerim'in hemen ardında: aynı soru, farklı alan nesnesi.
    ...(canOpenMyPois ? [{ id: 'myPois', label: "POI'lerim", Icon: PinIcon }] : []),
    ...(can(PERMISSIONS.LAYERS_VIEW) ? [{ id: 'layers', label: 'Katmanlar', Icon: LayersIcon }] : []),
    ...(can(PERMISSIONS.HEATMAP_VIEW)
      ? [{ id: 'heatmap', label: 'Isı Haritası Analizi', Icon: AnalysisIcon }]
      : []),
    // Right after "Çizimlerim"/"Katmanlar" because it is the same subject seen
    // from the other side: the records that are no longer on the map.
    // Çöp Kutusu'nun tek eylemi geri yüklemedir; listesi silinmiş çizimler VE
    // POI'lerdir.
    ...(canOpenTrash ? [{ id: 'trash', label: 'Çöp Kutusu', Icon: TrashIcon }] : []),
    ...(canAny(ADMIN_ENTRY_PERMISSIONS)
      ? [{ id: 'admin-users', label: 'Kullanıcı Yönetimi', Icon: ShieldIcon }]
      : []),
    { id: 'settings', label: 'Ayarlar', Icon: SettingsIcon },
    { id: 'about', label: 'Hakkında', Icon: InfoIcon },
  ]

  const handleSelect = (panelId) => {
    if (panelId === 'admin-users') {
      /* Kök yönlendirmesi aktörün açabileceği İLK bölümü seçer; buradan
         doğrudan /admin/users'a gitmek, yalnızca roles.view taşıyan bir
         yöneticiyi yetkisizlik ekranına düşürürdü. */
      navigate('/admin')
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
