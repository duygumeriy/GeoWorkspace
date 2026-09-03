import { useState } from 'react'
import { formatRouteDistance, formatRouteDuration } from '../../map/transportPathPresentation.js'
import ActiveSimulationsList from './ActiveSimulationsList.jsx'

/**
 * Paylaşılan bölümün İKİ görünümü.
 *
 * Bunlar ürün sekmesi DEĞİLDİR (o eksen "Kendi Yolculuğum / Paylaşımlı Ulaşım"
 * ayrımıdır): aynı ürünün iki bakışıdır — seçili hattın ayrıntısı ve o anda
 * çalışan tüm hatların listesi. Görünüm değiştirmek hiçbir simülasyona,
 * izleme seçimine ya da aboneliğe dokunmaz.
 */
const SHARED_VIEWS = Object.freeze({
  SELECTED: 'selected',
  ACTIVE: 'active',
})

/**
 * Çalışma alanının PAYLAŞILAN HAT bölümü.
 *
 * <b>Yalnızca çizer.</b> Hangi denetimin görüneceğine saf
 * <code>transportSimulationControls</code>, ne göstereceğine saf
 * <code>sharedJourneyPresentation</code> karar verir; bu bileşen ikinci bir
 * kural kitabı tutmaz. Rol adı, kullanıcı adı ya da yönetici bayrağı hiçbir
 * biçimde okunmaz — görünürlük ETKİN yetki kodundan türer ve zaten yalnızca
 * deneyimdir: backend yetkisiz isteğe 403 döndürmeye devam eder.
 *
 * <b>Durdurma çok kullanıcılı bir çalıştırmayı sonlandırır</b> ve bu yüzden
 * ONAY ister; onaylanana kadar hiçbir istek yola çıkmaz. Komut rota kimliğiyle
 * birlikte ÇALIŞTIRMA kimliğini de taşır — sunucu ikisini birden doğrular,
 * böylece eski bir sekme yerine geçmiş yeni bir çalıştırmayı durduramaz.
 * Başlatma yetkisi durdurma otoritesi olarak KULLANILMAZ: iki kod ayrıdır.
 *
 * <b>Uydurulmayanlar bilinçlidir.</b>
 * <ul>
 *   <li><b>Terminal durum UYDURULMAZ.</b> Durdurma sonrası ekran, sunucunun
 *       döndürdüğü otoriter terminal güncellemeyle değişir; yerel bir "durdu"
 *       varsayımı yazılmaz ve sistemin iç iptali tarayıcıdan çağrılmaz.</li>
 *   <li><b>Yönlendirme YOKTUR.</b> Kalıcı güzergah manevra bilgisi taşımaz;
 *       "şu anki talimat" ya da "sonraki dönüş" geometriden TÜRETİLMEZ.</li>
 *   <li><b>Sahte ilerleme YOKTUR.</b> Çalışan bir simülasyon yokken yüzde,
 *       çubuk ya da kalan süre gösterilmez.</li>
 * </ul>
 *
 * <b>Takip ≠ gözlem.</b> "Takibi Bırak" yalnızca KAMERA sahipliğini bırakır:
 * yayın sürer, işaretçi hareket etmeye devam eder ve sunucudaki simülasyon
 * herkes için çalışmaya devam eder.
 */
