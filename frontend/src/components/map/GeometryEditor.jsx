import { useId, useState } from 'react'
import CoordinateFields from './CoordinateFields.jsx'
import { ChevronIcon, CrosshairIcon, TrashIcon } from '../ui/icons/index.js'
import { GEOMETRY_EDIT_MODES } from '../../hooks/useGeometryEditing.js'
import { MIN_VERTICES, formatCoordsForCopy, formatVertexForCopy } from '../../map/geometryEdit.js'
import { formatArea, formatLength } from '../../map/measure.js'
import './GeometryEditor.css'

/** Length units offered by the extend/shorten tools. */
const DISTANCE_UNITS = [
  { id: 'm', label: 'metre', toMetres: 1 },
  { id: 'km', label: 'kilometre', toMetres: 1000 },
]

/**
 * The "Geometri" half of the edit panel.
 *
 * Every control here writes into the same edit-session vertex list the map's
 * Modify/Translate interactions write into, so a coordinate typed in a box and a
 * vertex dragged on the map are the same edit — one geometry, one undo stack.
 * Nothing in this file talks to the API; the session is saved by the panel above.
 *
 * Coordinates are WGS84 (EPSG:4326) throughout, which the panel states plainly
 * rather than leaving the user to guess from the numbers. The map's own
 * projection (3857) never surfaces here — the session converts at its boundary.
 */
export default function GeometryEditor({
  type,
  coords,
  metrics,
  validity,
  editMode,
  onEditModeChange,
  onSetVertex,
  onAddVertex,
  onRemoveVertex,
  onMoveVertex,
  onExtend,
  onShorten,
  onTargetLength,
  onZoomToVertex,
  onCopy,
  onNotify,
}) {
  if (!coords?.length) return null

  const copyAll = () => {
    onCopy?.(formatCoordsForCopy(coords), `${coords.length} koordinat kopyalandı.`)
  }

  return (
    <div className="geometry-editor">
      <p className="geometry-projection" role="note">
        Koordinatlar WGS84 (EPSG:4326) formatındadır.
      </p>

      <ModeToggle mode={editMode} onChange={onEditModeChange} />

      <Metrics type={type} metrics={metrics} />

      {type === 'point' ? (
        <PointEditor
          vertex={coords[0]}
          onSetVertex={onSetVertex}
          onZoomToVertex={onZoomToVertex}
          onCopy={onCopy}
        />
      ) : (
        <VertexEditor
          type={type}
          coords={coords}
          onSetVertex={onSetVertex}
          onAddVertex={onAddVertex}
          onRemoveVertex={onRemoveVertex}
          onMoveVertex={onMoveVertex}
          onNotify={onNotify}
        />
      )}

      {type === 'line' && (
        <LineTools
          onExtend={onExtend}
          onShorten={onShorten}
          onTargetLength={onTargetLength}
          currentLength={metrics?.length ?? 0}
          onNotify={onNotify}
        />
      )}

      {type !== 'point' && (
        <button type="button" className="geometry-secondary-action" onClick={copyAll}>
          Tüm Koordinatları Kopyala
        </button>
      )}

      {!validity.ok && validity.reason && (
        <p className="geometry-invalid" role="alert">
          {validity.reason}
        </p>
      )}
    </div>
  )
}

/**
 * "Köşeleri Düzenle" vs "Tüm Geometriyi Taşı".
 *
 * A mode rather than two always-live interactions: with both attached, a drag
 * aimed at a vertex could move the whole shape instead, which reads as the edit
 * going wrong. Here a drag always means exactly one thing.
 */
function ModeToggle({ mode, onChange }) {
  return (
    <div className="geometry-modes" role="group" aria-label="Harita düzenleme modu">
      <button
        type="button"
        className={`geometry-mode ${mode === GEOMETRY_EDIT_MODES.vertex ? 'is-active' : ''}`}
        aria-pressed={mode === GEOMETRY_EDIT_MODES.vertex}
        onClick={() => onChange(GEOMETRY_EDIT_MODES.vertex)}
      >
        Köşeleri Düzenle
      </button>
      <button
        type="button"
        className={`geometry-mode ${mode === GEOMETRY_EDIT_MODES.translate ? 'is-active' : ''}`}
        aria-pressed={mode === GEOMETRY_EDIT_MODES.translate}
        onClick={() => onChange(GEOMETRY_EDIT_MODES.translate)}
      >
        Tüm Geometriyi Taşı
      </button>
    </div>
  )
}

