import { useMemo, useState } from 'react'
import MapSheet from './MapSheet.jsx'
import { PointIcon, LineIcon, PolygonIcon, CloseIcon, UndoIcon, PinIcon } from '../ui/icons/index.js'
import {
  DEFAULT_TRASH_SORT,
  TRASH_SORT_OPTIONS,
  TRASH_TYPE_FILTERS,
  buildTrashView,
  trashRecordOf,
} from '../../map/trashFilters.js'
import { DRAWING_TYPES } from '../../map/drawingTypes.js'
import { formatDateTime } from '../../map/datetime.js'
import './TrashPanel.css'

/* POI'nin kendi simgesi vardır: listede bir noktadan ayırt edilebilmelidir. */
const TYPE_ICONS = { point: PointIcon, line: LineIcon, polygon: PolygonIcon, poi: PinIcon, 'transport-stop': PinIcon, 'transport-route': LineIcon }

/** Çizim türleri kanonik tablodan gelir; POI ayrı bir kayıttır. */
const POI_LABEL = 'POI'

/**
 * "Çöp Kutusu" — soft-deleted records the caller can bring back, and the way
 * back. Drawings and POIs share ONE panel: "ne sildim?" is the same question
 * whichever table the row lives in.
 *
 * This panel is the visible half of a feature the backend already had: deleting
 * a drawing has always kept the row and only marked it, but until now nothing in
 * the UI could show that, so a deletion looked permanent. Here the record is
 * listed with what it was, what type it is, its colour and when it was deleted,
 * and one button reopens it.
 *
 * Deliberately NOT here: permanent deletion. The panel lists, filters, searches
 * and restores — nothing in it can remove a row from the database.
 *
 * Structure mirrors "Çizimlerim" (same MapSheet, same chip row, same search
 * field, same status blocks) so the two read as one application rather than two.
 * Search, type filtering and ordering are applied by `buildTrashView`; this
 * component owns only the control values. Ownership filtering already happened
 * on the server — nothing here is a security check.
 */
