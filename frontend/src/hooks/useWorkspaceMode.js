import { useCallback, useMemo, useState } from 'react'

/**
 * The single source of truth for "what does a click on the map do right now".
 *
 * Before this hook the answer was spread across three places — the drawing
 * hook's own `activeTool`, the style panel's local type tab and the measurement
 * hook's own `mode` — which is exactly why the style panel could show "Çizgi"
 * while the toolbar and the OpenLayers Draw interaction were still on "Nokta".
 *
 * Here there is one `mode` and one remembered tool per family. The *active*
 * tool of a family is derived: it is null unless `mode` names that family, so
 * two interaction families can never be live at the same time — the exclusivity
 * is structural rather than something every call site has to remember.
 *
 *   mode: 'draw'     -> activeDrawTool      point | line | polygon
 *   mode: 'select'   -> activeSelectionTool single | box | polygon
 *   mode: 'measure'  -> activeMeasureTool   distance | area
 *   mode: 'analysis' -> activeAnalysisTool  polygon
 *   mode: 'locationAnalysis' -> activeLocationAnalysisTool  polygon
 *   mode: 'edit'     -> isEditing           (geometry of the selected record)
 *   mode: 'poi'      -> isPlacingPoi        (a single point for a new POI)
 *   mode: 'transportStop' -> isPlacingTransportStop (a single point for a new stop)
 *
 * `edit` is a mode for the same reason the others are: while the user is
 * dragging the vertices of an existing record, a click must not start a new
 * drawing, a measurement or a box selection. Because every interaction is
 * created from a derived `active*` value that is null outside its own mode,
 * entering edit tears all of them down without any call site remembering to.
 *
 * The remembered (inactive) values are kept so leaving and re-entering a mode
 * returns to the tool the user last used, and so the style panel knows which
 * type to show when no tool is active.
 *
 * `poi` is its own family for the same reason `analysis` is: the point it
 * produces is NOT a drawing record. It never reaches the drawings source, the
 * attribute popup or `/api/drawings/*`; it becomes a POI through a different
 * endpoint and a different table. Making it a mode is also what guarantees its
 * Draw interaction cannot be live at the same time as the drawing, selection,
 * measurement, analysis or geometry-edit ones.
 *
 * `analysis` is a fourth family rather than a variant of `draw` because what it
 * produces is a throwaway query geometry, not a record: it must not reach the
 * drawings source, the attribute popup or the API's create endpoints. Making it
 * a mode here is also what guarantees its Draw interaction cannot be live at the
 * same time as the drawing, selection or measurement ones.
 */

export const WORKSPACE_MODES = Object.freeze({
  draw: 'draw',
  select: 'select',
  measure: 'measure',
  analysis: 'analysis',
  /**
   * Konum analizinin hedef alanı.
   *
   * `analysis` ailesinin bir varyantı DEĞİL, ayrı bir ailedir: envanter
   * analizi çağıranın KENDİ çizimlerini sayar ve sonucu bir listedir; bu ise
   * ortak açık veri POI kümesini ağırlıklandırır ve sonucu bir rasterdir.
   * İkisini aynı moda bağlamak, birini açmanın diğerinin alanını sessizce
   * silmesi demek olurdu.
   */
  locationAnalysis: 'locationAnalysis',
  edit: 'edit',
  poi: 'poi',
  transportStop: 'transportStop',
  transportStopRelocate: 'transportStopRelocate',
})

/** Selection tools, in toolbar order. */
export const SELECTION_TOOLS = Object.freeze([
  { id: 'single', label: 'Tekli', hint: 'Bir çizime tıklayın · Shift/Cmd ile seçime ekleyin.' },
  { id: 'box', label: 'Kutu ile Seç', hint: 'Haritada bir dikdörtgen sürükleyin.' },
  { id: 'polygon', label: 'Alan ile Seç', hint: 'Alan sınırını çizin · Çift tıklayarak bitirin · ESC ile iptal.' },
])

export const SELECTION_TOOL_IDS = Object.freeze(SELECTION_TOOLS.map((tool) => tool.id))

/**
 * What the style panel is editing. Lives here, next to the workspace modes it
 * follows from, because these three are the reason the panel needs a mode at
 * all: only `drawing-default` may change the active draw tool.
 */
export const STYLE_PANEL_MODES = Object.freeze({
  /** The style the *next* drawing gets. Type tabs switch the active draw tool. */
  drawingDefault: 'drawing-default',
  /** One existing record. Its geometry type is fixed; tabs are hidden. */
  selectedFeature: 'selected-feature',
  /** Several existing records at once. Only changed fields are applied. */
  bulkSelection: 'bulk-selection',
})

