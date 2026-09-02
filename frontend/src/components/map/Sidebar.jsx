import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { usePermissions } from '../../auth/permissionStore.js'
import { ADMIN_ENTRY_PERMISSIONS, PERMISSIONS } from '../../auth/permissionCodes.js'
import useMediaQuery from '../../hooks/useMediaQuery.js'
import IconButton from '../ui/IconButton.jsx'
import infomotionLogo from '../../assets/brand/infomotion-logo.png'
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
  RouteIcon,
} from '../ui/icons/index.js'
import './Sidebar.css'

/**
 * Yolculuk Merkezi satırının kimliği.
 *
 * <b>Bilinçli olarak <code>MAP_CONTEXTS.journey</code> ile AYNI değerdir:</b>
 * panel bağlamı etkinken satır kendiliğinden etkin görünür ve ikinci bir
 * "hangi satır açık" defteri tutulmaz. Kenar çubuğu bağlam kayıtlarını
 * içe aktarmaz — tek bir dizge, iki modülü birbirine bağlamadan aynı gerçeği
 * söyler.
 */
export const JOURNEY_CENTER_ITEM_ID = 'journey'

/**
 * Marka çiziminin erişilebilir adı.
 *
 * Çizim ürün adını ve sloganını KENDİ İÇİNDE taşır; ekran okuyucu da aynısını
 * duymalıdır. Metin ayrıca HTML'e yazılmaz — görenler onu iki kez okurdu.
 */
const BRAND_ALT = 'Info&Motion — Sahadan veriye, veriden harekete.'

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
  canOpenMyStops = false,
  /* "Konum Analizi" İKİ yetki birden ister (location.analysis + poi.view):
     her iki uç da ikisini arar, dolayısıyla yalnızca birine sahip birine
     satırı göstermek garanti 403 alacak bir akışa davet etmek olurdu. Hesap
     MapPage'deki yetki katmanındadır; burada yalnızca sonucu tüketilir. */
  canOpenLocationAnalysis = false,
  /* Yolculuk Merkezi EN AZ BİR ürüne erişim ister (kişisel yolculuk ya da
     paylaşımlı ulaşım); hesap MapPage'deki yetki katmanındadır
     (`canOpenJourneyWorkspace`) ve burada yalnızca sonucu tüketilir. Rol adı
     okunmaz. */
  canOpenJourneyCenter = false,
  /* Yolculuk Merkezi bir kenar çubuğu SAYFASI değil, haritanın kendi
     panelidir: satır bu yüzden `onSelectPanel` yerine kendi açma eylemini
     çağırır. Eylem yalnızca paneli gösterir/gizler — hiçbir simülasyona,
     izlemeye ya da takibe dokunmaz. */
  onOpenJourneyCenter,
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
    /* TEK Yolculuk Merkezi girişi. Kişisel planlama, kaydedilen yolculuklar,
       yolculuk geçmişi ve paylaşımlı ulaşım AYRI satırlar DEĞİLDİR: hepsi tek
       bir ürünün içindeki bölümlerdir ve dördünü de kenar çubuğuna sermek,
       kullanıcıya bir ürün yerine dört ayrı araç gösterirdi. */
    ...(canOpenJourneyCenter
      ? [{ id: JOURNEY_CENTER_ITEM_ID, label: 'Yolculuk Merkezi', Icon: RouteIcon }]
      : []),
    ...(can(PERMISSIONS.DRAWINGS_VIEW) ? [{ id: 'drawings', label: 'Çizimlerim', Icon: ListIcon }] : []),
    // Çizimlerim'in hemen ardında: aynı soru, farklı alan nesnesi.
    ...(canOpenMyPois ? [{ id: 'myPois', label: "POI'lerim", Icon: PinIcon }] : []),
    ...(canOpenMyStops ? [{ id: 'myStops', label: 'Duraklarım', Icon: PinIcon }] : []),
    ...(can(PERMISSIONS.LAYERS_VIEW) ? [{ id: 'layers', label: 'Katmanlar', Icon: LayersIcon }] : []),
    ...(can(PERMISSIONS.HEATMAP_VIEW)
      ? [{ id: 'heatmap', label: 'Isı Haritası Analizi', Icon: AnalysisIcon }]
      : []),
    /* Isı Haritası Analizi'nin hemen ardında ama ONDAN AYRI bir satır: o,
       kişinin KENDİ çizim noktalarının yoğunluğudur; bu, ortak açık veri POI
       kümesini kategori ağırlıklarıyla puanlar. Aynı düğmeye bağlamak iki
       farklı soruyu tek yere koymak olurdu. */
    ...(canOpenLocationAnalysis
      ? [{ id: 'locationAnalysis', label: 'Konum Analizi', Icon: AnalysisIcon }]
      : []),
    // Right after "Çizimlerim"/"Katmanlar" because it is the same subject seen
    // from the other side: the records that are no longer on the map.
    // Çöp Kutusu'nun tek eylemi geri yüklemedir; listesi silinmiş çizimler VE
    // POI'lerdir.
    ...(canOpenTrash ? [{ id: 'trash', label: 'Çöp Kutusu', Icon: TrashIcon }] : []),
    /* Etiket "Yönetim Paneli"dir, "Kullanıcı Yönetimi" değil: bu giriş artık
       yalnızca kullanıcıları değil rolleri, yetkileri, POI yönetimini ve
       aktivite geçmişini de kapsıyor ve açtığı ekranın kendi başlığı da
       ("Yönetim Paneli", `AdminLayout`) bunu söylüyordu. Değişen YALNIZCA
       görünen metindir: `admin-users` kimliği, `/admin` rotası ve
       `ADMIN_ENTRY_PERMISSIONS` yetki kapısı olduğu gibi durur. */
    ...(canAny(ADMIN_ENTRY_PERMISSIONS)
      ? [{ id: 'admin-users', label: 'Yönetim Paneli', Icon: ShieldIcon }]
      : []),
    { id: 'settings', label: 'Ayarlar', Icon: SettingsIcon },
    { id: 'about', label: 'Hakkında', Icon: InfoIcon },
  ]

  const handleSelect = (panelId) => {
    /* Yolculuk Merkezi harita panelidir ve kendi açma/kapama eylemine
       sahiptir; panel koordinatörüne bir kenar çubuğu sayfası gibi girmez.
       Yönetim satırıyla AYNI kalıp: satırın hedefi sıradan bir panel değilse
       kendi eylemi çağrılır. */
    if (panelId === JOURNEY_CENTER_ITEM_ID) {
      onOpenJourneyCenter?.()
      if (isMobile) onCloseMobile?.()
      return
    }
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
          {/* ÜRÜN kimliği ÇİZİMİN KENDİSİDİR.
              Ad ve slogan çizimin içindedir; yanına ikinci bir başlık ya da
              simge KONMAZ — aynı şeyi iki kez söylemek olurdu. Kurumsal marka
              (Başarsoft) bu alanda değil, üst şeritte durur.

              Daraltılmış kenar çubuğunda 3:1 oranındaki çizim okunacak kadar
              yer bulamaz; bozulmasın diye çizilmez ve kimlik erişilebilir
              adda yaşamaya devam eder. */}
          {collapsed ? (
            <span className="map-sidebar-brand-collapsed" role="img" aria-label={BRAND_ALT} />
          ) : (
            <img className="map-sidebar-brand-logo" src={infomotionLogo} alt={BRAND_ALT} />
          )}
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