export default function TrashPanel({
  open,
  onClose,
  items = [],
  loading = false,
  error = null,
  restoringKey = null,
  onRetry,
  onRestore,
}) {
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sort, setSort] = useState(DEFAULT_TRASH_SORT)

  const { items: visible, matchCount } = useMemo(
    () => buildTrashView(items, { search, type: typeFilter, sort }),
    [items, search, typeFilter, sort],
  )

  if (!open) return null

  const total = items.length
  const isFiltered = search.trim().length > 0 || typeFilter !== 'all'

  const resetFilters = () => {
    setSearch('')
    setTypeFilter('all')
  }

  return (
    <MapSheet
      open={open}
      title={total > 0 ? `Çöp Kutusu (${total})` : 'Çöp Kutusu'}
      onClose={onClose}
      className="trash-panel"
    >
      {loading && (
        <p className="trash-status" role="status" aria-live="polite">
          Silinen kayıtlar yükleniyor...
        </p>
      )}

      {!loading && error && (
        <div className="trash-error" role="alert">
          <p className="trash-error-text">Silinen kayıtlar yüklenemedi.</p>
          {onRetry && (
            <button type="button" className="trash-retry" onClick={onRetry}>
              Tekrar Dene
            </button>
          )}
        </div>
      )}

      {/* Two different empty states. "Nothing here" and "nothing matched" are
          different situations and a single message for both would send the user
          looking for a drawing that a filter is hiding. */}
      {!loading && !error && total === 0 && (
        <p className="trash-empty">
          Çöp kutusunda kayıt yok.
          <span className="trash-empty-hint">Silinen çizimler ve POI'ler burada görünecek.</span>
        </p>
      )}

      {!loading && !error && total > 0 && (
        <>
          <div className="trash-controls">
            <div className="trash-search">
              <input
                type="search"
                className="trash-search-input"
                placeholder="Kayıt adına göre ara..."
                aria-label="Silinen kayıtlarda adına göre ara"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {search && (
                <button
                  type="button"
                  className="trash-search-clear"
                  aria-label="Aramayı temizle"
                  onClick={() => setSearch('')}
                >
                  <CloseIcon size={13} />
                </button>
              )}
            </div>

            {/* Çizim türleri "Çizimlerim" ile aynı kanonik tablodan; POI
                dördüncü bir çip olarak eklenir — tek çöp kutusu, dört tür. */}
            <div className="trash-chips" role="group" aria-label="Tür filtresi">
              {TRASH_TYPE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`trash-chip ${typeFilter === filter.id ? 'is-active' : ''}`}
                  aria-pressed={typeFilter === filter.id}
                  onClick={() => setTypeFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <label className="trash-select">
              <span className="trash-select-label">Sırala</span>
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                {TRASH_SORT_OPTIONS.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {matchCount === 0 ? (
            <div className="trash-empty-filtered">
              <p className="trash-empty">Bu filtreyle eşleşen kayıt bulunamadı.</p>
              {isFiltered && (
                <button type="button" className="trash-retry" onClick={resetFilters}>
                  Filtreleri Temizle
                </button>
              )}
            </div>
          ) : (
            <ul className="trash-items">
              {visible.map((item) => {
                const isPoi = item.type === 'poi'
                const isTransportStop = item.type === 'transport-stop'
                const isTransportRoute = item.type === 'transport-route'
                const config = DRAWING_TYPES[item.type]
                const Icon = TYPE_ICONS[item.type]
                /* Tek okuma: çizim girişleri `drawing`, POI girişleri `poi`
                   taşır ve ikisi de aynı şekle sahiptir. */
                const record = trashRecordOf(item) ?? {}
                const key = `${item.type}:${record.id}`
                const isRestoring = restoringKey === key
                const typeLabel = isPoi ? POI_LABEL : isTransportStop ? 'Durak' : isTransportRoute ? 'Güzergah' : config?.label ?? item.type
                const title = record.name || typeLabel

                return (
                  <li key={key} className="trash-row">
                    <span
                      className="trash-item-dot"
                      style={{
                        // POI'nin stili yoktur; haritadaki mavisiyle temsil edilir.
                        '--dot': isPoi
                          ? 'var(--poi-color, #2563EB)'
                          : record.routeColor ?? record.colorHex ?? record.style?.strokeColor ?? 'var(--primary-light)',
                      }}
                      aria-hidden="true"
                    />

                    <span className="trash-item-icon" aria-hidden="true">
                      {Icon && <Icon size={15} />}
                    </span>

                    <span className="trash-item-text">
                      <span className="trash-item-title">
                        #{record.id} {title}
                      </span>
                      <span className="trash-item-meta">Tür: {typeLabel}</span>
                      {/* POI'nin anlamlı ikinci alanı kategorisidir; çizimin
                          yerine geçen bir alan uydurulmaz. */}
                      {isPoi && (record.categoryPath || record.categoryName) && (
                        <span className="trash-item-meta">
                          Kategori: {record.categoryPath || record.categoryName}
                        </span>
                      )}
                      {isTransportStop && <span className="trash-item-meta">Güzergah: {record.routeName || '—'} · Sıra: {record.sequenceOrder}</span>}
                      {isTransportRoute && <span className="trash-item-meta">Durak: {record.stopCount ?? 0}</span>}
                      {/* Ekleyen YALNIZCA sunucu gönderdiyse (poi.manage)
                          gösterilir; harita sözleşmesi onu taşımaz. */}
                      {isPoi && item.creatorUsername && (
                        <span className="trash-item-meta">Ekleyen: {item.creatorUsername}</span>
                      )}
                      {/* The deletion time, not the modification time: the two
                          are different questions and only one of them belongs
                          in a trash. */}
                      <span className="trash-item-meta">Silinme: {formatDateTime(item.deletedAt)}</span>
                    </span>

                    <button
                      type="button"
                      className="trash-restore"
                      disabled={isRestoring}
                      aria-label={`${title} kaydını geri yükle`}
                      onClick={() => onRestore?.(item)}
                    >
                      <UndoIcon size={14} />
                      {isRestoring ? 'Yükleniyor...' : 'Geri Yükle'}
                    </button>
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
