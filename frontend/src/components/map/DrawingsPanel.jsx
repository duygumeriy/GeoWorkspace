import { useMemo, useState } from 'react'
import MapSheet from './MapSheet.jsx'
import {
  PointIcon,
  LineIcon,
  PolygonIcon,
  CheckSquareIcon,
  FocusIcon,
  PaletteIcon,
  TrashIcon,
  CloseIcon,
} from '../ui/icons/index.js'
import {
  DEFAULT_GROUP,
  DEFAULT_SORT,
  GROUP_OPTIONS,
  SORT_OPTIONS,
  TYPE_FILTERS,
  buildDrawingView,
} from '../../map/drawingFilters.js'
import { DRAWING_TYPES } from '../../map/drawingTypes.js'
import './DrawingsPanel.css'

const TYPE_ICONS = { point: PointIcon, line: LineIcon, polygon: PolygonIcon }

function formatShortDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * "Çizimlerim" — the management panel for the current user's drawings.
 *
 * The list is a second view of ONE selection, not a second selection: rows
 * write to the same `selectedKeys` the map uses, so selecting here haloes the
 * feature on the map and a box selection on the map ticks the rows.
 *
 * Two interaction modes:
 *  - normal: a row selects its drawing, frames it on the map and opens the
 *    detail panel; per-row actions offer edit and delete;
 *  - "Seç": rows become checkboxes for building a multi-selection.
 *
 * Search, type filter, sorting and grouping are applied by `buildDrawingView`;
 * this component owns only the control values. Ownership and soft-delete
 * filtering already happened on the server — nothing here is a security check.
 *
 * @param {Set<string>} selectedKeys
 */
