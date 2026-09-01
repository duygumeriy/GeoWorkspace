import { useCallback, useEffect, useState } from 'react'
import { fetchAdminActivity, readApiError } from '../../services/api.js'
import AdminPageHeader from '../../components/admin/AdminPageHeader.jsx'
import { formatDateTime } from '../../map/datetime.js'
import { activityContext } from '../../map/transportActivityPresentation.js'
import './ActivityPage.css'

const PAGE_SIZE = 25

/** Sonuç süzgeci. Değerler sunucunun `succeeded` parametresine BİREBİR gider. */
const OUTCOMES = [
  { value: 'all', label: 'Tüm sonuçlar' },
  { value: 'true', label: 'Başarılı' },
  { value: 'false', label: 'Başarısız' },
]

/** Kaynak türünün Türkçe karşılığı; tanınmayan tür ham hâliyle gösterilir. */
const RESOURCE_LABELS = {
  user: 'Kullanıcı',
  role: 'Rol',
  drawing: 'Çizim',
  poi: 'POI',
  poi_category: 'POI Kategorisi',
  transport_route: 'Güzergah',
  transport_stop: 'Durak',
  journey_simulation: 'Yolculuk simülasyonu',
}

/**
 * Aktivite geçmişi — SALT OKUNUR.
 *
 * <b>Kayıt sunucuda tutulur.</b> Bu ekran yerel bir günlük göstermez: satırlar
 * `activity_logs` tablosundan gelir ve sayfalama sunucu tarafındadır. Tarayıcı
 * tarafında biriktirilen bir liste, sekme kapandığında kaybolan ve başka bir
 * yöneticinin göremediği bir "geçmiş" olurdu — yani hiç geçmiş olmazdı.
 *
 * <b>Düzenleme ve silme YOKTUR</b> ve bu bir eksik değildir: silinebilen bir
 * denetim kaydı denetim kaydı değildir. Sunucunun da yazma ucu yoktur.
 *
 * <b>Sırlar hiç gelmez.</b> Kayıt yazılırken istek gövdesinden hiçbir metin
 * alınmaz (bkz. backend'deki ActivityDetails); dolayısıyla burada gösterilecek
 * bir parola, token ya da poligon WKT'si de yoktur.
 *
 * Süzgeçler SUNUCUYA gider — katalog gibi tamamı indirilmiş küçük bir veri
 * değil, sınırsız büyüyen bir tablo söz konusudur; istemcide süzmek tüm tabloyu
 * indirmeyi gerektirirdi.
 */
