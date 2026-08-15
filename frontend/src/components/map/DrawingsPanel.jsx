import { useState } from 'react'
import MapSheet from './MapSheet.jsx'
import { PointIcon, LineIcon, PolygonIcon, ChevronIcon, CheckSquareIcon } from '../ui/icons/index.js'
import './DrawingsPanel.css'

const TYPE_ICONS = { point: PointIcon, line: LineIcon, polygon: PolygonIcon }

function formatShortDate(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/**
 * Expandable inventory of everything stored in PostGIS, grouped by type.
 *
 * Two interaction modes:
 *  - normal: selecting a record selects it on the map and zooms to it;
 *  - "Seç": rows become checkboxes for building a multi-selection.
 *
 * Both write to the SAME `selectedKeys` state the map uses — the list is a
 * second view of one selection, not a second selection. Ticking a row here
 * haloes the feature on the map, and a box selection on the map ticks the rows.
 *
 * @param {Set<string>} selectedKeys
 */
export default function DrawingsPanel({
  open,
  onClose,
  groups,
  selectedKeys,
  visibility,
  visibleCount,
  onSelect,
  onToggleSelect,
  onSelectAllVisible,
  onClearSelection,
}) {
  const [expanded, setExpanded] = useState(() => ({ point: true, line: true, polygon: true }))
  const [selectMode, setSelectMode] = useState(false)

  if (!open) return null

  const total = groups.reduce((sum, group) => sum + group.items.length, 0)
  const selectedCount = selectedKeys.size

  return (
    <MapSheet open={open} title="Çizimler" onClose={onClose} className="drawings-panel">
      {total > 0 && (
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
      )}

      {selectMode && (
        <p className="drawings-select-status" role="status" aria-live="polite">
          {selectedCount === 0 ? 'Hiçbir çizim seçilmedi.' : `${selectedCount} çizim seçildi.`}
        </p>
      )}

      {total === 0 ? (
        <p className="drawings-empty">Henüz kayıtlı çizim yok. Alt araç çubuğundan çizim yapabilirsiniz.</p>
      ) : (
        groups.map((group) => {
          const Icon = TYPE_ICONS[group.type.id]
          const isOpen = expanded[group.type.id]
          // A hidden layer is called out, because in select mode its rows are
          // excluded from "Tüm Görünenleri Seç" and that would look arbitrary.
          const isHidden = visibility?.[group.type.id] === false

          return (
            <section key={group.type.id} className="drawings-group">
              <button
                type="button"
                className="drawings-group-head"
                aria-expanded={isOpen}
                onClick={() => setExpanded((current) => ({ ...current, [group.type.id]: !current[group.type.id] }))}
              >
                <Icon size={16} />
                <span className="drawings-group-title">
                  {group.type.plural} ({group.items.length})
                </span>
                {isHidden && <span className="drawings-group-hidden">gizli</span>}
                <ChevronIcon size={15} className={`drawings-chevron ${isOpen ? 'is-open' : ''}`} />
              </button>

              {isOpen && (
                <ul className="drawings-items">
                  {group.items.length === 0 && <li className="drawings-item-empty">Kayıt yok</li>}
                  {group.items.map((item) => {
                    const isSelected = selectedKeys.has(item.key)

                    return (
                      <li key={item.key}>
                        <button
                          type="button"
                          className={`drawings-item ${isSelected ? 'is-selected' : ''}`}
                          // In select mode the row is a checkbox; otherwise it
                          // is a navigation target. The ARIA role follows.
                          role={selectMode ? 'checkbox' : undefined}
                          aria-checked={selectMode ? isSelected : undefined}
                          aria-current={!selectMode && isSelected ? 'true' : undefined}
                          onClick={() => (selectMode ? onToggleSelect(item.key) : onSelect(item.key))}
                        >
                          {selectMode && (
                            <span className={`drawings-item-check ${isSelected ? 'is-checked' : ''}`} aria-hidden="true">
                              {isSelected && <CheckSquareIcon size={14} />}
                            </span>
                          )}
                          <span
                            className="drawings-item-dot"
                            style={{ '--dot': item.style?.strokeColor ?? 'var(--primary-light)' }}
                            aria-hidden="true"
                          />
                          <span className="drawings-item-text">
                            <span className="drawings-item-title">
                              #{item.databaseId} {item.name || group.type.label}
                            </span>
                            <span className="drawings-item-meta">
                              {item.createdBy || '—'} · {formatShortDate(item.createdDate)}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )
        })
      )}
    </MapSheet>
  )
}