export default function SharedTransportJourneyContent({
  shared = null,
  /* NAVİGASYON (Faz 5). SEÇİLİ hattın bağlamına aittir: izlemek, takip etmek
     ya da yönetim için seçmek bu bölümü ne açar ne kapatır. Bileşen hiçbir
     talimat ÜRETMEZ; sunucudan gelmiş olguyu çizer. */
  navigation = null,
  onStart,
  onPause,
  onResume,
  onStop,
  onFollow,
  onUnfollow,
  /* AKTİF SİMÜLASYONLAR (Faz 4A). Bölüm seçili hattan BAĞIMSIZDIR: hiç hat
     seçilmemişken bile çalışan hatlar listelenebilmelidir. */
  active = null,
  onActiveSearchChange,
  onSelectActiveRoute,
  onToggleWatch,
  onWatchAll,
  onClearWatch,
  onRetryActive,
  /* YÖNETİM (Faz 4B). Bu bölüm hiçbirini YORUMLAMAZ; yalnızca aktarır.
     Görünürlük kararı saf sunum modelindedir ve etkin yetki kodundan türer. */
  onToggleManaged,
  onSelectAllActive,
  onClearSelection,
  onRunBatchAction,
}) {
  /* Görünüm tercihi tamamen SUNUMDUR ve bu yüzden burada yaşar: yukarı
     taşımak, MapPage'e hiçbir karar taşımayan bir durum daha eklerdi. */
  const [view, setView] = useState(SHARED_VIEWS.SELECTED)
  const showingActive = Boolean(active) && view === SHARED_VIEWS.ACTIVE

  const tabs = active
    ? (
      /* İKİNCİL gezinme dili kullanılır (`journey-tab`), ürün çubuğununki
         (`journey-product-tab`) DEĞİL. Bunlar aynı ürünün iki bakışıdır;
         ürün çubuğuyla aynı görünmeleri, kullanıcıya "Seçili Hat"ı
         "Kendi Yolculuğum" ile aynı eksenin değeri gibi okuturdu. Kişisel
         ürünün bölümleri de aynı dili kullanır. */
      <div className="journey-tabs journey-shared-views" role="group" aria-label="Paylaşımlı ulaşım görünümü">
        <button
          type="button"
          aria-pressed={!showingActive}
          className={`journey-tab ${!showingActive ? 'is-active' : ''}`.trim()}
          onClick={() => setView(SHARED_VIEWS.SELECTED)}
        >
          Seçili Hat
        </button>
        <button
          type="button"
          aria-pressed={showingActive}
          className={`journey-tab ${showingActive ? 'is-active' : ''}`.trim()}
          onClick={() => setView(SHARED_VIEWS.ACTIVE)}
        >
          {/* Sayaç bir ROZET değil, listenin büyüklüğüdür; sıfırken de
              doğrudur ve sahte bir "yeni" vaadi taşımaz. */}
          Aktif Simülasyonlar ({active.totalCount})
        </button>
      </div>
    )
    : null

  const activeSection = (
    <ActiveSimulationsList
      active={active}
      onSearchChange={onActiveSearchChange}
      onSelectRoute={onSelectActiveRoute}
      onToggleWatch={onToggleWatch}
      onWatchAll={onWatchAll}
      onClearWatch={onClearWatch}
      onRetry={onRetryActive}
      onToggleManaged={onToggleManaged}
      onSelectAllActive={onSelectAllActive}
      onClearSelection={onClearSelection}
      onRunBatchAction={onRunBatchAction}
    />
  )

  if (showingActive) {
    return (
      <div className="journey-body journey-shared">
        {tabs}
        {activeSection}
      </div>
    )
  }

  if (!shared) {
    return (
      <div className="journey-body journey-shared">
        {tabs}
        <p className="journey-note" role="status">
          Canlı durumunu görmek için haritadan bir hat seçin.
        </p>
      </div>
    )
  }

  return (
    <div className="journey-body journey-shared">
      {tabs}
      <div className="journey-shared-route">
        {shared.routeColor && (
          <span
            className="journey-shared-swatch"
            style={{ backgroundColor: shared.routeColor }}
            aria-hidden="true"
          />
        )}
        <strong>{shared.routeName || `Hat #${shared.routeId}`}</strong>
      </div>

      {/* Ölçüler SUNUCUNUN kalıcı güzergahından gelir ve yalnızca hesaplanmış
          olanlar yazılır; eksik bir değer sıfır olarak gösterilmez. */}
      {(shared.distanceMeters !== null || shared.durationSeconds !== null) && (
        <p className="journey-summary-meta">
          {[
            shared.distanceMeters !== null ? formatRouteDistance(shared.distanceMeters) : null,
            shared.durationSeconds !== null ? formatRouteDuration(shared.durationSeconds) : null,
          ].filter(Boolean).join(' · ')}
        </p>
      )}

      {shared.isActive ? (
        <div className="journey-live-metrics">
          <span className="journey-shared-status" role="status">
            {shared.statusLabel} · {shared.progressLabel}
          </span>
          {/* Değer SUNUCUNUN anlık görüntüsünden gelir; ikinci bir yüzde
              hesaplanmaz. */}
          <div
            className="journey-live-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(shared.progressPercent)}
            aria-valuetext={`%${Math.round(shared.progressPercent)} tamamlandı`}
            aria-label="Hat simülasyonu ilerlemesi"
          >
            <span style={{ width: `${shared.progressPercent}%` }} />
          </div>
        </div>
      ) : (
        <p className="journey-note" role="status">
          {shared.statusLoading ? 'Yükleniyor…' : 'Aktif simülasyon yok'}
        </p>
      )}

      {/* NAVİGASYON. Çalışan bir simülasyon yokken hiç çizilmez: talimat,
          hareket eden bir aracın bilgisidir. */}
      {shared.isActive && navigation && (
        <div className="journey-nav" aria-label="Navigasyon">
          <span className="journey-nav-title">Navigasyon</span>

          {/* Manevrası olmayan hat NORMALDİR ve altyapı hatası gibi
              sunulmaz — bu yüzden `journey-note`, `journey-error` değil. */}
          {!navigation.available && (
            <p className="journey-note" role="status">{navigation.message}</p>
          )}

          {navigation.available && navigation.current && (
            <div className="journey-nav-row is-current">
              <span className="journey-nav-label">Şimdi</span>
              <span className="journey-nav-instruction">
                {navigation.current.instruction}
                {/* Sokak adı yalnızca VARSA taşınır; boş bir ad bilgi
                    değildir. */}
                {navigation.current.name && (
                  <span className="journey-nav-road"> · {navigation.current.name}</span>
                )}
              </span>
            </div>
          )}

          {/* SONRAKİ manevra yalnızca varsa gösterilir: varışta bir sonraki
              yoktur ve boş bir satır uydurulmaz. */}
          {navigation.available && navigation.next && (
            <div className="journey-nav-row">
              <span className="journey-nav-label">Sonraki</span>
              <span className="journey-nav-instruction">
                {navigation.next.text}
                {navigation.next.name && (
                  <span className="journey-nav-road"> · {navigation.next.name}</span>
                )}
              </span>
            </div>
          )}
        </div>
      )}

      <div className="journey-actions">
        {shared.showStart && (
          <button
            type="button"
            className="journey-primary"
            disabled={shared.startDisabled}
            aria-busy={shared.starting}
            onClick={onStart}
          >
            {shared.starting ? 'Başlatılıyor…' : 'Simülasyonu Başlat'}
          </button>
        )}
        {/* DURAKLAT yıkıcı DEĞİLDİR: aynı çalıştırma sürer, yalnızca saati
            donar. Bu yüzden onay istemez. */}
        {shared.showPause && (
          <button
            type="button"
            className="journey-secondary"
            disabled={shared.pauseDisabled}
            aria-busy={shared.pausing}
            onClick={onPause}
          >
            {shared.pausing ? 'Duraklatılıyor…' : 'Duraklat'}
          </button>
        )}
        {shared.showResume && (
          <button
            type="button"
            className="journey-primary"
            disabled={shared.pauseDisabled}
            aria-busy={shared.resuming}
            onClick={onResume}
          >
            {shared.resuming ? 'Sürdürülüyor…' : 'Devam Ettir'}
          </button>
        )}
        {/* SIFIRLA yıkıcıdır ve ONAYIN arkasındadır: tıklama komutu
            göndermez, yalnızca onayı açar. Ad ürün anlamını söyler —
            çalıştırma sona erer ve hat yeniden başlatılabilir hâle gelir. */}
        {shared.showStop && (
          <button
            type="button"
            className="journey-danger"
            disabled={shared.stopDisabled}
            aria-busy={shared.stopping}
            onClick={onStop}
          >
            {shared.stopping ? 'Sıfırlanıyor…' : 'Sıfırla'}
          </button>
        )}
        {shared.showFollow && (
          <button
            type="button"
            className="journey-secondary"
            disabled={shared.followDisabled}
            aria-pressed={false}
            onClick={onFollow}
          >
            Takip Et
          </button>
        )}
        {shared.showUnfollow && (
          <button
            type="button"
            className="journey-secondary"
            disabled={shared.followDisabled}
            aria-pressed
            onClick={onUnfollow}
          >
            Takibi Bırak
          </button>
        )}
      </div>

      {shared.error && <p className="journey-error" role="alert">{shared.error}</p>}
    </div>
  )
}
