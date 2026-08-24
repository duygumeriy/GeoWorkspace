import { useState } from 'react'
import { summarize, weekSchedule } from '../../poi/workHours.js'

/**
 * POI envanteri.
 *
 * Kaynak `GET /api/admin/poi`'dir — harita ucu DEĞİL: yönetim listesi pasif ve
 * silinmiş kayıtları da içerir ve her kaydı oluşturan kullanıcıyı taşır.
 * Harita sözleşmesinde oluşturan bilgisi bilinçli olarak yoktur.
 *
 * Sunum, kullanıcı ve rol ekranlarıyla AYNI tablo iskeletini kullanır
 * (`admin-users-list` / `admin-table-head` / `admin-user-row` + `data-label`):
 * masaüstünde tablo, dar ekranda kendiliğinden kart yığınına döner. Ayrı bir
 * mobil bileşen yazmak, aynı satırın iki yerde bakım görmesi olurdu.
 *
 * <b>Eylemler yetkinin ta kendisidir.</b> `poi.manage` taşıyan çağıran her
 * kaydı düzenleyebilir, silebilir ve geri yükleyebilir; bu yüzden satır artık
 * eylem taşır. Sunulan eylem kaydın DURUMUNA göre değişir: aktif bir kayıt
 * düzenlenip silinebilir, silinmiş bir kayıt yalnızca geri yüklenebilir.
 *
 * Karar burada verilmez: düğmeler ancak `canManage` true iken çizilir ve
 * uçlar aynı yetkiyi sunucuda bağımsız olarak yeniden arar. Silme SOFT'tur —
 * satır veritabanında kalır ve listede "Silinmiş" olarak görünmeye devam eder.
 */
