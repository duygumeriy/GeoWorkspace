import { useMemo, useState } from 'react'
import MapSheet from './MapSheet.jsx'
import { CloseIcon, FocusIcon, PinIcon, TrashIcon } from '../ui/icons/index.js'
import {
  DEFAULT_POI_SORT,
  POI_SORT_OPTIONS,
  buildMyPoiView,
  poiCategoryOptions,
  workHoursSummary,
} from '../../map/poiFilters.js'
import { formatLonLat } from '../../map/poi.js'
import './DrawingsPanel.css'
import './MyPoisPanel.css'

/**
 * "POI'lerim" — çağıranın kendi POI kayıtlarının yönetim paneli.
 *
 * <b>Çizimlerim'in kopyası değil, KARDEŞİDİR.</b> Aynı sheet iskeletini, aynı
 * denetim şeridini, aynı satır/eylem düzenini ve aynı boş/yükleniyor/hata
 * durumlarını kullanır (bu yüzden `DrawingsPanel.css` yeniden kullanılır ve
 * yalnızca POI'ye özgü birkaç kural eklenir); ama listelediği şey ayrı bir
 * alan nesnesidir — POI bir çizim DEĞİLDİR, kendi uçları ve kendi yetkileri
 * vardır. İkisi birbirinin yerine geçmez: yalnızca `poi.view` taşıyan biri
 * Çizimlerim'i hiç görmezken bu paneli görür.
 *
 * <b>Kapsam sunucunundur.</b> Liste `GET /api/poi/mine`ten gelir; burada
 * sahiplik süzgeci YOKTUR ve olamaz — harita sözleşmesi kaydın sahibini
 * taşımaz. Aynı şekilde eylemlerin görünürlüğü kaydın SUNUCUDAN gelen
 * `canUpdate` / `canDelete` bayraklarına bakar; sahiplik kuralı tarayıcıda
 * ikinci kez hesaplanmaz ve hiçbiri bir güvenlik sınırı değildir.
 */
