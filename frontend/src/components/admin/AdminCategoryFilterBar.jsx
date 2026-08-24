import {
  ADMIN_CATEGORY_KIND_OPTIONS,
  ADMIN_CATEGORY_STATUS_OPTIONS,
  hasActiveCategoryFilters,
} from '../../map/adminPoiFilters.js'

/**
 * Kategori taksonomisinin süzgeç şeridi.
 *
 * POI şeridiyle AYNI iskeleti ve aynı sınıfları kullanır: iki sekme arasında
 * gezinen bir yönetici, aynı denetimleri aynı yerde bulmalıdır. Kural yine
 * bileşenin dışındadır (`map/adminPoiFilters.js`).
 *
 * "Silinmiş" bir durum seçeneği YOKTUR: bu ekranın sözleşmesi böyle bir ayrımı
 * ayrı bir seçenek olarak sunmuyor ve hiçbir zaman sonuç vermeyecek bir filtre
 * eklemek, kullanıcıya olmayan bir yetenek vaat etmek olurdu.
 */
export default function AdminCategoryFilterBar({ filters, onChange, onReset, matchCount, total }) {
  const isFiltered = hasActiveCategoryFilters(filters)
  const set = (patch) => onChange({ ...filters, ...patch })

  return (
    <div className="admin-filter-bar" role="search">
      <div className="admin-filter-search">
        <input
          type="search"
          value={filters.search}
          onChange={(event) => set({ search: event.target.value })}
          placeholder="Kategori ara..."
          aria-label="Kategori adı veya yoluna göre ara"
        />
      </div>

      <label className="admin-filter-select">
        <span>Durum</span>
        <select
          value={filters.status}
          onChange={(event) => set({ status: event.target.value })}
          aria-label="Duruma göre süz"
        >
          {ADMIN_CATEGORY_STATUS_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className="admin-filter-select">
        <span>Tür</span>
        <select
          value={filters.kind}
          onChange={(event) => set({ kind: event.target.value })}
          aria-label="Türe göre süz"
        >
          {ADMIN_CATEGORY_KIND_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>

      <div className="admin-filter-meta">
        <span className="admin-filter-count" role="status">
          {matchCount === total ? `${total} kategori` : `${matchCount} / ${total} kategori`}
        </span>
        {isFiltered && (
          <button type="button" className="admin-filter-reset" onClick={onReset}>
            Filtreleri Temizle
          </button>
        )}
      </div>
    </div>
  )
}