export default function PoiList({
  pois,
  loading,
  canManage = false,
  busyId = null,
  /** Süzgeçten ÖNCEKİ kayıt sayısı: iki boş durumu ayırt eden tek bilgi. */
  total = null,
  onResetFilters,
  onEdit,
  onDelete,
  onRestore,
}) {
  /* Açık mesai detayları. Tek bir satırın yedi gününü sürekli göstermek tabloyu
     okunmaz yükseklikte yapardı; özet her zaman görünür, ayrıntı istendiğinde
     açılır. Küme id tutar — liste yenilendiğinde açık satır açık kalır. */
  const [expanded, setExpanded] = useState(() => new Set())

  const toggle = (id) =>
    setExpanded((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })

  if (loading) {
    return (
      <div className="admin-users-list" aria-label="POI kayıtları yükleniyor">
        {[1, 2, 3, 4, 5].map((n) => <div className="admin-skeleton" key={n} />)}
      </div>
    )
  }

  /* İKİ AYRI boş durum. "Henüz POI yok" demek, süzgecin sakladığı kayıtlar
     varken kullanıcıyı olmayan bir eksikliği aramaya gönderirdi. */
  if (!pois.length) {
    const filteredOut = total !== null && total > 0

    return (
      <div className="admin-empty">
        {filteredOut ? (
          <>
            <strong>Filtrelerle eşleşen POI bulunamadı.</strong>
            <span>Arama ya da süzgeç ölçütlerini genişletmeyi deneyin.</span>
            {onResetFilters && (
              <button type="button" className="admin-button secondary" onClick={onResetFilters}>
                Filtreleri Temizle
              </button>
            )}
          </>
        ) : (
          <>
            <strong>Henüz POI kaydı bulunmuyor.</strong>
            <span>Operatörler harita üzerinden POI ekledikçe kayıtlar burada listelenir.</span>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="admin-users-list admin-poi-list">
      <div className="admin-table-head" aria-hidden="true">
        <span>İsim</span>
        <span>Kategori</span>
        <span>Mesai Saatleri</span>
        <span>Konum</span>
        <span>Oluşturan</span>
        <span>Tarih</span>
        <span>Durum</span>
        {canManage && <span>İşlemler</span>}
      </div>

      {pois.map((poi) => {
        const open = expanded.has(poi.id)
        const status = statusOf(poi)

        return (
          <div className="admin-poi-row-group" key={poi.id}>
            <div className="admin-user-row admin-poi-row">
              <span className="admin-user-identity">
                <strong>{poi.name}</strong>
              </span>

              {/* Yol varsa yol gösterilir: "Yeme-İçme / Restoran", yalnızca
                  "Restoran"dan daha çok şey söyler. */}
              <span data-label="Kategori" className="admin-poi-category">
                {poi.categoryPath || poi.categoryName || '—'}
              </span>

              <span data-label="Mesai Saatleri" className="admin-poi-hours">
                <span className="admin-poi-hours-summary">{summarize(poi.workHours)}</span>
                {poi.workHours && (
                  <button
                    type="button"
                    className="admin-poi-hours-toggle"
                    onClick={() => toggle(poi.id)}
                    aria-expanded={open}
                    aria-controls={`poi-hours-${poi.id}`}
                  >
                    {open ? 'Gizle' : 'Tüm hafta'}
                  </button>
                )}
              </span>

              <span data-label="Konum" className="admin-poi-coordinates">
                {formatCoordinates(poi)}
              </span>

              <span data-label="Oluşturan" className="admin-poi-creator">
                <strong>{poi.creatorUsername || '—'}</strong>
              </span>

              <span data-label="Oluşturulma Tarihi">{formatDate(poi.createdDate)}</span>

              <span data-label="Durum">
                <span className={`admin-badge ${status.tone}`}>{status.label}</span>
              </span>

              {canManage && (
                <span data-label="İşlemler" className="admin-poi-actions">
                  {poi.isDeleted ? (
                    <button
                      type="button"
                      className="admin-button secondary"
                      disabled={busyId === poi.id}
                      onClick={() => onRestore?.(poi)}
                    >
                      Geri Yükle
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="admin-button secondary"
                        disabled={busyId === poi.id}
                        onClick={() => onEdit?.(poi)}
                      >
                        Düzenle
                      </button>
                      <button
                        type="button"
                        className="admin-button danger"
                        disabled={busyId === poi.id}
                        onClick={() => onDelete?.(poi)}
                      >
                        Sil
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>

            {open && (
              <div className="admin-poi-schedule" id={`poi-hours-${poi.id}`}>
                <dl>
                  {weekSchedule(poi.workHours).map((day) => (
                    <div key={day.key}>
                      <dt>{day.label}</dt>
                      <dd>{day.text}</dd>
                    </div>
                  ))}
                </dl>
                <p className="admin-poi-schedule-meta">
                  Güncellenme: {formatDate(poi.modifiedDate)}
                </p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Kaydın gösterim durumu.
 *
 * Silinmişlik önceliklidir: soft-delete edilmiş bir satırın ayrıca pasif
 * olması, ona "Pasif" demek için sebep değildir — anlamlı bilgi silinmiş
 * olmasıdır.
 */
function statusOf(poi) {
  if (poi.isDeleted) return { label: 'Silinmiş', tone: 'danger' }
  if (poi.isActive) return { label: 'Aktif', tone: 'success' }
  return { label: 'Pasif', tone: 'warning' }
}

/**
 * Kompakt koordinat: "32.85970, 39.93340".
 *
 * Beş ondalık ~1 metre çözünürlüktür; tabloda okunabilir kalırken noktayı
 * tanımlamaya fazlasıyla yeter. Ham sayıyı tam basamağıyla göstermek sütunu
 * taşırırdı.
 */
function formatCoordinates(poi) {
  if (!Number.isFinite(poi.longitude) || !Number.isFinite(poi.latitude)) return '—'
  return `${poi.longitude.toFixed(5)}, ${poi.latitude.toFixed(5)}`
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? '—'
    : date.toLocaleString('tr-TR', { dateStyle: 'medium', timeStyle: 'short' })
}
