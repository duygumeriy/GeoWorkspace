import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { usePermissions } from '../../auth/permissionStore.js'
import { PERMISSIONS } from '../../auth/permissionCodes.js'
import AdminPageHeader from '../../components/admin/AdminPageHeader.jsx'
import AdminTransportStopManagement from '../../components/admin/AdminTransportStopManagement.jsx'
import TransportRouteDialog from '../../components/admin/TransportRouteDialog.jsx'
import TransportManagementMap from '../../components/admin/TransportManagementMap.jsx'
import TransportTrackingControls from '../../components/map/TransportTrackingControls.jsx'
import { readApiError } from '../../services/api.js'
import {
  createTransportRoute,
  deleteTransportRoute,
  fetchTransportRoutePath,
  fetchTransportRoutes,
  fetchTransportRouteStops,
  fetchTransportStops,
  fetchDeletedManagedTransportStops,
  generateTransportRoutePath,
  reorderTransportRouteStops,
  restoreTransportStop,
  updateTransportRoute,
} from '../../services/transportApi.js'
import { restoreStopThenMaybeGenerate } from '../../services/transportStopWorkflow.js'
import useTransportSimulation from '../../hooks/useTransportSimulation.js'
import {
  sharedStopIntent,
  sharedStopIntentIsCurrent,
  transportSimulationControls,
} from '../../map/transportSimulationState.js'
import { transportVehiclePresentation } from '../../map/transportVehicle.js'
import { moveStopInRoute } from '../../map/adminTransportStops.js'
import {
  ADMIN_ROUTE_DEFAULT_FILTERS,
  adminRouteFiltersActive,
  buildAdminRouteView,
  pruneHiddenRoutes,
  routePathFor,
  toggleHiddenRoute,
} from '../../map/adminTransportRoutes.js'
import {
  formatRouteDistance,
  formatRouteDuration,
  transportPathStatus,
  transportRouteSummary,
} from '../../map/transportPathPresentation.js'
import './TransportRoutePage.css'

const bySequence = (left, right) => left.sequenceOrder - right.sequenceOrder || left.id - right.id