/** Read-only live measurements, recomputed from the session's vertex list. */
function Metrics({ type, metrics }) {
  if (!metrics) return null

  const items = []
  if (type === 'line') items.push({ label: 'Toplam Uzunluk', value: formatLength(metrics.length) })
  if (type === 'polygon') {
    items.push(
      { label: 'Alan', value: formatArea(metrics.area) },
      { label: 'Çevre', value: formatLength(metrics.perimeter) },
    )
  }
  items.push({ label: type === 'polygon' ? 'Köşe' : 'Nokta', value: `${metrics.vertexCount}` })

  return (
    <dl className="geometry-metrics">
      {items.map((item) => (
        <div key={item.label} className="geometry-metric">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/* --- Point ----------------------------------------------------------------- */

function PointEditor({ vertex, onSetVertex, onZoomToVertex, onCopy }) {
  const fieldId = useId()

  return (
    <div className="geometry-section">
      <CoordinateFields idPrefix={fieldId} vertex={vertex} onChange={(next) => onSetVertex(0, next)} />

      <div className="geometry-actions">
        <button type="button" className="geometry-secondary-action" onClick={onZoomToVertex}>
          <CrosshairIcon size={14} />
          Bu Konuma Git
        </button>
        <button
          type="button"
          className="geometry-secondary-action"
          onClick={() => onCopy?.(formatVertexForCopy(vertex), 'Koordinat kopyalandı.')}
        >
          Koordinatı Kopyala
        </button>
      </div>

      <p className="geometry-hint" role="note">
        Konumu haritadan da sürükleyebilirsiniz; iki yöntem aynı koordinatı düzenler.
      </p>
    </div>
  )
}

/* --- Line / Polygon vertex table -------------------------------------------- */

/**
 * The vertex list for lines and polygons.
 *
 * Reordering uses explicit up/down buttons rather than drag handles: a drag
 * reorder is not reliably operable by touch or keyboard, and this list has to
 * work on a phone. Deleting stops at the type's minimum — the button disables
 * itself and says why, instead of failing at save time.
 *
 * For polygons the list shows *unique* vertices with the ring left open; the
 * user is never asked to repeat the first coordinate at the end. Closure happens
 * once, where the real geometry is built.
 */
function VertexEditor({ type, coords, onSetVertex, onAddVertex, onRemoveVertex, onMoveVertex, onNotify }) {
  const fieldId = useId()
  const minimum = MIN_VERTICES[type]
  const atMinimum = coords.length <= minimum

  const handleRemove = (index) => {
    const reason = onRemoveVertex(index)
    if (reason) onNotify?.('info', reason)
  }

  return (
    <div className="geometry-section">
      <ul className="vertex-list">
        {coords.map((vertex, index) => (
          // Index-keyed on purpose: a vertex has no identity of its own, and its
          // position IS what the user is editing. A value-based key would make
          // React re-create the row every time a coordinate changed.
          // eslint-disable-next-line react/no-array-index-key
          <li key={index} className="vertex-row">
            <div className="vertex-row-head">
              <span className="vertex-index">{index + 1}</span>

              <span className="vertex-tools">
                <button
                  type="button"
                  className="vertex-tool"
                  title="Yukarı taşı"
                  aria-label={`${index + 1}. köşeyi yukarı taşı`}
                  disabled={index === 0}
                  onClick={() => onMoveVertex(index, -1)}
                >
                  <ChevronIcon size={13} className="vertex-tool-up" />
                </button>
                <button
                  type="button"
                  className="vertex-tool"
                  title="Aşağı taşı"
                  aria-label={`${index + 1}. köşeyi aşağı taşı`}
                  disabled={index === coords.length - 1}
                  onClick={() => onMoveVertex(index, 1)}
                >
                  <ChevronIcon size={13} />
                </button>
                <button
                  type="button"
                  className="vertex-tool"
                  title="Sonrasına nokta ekle"
                  aria-label={`${index + 1}. köşeden sonra nokta ekle`}
                  onClick={() => onAddVertex(index)}
                >
                  +
                </button>
                <button
                  type="button"
                  className="vertex-tool vertex-tool--danger"
                  title={atMinimum ? `En az ${minimum} köşe gereklidir` : 'Bu köşeyi sil'}
                  aria-label={`${index + 1}. köşeyi sil`}
                  disabled={atMinimum}
                  onClick={() => handleRemove(index)}
                >
                  <TrashIcon size={12} />
                </button>
              </span>
            </div>

            <CoordinateFields
              compact
              idPrefix={`${fieldId}-${index}`}
              vertex={vertex}
              onChange={(next) => onSetVertex(index, next)}
            />
          </li>
        ))}
      </ul>

      <div className="geometry-actions">
        <button
          type="button"
          className="geometry-secondary-action"
          onClick={() => onAddVertex(coords.length - 1)}
        >
          + Nokta Ekle
        </button>
      </div>

      {atMinimum && (
        <p className="geometry-hint" role="note">
          {type === 'polygon'
            ? `Poligon en az ${minimum} köşe içermelidir; silme şu an kapalı.`
            : `Çizgi en az ${minimum} nokta içermelidir; silme şu an kapalı.`}
        </p>
      )}
    </div>
  )
}

/* --- Line length tools ------------------------------------------------------ */

/**
 * Extend, shorten and target-length for a LineString.
 *
 * All three are geodesic: the distance is measured on the WGS84 sphere and the
 * new endpoint is placed along the terminal segment's true bearing, so "250
 * metre" means the same thing at every latitude rather than 250 distorted Web
 * Mercator metres.
 *
 * Nothing is written to the database — each operation edits the session's vertex
 * list, the map previews it immediately, and "Kaydet" is still the only way out.
 */
function LineTools({ onExtend, onShorten, onTargetLength, currentLength, onNotify }) {
  const fieldId = useId()

  const [end, setEnd] = useState('end')
  const [distance, setDistance] = useState('')
  const [unit, setUnit] = useState('m')
  const [fixedEnd, setFixedEnd] = useState('start')
  const [target, setTarget] = useState('')
  const [targetUnit, setTargetUnit] = useState('km')

  const toMetres = (value, unitId) =>
    Number(value) * (DISTANCE_UNITS.find((item) => item.id === unitId)?.toMetres ?? 1)

  /** Runs an operation and surfaces the refusal reason rather than doing nothing. */
  const run = (operation) => {
    const reason = operation()
    if (reason) onNotify?.('error', reason)
  }

  const distanceMetres = toMetres(distance, unit)
  const hasDistance = distance.trim() !== '' && Number.isFinite(distanceMetres) && distanceMetres > 0

  const targetMetres = toMetres(target, targetUnit)
  const hasTarget = target.trim() !== '' && Number.isFinite(targetMetres) && targetMetres > 0

  return (
    <div className="geometry-section line-tools">
      <h4 className="geometry-section-title">Uzat / Kısalt</h4>

      <div className="line-tool-row">
        <label className="line-tool-field">
          <span className="line-tool-label">Uç</span>
          <select value={end} onChange={(event) => setEnd(event.target.value)}>
            <option value="start">Başlangıç</option>
            <option value="end">Bitiş</option>
          </select>
        </label>

        <label className="line-tool-field">
          <span className="line-tool-label" id={`${fieldId}-distance-label`}>
            Mesafe
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={distance}
            placeholder="0"
            aria-labelledby={`${fieldId}-distance-label`}
            onChange={(event) => setDistance(event.target.value)}
          />
        </label>

        <label className="line-tool-field line-tool-field--unit">
          <span className="line-tool-label">Birim</span>
          <select value={unit} onChange={(event) => setUnit(event.target.value)}>
            {DISTANCE_UNITS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="geometry-actions">
        <button
          type="button"
          className="geometry-secondary-action"
          disabled={!hasDistance}
          title={hasDistance ? undefined : 'Önce sıfırdan büyük bir mesafe girin'}
          onClick={() => run(() => onExtend(end, distanceMetres))}
        >
          Uzat
        </button>
        <button
          type="button"
          className="geometry-secondary-action"
          disabled={!hasDistance}
          title={hasDistance ? undefined : 'Önce sıfırdan büyük bir mesafe girin'}
          onClick={() => run(() => onShorten(end, distanceMetres))}
        >
          Kısalt
        </button>
      </div>

      <h4 className="geometry-section-title">Hedef Uzunluk</h4>

      <p className="geometry-hint">Mevcut: {formatLength(currentLength)}</p>

      <div className="line-tool-row">
        <label className="line-tool-field">
          <span className="line-tool-label" id={`${fieldId}-target-label`}>
            Hedef
          </span>
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={target}
            placeholder="0"
            aria-labelledby={`${fieldId}-target-label`}
            onChange={(event) => setTarget(event.target.value)}
          />
        </label>

        <label className="line-tool-field line-tool-field--unit">
          <span className="line-tool-label">Birim</span>
          <select value={targetUnit} onChange={(event) => setTargetUnit(event.target.value)}>
            {DISTANCE_UNITS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        <label className="line-tool-field">
          <span className="line-tool-label">Sabit uç</span>
          <select value={fixedEnd} onChange={(event) => setFixedEnd(event.target.value)}>
            <option value="start">Başlangıç</option>
            <option value="end">Bitiş</option>
          </select>
        </label>
      </div>

      <div className="geometry-actions">
        <button
          type="button"
          className="geometry-secondary-action"
          disabled={!hasTarget}
          title={hasTarget ? undefined : 'Önce sıfırdan büyük bir hedef uzunluk girin'}
          onClick={() => run(() => onTargetLength(targetMetres, fixedEnd))}
        >
          Uzunluğu Uygula
        </button>
      </div>
    </div>
  )
}
