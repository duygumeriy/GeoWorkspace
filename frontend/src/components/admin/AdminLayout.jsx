import { useCallback, useEffect, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import useMediaQuery from '../../hooks/useMediaQuery.js'
import { CloseIcon, MenuIcon } from '../ui/icons/index.js'
import AdminSidebar from './AdminSidebar.jsx'
import './AdminLayout.css'

/* Haritanın çekmece eşiğiyle aynı: iki panel farklı ekranlarda farklı
   noktalarda daralsaydı, uygulama tek bir ürün gibi davranmazdı. */
const DRAWER_QUERY = '(max-width: 1024px)'

/**
 * Yönetim panelinin kabuğu: menü + içerik.
 *
 * Sayfalar (`Kullanıcılar`, `Roller`, `Yetkiler`) yalnızca kendi içeriklerini
 * yazar; menü, başlık çubuğu ve duyarlı davranış burada BİR kez tanımlıdır.
 * Her sayfanın kendi kenar çubuğunu kurması, üç ekranda birbirinden sapan üç
 * gezinme demek olurdu.
 */
export default function AdminLayout() {
  const isDrawer = useMediaQuery(DRAWER_QUERY)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const { pathname } = useLocation()

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  /* Rota değişince çekmece kapanır. Kapatmayı her bağlantının onClick'ine
     bırakmak, ileride eklenecek bir gezinme yolunu (yönlendirme, geri tuşu)
     atlardı. */
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  // Masaüstüne genişleyince açık kalmış bir çekmece, kalıcı menünün üstünde
  // asılı bir katman olarak kalırdı.
  useEffect(() => {
    if (!isDrawer) setDrawerOpen(false)
  }, [isDrawer])

  useEffect(() => {
    if (!drawerOpen) return undefined
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  return (
    <div className={`admin-layout ${drawerOpen ? 'is-drawer-open' : ''}`}>
      {/* Çekmece açıkken arka plan tıklanabilir bir kapatma alanıdır. */}
      {drawerOpen && (
        <button
          type="button"
          className="admin-layout-scrim"
          aria-label="Menüyü kapat"
          onClick={closeDrawer}
        />
      )}

      <aside
        className="admin-layout-sidebar"
        /* Kapalı çekmece ekran okuyucudan da gizlenir; görünmeyen bir menüyü
           sekmeyle dolaşmak kafa karıştırıcı olurdu. */
        inert={isDrawer && !drawerOpen}
      >
        <AdminSidebar onNavigate={isDrawer ? closeDrawer : undefined} />
      </aside>

      <div className="admin-layout-main">
        {/* Başlık çubuğu yalnızca çekmece modunda görünür: masaüstünde menü
            zaten kalıcı olduğu için boş bir şerit eklemenin anlamı yok. */}
        <header className="admin-layout-topbar">
          <button
            type="button"
            className="admin-layout-menu-btn"
            onClick={() => setDrawerOpen((open) => !open)}
            aria-expanded={drawerOpen}
            aria-label={drawerOpen ? 'Menüyü kapat' : 'Menüyü aç'}
          >
            {drawerOpen ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
          </button>
          <span className="admin-layout-topbar-title">Yönetim Paneli</span>
        </header>

        <main className="admin-layout-content">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