/**
 * The only tool of the analysis family: a temporary polygon drawn to ask the
 * backend how much inventory it intersects.
 */
export const ANALYSIS_TOOL = 'polygon'

/** Konum analizinin tek aracı: hedef alanı belirleyen geçici poligon. */
export const LOCATION_ANALYSIS_TOOL = 'polygon'

/** Toolbar/hint copy for the location analysis tool. */
export const LOCATION_ANALYSIS_TOOL_INFO = Object.freeze({
  id: LOCATION_ANALYSIS_TOOL,
  label: 'Konum Analizi Alanı',
  hint: 'Analiz alanını çizin · Çift tıklayarak bitirin · Bu alan veritabanına kaydedilmez.',
})

/** Toolbar/hint copy for the analysis tool, alongside the other tool tables. */
export const ANALYSIS_TOOL_INFO = Object.freeze({
  id: ANALYSIS_TOOL,
  label: 'Envanter Analizi',
  hint: 'Analiz alanını çizin · Çift tıklayarak bitirin · Bu alan veritabanına kaydedilmez.',
})

/** Selection is the resting state: with no tool chosen, clicking selects. */
const INITIAL = Object.freeze({
  mode: WORKSPACE_MODES.select,
  drawTool: 'point',
  selectionTool: 'single',
  measureTool: 'distance',
  /** The analysis family has a single tool today; kept symmetrical on purpose. */
  analysisTool: ANALYSIS_TOOL,
  locationAnalysisTool: LOCATION_ANALYSIS_TOOL,
})

