import MapSheet from './MapSheet.jsx'
import { DRAWING_TYPE_LIST } from '../../map/drawingTypes.js'
import { PointIcon, LineIcon, PolygonIcon } from '../ui/icons/index.js'
import './LayersPanel.css'

const TYPE_ICONS = { point: PointIcon, line: LineIcon, polygon: PolygonIcon }

/**
 * Per-geometry-type visibility.
 *
 * Turning a layer off only stops it rendering (the style function returns no
 * style for that type) — the features stay in the source and the rows stay in
 * PostGIS, so switching back on restores them with no refetch.
 */
export default function LayersPanel({ open, onClose, visibility, counts, onToggle }) {
  if (!open) return null

  return (
    <MapSheet open={open} title="Katmanlar" onClose={onClose} className="layers-panel">
      <p className="layers-hint">
        Katmanı kapatmak yalnızca görünümü gizler; kayıtlar veritabanında kalır.
      </p>

      <ul className="layers-list">
        {DRAWING_TYPE_LIST.map((type) => {
          const Icon = TYPE_ICONS[type.id]
          const isOn = visibility[type.id] !== false

          return (
            <li key={type.id}>
              <button
                type="button"
                className={`layers-row ${isOn ? 'is-on' : ''}`}
                aria-pressed={isOn}
                onClick={() => onToggle(type.id)}
              >
                <span className="layers-row-icon">
                  <Icon size={18} />
                </span>
                <span className="layers-row-text">
                  <span className="layers-row-label">{type.plural}</span>
                  <span className="layers-row-count">{counts[type.id] ?? 0} kayıt</span>
                </span>
                {/* Text state, not colour alone. */}
                <span className="layers-row-state">{isOn ? 'AÇIK' : 'KAPALI'}</span>
                <span className="layers-switch" aria-hidden="true">
                  <span className="layers-switch-knob" />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </MapSheet>
  )
}
