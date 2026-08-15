import { DRAWING_TYPE_LIST } from '../../map/drawingTypes.js'
import { MEASURE_MODES } from '../../hooks/useMeasurement.js'
import { ANALYSIS_TOOL_INFO, SELECTION_TOOLS } from '../../hooks/useWorkspaceMode.js'
import {
  PointIcon,
  LineIcon,
  PolygonIcon,
  RulerIcon,
  UndoIcon,
  RedoIcon,
  PaletteIcon,
  CursorIcon,
  BoxSelectIcon,
  LassoIcon,
  AnalysisIcon,
} from '../ui/icons/index.js'
import './DrawToolbar.css'

const TOOL_ICONS = { point: PointIcon, line: LineIcon, polygon: PolygonIcon }
const SELECTION_ICONS = { single: CursorIcon, box: BoxSelectIcon, polygon: LassoIcon }

/**
 * Floating draw-tool bar over the map viewport, bottom-centre.
 *
 * Placed over the map rather than in the sidebar so it stays reachable at every
 * breakpoint — on mobile the sidebar is an off-canvas drawer and would hide the
 * tools while drawing.
 *
 * Every button here renders from the canonical workspace mode: `activeTool` is
 * non-null only while the workspace is actually in draw mode, so what the bar
 * highlights is always what the map will do on the next click. Selection tools
 * sit in their own group; choosing one leaves draw mode, which is why a draw
 * tool and a selection tool can never look active at the same time.
 */
export default function DrawToolbar({
  activeTool,
  onSelectTool,
  measureMode,
  onSelectMeasure,
  selectionTool,
  onSelectSelectionTool,
  analysisActive,
  onToggleAnalysis,
  onOpenStyle,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}) {
  return (
    <div className="draw-toolbar" role="toolbar" aria-label="Çizim araçları">
      <div className="draw-toolbar-group">
        {DRAWING_TYPE_LIST.map((type) => {
          const Icon = TOOL_ICONS[type.id]
          const isActive = activeTool === type.id

          return (
            <button
              key={type.id}
              type="button"
              className={`draw-toolbar-btn ${isActive ? 'is-active' : ''}`}
              aria-pressed={isActive}
              aria-label={`${type.label} çiz (${type.shortcut})`}
              title={`${type.label} çiz — ${type.shortcut}`}
              onClick={() => onSelectTool(type.id)}
            >
              <Icon size={18} />
              <span className="draw-toolbar-label">{type.label}</span>
            </button>
          )
        })}

        <button
          type="button"
          className={`draw-toolbar-btn ${measureMode ? 'is-active' : ''}`}
          aria-pressed={Boolean(measureMode)}
          aria-label="Ölçüm aracı (M)"
          title="Ölçüm — M"
          onClick={() => onSelectMeasure(measureMode ? null : MEASURE_MODES[0].id)}
        >
          <RulerIcon size={18} />
          <span className="draw-toolbar-label">Ölçüm</span>
        </button>

        {/* Its own mode, not a draw tool: the polygon it produces is a query,
            and nothing it draws is ever written to the database. */}
        <button
          type="button"
          className={`draw-toolbar-btn ${analysisActive ? 'is-active' : ''}`}
          aria-pressed={analysisActive}
          aria-label={`${ANALYSIS_TOOL_INFO.label} aracı`}
          title={`${ANALYSIS_TOOL_INFO.label} — geçici alan, kaydedilmez`}
          onClick={onToggleAnalysis}
        >
          <AnalysisIcon size={18} />
          <span className="draw-toolbar-label">Envanter</span>
        </button>
      </div>

      <span className="draw-toolbar-divider" aria-hidden="true" />

      <div className="draw-toolbar-group" role="group" aria-label="Seçim modu">
        {SELECTION_TOOLS.map((tool) => {
          const Icon = SELECTION_ICONS[tool.id]
          const isActive = selectionTool === tool.id

          return (
            <button
              key={tool.id}
              type="button"
              className={`draw-toolbar-btn draw-toolbar-btn--select ${isActive ? 'is-active' : ''}`}
              aria-pressed={isActive}
              aria-label={`${tool.label} seçim modu`}
              title={tool.label}
              onClick={() => onSelectSelectionTool(tool.id)}
            >
              <Icon size={18} />
              <span className="draw-toolbar-label draw-toolbar-label--select">{tool.label}</span>
            </button>
          )
        })}
      </div>

      <span className="draw-toolbar-divider" aria-hidden="true" />

      <div className="draw-toolbar-group">
        <button
          type="button"
          className="draw-toolbar-btn draw-toolbar-btn--icon"
          aria-label="Stil panelini aç"
          title="Çizim stili"
          onClick={onOpenStyle}
        >
          <PaletteIcon size={18} />
        </button>
        <button
          type="button"
          className="draw-toolbar-btn draw-toolbar-btn--icon"
          aria-label="Geri al"
          title="Geri Al — Ctrl/Cmd+Z"
          disabled={!canUndo}
          onClick={onUndo}
        >
          <UndoIcon size={18} />
        </button>
        <button
          type="button"
          className="draw-toolbar-btn draw-toolbar-btn--icon"
          aria-label="İleri al"
          title="İleri Al — Ctrl/Cmd+Shift+Z"
          disabled={!canRedo}
          onClick={onRedo}
        >
          <RedoIcon size={18} />
        </button>
      </div>
    </div>
  )
}
