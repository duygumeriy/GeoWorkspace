import './Transport.css'

/**
 * Simülasyon durumu ve canlı takip denetimleri.
 *
 * <b>Tek bir yerde durur ve İKİ yüzeyde kullanılır:</b> güzergah yönetimi
 * sayfası ve ana harita çalışma alanı. Aynı düğmeleri iki kez yazmak, iki
 * ekranın zamanla farklı kurallara kayması demekti — özellikle görünürlük
 * kuralı (kim neyi görür) yalnızca bir yerde yaşamalıdır.
 *
 * <b>Karar burada verilmez.</b> Hangi denetimin görüneceğini Faz 3'ün saf
 * <code>transportSimulationControls</code> fonksiyonu söyler; bu bileşen
 * yalnızca onu çizer. Rol adı, kullanıcı adı ya da yönetici bayrağı hiçbir
 * biçimde okunmaz; görünürlük ETKİN yetki kodundan türer ve zaten yalnızca
 * deneyimdir — backend yetkisiz isteğe 403 döndürmeye devam eder.
 *
 * Düğme sınıfları DIŞARIDAN verilir: yönetim ekranı kendi <code>admin-button</code>
 * dilini, harita ise mevcut popup düğmesi dilini kullanır. Böylece ortak
 * bileşen, iki ekranın hiçbirine yabancı bir görsel dil taşımaz.
 */
export default function TransportTrackingControls({
  controls,
  statusLoading = false,
  starting = false,
  error = '',
  onStart,
  onFollow,
  onUnfollow,
  className = '',
  primaryButtonClassName = 'admin-button',
  secondaryButtonClassName = 'admin-button secondary',
}) {
  if (!controls) return null

  return (
    <section className={`transport-simulation-panel ${className}`.trim()} aria-label="Simülasyon durumu">
      <div className="transport-simulation-heading">
        <div>
          <span>Simülasyon</span>
          <strong>{statusLoading ? 'Yükleniyor…' : controls.statusLabel ?? 'Çalışmıyor'}</strong>
        </div>
        {controls.isActive && (
          <span className="transport-simulation-progress" role="status">
            İlerleme {controls.progressLabel}
          </span>
        )}
      </div>
      <div className="transport-simulation-actions">
        {controls.showStart && (
          <button
            type="button"
            className={primaryButtonClassName}
            disabled={controls.startDisabled}
            onClick={onStart}
          >
            {starting ? 'Başlatılıyor…' : 'Simülasyonu Başlat'}
          </button>
        )}
        {controls.showFollow && (
          <button
            type="button"
            className={secondaryButtonClassName}
            disabled={controls.followDisabled}
            onClick={onFollow}
          >
            Takip Et
          </button>
        )}
        {controls.showUnfollow && (
          <button
            type="button"
            className={secondaryButtonClassName}
            disabled={controls.followDisabled}
            onClick={onUnfollow}
          >
            Takibi Bırak
          </button>
        )}
      </div>
      {error && <p className="transport-path-failure" role="alert">{error}</p>}
    </section>
  )
}
