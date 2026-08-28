import { useCallback, useEffect, useRef, useState } from 'react'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import TileLayer from 'ol/layer/Tile.js'
import OSM from 'ol/source/OSM.js'
import { fromLonLat } from 'ol/proj.js'
import { readApiError } from '../../services/api.js'
import { createTransportStop, deleteTransportStop, updateTransportStop } from '../../services/transportApi.js'
import { deleteStopThenMaybeGenerate, persistStopThenMaybeGenerate } from '../../services/transportStopWorkflow.js'
import { duplicateStopNameWarning } from '../../map/adminTransportStops.js'
import useTransportLayer from '../../hooks/useTransportLayer.js'
import useTransportStopPlacement from '../../hooks/useTransportStopPlacement.js'
import useTransportStopRelocation from '../../hooks/useTransportStopRelocation.js'
import {
  TRANSPORT_ROUTE_KIND,
  TRANSPORT_ROUTE_PATH_KIND,
  TRANSPORT_ROUTE_LAYER_CLASSNAME,
  TRANSPORT_ROUTE_PATH_LAYER_CLASSNAME,
  TRANSPORT_STOP_KIND,
  TRANSPORT_STOP_LAYER_CLASSNAME,
} from '../../map/transport.js'
import { TURKEY_CENTER_LON_LAT, TURKEY_ZOOM } from '../../map/turkey.js'

