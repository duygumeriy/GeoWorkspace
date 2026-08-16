import { useEffect, useId, useRef, useState } from 'react'
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
 * What a vertex is called, per type.
 *
 * A polygon's vertices are corners of a boundary and a line's are stops along a
 * route; using one word for both was part of why the old panel read as generic
 * "points" that could be shuffled freely.
 */
const VERTEX_NOUN = { polygon: 'Köşe', line: 'Nokta' }

/** "Köşe 3" / "Nokta 3" — the same label the map draws on the marker. */
function vertexLabel(type, index) {
  return `${VERTEX_NOUN[type] ?? 'Nokta'} ${index + 1}`
}

/**
 * "Köşe 3–4 Arasına Ekle": names the exact segment a new vertex will split.
 *
 * This is the answer to the question the old `+` button raised and never
 * answered. The numbers are the ones on the map markers, so the button says
 * where the point will appear in terms the user can already see.
 */
function insertLabel(type, fromIndex, toIndex) {
  return `${VERTEX_NOUN[type] ?? 'Nokta'} ${fromIndex + 1}–${toIndex + 1} Arasına Ekle`
}

/**
 * The "Geometri" half of the edit panel.
 *
 * Every control here writes into the same edit-session vertex list the map's
 * Modify/Translate interactions write into, so a coordinate typed in a box and a
 * vertex dragged on the map are the same edit — one geometry, one undo stack.
 * Nothing in this file talks to the API; the session is saved by the panel above.
 *
 * ## Naming the effect, not the icon
 *
 * Every action that changes the shape says what it will do in words, and
 * insertion says *between which two numbered vertices* it will do it. Nothing
 * load-bearing is an unlabelled arrow or a bare `+`: the user should not have to
 * press a button to find out what it does.
 *
 * ## One selection, two surfaces
 *
 * `selectedVertex` / `selectedEdge` come from the edit session and are shared
 * with the map overlay. Clicking a row here highlights the marker out there;
 * clicking the marker scrolls this list to the row. There is no second copy of
 * "which vertex am I working on".
 *
 * Coordinates are WGS84 (EPSG:4326) throughout, which the panel states plainly
 * rather than leaving the user to guess from the numbers. The map's own
 * projection (3857) never surfaces here — the session converts at its boundary.
 */
export default function GeometryEditor({
  type,
  coords,
  segments = [],
  metrics,
  validity,
  editMode,
  onEditModeChange,
  selectedVertex = null,
  selectedEdge = null,
  onSelectVertex,
  onSetVertex,
  onAddVertexAfter,
  onAddVertexBefore,
  onSplitSelectedEdge,
  onRemoveVertex,
  onMoveVertex,
  onExtend,
  onShorten,
  onTargetLength,
  onFocusVertex,
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

      {/* A point has no vertices to pick between, so the two map gestures would
          do the same thing; offering the choice would be noise. */}
      {type !== 'point' && <ModeToggle mode={editMode} onChange={onEditModeChange} />}

      <Metrics type={type} metrics={metrics} />

      {type === 'point' && (
        <PointEditor
          vertex={coords[0]}
          onSetVertex={onSetVertex}
          onFocusVertex={onFocusVertex}
          onCopy={onCopy}
        />
      )}

      {type === 'polygon' && (
        <PolygonEditor
          coords={coords}
          segments={segments}
          selectedVertex={selectedVertex}
          selectedEdge={selectedEdge}
          onSelectVertex={onSelectVertex}
          onSetVertex={onSetVertex}
          onAddVertexAfter={onAddVertexAfter}
          onSplitSelectedEdge={onSplitSelectedEdge}
          onRemoveVertex={onRemoveVertex}
          onFocusVertex={onFocusVertex}
          onNotify={onNotify}
        />
      )}

      {type === 'line' && (
        <LineEditor
          coords={coords}
          metrics={metrics}
          selectedVertex={selectedVertex}
          onSelectVertex={onSelectVertex}
          onSetVertex={onSetVertex}
          onAddVertexAfter={onAddVertexAfter}
          onAddVertexBefore={onAddVertexBefore}
          onRemoveVertex={onRemoveVertex}
          onMoveVertex={onMoveVertex}
          onExtend={onExtend}
          onShorten={onShorten}
          onTargetLength={onTargetLength}
          onFocusVertex={onFocusVertex}
          onNotify={onNotify}
        />
      )}

      {type !== 'point' && (
        <button type="button" className="geometry-tertiary-action" onClick={copyAll}>
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
 * going wrong. Here a drag always means exactly one thing — and each option
 * spells out which thing, so the choice does not have to be made by experiment.
 */
function ModeToggle({ mode, onChange }) {
  const options = [
    {
      id: GEOMETRY_EDIT_MODES.vertex,
      title: 'Köşeleri Düzenle',
      description: 'Tek tek köşe noktalarını sürükleyerek şekli değiştirebilirsiniz.',
    },
    {
      id: GEOMETRY_EDIT_MODES.translate,
      title: 'Tüm Geometriyi Taşı',
      description: 'Şeklin boyutunu ve biçimini değiştirmeden tamamını taşıyabilirsiniz.',
    },
  ]

  return (
    <div className="geometry-modes" role="group" aria-label="Harita düzenleme modu">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`geometry-mode ${mode === option.id ? 'is-active' : ''}`}
          aria-pressed={mode === option.id}
          onClick={() => onChange(option.id)}
        >
          <span className="geometry-mode-title">{option.title}</span>
          <span className="geometry-mode-description">{option.description}</span>
        </button>
      ))}
    </div>
  )
}

