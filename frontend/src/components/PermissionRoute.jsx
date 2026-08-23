import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { usePermissions } from '../auth/permissionStore.js'
import { ADMIN_SECTIONS } from '../auth/permissionCodes'
import AccessDeniedPage from '../pages/AccessDeniedPage.jsx'
import './PermissionRoute.css'

/**
 * Rota koruyucusu: "bu ekranı açabilir miyim".
 *
 * <b>Güvenlik sınırı DEĞİLDİR.</b> Adres çubuğuna elle yazan biri bu bileşeni
 * atlayamaz ama atlasa da bir şey kazanmaz: ekranın okuduğu her uç kendi
 * yetkisini backend'de arar ve yetkisiz isteğe 403 döner. Koruyucu yalnızca
 * kişinin yalnızca hata gösterecek bir sayfaya düşmesini önler.
 *
 * <b>İki başarısızlık ayrı ayrı ele alınır.</b> Kimlik yoksa /login doğru
 * cevaptır. Kimlik VARSA ama yetki yoksa /login yanlış cevaptır — oturum
 * sağlamdır ve kişi yeniden giriş yaparak aynı yere düşerdi; bu durumda
 * yetkisizlik ekranı gösterilir.
 *
 * <b>Yetkiler bilinmeden karar verilmez.</b> Küme yüklenene kadar ekranın
 * kendisi ÇİZİLMEZ; "önce göster, sonra kaldır" bir yetkisiz arayüz sızıntısı
 * olurdu. Bekleme durumu ölçülüdür — tam ekran bir spinner değil, kısa bir
 * durum satırı.
 */
export default function PermissionRoute({ anyOf, children }) {
  const { isAuthenticated } = useAuth()
  const { canAny, permissionsLoaded, permissionsError } = usePermissions()

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  if (permissionsError) {
    // Yetki reddi değil, okuma hatası: ekran bunu ayırt eder ve tekrar dener.
    return <AccessDeniedPage />
  }

  if (!permissionsLoaded) {
    return (
      <div className="permission-gate" role="status" aria-live="polite">
        <span className="permission-gate-spinner" aria-hidden="true" />
        <span>Yetkileriniz denetleniyor…</span>
      </div>
    )
  }

  if (!canAny(anyOf)) {
    return <AccessDeniedPage />
  }

  return children
}

/**
 * `/admin` kökü: aktörün gerçekten AÇABİLECEĞİ ilk bölüme yönlendirir.
 *
 * Sabit bir `/admin/users` yönlendirmesi, yalnızca `roles.view` taşıyan bir
 * yöneticiyi paneli her açtığında yetkisizlik ekranına düşürürdü. Sıra
 * kenar çubuğunun sırasıdır ve tek yerden (ADMIN_SECTIONS) okunur.
 */
export function AdminIndexRedirect() {
  const { canAny, permissionsLoaded, permissionsError } = usePermissions()

  if (permissionsError) return <AccessDeniedPage />

  if (!permissionsLoaded) {
    return (
      <div className="permission-gate" role="status" aria-live="polite">
        <span className="permission-gate-spinner" aria-hidden="true" />
        <span>Yetkileriniz denetleniyor…</span>
      </div>
    )
  }

  const first = ADMIN_SECTIONS.find((section) => canAny(section.anyOf))

  return first ? <Navigate to={first.path} replace /> : <AccessDeniedPage />
}
