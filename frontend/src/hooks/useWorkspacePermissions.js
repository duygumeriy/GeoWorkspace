import { useCallback, useEffect, useMemo } from 'react'
import { usePermissions } from '../auth/permissionStore.js'
import { PERMISSIONS } from '../auth/permissionCodes.js'

/**
 * The permission layer over the workspace mode.
 *
 * <b>It does not become a second tool-state system.</b> `useWorkspaceMode`
 * stays the one source of truth for "what does a click on the map do right
 * now"; this hook sits above it and answers a different question — "may this
 * person reach that state at all". Keeping the two separate is what stops the
 * toolbar, the keyboard shortcuts and the OpenLayers interactions from drifting
 * apart, because all three still read the same mode underneath.
 *
 * Two things happen here, and they are deliberately paired:
 *
 *   1. <b>Entry is guarded.</b> The wrapped actions refuse to activate a tool
 *      the caller has no permission for. Hiding the button is not enough: the
 *      letter shortcuts (P/L/G/M) and the style panel's type tabs reach the
 *      same actions, so the gate has to sit where they all pass through.
 *   2. <b>An active tool is torn down when its permission disappears.</b>
 *      Authorization is live — a permission can be withdrawn while the map is
 *      open. Only hiding the button would leave the Draw interaction running
 *      and the next click would still start a shape.
 *
 * <b>None of this is a security boundary.</b> Every create/update/delete lands
 * on an endpoint that checks the same permission server-side and answers 403
 * regardless of what the browser allowed. This exists so the map never offers
 * an action that would only come back as an error.
 */
