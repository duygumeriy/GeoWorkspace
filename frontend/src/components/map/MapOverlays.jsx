import { DRAWING_TYPES, DRAWING_TYPE_LIST } from '../../map/drawingTypes.js'
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

/**
 * Result of a spatial inventory analysis.
 *
 * One readout serves both entry points — the temporary "Envanter Analizi" tool
 * and the automatic run after a polygon is saved — because they answer the same
 * question and only one of them can be the latest. The wording states which one
 * produced the number, and "Temizle" only appears for the temporary area, since
 * a saved polygon's own record is not this panel's to remove.
 */
export function AnalysisReadout({ loading, result, error, onClear, onClose }) {
  if (!loading && !result && !error) return null

  return (
    <div className="analysis-readout" role="status" aria-live="polite" aria-label="Envanter analizi">
      <div className="analysis-readout-head">
        <span className="analysis-readout-title">Analiz Sonucu</span>
        <button type="button" className="analysis-readout-close" aria-label="Analiz sonucunu kapat" onClick={onClose}>
          ×
        </button>
      </div>

      {loading && <p className="analysis-readout-state">Kesişim analizi yapılıyor...</p>}

      {!loading && error && <p className="analysis-readout-state analysis-readout-state--error">{error}</p>}

      {!loading && !error && result && (
        <>
          <p className="analysis-readout-total">
            {result.total > 0
              ? `Bu poligon ${result.total} envanter ile kesişiyor.`
              : 'Bu poligon hiçbir envanterle kesişmiyor.'}
          </p>
          <p className="analysis-readout-source">{result.label}</p>

          {result.total > 0 && (
            <ul className="analysis-readout-breakdown">
              {DRAWING_TYPE_LIST.map((type) => (
                <li key={type.id} className="analysis-readout-item">
                  <span className="analysis-readout-item-label">{type.plural}</span>
                  <span className="analysis-readout-item-value">{result[type.id]}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {result?.temporary && (
        <button type="button" className="analysis-readout-clear" onClick={onClear}>
          Analiz alanını temizle
        </button>
      )}

      <p className="analysis-readout-note">Analiz alanı veritabanına kaydedilmez.</p>
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
