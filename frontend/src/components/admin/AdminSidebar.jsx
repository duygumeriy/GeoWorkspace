import { NavLink } from 'react-router-dom'
import { usePermissions } from '../../auth/permissionStore.js'
import { PERMISSIONS } from '../../auth/permissionCodes.js'
import { KeyIcon, MapIcon, ShieldIcon, UserIcon } from '../ui/icons/index.js'
import './AdminSidebar.css'

/* Tek gezinme tanımı. Sayfalar kendi menülerini kurmaz; bir uç eklemek burada
   tek satırlık bir değişikliktir ve sıra her ekranda aynı kalır.

   Her satır, açtığı ekranın GET ucunun aradığı yetkiyi taşır — bu yüzden menü
   ile rota koruyucusu aynı cevabı verir ve görünen bir bağlantı yetkisizlik
   ekranına çıkmaz. */
const NAV_ITEMS = [
  { to: '/admin/users', label: 'Kullanıcılar', Icon: UserIcon, permission: PERMISSIONS.USERS_VIEW },
  { to: '/admin/roles', label: 'Roller', Icon: ShieldIcon, permission: PERMISSIONS.ROLES_VIEW },
  { to: '/admin/permissions', label: 'Yetkiler', Icon: KeyIcon, permission: PERMISSIONS.PERMISSIONS_VIEW },
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
 *
 * Yetkisi olmayan bölüm hiç ÇİZİLMEZ; devre dışı bir bağlantı bırakmak,
 * açılamayacak bir ekranı klavye sırasında tutmak ve kişiyi tıklamaya davet
 * etmek olurdu. Karar rol adına değil, etkin yetki koduna bakar — masaüstü
 * kolonu ve mobil çekmece AYNI bileşen olduğu için kural da tektir.
 */
export default function AdminSidebar({ onNavigate }) {
  const { can } = usePermissions()
  const items = NAV_ITEMS.filter((item) => can(item.permission))

  return (
    <nav className="admin-nav" aria-label="Yönetim menüsü">
      <div className="admin-nav-brand">
        <span className="admin-nav-brand-mark" aria-hidden="true">GW</span>
        <span className="admin-nav-brand-text">
          <strong>GeoWorkspace</strong>
          <small>Yönetim Paneli</small>
        </span>
      </div>

      {/* Tek bir bölüm bile görünmüyorsa başlık da çizilmez: boş bir "Yönetim"
          başlığı, olmayan bir menüyü varmış gibi gösterirdi. */}
      {items.length > 0 && (
        <div className="admin-nav-group">
          <h2 className="admin-nav-heading" id="admin-nav-manage">Yönetim</h2>
          <ul className="admin-nav-list" aria-labelledby="admin-nav-manage">
            {items.map(({ to, label, Icon }) => (
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
      )}

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
