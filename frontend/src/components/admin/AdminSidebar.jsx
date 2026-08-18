import { NavLink } from 'react-router-dom'
import { KeyIcon, MapIcon, ShieldIcon, UserIcon } from '../ui/icons/index.js'
import './AdminSidebar.css'

/* Tek gezinme tanımı. Sayfalar kendi menülerini kurmaz; bir uç eklemek burada
   tek satırlık bir değişikliktir ve sıra her ekranda aynı kalır. */
const NAV_ITEMS = [
  { to: '/admin/users', label: 'Kullanıcılar', Icon: UserIcon },
  { to: '/admin/roles', label: 'Roller', Icon: ShieldIcon },
  { to: '/admin/permissions', label: 'Yetkiler', Icon: KeyIcon },
]

/**
 * Yönetim panelinin gezinme sütunu.
 *
 * Masaüstünde sabit bir kolon, dar ekranlarda çekmecedir; iki durum da AYNI
 * bileşendir. İkinci bir "mobil menü" bileşeni yazmak, aktif durum ve erişim
 * kuralının iki yerde tekrarlanması demek olurdu.
 *
 * Öğeler gerçek `NavLink`'tir: orta tıkla yeni sekmede açılır, klavyeyle
 * gezilebilir ve aktif durumu router'dan gelir — tıklanabilir `div` ile bunların
 * hiçbiri olmazdı.
 */
export default function AdminSidebar({ onNavigate }) {
  return (
    <nav className="admin-nav" aria-label="Yönetim menüsü">
      <div className="admin-nav-brand">
        <span className="admin-nav-brand-mark" aria-hidden="true">GW</span>
        <span className="admin-nav-brand-text">
          <strong>GeoWorkspace</strong>
          <small>Yönetim Paneli</small>
        </span>
      </div>

      <div className="admin-nav-group">
        <h2 className="admin-nav-heading" id="admin-nav-manage">Yönetim</h2>
        <ul className="admin-nav-list" aria-labelledby="admin-nav-manage">
          {NAV_ITEMS.map(({ to, label, Icon }) => (
            <li key={to}>
              <NavLink
                to={to}
                className={({ isActive }) => `admin-nav-item ${isActive ? 'is-active' : ''}`}
                onClick={onNavigate}
              >
                {/* Aktiflik yalnızca renkle anlatılmaz: sol şerit + dolgu +
                    aria-current birlikte çalışır, böylece renk ayırt edemeyen
                    ve ekran okuyucu kullanan kişiler için de belirgindir. */}
                <span className="admin-nav-item-rail" aria-hidden="true" />
                <Icon size={18} />
                <span>{label}</span>
              </NavLink>
            </li>
          ))}
        </ul>
      </div>

      <div className="admin-nav-footer">
        <NavLink to="/map" className="admin-nav-item is-quiet" onClick={onNavigate}>
          <span className="admin-nav-item-rail" aria-hidden="true" />
          <MapIcon size={18} />
          <span>Haritaya Dön</span>
        </NavLink>
      </div>
    </nav>
  )
}
