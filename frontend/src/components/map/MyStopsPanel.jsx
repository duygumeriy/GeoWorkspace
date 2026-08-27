import { useMemo, useState } from 'react'
import MapSheet from './MapSheet.jsx'
import { CloseIcon, FocusIcon, TrashIcon } from '../ui/icons/index.js'
import { Pencil } from 'lucide-react'
import { buildMyStopView, MY_STOP_SORT_OPTIONS, myStopRouteOptions } from '../../map/myStopsFilters.js'
import './DrawingsPanel.css'
import './Transport.css'

export default function MyStopsPanel({
  open,
  onClose,
  stops = [],
  loading = false,
  error = null,
  onRetry,
  onSelect,
  onEdit,
  onDelete,
  canEdit = false,
  canDelete = false,
  busyId = null,
}) {
  const [search, setSearch] = useState('')
  const [routeId, setRouteId] = useState('all')
  const [sort, setSort] = useState('route-order')
  const routes = useMemo(() => myStopRouteOptions(stops), [stops])
  const visible = useMemo(() => buildMyStopView(stops, { search, routeId, sort }), [stops, search, routeId, sort])

  if (!open) return null
  const filtered = search.trim() || routeId !== 'all' || sort !== 'route-order'
  const clearFilters = () => { setSearch(''); setRouteId('all'); setSort('route-order') }

  return (
    <MapSheet open title={stops.length ? `Duraklarım (${stops.length})` : 'Duraklarım'} onClose={onClose} className="drawings-panel my-stops-panel">
      {loading && <p className="drawings-status" role="status">Duraklarınız yükleniyor...</p>}
      {!loading && error && <div className="drawings-error" role="alert"><p className="drawings-error-text">Duraklarınız yüklenemedi.</p><button type="button" className="drawings-retry" onClick={onRetry}>Tekrar Dene</button></div>}
      {!loading && !error && stops.length === 0 && <p className="drawings-empty">Henüz eklediğiniz bir durak bulunmuyor.</p>}
      {!loading && !error && stops.length > 0 && <>
        <div className="drawings-controls">
          <div className="drawings-search">
            <input type="search" className="drawings-search-input" placeholder="Durak ara..." aria-label="Duraklarımda ara" value={search} onChange={(event) => setSearch(event.target.value)} />
            {search && <button type="button" className="drawings-search-clear" aria-label="Aramayı temizle" onClick={() => setSearch('')}><CloseIcon size={13} /></button>}
          </div>
          <div className="drawings-selects">
            <label className="drawings-select">
              <span className="drawings-select-label">Güzergah</span>
              <select aria-label="Güzergah filtresi" value={routeId} onChange={(event) => setRouteId(event.target.value)}>
                <option value="all">Tüm Güzergahlar</option>
                {routes.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <label className="drawings-select">
              <span className="drawings-select-label">Sıralama</span>
              <select aria-label="Durak sıralaması" value={sort} onChange={(event) => setSort(event.target.value)}>
                {MY_STOP_SORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
              </select>
            </label>
          </div>
        </div>
        <div className="my-stops-summary"><span>{visible.length} / {stops.length} durak</span>{filtered && <button type="button" className="drawings-retry" onClick={clearFilters}>Filtreleri Temizle</button>}</div>
        {visible.length === 0 ? <div className="drawings-empty-filtered"><p className="drawings-empty">Bu filtrelere uygun durak bulunamadı.</p></div> :
          <ul className="drawings-items">{visible.map((stop) => <li key={stop.id} className="drawings-row">
            <button type="button" className="drawings-item" aria-label={`${stop.name} durağına git`} onClick={() => onSelect?.(stop)}>
              <span className="transport-route-color my-stops-color" style={{ backgroundColor: stop.routeColor || stop.colorHex }} aria-hidden="true" />
              <span className="drawings-item-text"><span className="drawings-item-title">#{stop.id} {stop.name}</span><span className="drawings-item-meta">{stop.routeName}</span><span className="drawings-item-meta">Sıra: {String(stop.sequenceOrder).padStart(2, '0')}</span></span>
            </button>
            <span className="drawings-item-actions">
              <button type="button" className="drawings-action" aria-label={`${stop.name} durağını haritada göster`} onClick={() => onSelect?.(stop)}><FocusIcon size={14} /></button>
              {canEdit && <button type="button" className="drawings-action" title="Düzenle" aria-label={`${stop.name} durağını düzenle`} disabled={busyId === stop.id} onClick={() => onEdit?.(stop)}><Pencil size={14} /></button>}
              {canDelete && <button type="button" className="drawings-action drawings-action--danger" aria-label={`${stop.name} durağını sil`} disabled={busyId === stop.id} onClick={() => onDelete?.(stop)}><TrashIcon size={14} /></button>}
            </span>
          </li>)}</ul>}
      </>}
    </MapSheet>
  )
}
