import { DRAWING_TYPES } from '../../map/drawingTypes.js'
import { MEASURE_MODES } from '../../hooks/useMeasurement.js'
import { ANALYSIS_TOOL_INFO, SELECTION_TOOLS } from '../../hooks/useWorkspaceMode.js'
import './MapOverlays.css'

/**
 * Small transient overlays drawn straight onto the map viewport: the
 * contextual drawing hint, the desktop hover tooltip, the live measurement
 * readout and the "saving" indicator.
 */

/** Contextual instructions for the active tool. */
export function DrawingHint({ activeTool, measureMode, selectionTool, analysisActive }) {
  let text = ''

  if (activeTool) text = DRAWING_TYPES[activeTool]?.hint ?? ''
  else if (analysisActive) text = ANALYSIS_TOOL_INFO.hint
  else if (measureMode) {
    const mode = MEASURE_MODES.find((item) => item.id === measureMode)
    text =
      mode?.id === 'area'
        ? 'Ölçmek istediğiniz alanı çizin · Çift tıklayarak bitirin · ESC ile iptal.'
        : 'Ölçüm için noktalar ekleyin · Çift tıklayarak bitirin · ESC ile iptal.'
  } else if (selectionTool && selectionTool !== 'single') {
    // "Tekli" is the resting state and needs no banner; the spatial tools
    // change what a drag does, so they explain themselves.
    text = SELECTION_TOOLS.find((tool) => tool.id === selectionTool)?.hint ?? ''
  }

  if (!text) return null

  return (
    <div className="map-hint" role="status">
      {text}
    </div>
  )
}

/**
 * Desktop-only hover tooltip. Positioned from the pointer pixel and nudged
 * left/up near the edges so it cannot be clipped by the viewport.
 */
export function HoverTooltip({ hovered }) {
  if (!hovered) return null

  return (
    <div
      className="map-hover-tooltip"
      style={{ left: `${hovered.pixel[0]}px`, top: `${hovered.pixel[1]}px` }}
      aria-hidden="true"
    >
      <span className="map-hover-title">{hovered.title}</span>
      {hovered.detail && <span className="map-hover-detail">{hovered.detail}</span>}
    </div>
  )
}

/** Live measurement value while drawing, plus the finished results. */
export function MeasurementReadout({ mode, liveLabel, results, onSelectMode, onClear, onClose }) {
  if (!mode) return null

  return (
    <div className="measure-readout" role="status" aria-label="Ölçüm">
      <div className="measure-modes" role="group" aria-label="Ölçüm türü">
        {MEASURE_MODES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`measure-mode ${mode === item.id ? 'is-active' : ''}`}
            aria-pressed={mode === item.id}
            onClick={() => onSelectMode(item.id)}
          >
            {item.label}
          </button>
        ))}
        <button type="button" className="measure-close" aria-label="Ölçümü kapat" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="measure-value" aria-live="polite">
        {liveLabel || results.at(-1)?.label || 'Ölçüm için haritaya çizin'}
      </div>

      {results.length > 0 && (
        <button type="button" className="measure-clear" onClick={onClear}>
          Ölçümleri temizle ({results.length})
        </button>
      )}

      <p className="measure-note">Ölçümler veritabanına kaydedilmez.</p>
    </div>
  )
}

/** Save-in-progress indicator shown while a POST/PATCH is in flight. */
export function SavingIndicator({ visible }) {
  if (!visible) return null
  return (
    <div className="map-saving" role="status">
      <span className="map-saving-dot" aria-hidden="true" />
      Kaydediliyor...
    </div>
  )
}
