import { NavLink } from 'react-router-dom'
import { usePermissions } from '../../auth/permissionStore.js'
import {
  PERMISSIONS,
  POI_SECTION_PERMISSIONS,
  TRANSPORT_ROUTE_SECTION_PERMISSIONS,
} from '../../auth/permissionCodes.js'
import { ClockIcon, KeyIcon, MapIcon, PinIcon, ShieldIcon, UserIcon } from '../ui/icons/index.js'
import infomotionLogo from '../../assets/brand/infomotion-logo.png'
import './AdminSidebar.css'

/* Tek gezinme tanımı. Sayfalar kendi menülerini kurmaz; bir uç eklemek burada
   tek satırlık bir değişikliktir ve sıra her ekranda aynı kalır.

   Her satır, açtığı ekranın GET ucunun aradığı yetkiyi taşır — bu yüzden menü
   ile rota koruyucusu aynı cevabı verir ve görünen bir bağlantı yetkisizlik
   ekranına çıkmaz. */
/* Harita kenar çubuğuyla AYNI çizim ve aynı erişilebilir ad: iki ekran tek
   ürün gibi okunsun diye marka ikinci kez çizilmez, var olan varlık yeniden
   kullanılır. */
const BRAND_ALT = 'Info&Motion — Sahadan veriye, veriden harekete.'

const NAV_ITEMS = [
  { to: '/admin/users', label: 'Kullanıcılar', Icon: UserIcon, anyOf: [PERMISSIONS.USERS_VIEW] },
  { to: '/admin/roles', label: 'Roller', Icon: ShieldIcon, anyOf: [PERMISSIONS.ROLES_VIEW] },
  { to: '/admin/permissions', label: 'Yetkiler', Icon: KeyIcon, anyOf: [PERMISSIONS.PERMISSIONS_VIEW] },
  { to: '/admin/activity', label: 'Aktivite Geçmişi', Icon: ClockIcon, anyOf: [PERMISSIONS.ACTIVITY_VIEW] },
  /* POI bölümü İKİ yetkiden herhangi biriyle açılır: biri POI envanterini,
     diğeri kategori taksonomisini yönetir ve bir kişide yalnızca biri
     bulunabilir. Tek bir koda bağlansaydı, yalnızca kategori yetkisi olan
     yönetici bölüme hiç giremezdi. */
  { to: '/admin/poi', label: 'POI Yönetimi', Icon: PinIcon, anyOf: POI_SECTION_PERMISSIONS },
  { to: '/admin/transport', label: 'Güzergah Yönetimi', Icon: MapIcon, anyOf: TRANSPORT_ROUTE_SECTION_PERMISSIONS },
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
  const { canAny } = usePermissions()
  const items = NAV_ITEMS.filter((item) => canAny(item.anyOf))

  return (
    <nav className="admin-nav" aria-label="Yönetim menüsü">
      <div className="admin-nav-brand">
        {/* Ad ve slogan çizimin İÇİNDEDİR; yanına ikinci bir başlık konmaz.
            Altta duran yalnızca bağlam etiketidir: hangi ekranda olunduğunu
            söyler, ayrı bir marka kurmaz. */}
        <span className="admin-nav-brand-plate">
          <img className="admin-nav-brand-logo" src={infomotionLogo} alt={BRAND_ALT} />
        </span>
        <span className="admin-nav-brand-context">Yönetim Paneli</span>
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