export default function useWorkspacePermissions(workspaceMode) {
  const { can, canAny } = usePermissions()

  const {
    activeDrawTool,
    activeMeasureTool,
    activeAnalysisTool,
    isEditing,
    selectDrawTool,
    setDrawTool,
    selectMeasureTool,
    selectSelectionTool,
    toggleAnalysisTool,
    stopDrawing,
    stopMeasuring,
    stopAnalysis,
    stopEditing,
  } = workspaceMode

  /* Üç oluşturma yetkisi AYRI kalır ve tek bir `canDraw`a indirgenmez: yalnızca
     nokta yetkisi olan biri için çizgi ve alan araçlarının görünmesi, backend'in
     403 döndüreceği bir eylemi vaat etmek olurdu. */
  const drawTools = useMemo(
    () => ({
      point: can(PERMISSIONS.DRAWINGS_POINT_CREATE),
      line: can(PERMISSIONS.DRAWINGS_LINE_CREATE),
      polygon: can(PERMISSIONS.DRAWINGS_POLYGON_CREATE),
    }),
    [can],
  )

  const canDrawAny = drawTools.point || drawTools.line || drawTools.polygon

  const canMeasure = can(PERMISSIONS.MEASUREMENT_USE)
  const canSelect = can(PERMISSIONS.SELECTION_USE)
  const canAnalyze = can(PERMISSIONS.INVENTORY_ANALYSIS)
  const canViewDrawings = can(PERMISSIONS.DRAWINGS_VIEW)
  const canUpdateStyle = can(PERMISSIONS.DRAWINGS_STYLE_UPDATE)
  const canDeleteDrawings = can(PERMISSIONS.DRAWINGS_DELETE)
  const canRestoreDrawings = can(PERMISSIONS.DRAWINGS_RESTORE)

  /* "Düzenle" TEK bir PUT gönderir ve o uç üç yetkinin ÜÇÜNÜ birden arar
     (metadata + geometry + style). İkisine sahip olup üçüncüsüne sahip
     olmayan birine düzenleme sunmak, kaydetmenin garanti 403 aldığı bir
     oturum açmak olurdu — bu yüzden koşul üçünün DE bulunmasıdır. */
  const canEditDrawing =
    can(PERMISSIONS.DRAWINGS_METADATA_UPDATE) &&
    can(PERMISSIONS.DRAWINGS_GEOMETRY_UPDATE) &&
    canUpdateStyle

  /* Geri/ileri al yığınındaki her adım, o an yetkisi olduğu için yapılmış bir
     eylemin tersidir. Hiçbir çizim mutasyonu yapamayan biri için yığın daima
     boş kalır; düğmeleri göstermek kalıcı olarak devre dışı iki simge
     bırakmak olurdu. */
  const canMutateDrawings = canAny([
    PERMISSIONS.DRAWINGS_POINT_CREATE,
    PERMISSIONS.DRAWINGS_LINE_CREATE,
    PERMISSIONS.DRAWINGS_POLYGON_CREATE,
    PERMISSIONS.DRAWINGS_METADATA_UPDATE,
    PERMISSIONS.DRAWINGS_GEOMETRY_UPDATE,
    PERMISSIONS.DRAWINGS_STYLE_UPDATE,
    PERMISSIONS.DRAWINGS_DELETE,
    PERMISSIONS.DRAWINGS_RESTORE,
  ])

  /* --- Girişin korunması ---------------------------------------------------- */

  const guardedSelectDrawTool = useCallback(
    (toolId) => {
      if (!drawTools[toolId]) return
      selectDrawTool(toolId)
    },
    [drawTools, selectDrawTool],
  )

  const guardedSetDrawTool = useCallback(
    (toolId) => {
      if (!drawTools[toolId]) return
      setDrawTool(toolId)
    },
    [drawTools, setDrawTool],
  )

  const guardedSelectMeasureTool = useCallback(
    (toolId) => {
      // Ölçümü KAPATMAK daima serbesttir: yetkisi kalmayan biri de aktif
      // moddan çıkabilmelidir.
      if (toolId && !canMeasure) return
      selectMeasureTool(toolId)
    },
    [canMeasure, selectMeasureTool],
  )

  const guardedSelectSelectionTool = useCallback(
    (toolId) => {
      if (!canSelect) return
      selectSelectionTool(toolId)
    },
    [canSelect, selectSelectionTool],
  )

  const guardedToggleAnalysisTool = useCallback(() => {
    // Açmak yetki ister; açıkken kapatmak istemez.
    if (!canAnalyze && !activeAnalysisTool) return
    toggleAnalysisTool()
  }, [canAnalyze, activeAnalysisTool, toggleAnalysisTool])

  /* --- Aktif aracın sökülmesi ------------------------------------------------
     Yetki canlıdır: harita açıkken kaldırılabilir. Yalnızca düğmeyi gizlemek,
     OpenLayers etkileşimini ayakta bırakır ve bir sonraki tık hâlâ şekil
     başlatırdı. Mod değiştiği anda etkileşim de yıkılır, çünkü her etkileşim
     `active*` türetilmiş değerinden kurulur. */

  useEffect(() => {
    if (activeDrawTool && !drawTools[activeDrawTool]) stopDrawing()
  }, [activeDrawTool, drawTools, stopDrawing])

  useEffect(() => {
    if (activeMeasureTool && !canMeasure) stopMeasuring()
  }, [activeMeasureTool, canMeasure, stopMeasuring])

  useEffect(() => {
    if (activeAnalysisTool && !canAnalyze) stopAnalysis()
  }, [activeAnalysisTool, canAnalyze, stopAnalysis])

  useEffect(() => {
    if (isEditing && !canEditDrawing) stopEditing()
  }, [isEditing, canEditDrawing, stopEditing])

  return {
    drawTools,
    canDrawAny,
    canMeasure,
    canSelect,
    canAnalyze,
    canViewDrawings,
    canEditDrawing,
    canUpdateStyle,
    canDeleteDrawings,
    canRestoreDrawings,
    canMutateDrawings,
    selectDrawTool: guardedSelectDrawTool,
    setDrawTool: guardedSetDrawTool,
    selectMeasureTool: guardedSelectMeasureTool,
    selectSelectionTool: guardedSelectSelectionTool,
    toggleAnalysisTool: guardedToggleAnalysisTool,
  }
}
