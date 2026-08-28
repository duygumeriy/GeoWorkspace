import { useMemo, useState } from 'react'
import {
  ADMIN_STOP_DEFAULT_FILTERS,
  adminStopActions,
  adminStopFiltersActive,
  adminStopStatus,
  buildAdminStopView,
} from '../../map/adminTransportStops.js'

export default function AdminTransportStopManagement({
  routes,
  activeStops,
  deletedStops,
  loading,
  error,
  permissions,
  onRetry,
  onFocus,
  onEdit,
  onDelete,
  onRestore,
}) {
  const [filters, setFilters] = useState(ADMIN_STOP_DEFAULT_FILTERS)
  const allStops = useMemo(() => [...activeStops, ...deletedStops.map((stop) => ({ ...stop, isDeleted: true }))], [activeStops, deletedStops])
  const visibleStops = useMemo(() => buildAdminStopView(allStops, filters), [allStops, filters])
  const filtersActive = adminStopFiltersActive(filters)

  const updateFilter = (key, value) => setFilters((current) => ({ ...current, [key]: value }))

  return (
    <section className="admin-stop-management" aria-labelledby="admin-stop-management-title">
      <header className="admin-stop-management-heading">
        <div>
          <h2 id="admin-stop-management-title">Durak Yönetimi</h2>
          <p>Tüm erişilebilir güzergâhlardaki durakları tek listeden yönetin.</p>
        </div>
        <span aria-label={`${allStops.length} durak`}>{allStops.length}</span>
      </header>

      <div className="admin-stop-filters" role="search" aria-label="Durak filtreleri">
        <label>
          <span>Durak ara</span>
          <input type="search" value={filters.search} onChange={(event) => updateFilter('search', event.target.value)} placeholder="Durak adı" />
        </label>
        <label>
          <span>Güzergah</span>
          <select value={filters.routeId} onChange={(event) => updateFilter('routeId', event.target.value)}>
            <option value="all">Tüm Güzergahlar</option>
            {routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
          </select>
        </label>
        <label>
          <span>Durum</span>
          <select value={filters.status} onChange={(event) => updateFilter('status', event.target.value)}>
            <option value="all">Tümü</option>
            <option value="active">Aktif</option>
            {permissions.canRestoreStop && <option value="deleted">Silinmiş</option>}
          </select>
        </label>
        {filtersActive && <button type="button" className="admin-button secondary" onClick={() => setFilters(ADMIN_STOP_DEFAULT_FILTERS)}>Filtreleri Temizle</button>}
      </div>

      {error && <div className="admin-error" role="alert"><span>{error}</span><button type="button" onClick={onRetry}>Tekrar dene</button></div>}
      {loading && <div className="admin-skeleton" role="status" aria-label="Duraklar yükleniyor" />}
      {!loading && !error && allStops.length === 0 && <div className="admin-empty">Henüz durak bulunmuyor.</div>}
      {!loading && !error && allStops.length > 0 && visibleStops.length === 0 && <div className="admin-empty">Filtrelere uygun durak bulunamadı.</div>}

      {!loading && !error && visibleStops.length > 0 && (
        <div className="admin-stop-table-wrap">
          <table className="admin-stop-table">
            <thead><tr><th>Durak Adı</th><th>Güzergah</th><th>Sıra</th><th>Durum</th><th>Koordinat</th><th><span className="sr-only">İşlemler</span></th></tr></thead>
            <tbody>
              {visibleStops.map((stop) => {
                const status = adminStopStatus(stop)
                const actions = adminStopActions(stop, permissions)
                return (
                  <tr key={`${status}-${stop.id}`}>
                    <td data-label="Durak Adı"><strong>{stop.name}</strong></td>
                    <td data-label="Güzergah"><span className="transport-route-swatch" style={{ backgroundColor: stop.routeColor }} aria-hidden="true" /> {stop.routeName}</td>
                    <td data-label="Sıra">{stop.sequenceOrder}</td>
                    <td data-label="Durum"><span className={`admin-stop-status is-${status}`}>{status === 'deleted' ? 'Silinmiş' : 'Aktif'}</span></td>
                    <td data-label="Koordinat"><span className="admin-stop-coordinate">{stop.latitude.toFixed(6)}, {stop.longitude.toFixed(6)}</span></td>
                    <td data-label="İşlemler">
                      <div className="admin-stop-row-actions">
                        {actions.includes('focus') && <button type="button" className="admin-button secondary" onClick={() => onFocus(stop)}>Haritada Göster</button>}
                        {actions.includes('edit') && <button type="button" className="admin-button secondary" onClick={() => onEdit(stop)}>Düzenle</button>}
                        {actions.includes('delete') && <button type="button" className="admin-button danger" onClick={() => onDelete(stop)}>Sil</button>}
                        {actions.includes('restore') && <button type="button" className="admin-button" onClick={() => onRestore(stop)}>Geri Yükle</button>}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