export default function TransportManagementMap({
  routes,
  selectedRoute,
  selectedStopId,
  selectedRouteStops,
  hiddenRouteIds,
  hoveredRouteId,
  canView,
  canCreateStop,
  canUpdateStop,
  canDeleteStop,
  canUpdateRoute,
  refreshVersion,
  editRequest,
  deleteRequest,
  onSelectRoute,
  onSelectStop,
  onTransportChanged,
  onTransportSnapshot,
  onHoveredRouteChange,
  onNotice,
}) {
  const targetRef = useRef(null)
  const [map, setMap] = useState(null)
  const [placing, setPlacing] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [generatePath, setGeneratePath] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [routeDraft, setRouteDraft] = useState('')
  const [locationEditing, setLocationEditing] = useState(false)
  const [regenerateAfterMove, setRegenerateAfterMove] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const focusedRouteRef = useRef(null)
  const focusedStopRef = useRef(null)
  const handledEditRequestRef = useRef(0)
  const handledDeleteRequestRef = useRef(0)
  const mapHoveredRouteRef = useRef(null)

  useEffect(() => {
    if (!targetRef.current) return undefined
    const instance = new Map({
      target: targetRef.current,
      layers: [new TileLayer({ source: new OSM() })],
      view: new View({ center: fromLonLat(TURKEY_CENTER_LON_LAT), zoom: TURKEY_ZOOM }),
    })
    setMap(instance)
    return () => {
      instance.setTarget(undefined)
    }
  }, [])

  const showMapError = useCallback((type, message) => onNotice?.({ type, message }), [onNotice])
  const transport = useTransportLayer(map, {
    permitted: canView,
    selectedStopId,
    selectedRouteId: selectedRoute?.id ?? null,
    hoveredRouteId,
    hiddenRouteIds,
    showToast: showMapError,
    onSnapshot: onTransportSnapshot,
  })
  const {
    refresh: refreshTransport,
    stops: transportStops,
    paths: transportPaths,
    loading: transportLoading,
    focusRoute,
    focusStop,
    applyStopOrder,
  } = transport

  const selectedStop = transportStops.find((stop) => stop.id === selectedStopId) ?? null
  const canGenerateAfterCreate = Boolean(canUpdateRoute && selectedRoute && (selectedRoute.stopCount ?? 0) + 1 >= 2)
  const createDuplicateWarning = duplicateStopNameWarning(transportStops, { routeId: selectedRoute?.id, name })
  const editDuplicateWarning = duplicateStopNameWarning(transportStops, {
    stopId: selectedStop?.id,
    routeId: routeDraft,
    name: nameDraft,
  })
  const selectedRouteHasGeometry = Boolean(selectedRoute && (
    transportPaths.some((candidate) => candidate.routeId === selectedRoute.id && candidate.isStale !== true && candidate.geometryWkt)
    || transportStops.some((stop) => stop.routeId === selectedRoute.id)
  ))

  const { pending: relocationPending, clearPending: clearRelocation } = useTransportStopRelocation(map, { active: locationEditing && Boolean(selectedStop) })

  const handlePlaced = useCallback(() => {
    setName('')
    setError('')
    setFormOpen(true)
  }, [])
  const { pending, clearPending } = useTransportStopPlacement(map, { active: placing && canCreateStop, onPlaced: handlePlaced })

  const cancelPlacement = useCallback(() => {
    setPlacing(false)
    setFormOpen(false)
    setName('')
    setError('')
    setGeneratePath(false)
    clearPending()
  }, [clearPending])

  const cancelLocationEdit = useCallback(() => {
    setLocationEditing(false)
    setRegenerateAfterMove(false)
    clearRelocation()
  }, [clearRelocation])

  useEffect(() => {
    cancelPlacement()
    cancelLocationEdit()
    setEditingName(false)
    setDeleteConfirm(false)
  }, [selectedRoute?.id, canCreateStop, cancelPlacement, cancelLocationEdit])

  useEffect(() => {
    if (!map || refreshVersion === 0) return
    refreshTransport()
  }, [map, refreshVersion, refreshTransport])

  useEffect(() => {
    if (selectedRoute) applyStopOrder(selectedRoute.id, selectedRouteStops)
  }, [selectedRoute, selectedRouteStops, applyStopOrder])

  useEffect(() => {
    if (!selectedRoute) {
      focusedRouteRef.current = null
      return
    }
    if (focusedRouteRef.current === selectedRoute.id || transportLoading) return
    if (focusRoute(selectedRoute.id)) focusedRouteRef.current = selectedRoute.id
  }, [selectedRoute, transportLoading, transportPaths, transportStops, focusRoute])

  useEffect(() => {
    if (!selectedStopId) {
      focusedStopRef.current = null
      return
    }
    if (focusedStopRef.current === selectedStopId || transportLoading) return
    if (focusStop(selectedStopId)) focusedStopRef.current = selectedStopId
  }, [selectedStopId, transportLoading, transportStops, focusStop])

  useEffect(() => {
    if (!selectedStop || editRequest?.stopId !== selectedStop.id || handledEditRequestRef.current === editRequest.version) return
    handledEditRequestRef.current = editRequest.version
    setNameDraft(selectedStop.name)
    setRouteDraft(String(selectedStop.routeId))
    setEditingName(true)
    setDeleteConfirm(false)
  }, [editRequest, selectedStop])

  useEffect(() => {
    if (!selectedStop || deleteRequest?.stopId !== selectedStop.id || handledDeleteRequestRef.current === deleteRequest.version) return
    handledDeleteRequestRef.current = deleteRequest.version
    setEditingName(false)
    setDeleteConfirm(true)
  }, [deleteRequest, selectedStop])

  useEffect(() => {
    if (!map || !canView) return undefined
    const featureAt = (pixel, className, kinds) => map.forEachFeatureAtPixel(
      pixel,
      (feature, layer) => layer?.getClassName?.().includes(className) && kinds.includes(feature.get('featureKind')) ? feature : null,
      { hitTolerance: 8 },
    )
    const handleClick = (event) => {
      if (placing || locationEditing) return
      const stopFeature = featureAt(event.pixel, TRANSPORT_STOP_LAYER_CLASSNAME, [TRANSPORT_STOP_KIND])
      if (stopFeature) {
        const stop = stopFeature.get('transportStop')
        onSelectRoute?.(stop.routeId)
        onSelectStop?.(stop.id)
        return
      }
      const routeFeature = featureAt(event.pixel, TRANSPORT_ROUTE_PATH_LAYER_CLASSNAME, [TRANSPORT_ROUTE_PATH_KIND])
        ?? featureAt(event.pixel, TRANSPORT_ROUTE_LAYER_CLASSNAME, [TRANSPORT_ROUTE_KIND])
      if (routeFeature) {
        onSelectStop?.(null)
        onSelectRoute?.(routeFeature.get('routeId'))
      }
    }
    map.on('singleclick', handleClick)
    return () => map.un('singleclick', handleClick)
  }, [map, canView, placing, locationEditing, onSelectRoute, onSelectStop])

  useEffect(() => {
    if (!map || !canView) return undefined
    const target = map.getTargetElement()
    const publishHoveredRoute = (routeId) => {
      const next = routeId == null ? null : Number(routeId)
      if (mapHoveredRouteRef.current === next) return
      mapHoveredRouteRef.current = next
      onHoveredRouteChange?.(next)
    }
    const handlePointerMove = (event) => {
      if (event.originalEvent?.pointerType === 'touch' || event.dragging || placing || locationEditing) {
        publishHoveredRoute(null)
        return
      }
      const feature = map.forEachFeatureAtPixel(
        event.pixel,
        (candidate, layer) => {
          const className = layer?.getClassName?.() ?? ''
          const kind = candidate.get('featureKind')
          const isRoute = (className.includes(TRANSPORT_ROUTE_PATH_LAYER_CLASSNAME) && kind === TRANSPORT_ROUTE_PATH_KIND)
            || (className.includes(TRANSPORT_ROUTE_LAYER_CLASSNAME) && kind === TRANSPORT_ROUTE_KIND)
          if (!isRoute || hiddenRouteIds?.has(candidate.get('routeId'))) return null
          return candidate
        },
        { hitTolerance: 6 },
      )
      publishHoveredRoute(feature?.get('routeId'))
    }
    const clearHover = () => publishHoveredRoute(null)
    map.on('pointermove', handlePointerMove)
    target?.addEventListener('pointerleave', clearHover)
    return () => {
      map.un('pointermove', handlePointerMove)
      target?.removeEventListener('pointerleave', clearHover)
      if (mapHoveredRouteRef.current != null) {
        mapHoveredRouteRef.current = null
        onHoveredRouteChange?.(null)
      }
    }
  }, [map, canView, placing, locationEditing, hiddenRouteIds, onHoveredRouteChange])

  useEffect(() => {
    if (!locationEditing) return undefined
    const cancelOnEscape = (event) => {
      if (event.key === 'Escape') cancelLocationEdit()
    }
    window.addEventListener('keydown', cancelOnEscape)
    return () => window.removeEventListener('keydown', cancelOnEscape)
  }, [locationEditing, cancelLocationEdit])

  const save = async (event) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !selectedRoute || !pending || saving) return
    setSaving(true)
    setError('')
    try {
      const result = await persistStopThenMaybeGenerate({
        save: () => createTransportStop({
          name: trimmed,
          routeId: selectedRoute.id,
          longitude: pending.longitude,
          latitude: pending.latitude,
        }),
        routeId: selectedRoute.id,
        generatePath: generatePath && canGenerateAfterCreate,
        saveFailureMessage: 'Durak eklenemedi.',
      })
      await onTransportChanged?.()
      await refreshTransport()
      cancelPlacement()
      if (result.generationError) {
        onNotice?.({ type: 'error', message: `Durak eklendi ancak rota yeniden hesaplanamadı. ${result.generationError}` })
      } else if (result.routeGenerated) {
        onNotice?.({ type: 'success', message: 'Durak eklendi, rota hesaplandı ve harita güncellendi.' })
      } else {
        onNotice?.({ type: 'success', message: 'Durak güzergahın sonuna eklendi.' })
      }
    } catch (caught) {
      setError(caught.message || 'Durak eklenemedi.')
    } finally {
      setSaving(false)
    }
  }

  const saveSelectedStop = async ({ move = false } = {}) => {
    if (!selectedStop || saving) return
    const point = move ? relocationPending : selectedStop
    if (move && !point) return
    const destinationRouteId = editingName ? Number(routeDraft) : selectedStop.routeId
    if (!routes.some((route) => route.id === destinationRouteId)) return
    setSaving(true)
    setError('')
    try {
      const result = await persistStopThenMaybeGenerate({
        save: () => updateTransportStop(selectedStop.id, {
          name: editingName ? nameDraft.trim() : selectedStop.name,
          routeId: destinationRouteId,
          longitude: point.longitude,
          latitude: point.latitude,
        }),
        routeId: destinationRouteId,
        generatePath: move && regenerateAfterMove && canUpdateRoute,
        sourceRouteId: selectedStop.routeId,
        generateTransferredRoutes: canUpdateRoute,
        reloadTransport: refreshTransport,
        saveFailureMessage: 'Durak güncellenemedi.',
      })
      if (!result.canonicalRefreshed || result.generationAttempted || result.refreshError) await refreshTransport()
      await onTransportChanged?.()
      setEditingName(false)
      cancelLocationEdit()
      if (result.transferred) onSelectRoute?.(result.destinationRouteId)
      if (result.transferred && result.refreshError) {
        onNotice?.({ type: 'error', message: result.refreshError })
      } else if (result.transferred) {
        const failures = result.affectedRouteOutcomes.filter((outcome) => outcome.attempted && !outcome.generated)
        if (failures.length > 0) {
          const details = failures.map((outcome) => `${outcome.routeName}: ${outcome.error}`).join(' ')
          onNotice?.({ type: 'error', message: `Durak taşındı ancak bazı güzergâh rotaları yeniden hesaplanamadı. ${details}` })
        } else if (result.generationAttempted) {
          onNotice?.({ type: 'success', message: 'Durak taşındı, etkilenen güzergâh rotaları yeniden hesaplandı.' })
        } else {
          onNotice?.({ type: 'success', message: 'Durak başka güzergaha taşındı.' })
        }
      } else if (result.generationError) {
        onNotice?.({ type: 'error', message: `Durak güncellendi ancak rota yeniden hesaplanamadı. ${result.generationError}` })
      } else if (result.routeGenerated) {
        onNotice?.({ type: 'success', message: 'Durak konumu güncellendi, rota hesaplandı ve harita yenilendi.' })
      } else {
        onNotice?.({ type: 'success', message: move ? 'Durak konumu güncellendi; rota güncel değil.' : 'Durak adı güncellendi.' })
      }
    } catch (caught) {
      setError(caught.message || 'Durak güncellenemedi.')
    } finally {
      setSaving(false)
    }
  }

  const removeSelectedStop = async () => {
    if (!selectedStop || saving) return
    setSaving(true)
    setError('')
    try {
      const result = await deleteStopThenMaybeGenerate({
        remove: () => deleteTransportStop(selectedStop.id),
        routeId: selectedStop.routeId,
        generatePath: canUpdateRoute,
        reloadTransport: refreshTransport,
      })
      onSelectStop?.(null)
      await onTransportChanged?.()
      if (result.generationAttempted) await refreshTransport()
      setDeleteConfirm(false)
      if (result.refreshError) {
        onNotice?.({ type: 'error', message: result.refreshError })
      } else if (result.generationError) {
        onNotice?.({ type: 'error', message: `Durak silindi ancak rota yeniden hesaplanamadı. ${result.generationError}` })
      } else if (result.routeGenerated) {
        onNotice?.({ type: 'success', message: 'Durak silindi, rota yeniden hesaplandı ve harita güncellendi.' })
      } else {
        onNotice?.({ type: 'success', message: 'Durak çöp kutusuna taşındı.' })
      }
    } catch (caught) {
      setError(caught.message || 'Durak silinemedi.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="transport-management-map-card" aria-label="Güzergah haritası">
      <div className="transport-management-map-heading">
        <div>
          <h3>Güzergah Haritası</h3>
          <p>{selectedRoute ? `${selectedRoute.name} haritada vurgulanıyor.` : 'Vurgulamak için bir güzergah seçin.'}</p>
        </div>
        <div className="transport-management-map-actions">
          {selectedRoute && <button type="button" className="admin-button secondary" onClick={() => focusRoute(selectedRoute.id)} disabled={!selectedRouteHasGeometry}>Güzergaha Odaklan</button>}
          {selectedRoute && canCreateStop && (
            <button type="button" className={`admin-button ${placing ? 'secondary' : ''}`} aria-pressed={placing} onClick={() => placing ? cancelPlacement() : setPlacing(true)}>
              {placing ? 'Yerleştirmeyi İptal Et' : 'Haritadan Durak Ekle'}
            </button>
          )}
        </div>
      </div>

      {placing && <p className="transport-management-map-hint" role="status">Durak konumunu seçmek için haritaya tıklayın.</p>}
      <div
        ref={targetRef}
        className="transport-management-map"
        data-testid="transport-management-map"
        data-hovered-route-id={hoveredRouteId ?? ''}
      />

      {selectedStop && (
        <aside className="transport-stop-map-detail" aria-label="Seçili durak detayı">
          <header><div><span>Seçili durak</span><strong>{selectedStop.name}</strong></div><button type="button" aria-label="Durak seçimini kapat" onClick={() => onSelectStop?.(null)}>×</button></header>
          <dl>
            <div><dt>Güzergah</dt><dd>{selectedStop.routeName}</dd></div>
            <div><dt>Sıra</dt><dd>{selectedStop.sequenceOrder}</dd></div>
            <div><dt>Boylam</dt><dd>{selectedStop.longitude.toFixed(6)}</dd></div>
            <div><dt>Enlem</dt><dd>{selectedStop.latitude.toFixed(6)}</dd></div>
          </dl>

          {editingName && (
            <div className="transport-stop-inline-edit">
              <label>Durak Adı<input value={nameDraft} onChange={(event) => setNameDraft(event.target.value)} maxLength={200} disabled={saving} autoFocus /></label>
              <label>Güzergah<select value={routeDraft} onChange={(event) => setRouteDraft(event.target.value)} disabled={saving}>{routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
              {editDuplicateWarning && <p className="transport-stop-duplicate-warning" role="status">{editDuplicateWarning}</p>}
              <div><button type="button" className="admin-button secondary" onClick={() => setEditingName(false)} disabled={saving}>İptal</button><button type="button" className="admin-button" onClick={() => saveSelectedStop()} disabled={saving || !nameDraft.trim() || !routeDraft}>Kaydet</button></div>
            </div>
          )}

          {locationEditing && (
            <div className="transport-stop-location-edit" role="status">
              <strong>Konum düzenleme etkin</strong>
              <p>{relocationPending ? `${relocationPending.longitude.toFixed(6)}, ${relocationPending.latitude.toFixed(6)}` : 'Seçili durağın yeni konumunu haritada tıklayın.'}</p>
              {canUpdateRoute && <label><input type="checkbox" checked={regenerateAfterMove} onChange={(event) => setRegenerateAfterMove(event.target.checked)} /> Konumu kaydet ve rotayı güncelle</label>}
              <div><button type="button" className="admin-button secondary" onClick={cancelLocationEdit} disabled={saving}>İptal</button><button type="button" className="admin-button" onClick={() => saveSelectedStop({ move: true })} disabled={saving || !relocationPending}>Konumu Kaydet</button></div>
            </div>
          )}

          {deleteConfirm && <p className="transport-stop-delete-confirm">Bu durak silinsin mi? <button type="button" className="admin-button secondary" onClick={() => setDeleteConfirm(false)} disabled={saving}>Vazgeç</button> <button type="button" className="admin-button danger" onClick={removeSelectedStop} disabled={saving}>Sil</button></p>}
          {error && <p className="admin-dialog-error" role="alert">{error}</p>}
          {!editingName && !locationEditing && !deleteConfirm && (
            <div className="transport-stop-map-actions">
              {canUpdateStop && <button type="button" className="admin-button secondary" onClick={() => { setNameDraft(selectedStop.name); setRouteDraft(String(selectedStop.routeId)); setEditingName(true) }}>Düzenle</button>}
              <button type="button" className="admin-button secondary" onClick={() => focusStop(selectedStop.id)}>Konuma Git</button>
              {canUpdateStop && <button type="button" className="admin-button secondary" onClick={() => setLocationEditing(true)}>Konumu Düzenle</button>}
              {canDeleteStop && <button type="button" className="admin-button danger" onClick={() => setDeleteConfirm(true)}>Sil</button>}
            </div>
          )}
        </aside>
      )}

      {formOpen && pending && (
        <div className="admin-dialog-backdrop" role="presentation">
          <form className="admin-dialog transport-stop-admin-dialog" role="dialog" aria-modal="true" aria-labelledby="transport-stop-admin-title" onSubmit={save}>
            <h2 id="transport-stop-admin-title">Haritadan Durak Ekle</h2>
            <p><strong>{selectedRoute?.name}</strong> güzergahına yeni durak ekliyorsunuz.</p>
            <label className="transport-route-field">
              Durak Adı
              <input value={name} onChange={(event) => setName(event.target.value)} maxLength={200} disabled={saving} autoFocus />
            </label>
            <p className="transport-stop-coordinate">
              EPSG:4326 · {pending.longitude.toFixed(5)}, {pending.latitude.toFixed(5)}
            </p>
            {createDuplicateWarning && <p className="transport-stop-duplicate-warning" role="status">{createDuplicateWarning}</p>}
            {canUpdateRoute && (
              <div className="transport-fast-route-option">
                <label><input type="checkbox" checked={generatePath} onChange={(event) => setGeneratePath(event.target.checked)} disabled={saving || !canGenerateAfterCreate} /> Durağı ekle ve rotayı hesapla</label>
                {!canGenerateAfterCreate && <small>Rota hesaplamak için ekleme sonrasında en az 2 durak olmalıdır.</small>}
              </div>
            )}
            {error && <p className="admin-dialog-error" role="alert">{error}</p>}
            <div className="admin-dialog-actions">
              <button type="button" className="admin-button secondary" onClick={cancelPlacement} disabled={saving}>İptal</button>
              <button type="submit" className="admin-button" disabled={!name.trim() || saving}>
                {saving ? 'Kaydediliyor…' : 'Durağı Kaydet'}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  )
}
