import {
  ADMIN_POI_SORT_OPTIONS,
  ADMIN_POI_STATUS_OPTIONS,
  adminPoiCategoryOptions,
  adminPoiCreatorOptions,
  hasActivePoiFilters,
} from '../../map/adminPoiFilters.js'

/**
 * POI envanterinin süzgeç şeridi.
 *
 * <b>Karar burada verilmez.</b> Bileşen yalnızca denetimleri çizer ve
 * değişiklikleri yukarı bildirir; eşleşme, birleşim ve sıralama kuralı
 * `map/adminPoiFilters.js` içindedir ve tek başına ölçülebilir.
 *
 * Açılır listelerin seçenekleri VERİDEN türetilir: listede hiç bulunmayan bir
 * kategoriyi ya da hiç kayıt eklememiş bir kullanıcıyı sunmak, kullanıcıyı
 * garanti boş bir sonuca göndermek olurdu.
 *
 * Şerit tek satırda başlar, dar ekranda kendiliğinden sarar; ayrı bir "filtre
 * kartı" açılmaz — envanterin kendisi ekranın asıl konusudur.
 */
export default function AdminPoiFilterBar({ pois, filters, onChange, onReset, matchCount, total }) {
  const categories = adminPoiCategoryOptions(pois)
  const creators = adminPoiCreatorOptions(pois)
  const isFiltered = hasActivePoiFilters(filters)

  const set = (patch) => onChange({ ...filters, ...patch })

  return (
    <div className="admin-filter-bar" role="search">
      <div className="admin-filter-search">
        <input
          type="search"
          value={filters.search}
          onChange={(event) => set({ search: event.target.value })}
          placeholder="POI ara..."
          aria-label="POI adı, kategori veya oluşturana göre ara"
        />
      </div>

      <label className="admin-filter-select">
        <span>Kategori</span>
        <select
          value={filters.category}
          onChange={(event) => set({ category: event.target.value })}
          aria-label="Kategoriye göre süz"
        >
          {categories.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className="admin-filter-select">
        <span>Durum</span>
        <select
          value={filters.status}
          onChange={(event) => set({ status: event.target.value })}
          aria-label="Duruma göre süz"
        >
          {ADMIN_POI_STATUS_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className="admin-filter-select">
        <span>Oluşturan</span>
        <select
          value={filters.creator}
          onChange={(event) => set({ creator: event.target.value })}
          aria-label="Oluşturana göre süz"
        >
          {creators.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>

      <label className="admin-filter-select">
        <span>Sırala</span>
        <select
          value={filters.sort}
          onChange={(event) => set({ sort: event.target.value })}
          aria-label="Sıralama ölçütü"
        >
          {ADMIN_POI_SORT_OPTIONS.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </label>

      <div className="admin-filter-meta">
        {/* Sayaç ikinci plandadır: bilgi verir, dikkat çekmez. */}
        <span className="admin-filter-count" role="status">
          {matchCount === total ? `${total} POI` : `${matchCount} / ${total} POI`}
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