export default function TransportRoutePage() {
  const { can } = usePermissions()
  const canView = can(PERMISSIONS.TRANSPORT_VIEW)
  const canCreate = can(PERMISSIONS.TRANSPORT_ROUTE_CREATE)
  const canUpdate = can(PERMISSIONS.TRANSPORT_ROUTE_UPDATE)
  const canDelete = can(PERMISSIONS.TRANSPORT_ROUTE_DELETE)
  const canReorder = can(PERMISSIONS.TRANSPORT_ROUTE_REORDER)
  const canCreateStop = can(PERMISSIONS.TRANSPORT_STOP_CREATE)
  const canUpdateStop = can(PERMISSIONS.TRANSPORT_STOP_UPDATE)
  const canDeleteStop = can(PERMISSIONS.TRANSPORT_STOP_DELETE)
  const canRestoreStop = can(PERMISSIONS.TRANSPORT_STOP_RESTORE)
  /* Diğer denetimlerle aynı kalıp: yalnızca ETKİN yetki kodu okunur.
     Görünürlük deneyimdir; yetkilendirme backend'dedir. */
  const canStartSimulation = can(PERMISSIONS.TRANSPORT_SIMULATION_START)
  /* DURDURMA AYRI bir yetkidir ve başlatmayı İMA ETMEZ. Yönetim ekranında
     olmak da bir yetki kaynağı DEĞİLDİR: karar burada da yalnızca etkin yetki
     kodundan gelir ve bağlayıcı denetim backend'dedir. */
  const canStopSimulation = can(PERMISSIONS.TRANSPORT_SIMULATION_STOP)
  const canManageRoutes = canCreate || canUpdate || canDelete || canReorder

  const [managementView, setManagementView] = useState(() => canManageRoutes ? 'routes' : 'stops')
  const [routes, setRoutes] = useState([])
  const [routesLoading, setRoutesLoading] = useState(true)
  const [routesError, setRoutesError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [stops, setStops] = useState([])
  const [stopsLoading, setStopsLoading] = useState(false)
  const [stopsError, setStopsError] = useState('')
  const [path, setPath] = useState(null)
  const [pathLoading, setPathLoading] = useState(false)
  const [pathError, setPathError] = useState('')
  const [generatingPath, setGeneratingPath] = useState(false)
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [dialogError, setDialogError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [mapRefreshVersion, setMapRefreshVersion] = useState(0)
  const [selectedStopId, setSelectedStopId] = useState(null)
  const [managedStops, setManagedStops] = useState([])
  const [managedDeletedStops, setManagedDeletedStops] = useState([])
  const [managedStopsLoading, setManagedStopsLoading] = useState(false)
  const [managedStopsError, setManagedStopsError] = useState('')
  const [mapEditRequest, setMapEditRequest] = useState(null)
  const [mapDeleteRequest, setMapDeleteRequest] = useState(null)
  const [routePaths, setRoutePaths] = useState(null)
  const [routeFilters, setRouteFilters] = useState(ADMIN_ROUTE_DEFAULT_FILTERS)
  const [hiddenRouteIds, setHiddenRouteIds] = useState(() => new Set())
  const [hoveredRouteId, setHoveredRouteId] = useState(null)
  /* Bu oturumda BAŞLATILAN çalıştırmanın kimliği: aracın ilk (%0) konumunun
     seçili rotada gösterilebilmesi için. Takip başlatmaz. */
  const [startedSimulationId, setStartedSimulationId] = useState(null)
  /* BEKLEYEN DURUM BİR BAYRAK DEĞİL, BİR KİMLİKTİR (ana haritayla aynı
     gerekçe): onay kutusu açıkken A bitip AYNI rotada B başlayabilir ve
     yalnızca "onay açık" bilgisi tutulsaydı, kullanıcının A için verdiği
     karar sessizce B'yi durdururdu. Niyet tetikleme anında dondurulur. */
  const [pendingSimulationStop, setPendingSimulationStop] = useState(null)
  const mutationInFlight = useRef(false)
  const stopRequestId = useRef(0)
  const pathRequestId = useRef(0)

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedId) ?? null,
    [routes, selectedId],
  )

  /* Seçili güzergahın simülasyon durumu. Kanca açılışta REST ile okur —
     güzergah bu tarayıcı hiç bağlanmadan önce de çalışıyor olabilir — ve
     canlı yayını yalnızca kullanıcı AÇIKÇA "Takip Et" dediğinde dinler. */
  const simulation = useTransportSimulation({ routeId: selectedId, canView })

  /* Haritadaki aracın sahibi: canlı takip edilen rota, o yoksa kullanıcının az
     önce BAŞLATTIĞI ve pasif olarak izlenen çalıştırma. İkincisi de CANLI
     akar — ama kamerayı ele geçirmez; görünümü hareket ettiren tek şey
     kullanıcının açık "Takip Et" eylemidir. */
  const vehicle = useMemo(() => transportVehiclePresentation({
    simulation: simulation.followedSimulation ?? simulation.observedSimulation ?? simulation.simulation,
    followingRouteId: simulation.followingRouteId,
    observedRouteId: simulation.observedRouteId,
    selectedRouteId: selectedId,
    startedSimulationId,
    routes,
  }), [
    simulation.followedSimulation,
    simulation.observedSimulation,
    simulation.simulation,
    simulation.followingRouteId,
    simulation.observedRouteId,
    selectedId,
    startedSimulationId,
    routes,
  ])

  const simulationControls = transportSimulationControls({
    routeId: selectedId,
    simulation: simulation.simulation,
    followingRouteId: simulation.followingRouteId,
    canStart: canStartSimulation,
    canStop: canStopSimulation,
    starting: simulation.starting,
    stopping: simulation.stopping,
    pausing: simulation.pausing,
    resuming: simulation.resuming,
    following: simulation.following,
  })
  const visibleRoutes = useMemo(
    () => buildAdminRouteView(routes, routePaths ?? [], routeFilters),
    [routes, routePaths, routeFilters],
  )
  const routeFiltersActive = adminRouteFiltersActive(routeFilters)

  const receiveTransportSnapshot = useCallback((snapshot) => {
    setRoutePaths(snapshot.paths)
  }, [])

  const toggleRouteVisibility = useCallback((routeId) => {
    setHiddenRouteIds((current) => toggleHiddenRoute(current, routeId))
    setHoveredRouteId((current) => current === routeId ? null : current)
  }, [])

  const loadRoutes = useCallback(async (options = {}) => {
    const strict = options?.strict === true
    setRoutesLoading(true)
    setRoutesError('')
    try {
      const response = await fetchTransportRoutes()
      if (!response.ok) throw new Error(await readApiError(response, 'Güzergahlar yüklenemedi.'))
      const next = (await response.json()).filter((route) => route.isActive === true)
      setRoutes(next)
      setSelectedId((current) => current != null && next.some((route) => route.id === current) ? current : null)
      return next
    } catch (error) {
      setRoutes([])
      setRoutesError(error.message || 'Güzergahlar yüklenemedi.')
      if (strict) throw error
      return []
    } finally {
      setRoutesLoading(false)
    }
  }, [])

  const loadManagedStops = useCallback(async (options = {}) => {
    const strict = options?.strict === true
    if (!canView) {
      setManagedStops([])
      setManagedDeletedStops([])
      return { active: [], deleted: [] }
    }
    setManagedStopsLoading(true)
    setManagedStopsError('')
    try {
      const [activeResponse, deletedResponse] = await Promise.all([
        fetchTransportStops(),
        canRestoreStop ? fetchDeletedManagedTransportStops() : null,
      ])
      if (!activeResponse.ok) throw new Error(await readApiError(activeResponse, 'Duraklar yüklenemedi.'))
      if (deletedResponse && !deletedResponse.ok) throw new Error(await readApiError(deletedResponse, 'Silinmiş duraklar yüklenemedi.'))
      const active = await activeResponse.json()
      const deleted = deletedResponse ? await deletedResponse.json() : []
      setManagedStops(active)
      setManagedDeletedStops(deleted)
      return { active, deleted }
    } catch (error) {
      setManagedStops([])
      setManagedDeletedStops([])
      setManagedStopsError(error.message || 'Duraklar yüklenemedi.')
      if (strict) throw error
      return { active: [], deleted: [] }
    } finally {
      setManagedStopsLoading(false)
    }
  }, [canRestoreStop, canView])

  const loadStops = useCallback(async (routeId) => {
    if (!routeId) {
      stopRequestId.current += 1
      setStops([])
      setStopsError('')
      return []
    }
    const requestId = ++stopRequestId.current
    setStopsLoading(true)
    setStopsError('')
    try {
      const response = await fetchTransportRouteStops(routeId)
      if (!response.ok) throw new Error(await readApiError(response, 'Duraklar yüklenemedi.'))
      const next = (await response.json()).sort(bySequence)
      if (requestId === stopRequestId.current) setStops(next)
      return next
    } catch (error) {
      if (requestId === stopRequestId.current) {
        setStops([])
        setStopsError(error.message || 'Duraklar yüklenemedi.')
      }
      return []
    } finally {
      if (requestId === stopRequestId.current) setStopsLoading(false)
    }
  }, [])

  const loadPath = useCallback(async (routeId) => {
    if (!routeId) {
      pathRequestId.current += 1
      setPath(null)
      setPathError('')
      return null
    }
    const requestId = ++pathRequestId.current
    setPathLoading(true)
    setPathError('')
    try {
      const response = await fetchTransportRoutePath(routeId)
      if (response.status === 404) {
        if (requestId === pathRequestId.current) setPath(null)
        return null
      }
      if (!response.ok) throw new Error(await readApiError(response, 'Rota bilgisi yüklenemedi.'))
      const next = await response.json()
      if (requestId === pathRequestId.current) setPath(next)
      return next
    } catch (error) {
      if (requestId === pathRequestId.current) {
        setPath(null)
        setPathError(error.message || 'Rota bilgisi yüklenemedi.')
      }
      return undefined
    } finally {
      if (requestId === pathRequestId.current) setPathLoading(false)
    }
  }, [])

  useEffect(() => { loadRoutes() }, [loadRoutes])
  useEffect(() => { loadStops(selectedId) }, [selectedId, loadStops])
  useEffect(() => { loadPath(selectedId) }, [selectedId, loadPath])
  useEffect(() => { if (managementView === 'stops') loadManagedStops() }, [managementView, loadManagedStops])
  useEffect(() => {
    setHiddenRouteIds((current) => pruneHiddenRoutes(current, routes))
  }, [routes])

  const selectRoute = useCallback((routeId) => {
    setSelectedId(routeId == null ? null : Number(routeId))
    setSelectedStopId(null)
  }, [])

  const generatePath = async () => {
    if (!selectedRoute || stops.length < 2 || generatingPath || !canUpdate) return
    setGeneratingPath(true)
    setPathError('')
    try {
      const response = await generateTransportRoutePath(selectedRoute.id)
      if (!response.ok) throw new Error(await readApiError(response, 'Rota hesaplanamadı.'))
      await response.json()
      await loadPath(selectedRoute.id)
      setMapRefreshVersion((value) => value + 1)
      setNotice({ type: 'success', message: 'Rota hesaplandı ve harita güncellendi.' })
    } catch (error) {
      const message = error.message || 'Rota hesaplanamadı.'
      await loadPath(selectedRoute.id)
      setMapRefreshVersion((value) => value + 1)
      setPathError(message)
      setNotice({ type: 'error', message })
    } finally {
      setGeneratingPath(false)
    }
  }

  const runRouteMutation = async (request, successMessage) => {
    if (mutationInFlight.current) return null
    mutationInFlight.current = true
    setBusy(true)
    setDialogError('')
    try {
      const response = await request()
      if (!response.ok) throw new Error(await readApiError(response, 'İşlem tamamlanamadı.'))
      const value = response.status === 204 ? true : await response.json()
      await loadRoutes()
      setMapRefreshVersion((value_) => value_ + 1)
      setNotice({ type: 'success', message: successMessage })
      return value
    } catch (error) {
      const message = error.message || 'İşlem tamamlanamadı.'
      if (dialog) setDialogError(message)
      else setNotice({ type: 'error', message })
      return null
    } finally {
      mutationInFlight.current = false
      setBusy(false)
    }
  }

  const submitRoute = async (payload) => {
    if (!dialog) return
    if (dialog.mode === 'create') {
      const created = await runRouteMutation(
        () => createTransportRoute(payload),
        `'${payload.name}' güzergahı oluşturuldu.`,
      )
      if (created) {
        setSelectedId(created.id)
        setDialog(null)
      }
      return
    }

    const updated = await runRouteMutation(
      () => updateTransportRoute(dialog.route.id, payload),
      `'${payload.name}' güzergahı güncellendi.`,
    )
    if (updated) setDialog(null)
  }

  const confirmDelete = async () => {
    const target = deleteTarget
    if (!target) return
    const response = await runRouteMutation(
      () => deleteTransportRoute(target.id),
      `'${target.name}' güzergahı normal ulaşımdan kaldırıldı. Durak kayıtları korunuyor.`,
    )
    if (response === true) {
      setSelectedId(null)
      setSelectedStopId(null)
      setStops([])
      setDeleteTarget(null)
    }
  }

  const saveStopOrder = async (numbered) => {
    if (!numbered || !canReorder || mutationInFlight.current) return
    const previous = stops
    setStops(numbered)
    mutationInFlight.current = true
    setBusy(true)
    try {
      const response = await reorderTransportRouteStops(selectedId, numbered.map((stop) => stop.id))
      if (!response.ok) throw new Error(await readApiError(response, 'Durak sırası güncellenemedi.'))
      await loadStops(selectedId)
      await loadRoutes()
      const refreshedPath = await loadPath(selectedId)
      setMapRefreshVersion((value) => value + 1)
      if (refreshedPath?.isStale) {
        setNotice({ type: 'error', message: 'Durak sırası güncellendi ancak rota yeniden hesaplanamadı.' })
      } else if (refreshedPath === undefined) {
        setNotice({ type: 'error', message: 'Durak sırası güncellendi ancak rota durumu doğrulanamadı.' })
      } else {
        setNotice({ type: 'success', message: 'Durak sırası güncellendi.' })
      }
    } catch (error) {
      setStops(previous)
      setNotice({ type: 'error', message: error.message || 'Durak sırası güncellenemedi.' })
    } finally {
      mutationInFlight.current = false
      setBusy(false)
    }
  }

  const dropStop = (targetId) => {
    const sourceId = draggingId
    setDraggingId(null)
    if (sourceId == null || sourceId === targetId) return
    const sourceIndex = stops.findIndex((stop) => stop.id === sourceId)
    const targetIndex = stops.findIndex((stop) => stop.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return
    const direction = targetIndex > sourceIndex ? 1 : -1
    let numbered = stops
    for (let index = sourceIndex; index !== targetIndex; index += direction) {
      numbered = moveStopInRoute(numbered, sourceId, direction)
    }
    saveStopOrder(numbered)
  }

  const moveStop = (stopId, direction) => saveStopOrder(moveStopInRoute(stops, stopId, direction))

  const transportChanged = useCallback(async () => {
    await Promise.all([
      loadRoutes(),
      loadStops(selectedId),
      loadPath(selectedId),
      managementView === 'stops' ? loadManagedStops() : null,
    ])
  }, [loadRoutes, loadStops, loadPath, loadManagedStops, managementView, selectedId])

  const focusManagedStop = useCallback((stop) => {
    setSelectedId(stop.routeId)
    setSelectedStopId(stop.id)
  }, [])

  const editManagedStop = useCallback((stop) => {
    focusManagedStop(stop)
    setMapEditRequest((current) => ({ stopId: stop.id, version: (current?.version ?? 0) + 1 }))
  }, [focusManagedStop])

  const deleteManagedStop = useCallback((stop) => {
    focusManagedStop(stop)
    setMapDeleteRequest((current) => ({ stopId: stop.id, version: (current?.version ?? 0) + 1 }))
  }, [focusManagedStop])

  const restoreManagedStop = async (stop) => {
    if (!canRestoreStop || busy) return
    setBusy(true)
    try {
      const reloadCanonical = async () => {
        const [nextRoutes, lists] = await Promise.all([
          loadRoutes({ strict: true }),
          loadManagedStops({ strict: true }),
        ])
        return { routes: nextRoutes, stops: lists.active }
      }
      const result = await restoreStopThenMaybeGenerate({
        restore: () => restoreTransportStop(stop.id),
        generatePath: canUpdate,
        reloadTransport: reloadCanonical,
      })
      let finalRefreshError = null
      if (result.generationAttempted) {
        try {
          await Promise.all([
            loadRoutes({ strict: true }),
            loadManagedStops({ strict: true }),
          ])
        } catch {
          finalRefreshError = 'Durak geri yüklendi ancak güzergah durumu yenilenemedi.'
        }
      }
      setSelectedId(result.routeId ?? stop.routeId)
      setSelectedStopId(result.stop?.id ?? stop.id)
      setMapRefreshVersion((value) => value + 1)
      if (result.refreshError || finalRefreshError) {
        setNotice({ type: 'error', message: result.refreshError ?? finalRefreshError })
      } else if (result.generationError) {
        setNotice({ type: 'error', message: `Durak geri yüklendi ancak rota yeniden hesaplanamadı. ${result.generationError}` })
      } else if (result.routeGenerated) {
        setNotice({ type: 'success', message: 'Durak geri yüklendi, rota yeniden hesaplandı ve harita güncellendi.' })
      } else {
        setNotice({ type: 'success', message: 'Durak geri yüklendi.' })
      }
    } catch (error) {
      setNotice({ type: 'error', message: error.message || 'Durak geri yüklenemedi.' })
    } finally {
      setBusy(false)
    }
  }

  const pathStatus = transportPathStatus(path)
  const routeSummary = transportRouteSummary(path, stopsLoading ? null : stops.length)

  return (
    <div className="transport-route-page">
      <AdminPageHeader title="Güzergah Yönetimi" description="Aktif güzergahları, sıralı durakları ve harita görünümünü yönetin." />

      {notice && (
        <div className={`admin-notice is-${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
          <span>{notice.message}</span>
          <button type="button" aria-label="Bildirimi kapat" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <div className="transport-management-tabs" role="tablist" aria-label="Ulaşım yönetimi bölümleri">
        {(canView || canManageRoutes) && <button type="button" role="tab" aria-selected={managementView === 'routes'} onClick={() => setManagementView('routes')}>Güzergah Yönetimi</button>}
        {canView && <button type="button" role="tab" aria-selected={managementView === 'stops'} onClick={() => setManagementView('stops')}>Durak Yönetimi</button>}
      </div>

      <div className={`transport-admin-layout is-${managementView}`}>
        <div className="transport-admin-content">
      {managementView === 'routes' && (
        <>
          <div className="transport-route-toolbar">
            <p>Güzergah seçimi haritadaki çizgi ve durak vurgusunu birlikte günceller.</p>
            {canCreate && <button type="button" className="admin-button" onClick={() => { setDialogError(''); setDialog({ mode: 'create' }) }}>+ Yeni Güzergah</button>}
          </div>

          {routesError && <div className="admin-error" role="alert"><span>{routesError}</span><button type="button" onClick={loadRoutes}>Tekrar dene</button></div>}

          <div className="transport-route-workspace">
        <section className="transport-route-list-card" aria-label="Aktif güzergahlar">
          <header><h2>Aktif Güzergahlar</h2><span aria-label={`${visibleRoutes.length} / ${routes.length} güzergah`}>{visibleRoutes.length}/{routes.length}</span></header>
          <div className="transport-route-filters" role="search" aria-label="Güzergah filtreleri">
            <label>
              <span>Güzergah ara</span>
              <input
                type="search"
                value={routeFilters.search}
                placeholder="Güzergah ara"
                onChange={(event) => setRouteFilters((current) => ({ ...current, search: event.target.value }))}
              />
            </label>
            <label>
              <span>Rota durumu</span>
              <select
                value={routeFilters.status}
                disabled={routePaths === null}
                onChange={(event) => setRouteFilters((current) => ({ ...current, status: event.target.value }))}
              >
                <option value="all">Tümü</option>
                <option value="current">Güncel</option>
                <option value="stale">Güncel değil</option>
                <option value="missing">Oluşturulmadı</option>
              </select>
            </label>
            {routeFiltersActive && <button type="button" className="admin-button secondary" onClick={() => setRouteFilters(ADMIN_ROUTE_DEFAULT_FILTERS)}>Filtreleri Temizle</button>}
          </div>
          {routesLoading && <div className="admin-skeleton" aria-label="Güzergahlar yükleniyor" />}
          {!routesLoading && !routesError && routes.length === 0 && <div className="admin-empty">Henüz güzergah bulunmuyor.</div>}
          {!routesLoading && !routesError && routes.length > 0 && visibleRoutes.length === 0 && <div className="admin-empty">Filtrelere uygun güzergah bulunamadı.</div>}
          <div className="transport-route-list">
            {visibleRoutes.map((route) => {
              const routePath = routePathFor(routePaths ?? [], route.id)
              const routeStatus = routePaths === null ? null : transportPathStatus(routePath)
              const routeVisible = !hiddenRouteIds.has(route.id)
              const routeHovered = routeVisible && route.id === hoveredRouteId
              return (
                <div
                  key={route.id}
                  className={`transport-route-list-item ${route.id === selectedId ? 'is-selected' : ''} ${routeHovered ? 'is-hovered' : ''}`}
                  data-route-id={route.id}
                  data-hovered={routeHovered}
                  onMouseEnter={() => { if (routeVisible) setHoveredRouteId(route.id) }}
                  onMouseLeave={() => setHoveredRouteId((current) => current === route.id ? null : current)}
                >
                  <button
                    type="button"
                    className="transport-route-list-select"
                    aria-label={`${route.name} güzergahını seç`}
                    aria-pressed={route.id === selectedId}
                    onClick={() => selectRoute(route.id)}
                  >
                    <span className="transport-route-swatch" style={{ backgroundColor: route.colorHex }} aria-label={`Renk ${route.colorHex}`} />
                    <span className="transport-route-list-identity">
                      <strong>{route.name}</strong>
                      <small>{route.stopCount} aktif durak</small>
                      {routePath && <small className="transport-route-list-metrics">{formatRouteDistance(routePath.distanceMeters)} · {formatRouteDuration(routePath.durationSeconds)}</small>}
                    </span>
                    <span className={`transport-route-list-status is-${routeStatus?.key ?? 'loading'}`}>{routeStatus?.label ?? 'Yükleniyor…'}</span>
                  </button>
                  <button
                    type="button"
                    className="transport-route-visibility"
                    aria-pressed={routeVisible}
                    aria-label={`${route.name} güzergahını ${routeVisible ? 'gizle' : 'göster'}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      toggleRouteVisibility(route.id)
                    }}
                  >
                    {routeVisible ? <Eye size={18} /> : <EyeOff size={18} />}
                  </button>
                </div>
              )
            })}
          </div>
        </section>

        <section className="transport-route-detail-card" aria-label="Seçili güzergah detayı">
          {!selectedRoute && <div className="transport-route-detail-empty"><strong>Bir güzergah seçin</strong><p>Durak sırası ve yönetim işlemleri burada açılır.</p></div>}
          {selectedRoute && (
            <>
              <header className="transport-route-detail-header">
                <div><span className="transport-route-swatch is-large" style={{ backgroundColor: selectedRoute.colorHex }} /><div><h2>{selectedRoute.name}</h2><code>{selectedRoute.colorHex}</code></div></div>
                <div className="transport-route-actions">
                  {canUpdate && <button type="button" className="admin-button secondary" onClick={() => { setDialogError(''); setDialog({ mode: 'edit', route: selectedRoute }) }}>Düzenle</button>}
                  {canDelete && <button type="button" className="admin-button danger" onClick={() => setDeleteTarget(selectedRoute)}>Sil</button>}
                </div>
              </header>

              <section className={`transport-path-status is-${pathStatus.key}`} aria-label="Hesaplanan rota durumu">
                <div className="transport-path-status-heading">
                  <div><span>Rota durumu</span><strong>{pathLoading ? 'Yükleniyor…' : pathStatus.label}</strong></div>
                  {canUpdate && (
                    <button
                      type="button"
                      className="admin-button"
                      onClick={generatePath}
                      disabled={stops.length < 2 || stopsLoading || pathLoading || generatingPath}
                    >
                      {generatingPath ? 'Hesaplanıyor…' : pathStatus.action}
                    </button>
                  )}
                </div>
                {stops.length < 2 && !stopsLoading && <p>Rota oluşturmak için en az 2 durak gerekli.</p>}
                <dl className={`transport-route-summary ${routeSummary.metricsAreStale ? 'is-stale' : ''}`} role="group" aria-label={`${selectedRoute.name} rota özeti`}>
                  <div><dt>Toplam Mesafe</dt><dd>{routeSummary.distance}</dd></div>
                  <div><dt>Tahmini Süre</dt><dd>{routeSummary.duration}</dd></div>
                  <div><dt>Durak Sayısı</dt><dd>{routeSummary.stopCount}</dd></div>
                  <div><dt>Son Hesaplama</dt><dd>{routeSummary.generatedAt}</dd></div>
                  <div><dt>Durum</dt><dd>{routeSummary.status.label}</dd></div>
                </dl>
                {routeSummary.metricsAreStale && <p className="transport-path-stale-metrics">Mesafe ve süre son hesaplanan, artık güncel olmayan rotaya aittir.</p>}
                {path?.isStale && <p className="transport-path-warning">Rota güncel değil; eski yol geometrisi haritada gösterilmiyor.</p>}
                {path?.lastFailureReason && <p className="transport-path-failure" role="status">{path.lastFailureReason}</p>}
                {pathError && <p className="transport-path-failure" role="alert">{pathError}</p>}
              </section>

              {/* Denetimler ana harita ile PAYLAŞILAN bileşendir; iki ekranın
                  görünürlük kuralı tek yerde durur. */}
              <TransportTrackingControls
                controls={simulationControls}
                statusLoading={simulation.statusLoading}
                starting={simulation.starting}
                stopping={simulation.stopping}
                pausing={simulation.pausing}
                resuming={simulation.resuming}
                error={simulation.error}
                onStart={async () => {
                  /* Başlatma da komut yolunda denetlenir — durdurma tarafıyla
                     AYNI kural. Yönetim ekranında olmak bir yetki kaynağı
                     değildir ve düğmenin görünürlüğü bir denetim değildir. */
                  if (!canStartSimulation) return
                  const snapshot = await simulation.start(selectedRoute.id)
                  // Takip AÇILMAZ; yalnızca ilk konum haritada belirir.
                  if (snapshot) setStartedSimulationId(snapshot.simulationId)
                }}
                /* Tıklama komutu GÖNDERMEZ: yalnızca onayı açar ve
                   durdurulmak İSTENEN çalıştırmanın kimliğini YAKALAR. Çok
                   kullanıcılı canlı bir çalıştırma yanlış bir tıklamayla
                   kesilmemelidir. */
                /* Duraklat/Devam Ettir yıkıcı DEĞİLDİR: onay istemezler ve
                   ana haritayla AYNI kanca komutlarını çağırırlar. Yetenek
                   yine de burada denetlenir — yönetim ekranında olmak bir
                   yetki kaynağı değildir. */
                onPause={() => {
                  if (!canStopSimulation) return
                  simulation.pause(selectedId, simulationControls.stoppableSimulationId)
                }}
                onResume={() => {
                  if (!canStopSimulation) return
                  simulation.resume(selectedId, simulationControls.stoppableSimulationId)
                }}
                onStop={() => {
                  if (!canStopSimulation) return
                  const intent = sharedStopIntent({
                    routeId: selectedId,
                    simulationId: simulationControls.stoppableSimulationId,
                  })
                  // Rota + çalıştırma çiftinden biri eksikse niyet KURULAMAZ.
                  if (intent) setPendingSimulationStop(intent)
                }}
                onFollow={() => simulation.follow(selectedRoute.id)}
                onUnfollow={() => simulation.unfollow()}
              />

              <div className="transport-stop-list-heading"><h3>Sıralı Duraklar</h3><span>{stops.length}</span></div>
              {stopsError && <div className="admin-error" role="alert"><span>{stopsError}</span><button type="button" onClick={() => loadStops(selectedId)}>Tekrar dene</button></div>}
              {stopsLoading && <div className="admin-skeleton" aria-label="Duraklar yükleniyor" />}
              {!stopsLoading && !stopsError && stops.length === 0 && <div className="transport-stop-empty">Bu güzergaha henüz durak eklenmemiş.</div>}
              <ol className="transport-stop-list" aria-label={`${selectedRoute.name} durak sırası`}>
                {stops.map((stop, index) => (
                  <li
                    key={stop.id}
                    draggable={canReorder && !busy}
                    data-stop-id={stop.id}
                    onDragStart={(event) => {
                      if (!canReorder) return
                      setDraggingId(stop.id)
                      event.dataTransfer.effectAllowed = 'move'
                      event.dataTransfer.setData('text/plain', String(stop.id))
                    }}
                    onDragOver={(event) => { if (canReorder) event.preventDefault() }}
                    onDrop={(event) => { event.preventDefault(); dropStop(stop.id) }}
                    onDragEnd={() => setDraggingId(null)}
                    className={`${draggingId === stop.id ? 'is-dragging' : ''} ${canReorder ? '' : 'is-readonly'} ${selectedStopId === stop.id ? 'is-selected' : ''}`}
                  >
                    {canReorder && <span className="transport-stop-drag" aria-label={`${stop.name} durağını sürükle`}>☰</span>}
                    <button type="button" className="transport-stop-select" aria-pressed={selectedStopId === stop.id} onClick={() => setSelectedStopId(stop.id)}>
                      <span className="transport-stop-order">{String(stop.sequenceOrder).padStart(2, '0')}</span>
                      <span className="transport-stop-name"><strong>{stop.name}</strong><small>{stop.latitude.toFixed(5)}, {stop.longitude.toFixed(5)}</small></span>
                    </button>
                    {canReorder && (
                      <div className="transport-stop-order-actions">
                        <button type="button" aria-label={`${stop.name} durağını yukarı taşı`} onClick={() => moveStop(stop.id, -1)} disabled={busy || index === 0}>↑</button>
                        <button type="button" aria-label={`${stop.name} durağını aşağı taşı`} onClick={() => moveStop(stop.id, 1)} disabled={busy || index === stops.length - 1}>↓</button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {!canReorder && stops.length > 1 && <p className="transport-route-readonly">Durak sırasını değiştirme yetkiniz bulunmuyor.</p>}
            </>
          )}
        </section>
          </div>
        </>
      )}

      {managementView === 'stops' && (
        <AdminTransportStopManagement
          routes={routes}
          activeStops={managedStops}
          deletedStops={managedDeletedStops}
          loading={managedStopsLoading}
          error={managedStopsError}
          permissions={{ canView, canUpdateStop, canDeleteStop, canRestoreStop }}
          onRetry={loadManagedStops}
          onFocus={focusManagedStop}
          onEdit={editManagedStop}
          onDelete={deleteManagedStop}
          onRestore={restoreManagedStop}
        />
      )}
        </div>
        <div className="transport-admin-map-column">
      <TransportManagementMap
        routes={routes}
        selectedRoute={selectedRoute}
        selectedStopId={selectedStopId}
        selectedRouteStops={stops}
        hiddenRouteIds={hiddenRouteIds}
        hoveredRouteId={hoveredRouteId}
        vehicle={vehicle}
        canView={canView}
        canCreateStop={canCreateStop}
        canUpdateStop={canUpdateStop}
        canDeleteStop={canDeleteStop}
        canUpdateRoute={canUpdate}
        refreshVersion={mapRefreshVersion}
        editRequest={mapEditRequest}
        deleteRequest={mapDeleteRequest}
        onSelectRoute={selectRoute}
        onSelectStop={setSelectedStopId}
        onTransportChanged={transportChanged}
        onTransportSnapshot={receiveTransportSnapshot}
        onHoveredRouteChange={setHoveredRouteId}
        onNotice={setNotice}
      />
        </div>
      </div>

      {dialog && <TransportRouteDialog key={dialog.mode === 'edit' ? dialog.route.id : 'create'} route={dialog.route} busy={busy} error={dialogError} onCancel={() => setDialog(null)} onSubmit={submitRoute} />}

      {/* Hat simülasyonu durdurma onayı. Sayfanın KENDİ diyalog dilini
          kullanır (ana haritanınkini değil) ama komut ana haritayla AYNI
          istemci fonksiyonudur: ikinci bir durdurma yolu YOKTUR. */}
      {/* Yetenek kaybolursa AÇIK KALAN kutu da kapanır: görünürlük bir denetim
          değildir ve yetkiler oturum içinde tazelenebilir. */}
      {pendingSimulationStop && canStopSimulation && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !simulation.stopping) setPendingSimulationStop(null) }}>
          <div className="admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="transport-simulation-stop-title" aria-describedby="transport-simulation-stop-copy">
            <h2 id="transport-simulation-stop-title">Hat simülasyonu sıfırlansın mı?</h2>
            <p id="transport-simulation-stop-copy">Bu simülasyon sona erdirilecek ve hat başlangıç durumuna dönecek; onu izleyen diğer kullanıcılar da aracı görmeyi bırakır. Yeniden başlatıldığında %0'dan yeni bir simülasyon oluşturulur.</p>
            <div className="admin-dialog-actions">
              {/* Vazgeçmek HİÇBİR ŞEY yapmaz: sunucuya istek gitmez. */}
              <button type="button" className="admin-button secondary" onClick={() => setPendingSimulationStop(null)} disabled={simulation.stopping}>İptal</button>
              <button
                type="button"
                className="admin-button danger"
                disabled={simulation.stopping}
                onClick={async () => {
                  /* KOMUT ANINDA yeniden denetim — FAIL-CLOSED, İKİ eksende:
                     YETKİ (kutu açıkken geri alınmış olabilir) ve KİMLİK
                     (yakalanan çalıştırma hâlâ o anki çalıştırma mı).
                     A bitip yerine B geçtiyse istek HİÇ yola çıkmaz; yakalanan
                     kimliği o anki kimlikle DEĞİŞTİRMEK, kullanıcının hiç
                     vermediği bir kararı uygulamak olurdu.

                     Komut YAKALANMIŞ iki kimliği taşır; "en güncel olanı
                     durdur" geri dönüşü YOKTUR. */
                  const intent = pendingSimulationStop
                  if (canStopSimulation
                    && sharedStopIntentIsCurrent(intent, {
                      routeId: selectedId,
                      stoppableSimulationId: simulationControls.stoppableSimulationId,
                    })) {
                    await simulation.stop(intent.routeId, intent.simulationId)
                  }
                  setPendingSimulationStop(null)
                }}
              >
                {simulation.stopping ? 'Sıfırlanıyor…' : 'Sıfırla'}
              </button>
            </div>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setDeleteTarget(null) }}>
          <div className="admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="transport-route-delete-title" aria-describedby="transport-route-delete-copy">
            <h2 id="transport-route-delete-title">'{deleteTarget.name}' güzergahı silinsin mi?</h2>
            <p id="transport-route-delete-copy">Güzergah normal ulaşım görünümünden kaldırılacak ve durakları haritada görünmeyecek. Durak kayıtları kalıcı olarak silinmeyecek.</p>
            <div className="admin-dialog-actions">
              <button type="button" className="admin-button secondary" onClick={() => setDeleteTarget(null)} disabled={busy}>İptal</button>
              <button type="button" className="admin-button danger" onClick={confirmDelete} disabled={busy}>{busy ? 'Siliniyor…' : 'Güzergahı Sil'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
