import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import 'ol/ol.css'
import Map from 'ol/Map'
import View from 'ol/View'
import TileLayer from 'ol/layer/Tile'
import OSM from 'ol/source/OSM'
import { defaults as defaultControls, ScaleLine } from 'ol/control'
import { fromLonLat } from 'ol/proj'
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
import ConfirmDialog from '../components/map/ConfirmDialog.jsx'
import AttributePopup from '../components/map/AttributePopup.jsx'
import { SettingsPanel, AboutPanel } from '../components/map/InfoPanels.jsx'
import {
  AnalysisReadout,
  DrawingHint,
  HoverTooltip,
  MeasurementReadout,
  SavingIndicator,
} from '../components/map/MapOverlays.jsx'
import useMediaQuery from '../hooks/useMediaQuery.js'
import useToasts from '../hooks/useToasts.js'
import useDrawingWorkspace from '../hooks/useDrawingWorkspace.js'
import useInventoryAnalysis from '../hooks/useInventoryAnalysis.js'
import useWorkspaceMode, { STYLE_PANEL_MODES } from '../hooks/useWorkspaceMode.js'
import useMapView, { TURKEY_CENTER_LON_LAT, TURKEY_ZOOM } from '../hooks/useMapView.js'
import useMeasurement from '../hooks/useMeasurement.js'
import useFeatureInteraction from '../hooks/useFeatureInteraction.js'
import useSelectionTools from '../hooks/useSelectionTools.js'
import useKeyboardShortcuts from '../hooks/useKeyboardShortcuts.js'
import useGeometryEditing from '../hooks/useGeometryEditing.js'
import { DRAWING_TYPES, DRAWING_TYPE_LIST, colorPatchFor } from '../map/drawingTypes.js'
import { geometryToWkt4326 } from '../map/drawing.js'
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

    const map = new Map({
      target: mapContainerRef.current,
      controls: defaultControls().extend([new ScaleLine({ units: 'metric' })]),
      layers: [
        new TileLayer({
          source: new OSM(),
        }),
      ],
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

  const { fitExtent } = mapView
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

  const geometryEditing = useGeometryEditing(mapInstance, {
    active: workspaceMode.isEditing,
    feature: editingFeature,
  })

  const { cancel: revertGeometry, commit: commitGeometry } = geometryEditing
  const { startEditing, stopEditing } = workspaceMode
  const { updateFeature } = workspace

  const startEdit = useCallback(() => {
    if (!canManageSelected) return
    startEditing()
  }, [canManageSelected, startEditing])

  /** "İptal": geometry snapshot is restored; name/colour drafts simply die. */
  const cancelEdit = useCallback(() => {
    revertGeometry()
    stopEditing()
  }, [revertGeometry, stopEditing])

  /**
   * "Kaydet": name, colour and geometry travel in ONE request, so the record
   * can never end up half-updated. Colour is expanded into the style columns
   * the type actually has (stroke always, fill where supported) by the same
   * helper the attribute popup uses.
   */
  const saveEdit = useCallback(
    async ({ name, color }) => {
      const feature = selectedFeature ? featureByKey(selectedFeature.key) : null
      if (!feature) return

      const ok = await updateFeature(selectedFeature.key, {
        name,
        style: colorPatchFor(selectedFeature.type, color),
        wkt: geometryToWkt4326(feature.getGeometry()),
      })

      if (ok) {
        // The new shape is now the persisted one; drop the undo snapshot so a
        // later cancel cannot reinstate a geometry the database no longer has.
        commitGeometry()
        stopEditing()
      }
      // On failure the session stays open with the user's edits intact.
    },
    [selectedFeature, featureByKey, updateFeature, commitGeometry, stopEditing],
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

  const editFromList = useCallback(
    (key) => {
      selectAndZoom(key)
      // The panel is covering the map it is about to edit; close it so the
      // Modify handles are actually reachable.
      setActivePanel(null)
      startEditing()
    },
    [selectAndZoom, startEditing],
  )

  const deleteFromList = useCallback(
    (key) => {
      const item = workspace.drawings.find((drawing) => drawing.key === key)
      // Same confirmation dialog as the map's own delete — one flow, so soft
      // delete can never happen without a confirmation step.
      if (item) setPendingDelete([item])
    },
    [workspace.drawings],
  )
  /** Esc: abort drawing first, then close whatever is open. */
  const handleEscape = useCallback(() => {
    if (pendingDelete) {
      setPendingDelete(null)
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
  }, [pendingDelete, workspaceMode, styleTarget, activePanel, selectionCount, workspace, cancelEdit])

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
              />

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
              <AnalysisReadout
                loading={analysis.isLoading}
                result={analysis.result}
                error={analysis.error}
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
                onCancelEdit={cancelEdit}
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
                onSelect={selectAndZoom}
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
            </>
          )}

          <MapLoadingOverlay visible={!mapReady && isIdle} />
        </div>
      </div>
    </div>
  )
}