export default function MyPoisPanel({
  open,
  onClose,
  pois = [],
  loading = false,
  error = null,
  onRetry,
  /** Satır: haritada odaklan + POI Bilgisi'ni aç. */
  onSelect,
  onEdit,
  onDelete,
  /** İşlem gören kaydın kimliği; yalnızca o satırın düğmeleri bekler. */
  busyId = null,
}) {
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [sort, setSort] = useState(DEFAULT_POI_SORT)

  const categories = useMemo(() => poiCategoryOptions(pois), [pois])
  const { items, matchCount } = useMemo(
    () => buildMyPoiView(pois, { search, category, sort }),
    [pois, search, category, sort],
  )

  if (!open) return null

  const total = pois.length
  const isFiltered = search.trim().length > 0 || category !== 'all'

  const resetFilters = () => {
    setSearch('')
    setCategory('all')
  }

  return (
    <MapSheet
      open={open}
      title={total > 0 ? `POI'lerim (${total})` : "POI'lerim"}
      onClose={onClose}
      className="drawings-panel my-pois-panel"
    >
      {loading && (
        <p className="drawings-status" role="status" aria-live="polite">
          POI kayıtlarınız yükleniyor...
        </p>
      )}

      {!loading && error && (
        <div className="drawings-error" role="alert">
          <p className="drawings-error-text">POI kayıtlarınız yüklenemedi.</p>
          {onRetry && (
            <button type="button" className="drawings-retry" onClick={onRetry}>
              Tekrar Dene
            </button>
          )}
        </div>
      )}

      {/* İki AYRI boş durum: hiç kaydın olmaması ile süzgecin her şeyi
          gizlemesi farklı şeylerdir ve tek bir metin, kullanıcıyı süzgecin
          sakladığı bir kaydı aramaya gönderirdi. */}
      {!loading && !error && total === 0 && (
        <p className="drawings-empty">
          Henüz POI eklememişsiniz. Alt araç çubuğundaki “POI Ekle” ile ekleyebilirsiniz.
        </p>
      )}

      {!loading && !error && total > 0 && (
        <>
          <div className="drawings-controls">
            <div className="drawings-search">
              <input
                type="search"
                className="drawings-search-input"
                placeholder="POI adı veya kategori ara..."
                aria-label="POI'lerimde ada veya kategoriye göre ara"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="drawings-search-clear"
                  aria-label="Aramayı temizle"
                  onClick={() => setSearch('')}
                >
                  <CloseIcon size={13} />
                </button>
              )}
            </div>

            <div className="drawings-selects">
              <label className="drawings-select">
                <span className="drawings-select-label">Kategori</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  {categories.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="drawings-select">
                <span className="drawings-select-label">Sırala</span>
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  {POI_SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {matchCount === 0 ? (
            <div className="drawings-empty-filtered">
              <p className="drawings-empty">Bu filtrelere uygun POI bulunamadı.</p>
              {isFiltered && (
                <button type="button" className="drawings-retry" onClick={resetFilters}>
                  Filtreleri Temizle
                </button>
              )}
            </div>
          ) : (
            <ul className="drawings-items">
              {items.map((poi) => {
                const label = poi.name || 'POI'
                const isBusy = busyId === poi.id

                return (
                  <li key={poi.id} className="drawings-row">
                    {/* Satırın ANA içeriği tek bir erişilebilir denetimdir:
                        tıklamak (ve klavyeden Enter/Space) haritada o POI'ye
                        gider. Düzenle/Sil onun İÇİNDE değil, KARDEŞİDİR —
                        iç içe düğme geçersiz bir yapı olurdu ve bir eylemi
                        tıklamak satırın odaklanmasını da tetiklerdi. */}
                    <button
                      type="button"
                      className="drawings-item"
                      aria-label={`${label} kaydına git`}
                      onClick={() => onSelect?.(poi)}
                    >
                      <span
                        className="drawings-item-dot"
                        style={{ '--dot': 'var(--poi-color, #2563EB)' }}
                        aria-hidden="true"
                      />

                      <span className="drawings-item-icon" aria-hidden="true">
                        <PinIcon size={15} />
                      </span>

                      <span className="drawings-item-text">
                        <span className="drawings-item-title">
                          #{poi.id} {label}
                        </span>
                        {/* Yol, yalnızca yaprak addan daha çok şey söyler. */}
                        <span className="drawings-item-meta">
                          {poi.categoryPath || poi.categoryName || 'Kategori Yok'}
                        </span>
                        {/* Mesai özeti yönetim ekranıyla AYNI yorumdan gelir. */}
                        <span className="drawings-item-meta">
                          Mesai: {workHoursSummary(poi)}
                        </span>
                        <span className="drawings-item-meta my-pois-coordinates">
                          {formatLonLat(poi.longitude, poi.latitude)}
                        </span>
                      </span>
                    </button>

                    {/* Her zaman çizilir, hover ile açığa çıkarılmaz: telefonda
                        açığa çıkaracak bir hover yoktur. */}
                    <span className="drawings-item-actions">
                      <button
                        type="button"
                        className="drawings-action"
                        title="Haritada Göster"
                        aria-label={`${label} kaydını haritada göster`}
                        onClick={() => onSelect?.(poi)}
                      >
                        <FocusIcon size={14} />
                      </button>

                      {/* Eylemler SUNUCUNUN kararını yansıtır. */}
                      {poi.canUpdate && (
                        <button
                          type="button"
                          className="drawings-action"
                          title="Düzenle"
                          aria-label={`${label} kaydını düzenle`}
                          disabled={isBusy}
                          onClick={() => onEdit?.(poi)}
                        >
                          Düzenle
                        </button>
                      )}

                      {poi.canDelete && (
                        <button
                          type="button"
                          className="drawings-action drawings-action--danger"
                          title="Sil"
                          aria-label={`${label} kaydını sil`}
                          disabled={isBusy}
                          onClick={() => onDelete?.(poi)}
                        >
                          <TrashIcon size={14} />
                        </button>
                      )}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </>
      )}
    </MapSheet>
  )
}
