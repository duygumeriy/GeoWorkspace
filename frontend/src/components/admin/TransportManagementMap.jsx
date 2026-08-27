import { useCallback, useEffect, useRef, useState } from 'react'
import Map from 'ol/Map.js'
import View from 'ol/View.js'
import TileLayer from 'ol/layer/Tile.js'
import OSM from 'ol/source/OSM.js'
import { fromLonLat } from 'ol/proj.js'
import { readApiError } from '../../services/api.js'
import { createTransportStop } from '../../services/transportApi.js'
import useTransportLayer from '../../hooks/useTransportLayer.js'
import useTransportStopPlacement from '../../hooks/useTransportStopPlacement.js'
import { TURKEY_CENTER_LON_LAT, TURKEY_ZOOM } from '../../map/turkey.js'

export default function TransportManagementMap({ selectedRoute, canView, canCreateStop, refreshVersion, onStopCreated, onNotice }) {
  const targetRef = useRef(null)
  const [map, setMap] = useState(null)
  const [placing, setPlacing] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

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
  const { refresh: refreshTransport } = useTransportLayer(map, {
    permitted: canView,
    selectedStopId: null,
    selectedRouteId: selectedRoute?.id ?? null,
    showToast: showMapError,
  })

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
    clearPending()
  }, [clearPending])

  useEffect(() => {
    cancelPlacement()
  }, [selectedRoute?.id, canCreateStop, cancelPlacement])

  useEffect(() => {
    if (!map || refreshVersion === 0) return
    refreshTransport()
  }, [map, refreshVersion, refreshTransport])

  const save = async (event) => {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !selectedRoute || !pending || saving) return
    setSaving(true)
    setError('')
    try {
      const response = await createTransportStop({
        name: trimmed,
        routeId: selectedRoute.id,
        longitude: pending.longitude,
        latitude: pending.latitude,
      })
      if (!response.ok) throw new Error(await readApiError(response, 'Durak eklenemedi.'))
      await onStopCreated?.()
      await refreshTransport()
      cancelPlacement()
      onNotice?.({ type: 'success', message: 'Durak güzergahın sonuna eklendi.' })
    } catch (caught) {
      setError(caught.message || 'Durak eklenemedi.')
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
        {selectedRoute && canCreateStop && (
          <button
            type="button"
            className={`admin-button ${placing ? 'secondary' : ''}`}
            aria-pressed={placing}
            onClick={() => placing ? cancelPlacement() : setPlacing(true)}
          >
            {placing ? 'Yerleştirmeyi İptal Et' : 'Haritadan Durak Ekle'}
          </button>
        )}
      </div>

      {placing && <p className="transport-management-map-hint" role="status">Durak konumunu seçmek için haritaya tıklayın.</p>}
      <div ref={targetRef} className="transport-management-map" data-testid="transport-management-map" />

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
