import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import 'ol/ol.css'
import Map from 'ol/Map'
import View from 'ol/View'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import { fromLonLat, toLonLat } from 'ol/proj'
import { useAuth } from '../auth/AuthContext'
import { canManageAll, canManageDrawing } from '../auth/permissions.js'
import { useTransition } from '../transition/TransitionContext.jsx'
import { setConnectionHandler } from '../services/api'
import Sidebar from '../components/map/Sidebar.jsx'
import Topbar from '../components/map/Topbar.jsx'
import MapLoadingOverlay from '../components/map/MapLoadingOverlay.jsx'
import DrawToolbar from '../components/map/DrawToolbar.jsx'
import QuickActions from '../components/map/QuickActions.jsx'
import MapToasts from '../components/map/MapToasts.jsx'
import StylePanel from '../components/map/StylePanel.jsx'
import SelectedFeaturePanel from '../components/map/SelectedFeaturePanel.jsx'
import MultiSelectionPanel from '../components/map/MultiSelectionPanel.jsx'
import LayersPanel from '../components/map/LayersPanel.jsx'
import DrawingsPanel from '../components/map/DrawingsPanel.jsx'
import TrashPanel from '../components/map/TrashPanel.jsx'
import BasemapSelector from '../components/map/BasemapSelector.jsx'
import ConfirmDialog from '../components/map/ConfirmDialog.jsx'
import AttributePopup from '../components/map/AttributePopup.jsx'
import AnalysisPanel from '../components/map/AnalysisPanel.jsx'
import { SettingsPanel, AboutPanel } from '../components/map/InfoPanels.jsx'
import {
  DrawingHint,
  HoverTooltip,
  MeasurementReadout,
  SavingIndicator,
} from '../components/map/MapOverlays.jsx'
import useMediaQuery from '../hooks/useMediaQuery.js'
import useToasts from '../hooks/useToasts.js'
import useDrawingWorkspace from '../hooks/useDrawingWorkspace.js'
import useTrash from '../hooks/useTrash.js'
import useBasemap from '../hooks/useBasemap.js'
import useInventoryAnalysis from '../hooks/useInventoryAnalysis.js'
import useWorkspaceMode, { STYLE_PANEL_MODES } from '../hooks/useWorkspaceMode.js'
import useMapView, { TURKEY_CENTER_LON_LAT, TURKEY_ZOOM } from '../hooks/useMapView.js'
import useMeasurement from '../hooks/useMeasurement.js'
import useFeatureInteraction from '../hooks/useFeatureInteraction.js'
import useSelectionTools from '../hooks/useSelectionTools.js'
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts.js'
import useGeometryEditing, { GEOMETRY_EDIT_MODES } from '../hooks/useGeometryEditing.js'
import useEditSession from '../hooks/useEditSession.js'
import useVertexOverlay from '../hooks/useVertexOverlay.js'
import useAnalysisHighlight from '../hooks/useAnalysisHighlight.js'
import { DRAWING_TYPES, DRAWING_TYPE_LIST, colorPatchFor, normalizeTags } from '../map/drawingTypes.js'
import {
  formatArea,
  formatLength,
  formatLonLat,
  measureArea,
  measureLength,
  measurePerimeter,
} from '../map/measure.js'
import './MapPage.css'

const MAP_READY_FALLBACK_MS = 2500

