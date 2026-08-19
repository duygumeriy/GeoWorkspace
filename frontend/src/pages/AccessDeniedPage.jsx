import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext.jsx'
import { usePermissions } from '../auth/permissionStore.js'
import { ADMIN_ENTRY_PERMISSIONS, PERMISSIONS } from '../auth/permissionCodes.js'
import { LockIcon, LogoutIcon } from '../components/ui/icons/index.js'
import './AccessDeniedPage.css'

/**
 * Kimliği doğrulanmış ama bu bölüme yetkisi olmayan kullanıcının gördüğü ekran.
 *
 * <b>Giriş ekranına YÖNLENDİRİLMEZ.</b> Oturum sorunsuzdur; kişiyi /login'e
 * atmak "şifreni yanlış girdin" der ve yeniden giriş yaptığında aynı yere
 * düşerdi. 401 ile 403 arasındaki ayrım burada da korunur.
 *
 * Yetki okuması BAŞARISIZ olduysa bu bir yetki reddi değildir; o durumda
 * ekran bunu söyler ve tekrar denemeyi önerir — kalıcı bir "erişim yok"
 * göstermek, geçici bir ağ hatasını kalıcı bir duvara çevirirdi.
 */
export default function AccessDeniedPage() {
  const navigate = useNavigate()
  const { logout, username } = useAuth()
  const { can, canAny, permissionsError, refreshPermissions } = usePermissions()

  const canOpenMap = can(PERMISSIONS.MAP_VIEW)
  const canOpenAdmin = canAny(ADMIN_ENTRY_PERMISSIONS)

  return (
    <main className="access-denied">
      <section className="access-denied-card" role="alert">
        <span className="access-denied-icon" aria-hidden="true">
          <LockIcon size={26} />
        </span>

        {permissionsError ? (
          <>
            <h1>Yetkileriniz yüklenemedi</h1>
            <p>
              Sunucuya ulaşılamadığı için hangi bölümleri açabileceğiniz belirlenemedi. Bağlantınız
              döndüğünde tekrar deneyin.
            </p>
            <div className="access-denied-actions">
              <button type="button" className="access-denied-button" onClick={refreshPermissions}>
                Tekrar dene
              </button>
            </div>
          </>
        ) : (
          <>
            <h1>Bu bölüme erişim yetkiniz yok</h1>
            <p>
              {username ? `${username} hesabı` : 'Hesabınız'} bu ekranı açmak için gereken yetkiye
              sahip değil. Erişim gerekiyorsa bir yöneticiden yetki talep edebilirsiniz.
            </p>

            {/* Açabildiği bir bölüm varsa çıkmaz sokakta bırakılmaz. */}
            {(canOpenMap || canOpenAdmin) && (
              <div className="access-denied-actions">
                {canOpenMap && (
                  <button type="button" className="access-denied-button" onClick={() => navigate('/map')}>
                    Haritaya git
                  </button>
                )}
                {canOpenAdmin && (
                  <button type="button" className="access-denied-button" onClick={() => navigate('/admin')}>
                    Yönetim paneline git
                  </button>
                )}
              </div>
            )}

            {!canOpenMap && !canOpenAdmin && (
              <p className="access-denied-note">
                Hesabınıza şu anda kullanabileceğiniz hiçbir bölüm tanımlı değil.
              </p>
            )}
          </>
        )}

        <button type="button" className="access-denied-logout" onClick={logout}>
          <LogoutIcon size={16} />
          <span>Çıkış Yap</span>
        </button>
      </section>
    </main>
  )
}