export default function useWorkspaceMode() {
  const [state, setState] = useState(INITIAL)

  /* --- Draw ---------------------------------------------------------------- */

  /** Toolbar behaviour: pressing the active tool again leaves drawing. */
  const selectDrawTool = useCallback((toolId) => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.draw && current.drawTool === toolId
        ? { ...current, mode: WORKSPACE_MODES.select }
        : { ...current, mode: WORKSPACE_MODES.draw, drawTool: toolId },
    )
  }, [])

  /**
   * Unconditional activation, used by the style panel's type tabs: choosing
   * "Çizgi" there means the next drawing is a line, so the tool must actually
   * become line — toggling would be wrong when line is already active.
   */
  const setDrawTool = useCallback((toolId) => {
    setState((current) => ({ ...current, mode: WORKSPACE_MODES.draw, drawTool: toolId }))
  }, [])

  const stopDrawing = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.draw ? { ...current, mode: WORKSPACE_MODES.select } : current,
    )
  }, [])

  /* --- Select -------------------------------------------------------------- */

  const selectSelectionTool = useCallback((toolId) => {
    setState((current) => {
      // Pressing an active spatial tool again falls back to plain click-select
      // rather than leaving the user with no way to interact with the map.
      const next =
        current.mode === WORKSPACE_MODES.select && current.selectionTool === toolId && toolId !== 'single'
          ? 'single'
          : toolId
      return { ...current, mode: WORKSPACE_MODES.select, selectionTool: next }
    })
  }, [])

  /* --- Measure ------------------------------------------------------------- */

  const selectMeasureTool = useCallback((toolId) => {
    setState((current) => {
      if (!toolId) return { ...current, mode: WORKSPACE_MODES.select }
      return current.mode === WORKSPACE_MODES.measure && current.measureTool === toolId
        ? { ...current, mode: WORKSPACE_MODES.select }
        : { ...current, mode: WORKSPACE_MODES.measure, measureTool: toolId }
    })
  }, [])

  const stopMeasuring = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.measure ? { ...current, mode: WORKSPACE_MODES.select } : current,
    )
  }, [])

  /* --- Analysis ------------------------------------------------------------ */

  /** Toolbar behaviour: pressing the active analysis tool again leaves the mode. */
  const toggleAnalysisTool = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.analysis
        ? { ...current, mode: WORKSPACE_MODES.select }
        : { ...current, mode: WORKSPACE_MODES.analysis, analysisTool: ANALYSIS_TOOL },
    )
  }, [])

  const stopAnalysis = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.analysis ? { ...current, mode: WORKSPACE_MODES.select } : current,
    )
  }, [])

  /* --- Konum analizi -------------------------------------------------------- */

  /** Toolbar behaviour: pressing the active tool again leaves the mode. */
  const toggleLocationAnalysisTool = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.locationAnalysis
        ? { ...current, mode: WORKSPACE_MODES.select }
        : { ...current, mode: WORKSPACE_MODES.locationAnalysis, locationAnalysisTool: LOCATION_ANALYSIS_TOOL },
    )
  }, [])

  const stopLocationAnalysis = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.locationAnalysis
        ? { ...current, mode: WORKSPACE_MODES.select }
        : current,
    )
  }, [])

  /* --- POI ----------------------------------------------------------------- */

  /** Toolbar behaviour: pressing the active POI tool again leaves the mode. */
  const togglePoiTool = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.poi
        ? { ...current, mode: WORKSPACE_MODES.select }
        : { ...current, mode: WORKSPACE_MODES.poi },
    )
  }, [])

  const stopPoiPlacement = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.poi ? { ...current, mode: WORKSPACE_MODES.select } : current,
    )
  }, [])

  /* --- Ulaşım durağı ------------------------------------------------------ */

  const toggleTransportStopTool = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.transportStop
        ? { ...current, mode: WORKSPACE_MODES.select }
        : { ...current, mode: WORKSPACE_MODES.transportStop },
    )
  }, [])

  const stopTransportStopPlacement = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.transportStop ? { ...current, mode: WORKSPACE_MODES.select } : current,
    )
  }, [])

  const startTransportStopRelocation = useCallback(() => {
    setState((current) => ({ ...current, mode: WORKSPACE_MODES.transportStopRelocate }))
  }, [])

  const stopTransportStopRelocation = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.transportStopRelocate
        ? { ...current, mode: WORKSPACE_MODES.select }
        : current,
    )
  }, [])

  /* --- Edit ---------------------------------------------------------------- */

  /**
   * Enters geometry-edit mode. Selection is deliberately NOT cleared: the
   * record being edited is the selected one, and the detail panel stays open
   * to offer "Kaydet" / "İptal".
   */
  const startEditing = useCallback(() => {
    setState((current) => ({ ...current, mode: WORKSPACE_MODES.edit }))
  }, [])

  const stopEditing = useCallback(() => {
    setState((current) =>
      current.mode === WORKSPACE_MODES.edit ? { ...current, mode: WORKSPACE_MODES.select } : current,
    )
  }, [])

  return useMemo(
    () => ({
      mode: state.mode,
      // Derived actives: null unless the mode owns them. Every interaction in
      // the app is created from these, so cleanup is automatic on a mode change.
      activeDrawTool: state.mode === WORKSPACE_MODES.draw ? state.drawTool : null,
      activeSelectionTool: state.mode === WORKSPACE_MODES.select ? state.selectionTool : null,
      activeMeasureTool: state.mode === WORKSPACE_MODES.measure ? state.measureTool : null,
      activeAnalysisTool: state.mode === WORKSPACE_MODES.analysis ? state.analysisTool : null,
      activeLocationAnalysisTool:
        state.mode === WORKSPACE_MODES.locationAnalysis ? state.locationAnalysisTool : null,
      /**
       * Type the style panel edits in `drawing-default` mode: the live tool if
       * there is one, otherwise the one that would come back next.
       */
      styleToolType: state.drawTool,
      isDrawing: state.mode === WORKSPACE_MODES.draw,
      isMeasuring: state.mode === WORKSPACE_MODES.measure,
      isSelecting: state.mode === WORKSPACE_MODES.select,
      isAnalyzing: state.mode === WORKSPACE_MODES.analysis,
      isSelectingAnalysisArea: state.mode === WORKSPACE_MODES.locationAnalysis,
      isEditing: state.mode === WORKSPACE_MODES.edit,
      isPlacingPoi: state.mode === WORKSPACE_MODES.poi,
      isPlacingTransportStop: state.mode === WORKSPACE_MODES.transportStop,
      isRelocatingTransportStop: state.mode === WORKSPACE_MODES.transportStopRelocate,
      selectDrawTool,
      setDrawTool,
      stopDrawing,
      selectSelectionTool,
      selectMeasureTool,
      stopMeasuring,
      toggleAnalysisTool,
      stopAnalysis,
      toggleLocationAnalysisTool,
      stopLocationAnalysis,
      togglePoiTool,
      stopPoiPlacement,
      toggleTransportStopTool,
      stopTransportStopPlacement,
      startTransportStopRelocation,
      stopTransportStopRelocation,
      startEditing,
      stopEditing,
    }),
    [
      state,
      selectDrawTool,
      setDrawTool,
      stopDrawing,
      selectSelectionTool,
      selectMeasureTool,
      stopMeasuring,
      toggleAnalysisTool,
      stopAnalysis,
      toggleLocationAnalysisTool,
      stopLocationAnalysis,
      togglePoiTool,
      stopPoiPlacement,
      toggleTransportStopTool,
      stopTransportStopPlacement,
      startTransportStopRelocation,
      stopTransportStopRelocation,
      startEditing,
      stopEditing,
    ],
  )
}
