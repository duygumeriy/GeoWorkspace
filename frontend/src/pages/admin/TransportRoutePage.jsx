import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePermissions } from '../../auth/permissionStore.js'
import { PERMISSIONS } from '../../auth/permissionCodes.js'
import AdminPageHeader from '../../components/admin/AdminPageHeader.jsx'
import TransportRouteDialog from '../../components/admin/TransportRouteDialog.jsx'
import TransportManagementMap from '../../components/admin/TransportManagementMap.jsx'
import { readApiError } from '../../services/api.js'
import {
  createTransportRoute,
  deleteTransportRoute,
  fetchTransportRoutes,
  fetchTransportRouteStops,
  reorderTransportRouteStops,
  updateTransportRoute,
} from '../../services/transportApi.js'
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

  const [routes, setRoutes] = useState([])
  const [routesLoading, setRoutesLoading] = useState(true)
  const [routesError, setRoutesError] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [stops, setStops] = useState([])
  const [stopsLoading, setStopsLoading] = useState(false)
  const [stopsError, setStopsError] = useState('')
  const [notice, setNotice] = useState(null)
  const [dialog, setDialog] = useState(null)
  const [dialogError, setDialogError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [busy, setBusy] = useState(false)
  const [draggingId, setDraggingId] = useState(null)
  const [mapRefreshVersion, setMapRefreshVersion] = useState(0)
  const mutationInFlight = useRef(false)
  const stopRequestId = useRef(0)

  const selectedRoute = useMemo(
    () => routes.find((route) => route.id === selectedId) ?? null,
    [routes, selectedId],
  )

  const loadRoutes = useCallback(async () => {
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
      return []
    } finally {
      setRoutesLoading(false)
    }
  }, [])

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

  useEffect(() => { loadRoutes() }, [loadRoutes])
  useEffect(() => { loadStops(selectedId) }, [selectedId, loadStops])

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
      setStops([])
      setDeleteTarget(null)
    }
  }

  const dropStop = async (targetId) => {
    const sourceId = draggingId
    setDraggingId(null)
    if (!canReorder || sourceId == null || sourceId === targetId || mutationInFlight.current) return
    const sourceIndex = stops.findIndex((stop) => stop.id === sourceId)
    const targetIndex = stops.findIndex((stop) => stop.id === targetId)
    if (sourceIndex < 0 || targetIndex < 0) return

    const previous = stops
    const reordered = [...stops]
    const [moved] = reordered.splice(sourceIndex, 1)
    reordered.splice(targetIndex, 0, moved)
    const numbered = reordered.map((stop, index) => ({ ...stop, sequenceOrder: index + 1 }))
    setStops(numbered)
    mutationInFlight.current = true
    setBusy(true)
    try {
      const response = await reorderTransportRouteStops(selectedId, numbered.map((stop) => stop.id))
      if (!response.ok) throw new Error(await readApiError(response, 'Durak sırası güncellenemedi.'))
      await loadStops(selectedId)
      await loadRoutes()
      setMapRefreshVersion((value) => value + 1)
      setNotice({ type: 'success', message: 'Durak sırası güncellendi.' })
    } catch (error) {
      setStops(previous)
      setNotice({ type: 'error', message: error.message || 'Durak sırası güncellenemedi.' })
    } finally {
      mutationInFlight.current = false
      setBusy(false)
    }
  }

  const stopCreated = useCallback(async () => {
    await Promise.all([loadRoutes(), loadStops(selectedId)])
    setMapRefreshVersion((value) => value + 1)
  }, [loadRoutes, loadStops, selectedId])

  return (
    <div className="transport-route-page">
      <AdminPageHeader title="Güzergah Yönetimi" description="Aktif güzergahları, sıralı durakları ve harita görünümünü yönetin." />

      {notice && (
        <div className={`admin-notice is-${notice.type}`} role="status">
          {notice.message}
          <button type="button" aria-label="Bildirimi kapat" onClick={() => setNotice(null)}>×</button>
        </div>
      )}

      <div className="transport-route-toolbar">
        <p>Güzergah seçimi haritadaki çizgi ve durak vurgusunu birlikte günceller.</p>
        {canCreate && <button type="button" className="admin-button" onClick={() => { setDialogError(''); setDialog({ mode: 'create' }) }}>+ Yeni Güzergah</button>}
      </div>

      {routesError && <div className="admin-error" role="alert"><span>{routesError}</span><button type="button" onClick={loadRoutes}>Tekrar dene</button></div>}

      <div className="transport-route-workspace">
        <section className="transport-route-list-card" aria-label="Aktif güzergahlar">
          <header><h2>Aktif Güzergahlar</h2><span>{routes.length}</span></header>
          {routesLoading && <div className="admin-skeleton" aria-label="Güzergahlar yükleniyor" />}
          {!routesLoading && !routesError && routes.length === 0 && <div className="admin-empty">Aktif güzergah bulunmuyor.</div>}
          <div className="transport-route-list">
            {routes.map((route) => (
              <button
                type="button"
                key={route.id}
                className={`transport-route-list-item ${route.id === selectedId ? 'is-selected' : ''}`}
                aria-pressed={route.id === selectedId}
                onClick={() => setSelectedId((current) => current === route.id ? null : route.id)}
              >
                <span className="transport-route-swatch" style={{ backgroundColor: route.colorHex }} aria-label={`Renk ${route.colorHex}`} />
                <span className="transport-route-list-identity"><strong>{route.name}</strong><small>{route.stopCount} aktif durak</small></span>
              </button>
            ))}
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

              <div className="transport-stop-list-heading"><h3>Sıralı Duraklar</h3><span>{stops.length}</span></div>
              {stopsError && <div className="admin-error" role="alert"><span>{stopsError}</span><button type="button" onClick={() => loadStops(selectedId)}>Tekrar dene</button></div>}
              {stopsLoading && <div className="admin-skeleton" aria-label="Duraklar yükleniyor" />}
              {!stopsLoading && !stopsError && stops.length === 0 && <div className="transport-stop-empty">Bu güzergaha henüz durak eklenmemiş.</div>}
              <ol className="transport-stop-list" aria-label={`${selectedRoute.name} durak sırası`}>
                {stops.map((stop) => (
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
                    className={`${draggingId === stop.id ? 'is-dragging' : ''} ${canReorder ? '' : 'is-readonly'}`}
                  >
                    {canReorder && <span className="transport-stop-drag" aria-label={`${stop.name} durağını sürükle`}>☰</span>}
                    <span className="transport-stop-order">{String(stop.sequenceOrder).padStart(2, '0')}</span>
                    <span className="transport-stop-name"><strong>{stop.name}</strong><small>{stop.latitude.toFixed(5)}, {stop.longitude.toFixed(5)}</small></span>
                  </li>
                ))}
              </ol>
              {!canReorder && stops.length > 1 && <p className="transport-route-readonly">Durak sırasını değiştirme yetkiniz bulunmuyor.</p>}
            </>
          )}
        </section>
      </div>

      <TransportManagementMap
        selectedRoute={selectedRoute}
        canView={canView}
        canCreateStop={canCreateStop}
        refreshVersion={mapRefreshVersion}
        onStopCreated={stopCreated}
        onNotice={setNotice}
      />

      {dialog && <TransportRouteDialog key={dialog.mode === 'edit' ? dialog.route.id : 'create'} route={dialog.route} busy={busy} error={dialogError} onCancel={() => setDialog(null)} onSubmit={submitRoute} />}

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
