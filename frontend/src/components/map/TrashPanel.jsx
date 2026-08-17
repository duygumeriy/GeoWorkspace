import { useMemo, useState } from 'react'
import MapSheet from './MapSheet.jsx'
import { PointIcon, LineIcon, PolygonIcon, CloseIcon, UndoIcon } from '../ui/icons/index.js'
import { TYPE_FILTERS } from '../../map/drawingFilters.js'
import { DEFAULT_TRASH_SORT, TRASH_SORT_OPTIONS, buildTrashView } from '../../map/trashFilters.js'
import { DRAWING_TYPES } from '../../map/drawingTypes.js'
import { formatDateTime } from '../../map/datetime.js'
import './TrashPanel.css'

const TYPE_ICONS = { point: PointIcon, line: LineIcon, polygon: PolygonIcon }

/**
 * "Çöp Kutusu" — the current user's soft-deleted drawings, and the way back.
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
          Silinen çizimler yükleniyor...
        </p>
      )}

      {!loading && error && (
        <div className="trash-error" role="alert">
          <p className="trash-error-text">Silinen çizimler yüklenemedi.</p>
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
          Çöp kutusunda çizim yok.
          <span className="trash-empty-hint">Silinen çizimler burada görünecek.</span>
        </p>
      )}

      {!loading && !error && total > 0 && (
        <>
          <div className="trash-controls">
            <div className="trash-search">
              <input
                type="search"
                className="trash-search-input"
                placeholder="Çizim adına göre ara..."
                aria-label="Silinen çizimlerde adına göre ara"
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

            {/* The same four options "Çizimlerim" offers, from the same table —
                one trash for all three geometry types, not three screens. */}
            <div className="trash-chips" role="group" aria-label="Tür filtresi">
              {TYPE_FILTERS.map((filter) => (
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
              <p className="trash-empty">Bu filtreyle eşleşen çizim bulunamadı.</p>
              {isFiltered && (
                <button type="button" className="trash-retry" onClick={resetFilters}>
                  Filtreleri Temizle
                </button>
              )}
            </div>
          ) : (
            <ul className="trash-items">
              {visible.map((item) => {
                const config = DRAWING_TYPES[item.type]
                const Icon = TYPE_ICONS[item.type]
                const drawing = item.drawing ?? {}
                const key = `${item.type}:${drawing.id}`
                const isRestoring = restoringKey === key
                const title = drawing.name || config?.label || 'Çizim'

                return (
                  <li key={key} className="trash-row">
                    <span
                      className="trash-item-dot"
                      style={{ '--dot': drawing.style?.strokeColor ?? 'var(--primary-light)' }}
                      aria-hidden="true"
                    />

                    <span className="trash-item-icon" aria-hidden="true">
                      {Icon && <Icon size={15} />}
                    </span>

                    <span className="trash-item-text">
                      <span className="trash-item-title">
                        #{drawing.id} {title}
                      </span>
                      <span className="trash-item-meta">Tür: {config?.label ?? item.type}</span>
                      {/* The deletion time, not the modification time: the two
                          are different questions and only one of them belongs
                          in a trash. */}
                      <span className="trash-item-meta">Silinme: {formatDateTime(item.deletedAt)}</span>
                    </span>

                    <button
                      type="button"
                      className="trash-restore"
                      disabled={isRestoring}
                      aria-label={`${title} çizimini geri yükle`}
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