function formatRemaining(expiresAt) {
  if (!expiresAt) return ''
  const diffMs = new Date(expiresAt).getTime() - Date.now()
  if (diffMs <= 0) return '00:00'
  const totalSeconds = Math.floor(diffMs / 1000)
  const minutes = String(Math.floor(totalSeconds / 60)).padStart(2, '0')
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

export default function MapPage() {
  const mapContainerRef = useRef(null)
  const mapRef = useRef(null)
  const { logout, expiresAt, username, isAdmin, userId } = useAuth()
  const { reportMapReady, isIdle } = useTransition()
  const navigate = useNavigate()

  const [remaining, setRemaining] = useState(() => formatRemaining(expiresAt))
  const [mapReady, setMapReady] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  // Exposed as state (not just a ref) so the drawing hook re-runs when the map
  // instance is actually created or torn down, StrictMode double-mount included.
  const [mapInstance, setMapInstance] = useState(null)

  /** Which sidebar panel is open: drawings | layers | settings | about | null. */
  const [activePanel, setActivePanel] = useState(null)
  /** What the style panel is editing: null | 'tool' | 'feature' | 'bulk'. */
  const [styleTarget, setStyleTarget] = useState(null)
  const [pendingDelete, setPendingDelete] = useState(null)
  /** Non-null while the trash is asking whether to reopen a deleted drawing. */
  const [pendingRestore, setPendingRestore] = useState(null)

  // Hover tooltips and letter shortcuts only make sense with a real pointer
  // and a physical keyboard; on touch devices tap-to-select is the interaction.
  const hasFinePointer = useMediaQuery('(hover: hover) and (pointer: fine)')

  const { toasts, showToast, dismissToast } = useToasts()

  // ONE source of truth for what the map is currently doing. Every interaction
  // below is created from it, and the toolbar and style panel both render from
  // it — so the bar, the panel and the OpenLayers interaction cannot disagree.
  const workspaceMode = useWorkspaceMode()

  // Declared before the drawing workspace because saving a polygon feeds
  // straight into it: one analysis engine serves both the temporary tool and
  // the automatic run after a polygon record is created.
  const analysis = useInventoryAnalysis(mapInstance, {
    active: Boolean(workspaceMode.activeAnalysisTool),
    showToast,
  })
  const { analyzeSaved } = analysis

  const workspace = useDrawingWorkspace(mapInstance, {
    showToast,
    activeDrawTool: workspaceMode.activeDrawTool,
    onPolygonSaved: analyzeSaved,
  })
  /* The trash is fetched only while its panel is open, and a successful restore
     reloads the map through the workspace's own loader — the record has to come
     back where the user deleted it from, not only leave this list. That is also
     why there is no second "add it to the map" code path here. */
  const trash = useTrash({
    active: activePanel === 'trash',
    showToast,
    onRestored: workspace.reloadDrawings,
  })

  /* The one owner of the selected basemap. It is independent of the UI theme in
     both directions: nothing here reads `useTheme`, and the theme never picks a
     basemap — every light/dark × standard/uydu combination is valid. */
  const basemap = useBasemap(mapInstance)

  const mapView = useMapView(mapInstance, { showToast })
  const measurement = useMeasurement(mapInstance, workspaceMode.activeMeasureTool)

  const { selectFeature, extentOf, extentOfKeys, visibleExtent, selectedKeys, selectedFeature, featureByKey } =
    workspace

  // Click-to-select runs in select mode only, and not while an area polygon is
  // being drawn — there a click is a vertex, not a selection.
  const clickSelectEnabled =
    workspaceMode.isSelecting && workspaceMode.activeSelectionTool !== 'polygon'

  const { hovered } = useFeatureInteraction(mapInstance, {
    enabled: clickSelectEnabled,
    hoverEnabled: hasFinePointer,
    onSelect: selectFeature,
  })

  /** Box / area selection results land in the same canonical selection set. */
  const handleSpatialSelect = useCallback(
    (keys, { additive }) => {
      if (additive) workspace.addToSelection(keys)
      else workspace.setSelection(keys)

      showToast('info', keys.length ? `${keys.length} çizim seçildi.` : 'Seçilen alanda çizim bulunamadı.')
    },
    [workspace, showToast],
  )

  useSelectionTools(mapInstance, {
    // Non-null only in select mode, so a box drag can never be live while a
    // draw or measure interaction is.
    tool: workspaceMode.activeSelectionTool === 'single' ? null : workspaceMode.activeSelectionTool,
    onSelect: handleSpatialSelect,
    selectKeysIn: workspace.selectKeysIn,
  })

  /* --- Map bootstrap ------------------------------------------------------ */
  // Unchanged from the original: same tile source, same Türkiye centre/zoom.
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return

    /* No base layer here any more: the basemaps are owned by `useBasemap`,
       which adds all of them below the overlays and shows one. The Map, its
       View and this effect are otherwise unchanged — the map instance is
       created exactly once and a basemap change never reaches it. */
    const map = new Map({
      target: mapContainerRef.current,
      controls: defaultControls().extend([new ScaleLine({ units: 'metric' })]),
      view: new View({
        center: fromLonLat(TURKEY_CENTER_LON_LAT),
        zoom: TURKEY_ZOOM,
      }),
    })

    mapRef.current = map
    setMapInstance(map)

    const fallbackTimer = setTimeout(() => setMapReady(true), MAP_READY_FALLBACK_MS)
    map.once('rendercomplete', () => {
      clearTimeout(fallbackTimer)
      setMapReady(true)
    })

    return () => {
      clearTimeout(fallbackTimer)
      map.setTarget(undefined)
      mapRef.current = null
      setMapInstance(null)
    }
  }, [])

  // Lets the app-level transition overlay (if one is currently holding, e.g.
  // right after a successful login) know it's safe to reveal.
  useEffect(() => {
    if (mapReady) reportMapReady()
  }, [mapReady, reportMapReady])

  // The profile (username, role) is owned by AuthContext, which fetches
  // /api/auth/me once per session — this page just reads it, so there is a
  // single source of truth and a single request.

  // Connection feedback derived from real request outcomes — no polling.
  useEffect(() => {
    let online = true
    setConnectionHandler((isOnline) => {
      if (isOnline === online) return
      online = isOnline
      if (isOnline) showToast('success', 'Bağlantı yeniden kuruldu.', { id: 'connection' })
      else showToast('error', 'Bağlantı kurulamadı.', { id: 'connection', timeout: 8000 })
    })
    return () => setConnectionHandler(null)
  }, [showToast])

  // Optional session countdown display, purely derived from expiresAt.
  useEffect(() => {
    setRemaining(formatRemaining(expiresAt))
    if (!expiresAt) return

    const interval = setInterval(() => {
      setRemaining(formatRemaining(expiresAt))
    }, 1000)

    return () => clearInterval(interval)
  }, [expiresAt])

  /* --- Actions ------------------------------------------------------------ */

  const handleLogout = () => {
    logout()
    navigate('/login', { replace: true })
  }

  const { fitExtent, panTo, ensureVisible } = mapView
  const { selectionCount, selectionCounts, selectedFeatures } = workspace

  /** Selecting from the drawings list also frames the geometry. */
  const selectAndZoom = useCallback(
    (key) => {
      selectFeature(key)
      const extent = extentOf(key)
      if (extent) fitExtent(extent)
    },
    [selectFeature, extentOf, fitExtent],
  )

  const focusAllDrawings = useCallback(() => {
    const extent = visibleExtent()
    if (!extent) {
      showToast('info', 'Henüz görüntülenecek çizim yok.')
      return
    }
    fitExtent(extent)
  }, [visibleExtent, fitExtent, showToast])

  /**
   * "Seçime Odaklan": one combined extent for the whole selection.
   * `fitExtent` already treats a zero-area extent (a lone point) as a centre
   * plus a sensible zoom rather than an infinite zoom-in, and it skips the
   * animation entirely when the user prefers reduced motion.
   */
  const focusSelection = useCallback(() => {
    const extent = extentOfKeys(selectedKeys)
    if (extent) fitExtent(extent)
  }, [extentOfKeys, selectedKeys, fitExtent])

  // Deleting or deselecting the feature being styled leaves nothing to edit.
  useEffect(() => {
    if (styleTarget === 'feature' && !selectedFeature) setStyleTarget(null)
    if (styleTarget === 'bulk' && selectionCount < 2) setStyleTarget(null)
  }, [styleTarget, selectedFeature, selectionCount])

  const openStyleForSelection = useCallback(() => setStyleTarget('feature'), [])
  const openStyleForBulk = useCallback(() => setStyleTarget('bulk'), [])

  /**
   * The toolbar palette always edits the *tool* defaults — the style the next
   * drawing will get. Editing existing records goes through "Stili Değiştir"
   * (one) or "Stil Uygula" (many), so the three never get confused.
   *
   * Which type it opens on is read from the canonical mode, not from a copy
   * kept here; the panel's tabs write back to that same state.
   */
  const openStyleForTool = useCallback(() => setStyleTarget('tool'), [])

  const closeStylePanel = useCallback(() => setStyleTarget(null), [])

  const requestDelete = useCallback(() => {
    if (selectedFeatures.length > 0) setPendingDelete(selectedFeatures)
  }, [selectedFeatures])

  const confirmDelete = useCallback(async () => {
    const targets = pendingDelete
    setPendingDelete(null)
    if (!targets?.length) return
    // One record still goes through the single-record endpoint; two or more use
    // the atomic bulk endpoint so a half-finished delete is not possible.
    if (targets.length === 1) await workspace.removeFeature(targets[0].key)
    else await workspace.removeFeatures(targets.map((item) => item.key))
  }, [pendingDelete, workspace])

  /* Restoring goes through the same confirmation step deleting does, using the
     app's own dialog rather than `window.confirm`. Reopening a drawing is
     recoverable — it can simply be deleted again — so the dialog asks in the
     primary tone instead of the destructive red. */
  const requestRestore = useCallback((item) => setPendingRestore(item), [])

  const confirmRestore = useCallback(async () => {
    const target = pendingRestore
    setPendingRestore(null)
    if (target) await trash.restore(target)
  }, [pendingRestore, trash])

  const handleSelectPanel = useCallback((panelId) => {
    setActivePanel((current) => (current === panelId ? null : panelId))
  }, [])

  const selectedGeometry = selectedFeature ? featureByKey(selectedFeature.key)?.getGeometry() ?? null : null

  /* Ownership-driven UI state. This only decides which controls are offered —
     the backend independently re-checks ownership on every mutation and
     answers 403, so nothing here is load-bearing for security. */
  const canManageSelected = canManageDrawing({ isAdmin, userId }, selectedFeature)
  const canManageSelection = canManageAll({ isAdmin, userId }, selectedFeatures)
  const foreignSelectedCount = selectedFeatures.filter(
    (item) => !canManageDrawing({ isAdmin, userId }, item),
  ).length

  /* --- Geometry edit session ----------------------------------------------
     `workspaceMode.isEditing` is the single switch: it turns the OpenLayers
     Modify/Translate interactions on here and simultaneously makes every other
     interaction (draw, measure, box-select) inactive, because each of those is
     derived from a mode that is no longer current. */

  const editingFeature = workspaceMode.isEditing && selectedFeature
    ? featureByKey(selectedFeature.key)
    : null

  /** Which gesture the map performs: drag a vertex, or drag the whole shape. */
  const [geometryEditMode, setGeometryEditMode] = useState(GEOMETRY_EDIT_MODES.vertex)

  /* THE edit state. Every editing surface — the two panel tabs, the coordinate
     inputs, the line tools and the map interactions below — reads and writes
     this one session, so there is a single geometry rather than several copies
     to reconcile. */
  const editSession = useEditSession({
    feature: editingFeature,
    descriptor: selectedFeature,
    active: workspaceMode.isEditing,
  })

  // The map's gestures feed the same session: `commitFromMap` reads the geometry
  // OpenLayers just changed and puts it on the session's undo stack, exactly as
  // a typed coordinate would.
  useGeometryEditing(mapInstance, {
    active: workspaceMode.isEditing,
    feature: editingFeature,
    mode: geometryEditMode,
    onCommit: editSession.commitFromMap,
  })

  /* Numbered vertex markers over the drawing being edited, and clicks on them.
     The overlay renders the SAME session — it holds no geometry and no second
     selection — so the "Köşe 3" in the panel and the "3" on the map are one
     index that both surfaces read and write. */
  useVertexOverlay(mapInstance, {
    active: workspaceMode.isEditing,
    type: editSession.type ?? null,
    coords: editSession.coords ?? null,
    selectedVertex: editSession.selectedVertex,
    selectedEdge: editSession.selectedEdge,
    // A selection made ON the map needs no camera move: the user is looking
    // right at what they clicked.
    onSelectVertex: editSession.selectVertex,
    onSelectEdge: editSession.selectEdge,
    onClearSelection: editSession.clearSelection,
  })

  const { startEditing, stopEditing } = workspaceMode
  const { updateFeature } = workspace
  const { revertGeometry, isDirty: hasUnsavedEdits } = editSession

  /** Non-null while the unsaved-changes dialog is asking; holds what to do next. */
  const [pendingDiscard, setPendingDiscard] = useState(null)

  const startEdit = useCallback(() => {
    if (!canManageSelected) return
    // Every session starts on vertex editing; translate is an explicit choice.
    setGeometryEditMode(GEOMETRY_EDIT_MODES.vertex)
    startEditing()
  }, [canManageSelected, startEditing])

  /** Closes the session, putting the map geometry back as it was. */
  const discardEdit = useCallback(() => {
    revertGeometry()
    stopEditing()
  }, [revertGeometry, stopEditing])

  /**
   * "İptal" / panel close / navigating away mid-edit.
   *
   * With unsaved work the user is asked first, through the app's own dialog —
   * never `window.confirm`, which cannot be styled, cannot be dismissed with the
   * app's Escape handling and looks like a browser error rather than a choice.
   * With nothing to lose the session simply closes; a confirmation that always
   * appears is one people learn to click through.
   */
  const cancelEdit = useCallback(
    (afterDiscard = null) => {
      if (hasUnsavedEdits) {
        setPendingDiscard(() => afterDiscard ?? (() => {}))
        return
      }
      discardEdit()
      afterDiscard?.()
    },
    [hasUnsavedEdits, discardEdit],
  )

  const confirmDiscard = useCallback(() => {
    const next = pendingDiscard
    setPendingDiscard(null)
    discardEdit()
    next?.()
  }, [pendingDiscard, discardEdit])

  /**
   * "Kaydet": metadata, colour and geometry travel in ONE request, so the
   * record can never end up half-updated. Colour is expanded into the style
   * columns the type actually has (stroke always, fill where supported) by the
   * same helper the attribute popup uses, and the geometry is written from the
   * SESSION's vertex list rather than read back off the map — the session is
   * the source of truth, and a manual coordinate that has not yet round-tripped
   * through the map would otherwise be lost.
   */
  const saveEdit = useCallback(async () => {
    const draft = editSession.draft
    const wkt = editSession.toWkt()
    if (!draft || !wkt || !selectedFeature || !editSession.canSave) return

    const ok = await updateFeature(selectedFeature.key, {
      name: draft.name.trim(),
      // Empty strings are meaningful here: they clear the field server-side.
      description: draft.description.trim(),
      category: draft.category,
      tags: normalizeTags(draft.tags),
      style: colorPatchFor(selectedFeature.type, draft.color),
      wkt,
    })

    // On failure the session stays open with the user's edits intact.
    if (ok) stopEditing()
  }, [editSession, selectedFeature, updateFeature, stopEditing])

  /* --- Analysis results -> the map -----------------------------------------
     Every match the analysis returns is, by definition, one of the caller's own
     drawings — the backend scopes the query to them — so it is already on the
     map. That is what lets the result list carry only identity and metadata:
     the geometry is looked up here rather than sent twice. */

  /** The map feature behind a matched record, or null if it is not loaded. */
  const analysisFeature = useCallback(
    (item) => {
      if (!item) return null
      const match = workspace.drawings.find(
        (drawing) => drawing.type === item.drawingType && drawing.databaseId === item.id,
      )
      return match ? featureByKey(match.key) : null
    },
    [workspace.drawings, featureByKey],
  )

  /** The geometry the highlight layer draws, derived from the shared selection. */
  const highlightedGeometry = useMemo(() => {
    const selected = analysis.selectedKey
    if (!selected) return null

    const [type, rawId] = selected.split(':')
    const feature = analysisFeature({ drawingType: type, id: Number(rawId) })
    return feature?.getGeometry() ?? null
  }, [analysis.selectedKey, analysisFeature])

  useAnalysisHighlight(mapInstance, { geometry: highlightedGeometry })

  /**
   * Geometry-derived detail for one match, measured with the app's own helpers.
   *
   * Computed from the feature on the map rather than returned by the API so a
   * length shown here and in the drawing panel are the same number produced by
   * the same code, not two answers that could drift apart.
   */
  const analysisMetrics = useCallback(
    (item) => {
      const geometry = analysisFeature(item)?.getGeometry()
      if (!geometry) return []

      if (item.drawingType === 'point') {
        const { lon, lat } = formatLonLat(toLonLat(geometry.getCoordinates()))
        return [
          { label: 'Boylam', value: lon },
          { label: 'Enlem', value: lat },
        ]
      }

      if (item.drawingType === 'line') {
        return [
          { label: 'Toplam Uzunluk', value: formatLength(measureLength(geometry)) },
          { label: 'Nokta Sayısı', value: `${geometry.getCoordinates().length}` },
        ]
      }

      return [
        { label: 'Alan', value: formatArea(measureArea(geometry)) },
        { label: 'Çevre', value: formatLength(measurePerimeter(geometry)) },
        // The ring repeats its first vertex to close; the user counts corners.
        { label: 'Köşe Sayısı', value: `${Math.max(0, (geometry.getCoordinates()?.[0]?.length ?? 1) - 1)}` },
      ]
    },
    [analysisFeature],
  )

  /** "Haritada Göster": frames the match without disturbing the analysis. */
  const showAnalysisItemOnMap = useCallback(
    (item) => {
      const feature = analysisFeature(item)
      if (!feature) {
        showToast('info', 'Bu çizim haritada bulunamadı.')
        return
      }
      /* The selection is deliberately left alone. This button only exists inside
         an already-expanded result, so the record is selected and its highlight
         is already lit; re-running the row's toggle would switch it back OFF and
         the user would watch the highlight vanish as the map flew to it.
         Only the camera moves — the analysis area, the result and the panel all
         stay exactly as they were. */
      fitExtent(feature.getGeometry()?.getExtent())
    },
    [analysisFeature, fitExtent, showToast],
  )

  /**
   * "Çizimi Aç": hands the record to the ORDINARY drawing detail panel rather
   * than growing a second one inside the analysis results.
   */
  const openAnalysisItemDrawing = useCallback(
    (item) => {
      const match = workspace.drawings.find(
        (drawing) => drawing.type === item.drawingType && drawing.databaseId === item.id,
      )
      if (!match) {
        showToast('info', 'Bu çizim haritada bulunamadı.')
        return
      }
      selectAndZoom(match.key)
    },
    [workspace.drawings, selectAndZoom, showToast],
  )

  /** Copy helper shared by the point and "all coordinates" actions. */
  const copyText = useCallback(
    async (text, successMessage) => {
      try {
        await navigator.clipboard.writeText(text)
        showToast('success', successMessage)
      } catch {
        // Clipboard access can be denied (insecure origin, permission); saying
        // so beats a button that silently does nothing.
        showToast('error', 'Panoya kopyalanamadı.')
      }
    },
    [showToast],
  )

  /* --- Panel -> map vertex selection ---------------------------------------
     The mirror of the overlay's map -> panel direction. Both write the session's
     one `selectedVertex`, so neither surface can be showing a different vertex
     than the other. */

  /** The vertex under `index`, in map coordinates, or null. */
  const { coords: editCoords } = editSession
  const vertexCoordinate = useCallback(
    (index) => {
      const vertex = editCoords?.[index]
      return vertex ? fromLonLat(vertex) : null
    },
    [editCoords],
  )

  /**
   * Clicking a row: select it, and move the map only if the vertex is not
   * already on screen. Panning on every click would jolt the map for a marker
   * the user can already see.
   */
  const selectEditedVertex = useCallback(
    (index) => {
      editSession.selectVertex(index)
      const coordinate = vertexCoordinate(index)
      if (coordinate) ensureVisible(coordinate)
    },
    [editSession, vertexCoordinate, ensureVisible],
  )

  /**
   * "Haritada Göster": centres on one vertex at the CURRENT zoom.
   *
   * Deliberately not a zoom-in — the number the user just read only means
   * anything in the context of the shape around it, and framing a single vertex
   * would push the rest of the geometry off screen.
   */
  const focusEditedVertex = useCallback(
    (index) => {
      editSession.selectVertex(index)
      const coordinate = vertexCoordinate(index)
      if (coordinate) panTo(coordinate)
    },
    [editSession, vertexCoordinate, panTo],
  )

  // Losing the selection mid-edit (delete, deselect) must not strand the map in
  // edit mode with nothing to edit.
  useEffect(() => {
    if (workspaceMode.isEditing && !selectedFeature) stopEditing()
  }, [workspaceMode.isEditing, selectedFeature, stopEditing])

  /* --- Çizimlerim row actions ----------------------------------------------
     Both route through the SAME state the map uses: the row selects the
     drawing first, then the shared edit / delete flow takes over. That is what
     keeps the sidebar and the map showing one selection rather than two. */

  /* Leaving an open edit session by picking a different drawing has to go
     through the same unsaved-changes guard as closing the panel; otherwise the
     list becomes a side door that silently discards work. `cancelEdit` runs the
     follow-up action itself once it is safe to, so the guarded and unguarded
     paths stay one code path.

     Clicking the MAP cannot reach here: selection is disabled outside select
     mode, and edit is its own mode — that door is already closed. */
  const guardEdit = useCallback(
    (action) => {
      if (workspaceMode.isEditing) cancelEdit(action)
      else action()
    },
    [workspaceMode.isEditing, cancelEdit],
  )

  const selectFromList = useCallback((key) => guardEdit(() => selectAndZoom(key)), [guardEdit, selectAndZoom])

  const editFromList = useCallback(
    (key) =>
      guardEdit(() => {
        selectAndZoom(key)
        // The panel is covering the map it is about to edit; close it so the
        // Modify handles are actually reachable.
        setActivePanel(null)
        setGeometryEditMode(GEOMETRY_EDIT_MODES.vertex)
        startEditing()
      }),
    [guardEdit, selectAndZoom, startEditing],
  )

  const deleteFromList = useCallback(
    (key) =>
      guardEdit(() => {
        const item = workspace.drawings.find((drawing) => drawing.key === key)
        // Same confirmation dialog as the map's own delete — one flow, so soft
        // delete can never happen without a confirmation step.
        if (item) setPendingDelete([item])
      }),
    [guardEdit, workspace.drawings],
  )
  /** Esc: abort drawing first, then close whatever is open. */
  const handleEscape = useCallback(() => {
    // The unsaved-changes dialog is the most modal thing on screen; Esc there
    // means "go back to editing", which is its safe answer.
    if (pendingDiscard) {
      setPendingDiscard(null)
      return
    }
    if (pendingDelete) {
      setPendingDelete(null)
      return
    }
    if (pendingRestore) {
      setPendingRestore(null)
      return
    }
    // The attribute popup is the most modal thing on screen: Esc there means
    // "discard this shape", not "leave the tool".
    if (workspace.pendingDrawing) {
      workspace.cancelPendingDrawing()
      return
    }
    // An open edit session is the next most modal: Esc abandons the edit and
    // puts the geometry back, rather than dropping the selection under it.
    if (workspaceMode.isEditing) {
      // Asks first when there is unsaved work; closes straight away when not.
      cancelEdit()
      return
    }
    if (workspaceMode.isAnalyzing) {
      workspaceMode.stopAnalysis()
      return
    }
    if (workspaceMode.isDrawing) {
      workspaceMode.stopDrawing()
      return
    }
    if (workspaceMode.isMeasuring) {
      workspaceMode.stopMeasuring()
      return
    }
    // A spatial selection tool is a mode too; Esc drops back to plain clicking.
    if (workspaceMode.activeSelectionTool && workspaceMode.activeSelectionTool !== 'single') {
      workspaceMode.selectSelectionTool('single')
      return
    }
    if (styleTarget) {
      setStyleTarget(null)
      return
    }
    if (activePanel) {
      setActivePanel(null)
      return
    }
    if (selectionCount > 0) workspace.clearSelection()
  }, [
    pendingDiscard,
    pendingDelete,
    pendingRestore,
    workspaceMode,
    styleTarget,
    activePanel,
    selectionCount,
    workspace,
    cancelEdit,
  ])

  const handleMeasureShortcut = useCallback(
    () => workspaceMode.selectMeasureTool(workspaceMode.activeMeasureTool ?? 'distance'),
    [workspaceMode],
  )

  useKeyboardShortcuts({
    lettersEnabled: hasFinePointer,
    // The shortcuts drive the same canonical actions the toolbar does; there is
    // no second code path that could leave the two out of step.
    onTool: workspaceMode.selectDrawTool,
    onMeasure: handleMeasureShortcut,
    onEscape: handleEscape,
    onUndo: workspace.undo,
    onRedo: workspace.redo,
  })

  /* --- Derived ------------------------------------------------------------ */

  const layerCounts = workspace.drawingGroups.reduce(
    (acc, group) => ({ ...acc, [group.type.id]: group.items.length }),
    {},
  )


  const isStylePanelOpen = styleTarget !== null
  // Only one right-hand surface at a time keeps the map readable on tablets.
  // One selected feature gets the detail panel; two or more get the multi
  // panel — the same selection state, shown at the altitude that is useful.
  const isSelectedPanelOpen = selectionCount === 1 && !isStylePanelOpen && !activePanel
  const isMultiPanelOpen = selectionCount >= 2 && !isStylePanelOpen && !activePanel
  // Drives the CSS that moves the OpenLayers zoom control out from under the
  // docked panel; on phones the panel is a bottom sheet and nothing shifts.
  const hasDockedPanel = isStylePanelOpen || isSelectedPanelOpen || isMultiPanelOpen || Boolean(activePanel)

  const stylePanelMode =
    styleTarget === 'feature'
      ? STYLE_PANEL_MODES.selectedFeature
      : styleTarget === 'bulk'
        ? STYLE_PANEL_MODES.bulkSelection
        : STYLE_PANEL_MODES.drawingDefault

  /** "1 Nokta, 1 Çizgi ve 1 Poligon" for the delete confirmation. */
  const describeSelection = (items) => {
    const parts = DRAWING_TYPE_LIST.map((type) => {
      const count = items.filter((item) => item.type === type.id).length
      return count > 0 ? `${count} ${type.label}` : null
    }).filter(Boolean)

    if (parts.length <= 1) return parts.join('')
    return `${parts.slice(0, -1).join(', ')} ve ${parts.at(-1)}`
  }

  return (
    <div className={`map-page ${mapReady ? 'map-page--ready' : ''}`}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((value) => !value)}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        activePanel={activePanel}
        onSelectPanel={handleSelectPanel}
        username={username}
        remaining={remaining}
        onLogout={handleLogout}
      />

      <div className="map-main">
        <Topbar
          username={username}
          remaining={remaining}
          onLogout={handleLogout}
          onOpenMobileMenu={() => setMobileMenuOpen(true)}
          mobileMenuOpen={mobileMenuOpen}
        />

        <div className={`map-viewport ${hasDockedPanel ? 'has-docked-panel' : ''}`}>
          <div className="map-container" ref={mapContainerRef} />

          {mapReady && (
            <>
              <QuickActions
                onGoTurkey={mapView.goToTurkey}
                onGoMyLocation={mapView.goToMyLocation}
                onFocusAll={focusAllDrawings}
              >
                {/* Background imagery. Not the "Katmanlar" panel, which toggles
                    the data overlays drawn on top of whatever is chosen here. */}
                <BasemapSelector
                  value={basemap.basemapId}
                  options={basemap.basemaps}
                  onChange={basemap.selectBasemap}
                />
              </QuickActions>

              {/* Everything below renders straight from the canonical mode —
                  no component keeps its own idea of the active tool. */}
              <DrawToolbar
                activeTool={workspaceMode.activeDrawTool}
                onSelectTool={workspaceMode.selectDrawTool}
                measureMode={workspaceMode.activeMeasureTool}
                onSelectMeasure={(mode) => workspaceMode.selectMeasureTool(mode ?? 'distance')}
                selectionTool={workspaceMode.activeSelectionTool}
                onSelectSelectionTool={workspaceMode.selectSelectionTool}
                analysisActive={Boolean(workspaceMode.activeAnalysisTool)}
                onToggleAnalysis={workspaceMode.toggleAnalysisTool}
                onOpenStyle={openStyleForTool}
                canUndo={workspace.canUndo}
                canRedo={workspace.canRedo}
                onUndo={workspace.undo}
                onRedo={workspace.redo}
              />

              <DrawingHint
                activeTool={workspaceMode.activeDrawTool}
                measureMode={workspaceMode.activeMeasureTool}
                selectionTool={workspaceMode.activeSelectionTool}
                analysisActive={Boolean(workspaceMode.activeAnalysisTool)}
              />

              {/* One readout for both analysis entry points: the temporary tool
                  and the run that follows a saved polygon. */}
              <AnalysisPanel
                loading={analysis.isLoading}
                result={analysis.result}
                error={analysis.error}
                selectedKey={analysis.selectedKey}
                onSelectItem={analysis.selectItem}
                onShowOnMap={showAnalysisItemOnMap}
                onOpenDrawing={openAnalysisItemDrawing}
                metricsFor={analysisMetrics}
                onClear={analysis.clear}
                onClose={analysis.clear}
              />

              <MeasurementReadout
                mode={workspaceMode.activeMeasureTool}
                liveLabel={measurement.liveLabel}
                results={measurement.results}
                onSelectMode={workspaceMode.selectMeasureTool}
                onClear={measurement.clear}
                onClose={() => {
                  measurement.clear()
                  workspaceMode.stopMeasuring()
                }}
              />

              {hasFinePointer && <HoverTooltip hovered={hovered} />}

              <SavingIndicator visible={workspace.isSaving} />

              {workspace.loadingDrawings && (
                <div className="map-drawings-loading" role="status">
                  Kayıtlı çizimler yükleniyor...
                </div>
              )}

              <StylePanel
                open={isStylePanelOpen}
                mode={stylePanelMode}
                onClose={closeStylePanel}
                editingFeature={styleTarget === 'feature' ? selectedFeature : null}
                selectedFeatures={styleTarget === 'bulk' ? selectedFeatures : []}
                toolStyles={workspace.toolStyles}
                // The type the panel edits and the tool the map draws with are
                // the same value, read from and written back to one place.
                activeType={workspaceMode.styleToolType}
                onSelectDrawTool={workspaceMode.setDrawTool}
                onSetToolStyle={workspace.setToolStyle}
                onPreview={workspace.previewStyle}
                onPreviewPatch={workspace.previewStylePatch}
                onApply={workspace.applyStyle}
                onApplyPatch={workspace.applyStylePatchToSelection}
              />

              <SelectedFeaturePanel
                open={isSelectedPanelOpen}
                feature={selectedFeature}
                geometry={selectedGeometry}
                onClose={workspace.clearSelection}
                onZoom={() => selectedFeature && fitExtent(extentOf(selectedFeature.key))}
                onEditStyle={openStyleForSelection}
                onDelete={requestDelete}
                editing={workspaceMode.isEditing}
                saving={workspace.isSaving}
                onStartEdit={startEdit}
                onSaveEdit={saveEdit}
                onCancelEdit={() => cancelEdit()}
                session={editSession}
                editMode={geometryEditMode}
                onEditModeChange={setGeometryEditMode}
                onSelectVertex={selectEditedVertex}
                onFocusVertex={focusEditedVertex}
                onCopyText={copyText}
                onNotify={showToast}
                canManage={canManageSelected}
              />

              <MultiSelectionPanel
                open={isMultiPanelOpen}
                count={selectionCount}
                counts={selectionCounts}
                onClose={workspace.clearSelection}
                onFocus={focusSelection}
                onEditStyle={openStyleForBulk}
                onDelete={requestDelete}
                onClear={workspace.clearSelection}
                canManageAll={canManageSelection}
                foreignCount={foreignSelectedCount}
              />

              <DrawingsPanel
                open={activePanel === 'drawings'}
                onClose={() => setActivePanel(null)}
                drawings={workspace.drawings}
                selectedKeys={selectedKeys}
                visibility={workspace.visibility}
                visibleCount={workspace.visibleCount}
                loading={workspace.loadingDrawings}
                error={workspace.loadError}
                onRetry={workspace.reloadDrawings}
                onSelect={selectFromList}
                onToggleSelect={workspace.toggleSelection}
                onSelectAllVisible={() => {
                  const count = workspace.selectAllVisible()
                  showToast('info', count ? `${count} çizim seçildi.` : 'Görünür çizim yok.')
                }}
                onClearSelection={workspace.clearSelection}
                onEdit={editFromList}
                onDelete={deleteFromList}
                canManage={(item) => canManageDrawing({ isAdmin, userId }, item)}
              />

              {/* Soft delete made visible: the rows the database kept, with
                  the one action that puts them back. No permanent delete. */}
              <TrashPanel
                open={activePanel === 'trash'}
                onClose={() => setActivePanel(null)}
                items={trash.items}
                loading={trash.loading}
                error={trash.error}
                restoringKey={trash.restoringKey}
                onRetry={trash.reload}
                onRestore={requestRestore}
              />

              <LayersPanel
                open={activePanel === 'layers'}
                onClose={() => setActivePanel(null)}
                visibility={workspace.visibility}
                counts={layerCounts}
                onToggle={workspace.toggleVisibility}
              />

              <SettingsPanel
                open={activePanel === 'settings'}
                onClose={() => setActivePanel(null)}
                shortcutsEnabled={hasFinePointer}
              />

              <AboutPanel open={activePanel === 'about'} onClose={() => setActivePanel(null)} />

              {/* Opens the instant a shape is finished. Until "Kaydet" is
                  pressed the geometry exists only on the pending layer — no
                  record has been created, so "İptal" simply throws it away. */}
              <AttributePopup
                open={Boolean(workspace.pendingDrawing)}
                pending={workspace.pendingDrawing}
                saving={workspace.isSaving}
                onSave={workspace.savePendingDrawing}
                onCancel={workspace.cancelPendingDrawing}
                onColorChange={workspace.previewPendingColor}
              />

              <MapToasts toasts={toasts} onDismiss={dismissToast} />

              {/* One dialog for both cases: the wording scales with the count
                  and always names exactly what is about to be removed. */}
              <ConfirmDialog
                open={Boolean(pendingDelete?.length)}
                title={pendingDelete?.length > 1 ? 'Çizimleri sil' : 'Çizimi sil'}
                message={
                  !pendingDelete?.length
                    ? ''
                    : pendingDelete.length === 1
                      ? // Naming the drawing makes the dialog specific enough to
                        // catch a mis-click on the wrong row.
                        `“${pendingDelete[0].name || DRAWING_TYPES[pendingDelete[0].type].label}” çizimini silmek istediğinize emin misiniz?`
                      : `${pendingDelete.length} çizimi silmek istediğinize emin misiniz?`
                }
                description={
                  !pendingDelete?.length
                    ? ''
                    : // Soft delete: the row stays in the database, so promising
                      // permanent removal here would be untrue.
                      `${describeSelection(pendingDelete)} haritadan ve Çizimlerim listesinden kaldırılacaktır. Bu işlem geri alınabilir.`
                }
                confirmLabel={pendingDelete?.length > 1 ? `${pendingDelete.length} Çizimi Sil` : 'Sil'}
                onConfirm={confirmDelete}
                onCancel={() => setPendingDelete(null)}
              />

              {/* Restore confirmation. Same dialog component as the delete one,
                  in the primary tone: the record is coming back, and the row
                  it comes back into is the very one that was deleted. */}
              <ConfirmDialog
                open={Boolean(pendingRestore)}
                tone="primary"
                title="Çizimi geri yükle"
                message={
                  !pendingRestore
                    ? ''
                    : // Naming the drawing makes the dialog specific enough to
                      // catch a mis-tap on the neighbouring row.
                      `“${pendingRestore.drawing?.name || DRAWING_TYPES[pendingRestore.type]?.label || 'Çizim'}” çizimini geri yüklemek istiyor musunuz?`
                }
                description="Çizim aynı kayıt olarak haritaya ve Çizimlerim listesine geri döner, Çöp Kutusu'ndan kalkar."
                confirmLabel="Geri Yükle"
                onConfirm={confirmRestore}
                onCancel={() => setPendingRestore(null)}
              />

              {/* Unsaved edits. The same dialog component as the delete
                  confirmation, so both destructive moments look and behave
                  alike — and neither is a browser `confirm()`. Cancelling is
                  the safe answer, so it is the one that returns to editing. */}
              <ConfirmDialog
                open={Boolean(pendingDiscard)}
                title="Kaydedilmemiş değişiklikler"
                message="Kaydedilmemiş değişiklikleriniz var."
                description="Şimdi çıkarsanız bu düzenlemeler kaybolur. Çizim veritabanında olduğu gibi kalır."
                confirmLabel="Değişiklikleri At"
                cancelLabel="Düzenlemeye Dön"
                onConfirm={confirmDiscard}
                onCancel={() => setPendingDiscard(null)}
              />
            </>
          )}

          <MapLoadingOverlay visible={!mapReady && isIdle} />
        </div>
      </div>
    </div>
  )
}