export default function DrawingsPanel({
  open,
  onClose,
  drawings = [],
  selectedKeys,
  visibility,
  visibleCount,
  loading = false,
  error = null,
  onRetry,
  onSelect,
  onToggleSelect,
  onSelectAllVisible,
  onClearSelection,
  onEdit,
  onDelete,
  canManage,
}) {
  const [selectMode, setSelectMode] = useState(false)
  const [search, setSearch] = useState('')
  const [typeFilter, setTypeFilter] = useState('all')
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [group, setGroup] = useState(DEFAULT_GROUP)

  const { groups, matchCount } = useMemo(
    () => buildDrawingView(drawings, { search, type: typeFilter, sort, group }),
    [drawings, search, typeFilter, sort, group],
  )

  if (!open) return null

  const total = drawings.length
  const selectedCount = selectedKeys.size
  const isFiltered = search.trim().length > 0 || typeFilter !== 'all'

  const resetFilters = () => {
    setSearch('')
    setTypeFilter('all')
  }

  return (
    <MapSheet
      open={open}
      title={total > 0 ? `Çizimlerim (${total})` : 'Çizimlerim'}
      onClose={onClose}
      className="drawings-panel"
    >
      {loading && (
        <p className="drawings-status" role="status" aria-live="polite">
          Çizimler yükleniyor...
        </p>
      )}

      {!loading && error && (
        <div className="drawings-error" role="alert">
          <p className="drawings-error-text">Çizimler yüklenemedi.</p>
          {onRetry && (
            <button type="button" className="drawings-retry" onClick={onRetry}>
              Tekrar Dene
            </button>
          )}
        </div>
      )}

      {!loading && !error && total === 0 && (
        <p className="drawings-empty">Henüz çiziminiz yok. Alt araç çubuğundan çizim yapabilirsiniz.</p>
      )}

      {!loading && !error && total > 0 && (
        <>
          <div className="drawings-controls">
            <div className="drawings-search">
              <input
                type="search"
                className="drawings-search-input"
                placeholder="Çizim ara..."
                aria-label="Çizim ara"
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

            {/* Type filter as a segmented row: four short labels fit on a phone
                and each choice stays one tap away. */}
            <div className="drawings-chips" role="group" aria-label="Tür filtresi">
              {TYPE_FILTERS.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  className={`drawings-chip ${typeFilter === filter.id ? 'is-active' : ''}`}
                  aria-pressed={typeFilter === filter.id}
                  onClick={() => setTypeFilter(filter.id)}
                >
                  {filter.label}
                </button>
              ))}
            </div>

            <div className="drawings-selects">
              <label className="drawings-select">
                <span className="drawings-select-label">Sırala</span>
                <select value={sort} onChange={(event) => setSort(event.target.value)}>
                  {SORT_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="drawings-select">
                <span className="drawings-select-label">Grupla</span>
                <select value={group} onChange={(event) => setGroup(event.target.value)}>
                  {GROUP_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          <div className="drawings-toolbar">
            <button
              type="button"
              className={`drawings-mode-btn ${selectMode ? 'is-active' : ''}`}
              aria-pressed={selectMode}
              onClick={() => setSelectMode((value) => !value)}
            >
              <CheckSquareIcon size={15} />
              Seç
            </button>

            {selectMode && (
              <>
                <button
                  type="button"
                  className="drawings-bulk-btn"
                  disabled={visibleCount === 0}
                  onClick={onSelectAllVisible}
                >
                  Tüm Görünenleri Seç
                </button>
                <button
                  type="button"
                  className="drawings-bulk-btn"
                  disabled={selectedCount === 0}
                  onClick={onClearSelection}
                >
                  Seçimi Temizle
                </button>
              </>
            )}
          </div>

          {selectMode && (
            <p className="drawings-select-status" role="status" aria-live="polite">
              {selectedCount === 0 ? 'Hiçbir çizim seçilmedi.' : `${selectedCount} çizim seçildi.`}
            </p>
          )}

          {matchCount === 0 ? (
            <div className="drawings-empty-filtered">
              <p className="drawings-empty">Bu filtrelere uygun çizim bulunamadı.</p>
              {isFiltered && (
                <button type="button" className="drawings-retry" onClick={resetFilters}>
                  Filtreleri Temizle
                </button>
              )}
            </div>
          ) : (
            groups.map((entry) => (
              <section key={entry.id} className="drawings-group">
                {/* Ungrouped results come back as one unlabelled group, so the
                    header simply disappears rather than needing a second layout. */}
                {entry.label && (
                  <h3 className="drawings-group-title">
                    {entry.label} ({entry.items.length})
                  </h3>
                )}

                <ul className="drawings-items">
                  {entry.items.map((item) => {
                    const isSelected = selectedKeys.has(item.key)
                    const Icon = TYPE_ICONS[item.type]
                    const config = DRAWING_TYPES[item.type]
                    const isHidden = visibility?.[item.type] === false
                    const manageable = canManage ? canManage(item) : true

                    return (
                      <li key={item.key} className={`drawings-row ${isSelected ? 'is-selected' : ''}`}>
                        <button
                          type="button"
                          className="drawings-item"
                          // In select mode the row is a checkbox; otherwise it
                          // is a navigation target. The ARIA role follows.
                          role={selectMode ? 'checkbox' : undefined}
                          aria-checked={selectMode ? isSelected : undefined}
                          aria-current={!selectMode && isSelected ? 'true' : undefined}
                          onClick={() => (selectMode ? onToggleSelect(item.key) : onSelect(item.key))}
                        >
                          {selectMode && (
                            <span
                              className={`drawings-item-check ${isSelected ? 'is-checked' : ''}`}
                              aria-hidden="true"
                            >
                              {isSelected && <CheckSquareIcon size={14} />}
                            </span>
                          )}

                          <span
                            className="drawings-item-dot"
                            style={{ '--dot': item.style?.strokeColor ?? 'var(--primary-light)' }}
                            aria-hidden="true"
                          />

                          <span className="drawings-item-icon" aria-hidden="true">
                            <Icon size={15} />
                          </span>

                          <span className="drawings-item-text">
                            <span className="drawings-item-title">
                              #{item.databaseId} {item.name || config.label}
                            </span>
                            <span className="drawings-item-meta">
                              {config.label} · {formatShortDate(item.createdDate)}
                              {isHidden && ' · gizli'}
                            </span>
                          </span>
                        </button>

                        {/* Always rendered, never hover-revealed: on a phone
                            there is no hover to reveal them with. */}
                        {!selectMode && (
                          <span className="drawings-item-actions">
                            <button
                              type="button"
                              className="drawings-action"
                              title="Haritada Göster"
                              aria-label={`${item.name || config.label} çizimini haritada göster`}
                              onClick={() => onSelect(item.key)}
                            >
                              <FocusIcon size={14} />
                            </button>
                            {manageable && (
                              <>
                                <button
                                  type="button"
                                  className="drawings-action"
                                  title="Düzenle"
                                  aria-label={`${item.name || config.label} çizimini düzenle`}
                                  onClick={() => onEdit?.(item.key)}
                                >
                                  <PaletteIcon size={14} />
                                </button>
                                <button
                                  type="button"
                                  className="drawings-action drawings-action--danger"
                                  title="Sil"
                                  aria-label={`${item.name || config.label} çizimini sil`}
                                  onClick={() => onDelete?.(item.key)}
                                >
                                  <TrashIcon size={14} />
                                </button>
                              </>
                            )}
                          </span>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))
          )}
        </>
      )}
    </MapSheet>
  )
}