/** Read-only live measurements, recomputed from the session's vertex list. */
function Metrics({ type, metrics }) {
  // A point's coordinates ARE its measurements, and they are already shown as
  // labelled inputs below; repeating them would be two places to read one fact.
  if (!metrics || type === 'point') return null

  const items = []
  if (type === 'line') items.push({ label: 'Toplam Uzunluk', value: formatLength(metrics.length) })
  if (type === 'polygon') {
    items.push(
      { label: 'Alan', value: formatArea(metrics.area) },
      { label: 'Çevre', value: formatLength(metrics.perimeter) },
    )
  }
  items.push({
    label: type === 'polygon' ? 'Köşe Sayısı' : 'Nokta Sayısı',
    value: `${metrics.vertexCount}`,
  })

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

/**
 * A point has one coordinate and nothing to sequence, so the editor is one pair
 * of inputs and two plain actions. Everything the line and polygon editors need
 * — insertion, ordering, selection — would be furniture here.
 */
function PointEditor({ vertex, onSetVertex, onFocusVertex, onCopy }) {
  const fieldId = useId()

  return (
    <div className="geometry-section">
      <h4 className="geometry-section-title">Konum</h4>

      <CoordinateFields idPrefix={fieldId} vertex={vertex} onChange={(next) => onSetVertex(0, next)} />

      <div className="geometry-actions">
        <button
          type="button"
          className="geometry-secondary-action"
          onClick={() => onFocusVertex?.(0)}
        >
          <CrosshairIcon size={14} />
          Haritada Göster
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
        Harita üzerinde taşımak için noktayı sürükleyebilirsiniz; iki yöntem aynı koordinatı düzenler.
      </p>
    </div>
  )
}

/* --- Shared vertex row ------------------------------------------------------ */

/**
 * One vertex: its number, its coordinates, and the actions that apply to it.
 *
 * The header is a button rather than a label — clicking anywhere on it selects
 * the vertex, which is what lights up the matching numbered marker on the map.
 * Actions are always visible rather than revealed by selection: a control the
 * user has to discover is exactly the problem this phase exists to remove.
 */
function VertexRow({ type, index, vertex, selected, onSelect, onSetVertex, onFocusVertex, children }) {
  const fieldId = useId()
  const rowRef = useRef(null)

  /* Selection can arrive from the MAP, in which case the matching row may be
     scrolled out of sight. `nearest` scrolls the minimum needed and does nothing
     when the row is already visible. Focus is deliberately NOT moved: the user
     clicked a map marker, not a text box, and stealing the caret would hijack
     the keyboard mid-edit. */
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const label = vertexLabel(type, index)

  return (
    <li ref={rowRef} className={`vertex-row ${selected ? 'is-selected' : ''}`}>
      <div className="vertex-row-head">
        <button
          type="button"
          className="vertex-name"
          aria-pressed={selected}
          onClick={() => onSelect?.(index)}
        >
          {label}
        </button>

        <button
          type="button"
          className="vertex-locate"
          onClick={() => onFocusVertex?.(index)}
        >
          <CrosshairIcon size={13} />
          Haritada Göster
        </button>
      </div>

      <CoordinateFields
        compact
        idPrefix={fieldId}
        vertex={vertex}
        onChange={(next) => onSetVertex(index, next)}
      />

      <div className="vertex-row-actions">{children}</div>
    </li>
  )
}

/** "Köşeyi Sil" / "Noktayı Sil", disabled with its reason at the minimum. */
function DeleteVertexButton({ type, index, atMinimum, minimum, onRemoveVertex, onNotify }) {
  const reason =
    type === 'polygon'
      ? `Polygon için en az ${minimum} köşe gereklidir.`
      : `Çizgi için en az ${minimum} nokta gereklidir.`

  const handleRemove = () => {
    const refusal = onRemoveVertex(index)
    if (refusal) onNotify?.('info', refusal)
  }

  return (
    <button
      type="button"
      className="vertex-action vertex-action--danger"
      disabled={atMinimum}
      title={atMinimum ? reason : undefined}
      onClick={handleRemove}
    >
      <TrashIcon size={12} />
      {type === 'polygon' ? 'Köşeyi Sil' : 'Noktayı Sil'}
    </button>
  )
}

/* --- Polygon ---------------------------------------------------------------- */

/**
 * The polygon vertex editor.
 *
 * ## Why there is no reorder control
 *
 * A polygon's vertex order *is* its boundary. Swapping two of them does not
 * rearrange a list, it re-routes an edge — usually into a self-intersecting
 * shape the backend then rejects. The old up/down arrows offered that as a
 * casual, unlabelled action. Reshaping is done by moving vertices (on the map or
 * by coordinate) and by adding and deleting them, all of which keep the ring
 * traversable.
 *
 * ## Where a new vertex goes
 *
 * Always onto a named edge, at its midpoint, and the button says which edge:
 * either "Köşe 3–4 Arasına Ekle" in the row, or the edge picked on the map. The
 * ring wraps, so the last row offers the closing edge ("Köşe 6–1") rather than
 * flinging a point off into space the way an open-ended append would.
 */
function PolygonEditor({
  coords,
  segments,
  selectedVertex,
  selectedEdge,
  onSelectVertex,
  onSetVertex,
  onAddVertexAfter,
  onSplitSelectedEdge,
  onRemoveVertex,
  onFocusVertex,
  onNotify,
}) {
  const minimum = MIN_VERTICES.polygon
  const atMinimum = coords.length <= minimum
  const selectedSegment = selectedEdge == null ? null : segments[selectedEdge]
  const edgePickerRef = useRef(null)

  /* An edge is picked out on the MAP, but the action that uses it lives at the
     bottom of the panel — below the fold behind a long vertex list. Without
     this, clicking an edge appears to do nothing at all. */
  useEffect(() => {
    if (selectedSegment) edgePickerRef.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedSegment])

  return (
    <div className="geometry-section">
      <p className="geometry-hint" role="note">
        Poligon köşeleri haritada numaralandırılmıştır. Bir köşeye veya kenara tıklayarak
        seçebilirsiniz.
      </p>

      <ul className="vertex-list">
        {coords.map((vertex, index) => {
          // The ring closes, so the vertex after the last one is the first.
          const next = (index + 1) % coords.length

          return (
            // Index-keyed on purpose: a vertex has no identity of its own, and its
            // position IS what the user is editing. A value-based key would make
            // React re-create the row every time a coordinate changed.
            // eslint-disable-next-line react/no-array-index-key
            <VertexRow
              key={index}
              type="polygon"
              index={index}
              vertex={vertex}
              selected={index === selectedVertex}
              onSelect={onSelectVertex}
              onSetVertex={onSetVertex}
              onFocusVertex={onFocusVertex}
            >
              <button
                type="button"
                className="vertex-action"
                onClick={() => onAddVertexAfter(index)}
              >
                {insertLabel('polygon', index, next)}
              </button>

              <DeleteVertexButton
                type="polygon"
                index={index}
                atMinimum={atMinimum}
                minimum={minimum}
                onRemoveVertex={onRemoveVertex}
                onNotify={onNotify}
              />
            </VertexRow>
          )
        })}
      </ul>

      {atMinimum && (
        <p className="geometry-hint" role="note">
          Polygon için en az {minimum} köşe gereklidir; silme şu an kapalı.
        </p>
      )}

      <div className="edge-picker" ref={edgePickerRef}>
        <h4 className="geometry-section-title">Kenara Köşe Ekle</h4>
        <p className="geometry-hint">
          Haritada bir kenara tıklayın: seçilen kenar vurgulanır ve yeni köşe tam ortasına eklenir.
        </p>
        <button
          type="button"
          className="geometry-secondary-action"
          disabled={!selectedSegment}
          onClick={onSplitSelectedEdge}
        >
          {selectedSegment
            ? `Seçili Kenara Köşe Ekle (Köşe ${selectedSegment.from + 1}–${selectedSegment.to + 1})`
            : 'Önce haritadan bir kenar seçin'}
        </button>
      </div>
    </div>
  )
}

/* --- Line ------------------------------------------------------------------- */

/**
 * The line editor, split into two sub-sections.
 *
 * A LineString carries both a vertex list and the geodesic length tools, and
 * stacking them made the panel a wall of controls where the coordinate list and
 * the extend/shorten inputs competed for attention. They are different jobs, so
 * they get different tabs and only one is on screen at a time.
 *
 * Unlike a polygon, a line's vertex order is its *direction of travel* and
 * reordering is a legitimate edit — so it stays, but under "Gelişmiş", because
 * it is far rarer than moving, adding or deleting a point.
 */
function LineEditor({
  coords,
  metrics,
  selectedVertex,
  onSelectVertex,
  onSetVertex,
  onAddVertexAfter,
  onAddVertexBefore,
  onRemoveVertex,
  onMoveVertex,
  onExtend,
  onShorten,
  onTargetLength,
  onFocusVertex,
  onNotify,
}) {
  const [section, setSection] = useState('points')

  return (
    <div className="geometry-section">
      <div className="geometry-subtabs" role="tablist" aria-label="Çizgi düzenleme bölümleri">
        <button
          type="button"
          role="tab"
          aria-selected={section === 'points'}
          className={`geometry-subtab ${section === 'points' ? 'is-active' : ''}`}
          onClick={() => setSection('points')}
        >
          Noktalar
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={section === 'length'}
          className={`geometry-subtab ${section === 'length' ? 'is-active' : ''}`}
          onClick={() => setSection('length')}
        >
          Uzunluk Araçları
        </button>
      </div>

      {section === 'points' ? (
        <LineVertexEditor
          coords={coords}
          selectedVertex={selectedVertex}
          onSelectVertex={onSelectVertex}
          onSetVertex={onSetVertex}
          onAddVertexAfter={onAddVertexAfter}
          onAddVertexBefore={onAddVertexBefore}
          onRemoveVertex={onRemoveVertex}
          onMoveVertex={onMoveVertex}
          onFocusVertex={onFocusVertex}
          onNotify={onNotify}
        />
      ) : (
        <LineTools
          onExtend={onExtend}
          onShorten={onShorten}
          onTargetLength={onTargetLength}
          currentLength={metrics?.length ?? 0}
          onNotify={onNotify}
        />
      )}
    </div>
  )
}

function LineVertexEditor({
  coords,
  selectedVertex,
  onSelectVertex,
  onSetVertex,
  onAddVertexAfter,
  onAddVertexBefore,
  onRemoveVertex,
  onMoveVertex,
  onFocusVertex,
  onNotify,
}) {
  const minimum = MIN_VERTICES.line
  const atMinimum = coords.length <= minimum
  const lastIndex = coords.length - 1

  return (
    <div className="geometry-section">
      <p className="geometry-hint" role="note">
        Noktalar haritada 1’den {coords.length}’e doğru numaralandırılmıştır; bu sıra çizginin
        yönünü belirler.
      </p>

      <ul className="vertex-list">
        {coords.map((vertex, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <VertexRow
            key={index}
            type="line"
            index={index}
            vertex={vertex}
            selected={index === selectedVertex}
            onSelect={onSelectVertex}
            onSetVertex={onSetVertex}
            onFocusVertex={onFocusVertex}
          >
            <button type="button" className="vertex-action" onClick={() => onAddVertexBefore(index)}>
              {/* Before the first point there is no segment to split, so the new
                  point continues the line backwards — and says so. */}
              {index === 0 ? 'Başa Nokta Ekle' : insertLabel('line', index - 1, index)}
            </button>

            <button type="button" className="vertex-action" onClick={() => onAddVertexAfter(index)}>
              {index === lastIndex ? 'Sona Nokta Ekle' : insertLabel('line', index, index + 1)}
            </button>

            <DeleteVertexButton
              type="line"
              index={index}
              atMinimum={atMinimum}
              minimum={minimum}
              onRemoveVertex={onRemoveVertex}
              onNotify={onNotify}
            />

            {/* Reordering re-routes the line, so it is deliberately one level
                down rather than sitting next to the everyday actions. */}
            <details className="vertex-advanced">
              <summary>Gelişmiş</summary>
              <div className="vertex-advanced-actions">
                <button
                  type="button"
                  className="vertex-action"
                  disabled={index === 0}
                  onClick={() => onMoveVertex(index, -1)}
                >
                  <ChevronIcon size={12} className="vertex-arrow-up" />
                  Bir Önceki Sıraya Taşı
                </button>
                <button
                  type="button"
                  className="vertex-action"
                  disabled={index === lastIndex}
                  onClick={() => onMoveVertex(index, 1)}
                >
                  <ChevronIcon size={12} />
                  Bir Sonraki Sıraya Taşı
                </button>
              </div>
            </details>
          </VertexRow>
        ))}
      </ul>

      {atMinimum && (
        <p className="geometry-hint" role="note">
          Çizgi için en az {minimum} nokta gereklidir; silme şu an kapalı.
        </p>
      )}

      {/* Extending either end without first hunting for the terminal row. */}
      <div className="geometry-actions">
        <button
          type="button"
          className="geometry-secondary-action"
          onClick={() => onAddVertexBefore(0)}
        >
          + Başlangıca Nokta Ekle
        </button>
        <button
          type="button"
          className="geometry-secondary-action"
          onClick={() => onAddVertexAfter(lastIndex)}
        >
          + Sona Nokta Ekle
        </button>
      </div>

      <p className="geometry-hint" role="note">
        Uçlara eklenen nokta, son bölümün yönünde devam ederek yerleştirilir; ardından haritadan
        sürükleyebilir veya koordinatını yazabilirsiniz.
      </p>
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
    /* The live "Toplam Uzunluk" metric sits above the sub-tabs and stays on
       screen here, so this section does not repeat it as a second figure the
       reader has to check against the first. */
    <div className="geometry-section line-tools">
      <h4 className="geometry-section-title">Uzat / Kısalt</h4>

      <p className="geometry-hint">
        Seçilen uç, çizginin son bölümünün yönünde ileri veya geri taşınır; şekil bozulmaz.
      </p>

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

      <p className="geometry-hint">
        Mevcut uzunluk {formatLength(currentLength)}. Sabit uç yerinde kalır, diğer uç hedefe göre
        taşınır.
      </p>

      <div className="line-tool-row">
        <label className="line-tool-field">
          <span className="line-tool-label" id={`${fieldId}-target-label`}>
            Hedef uzunluk
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