export default function ActivityPage() {
  const [page, setPage] = useState(1)
  const [outcome, setOutcome] = useState('all')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const res = await fetchAdminActivity({
        page,
        pageSize: PAGE_SIZE,
        succeeded: outcome === 'all' ? undefined : outcome === 'true',
      })
      if (!res.ok) {
        /* 403 bir oturum sorunu DEĞİLDİR: token geçerli, izin yok. authFetch
           yalnızca 401'de çıkış yaptırır; burada kişiyi giriş ekranına atmak,
           çalışan bir oturumu yetki eksikliği yüzünden sonlandırmak olurdu. */
        throw new Error(res.status === 403
          ? 'Aktivite geçmişini görüntülemek için gerekli izne sahip değilsiniz. Yönetici oturumunuzda MFA doğrulaması gerekli olabilir.'
          : await readApiError(res, 'Aktivite geçmişi yüklenemedi.'))
      }
      setData(await res.json())
    } catch (err) {
      setData(null)
      setError(err.message || 'Aktivite geçmişi yüklenemedi.')
    } finally {
      setLoading(false)
    }
  }, [page, outcome])

  useEffect(() => { load() }, [load])

  const items = data?.items ?? []
  const totalPages = data?.totalPages ?? 0

  const changeOutcome = (value) => {
    setOutcome(value)
    // Süzgeç değişince sayfa BAŞA döner: 3. sayfada süzmek, çoğu zaman var
    // olmayan bir sayfayı istemek olurdu.
    setPage(1)
  }

  return (
    <div className="admin-activity-page">
      <AdminPageHeader
        title="Aktivite Geçmişi"
        /* Metin kapsamı DÜRÜSTÇE söyler: bu bir istek izi değil, değişiklik
           defteridir. */
        description="Sistemde yapılan yönetim, çizim, POI ve ulaşım değişikliklerinin kaydı. En yeni işlem en üstte; okuma istekleri kaydedilmez."
      />

      <section className="admin-toolbar admin-activity-toolbar" aria-label="Aktivite filtreleri">
        <label>
          Sonuç
          <select value={outcome} onChange={(event) => changeOutcome(event.target.value)}>
            {OUTCOMES.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      </section>

      {error && (
        <div className="admin-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={load}>Tekrar dene</button>
        </div>
      )}

      {!error && (
        <div className="admin-activity-list">
          <div className="admin-activity-head admin-table-head" aria-hidden="true">
            <span>Tarih / Saat</span>
            <span>Kullanıcı</span>
            <span>İşlem</span>
            <span>Kaynak</span>
            <span>Sonuç</span>
          </div>

          {loading ? (
            /* Yükleme, boş listeden AYRI bir durumdur: "kayıt yok" demek,
               henüz gelmemiş veriyi yok saymak olurdu. */
            <div role="status" aria-label="Aktivite geçmişi yükleniyor">
              {Array.from({ length: 5 }, (_, index) => (
                <div key={index} className="admin-skeleton" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="admin-empty">
              <strong>Kayıt yok</strong>
              <span>
                {outcome === 'all'
                  ? 'Henüz kaydedilmiş bir işlem bulunmuyor.'
                  : 'Bu süzgeçle eşleşen işlem bulunamadı.'}
              </span>
            </div>
          ) : (
            <ul className="admin-activity-rows">
              {items.map((item) => {
                /* Tek çağrı, tüm ürünler: ulaşım ya da kişisel yolculuk
                   bağlamı aynı güvenli sunumdan geçer. Tanınmayan ayrıntı
                   `null` döner ve satır ham JSON GÖSTERMEZ. */
                const context = activityContext(item.details)
                return (
                  <li key={item.id} className="admin-activity-row" data-action={item.action}>
                    <span className="admin-user-date" data-label="Tarih">{formatDateTime(item.occurredAt)}</span>
                    <span data-label="Kullanıcı">
                      {/* Ad işlem ANINDAKİ hâliyle saklanır: kullanıcı sonradan
                          silinse bile satır okunabilir kalır. */}
                      {item.actorUsername || '—'}
                    </span>
                    <span data-label="İşlem">
                      <strong>{item.actionName}</strong>
                      <small className="admin-activity-code">{item.action}</small>
                      {context && <small className="admin-transport-activity-context">{context}</small>}
                    </span>
                    <span data-label="Kaynak">
                      {item.resourceType
                        ? `${RESOURCE_LABELS[item.resourceType] ?? item.resourceType}${item.resourceId ? ` #${item.resourceId}` : ''}`
                        : '—'}
                    </span>
                    <span data-label="Sonuç">
                      {/* Sonuç renge DEĞİL metne dayanır; renk yalnızca ona
                          eşlik eder. */}
                      <span className={`admin-badge ${item.isSuccess ? 'success' : 'danger'}`}>
                        {item.isSuccess ? 'Başarılı' : `Başarısız · ${item.statusCode}`}
                      </span>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      {!error && !loading && totalPages > 1 && (
        <nav className="admin-activity-pager" aria-label="Sayfalama">
          <button
            type="button"
            className="admin-button secondary"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            Önceki
          </button>
          <span role="status">
            Sayfa <strong>{data.page}</strong> / {totalPages} · toplam {data.totalCount} kayıt
          </span>
          <button
            type="button"
            className="admin-button secondary"
            disabled={page >= totalPages}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            Sonraki
          </button>
        </nav>
      )}
    </div>
  )
}
