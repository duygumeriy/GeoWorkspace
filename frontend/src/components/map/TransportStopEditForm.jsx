import { useEffect, useState } from 'react'
import MapSheet from './MapSheet.jsx'
import './Transport.css'

const MAX_NAME_LENGTH = 200

export default function TransportStopEditForm({
  open,
  stop,
  routes,
  pendingPoint,
  moving,
  saving,
  error,
  onStartMove,
  onCancelMove,
  onSave,
  onCancel,
}) {
  const [name, setName] = useState(stop?.name ?? '')
  const [routeId, setRouteId] = useState(stop?.routeId != null ? String(stop.routeId) : '')
  const [longitude, setLongitude] = useState(stop?.longitude != null ? String(stop.longitude) : '')
  const [latitude, setLatitude] = useState(stop?.latitude != null ? String(stop.latitude) : '')

  useEffect(() => {
    if (!pendingPoint) return
    setLongitude(String(pendingPoint.longitude))
    setLatitude(String(pendingPoint.latitude))
  }, [pendingPoint])

  /* Another workspace tool taking ownership cancels relocation. The preview
     hook clears its marker; the form restores the original draft coordinate. */
  useEffect(() => {
    if (moving || pendingPoint) return
    setLongitude(String(stop?.longitude ?? ''))
    setLatitude(String(stop?.latitude ?? ''))
  }, [moving, pendingPoint, stop?.longitude, stop?.latitude])

  if (!open || !stop) return null

  const parsedLongitude = Number(longitude)
  const parsedLatitude = Number(latitude)
  const selectedRouteId = Number(routeId)
  const longitudeValid = longitude.trim() !== '' && Number.isFinite(parsedLongitude) && parsedLongitude >= -180 && parsedLongitude <= 180
  const latitudeValid = latitude.trim() !== '' && Number.isFinite(parsedLatitude) && parsedLatitude >= -90 && parsedLatitude <= 90
  const routeValid = routes.some((route) => route.id === selectedRouteId)
  const canSubmit = name.trim().length > 0 && routeValid && longitudeValid && latitudeValid && !saving

  const cancelMove = () => {
    setLongitude(String(stop.longitude))
    setLatitude(String(stop.latitude))
    onCancelMove?.()
  }

  const submit = (event) => {
    event.preventDefault()
    if (!canSubmit) return
    onSave?.({
      name: name.trim(),
      routeId: selectedRouteId,
      longitude: parsedLongitude,
      latitude: parsedLatitude,
    })
  }

  return (
    <MapSheet open title="Durağı Düzenle" onClose={onCancel} className="transport-sheet transport-edit-sheet">
      <form className="transport-form" onSubmit={submit}>
        <label className="transport-field">
          <span>Durak Adı</span>
          <input value={name} onChange={(event) => setName(event.target.value)} maxLength={MAX_NAME_LENGTH} disabled={saving} autoFocus />
        </label>

        <label className="transport-field">
          <span>Güzergah</span>
          <select value={routeId} onChange={(event) => setRouteId(event.target.value)} disabled={saving}>
            {routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}
          </select>
        </label>

        <fieldset className="transport-coordinate-fields">
          <legend>Konum (EPSG:4326)</legend>
          <label className="transport-field">
            <span>Longitude</span>
            <input required type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} disabled={saving || moving} aria-invalid={!longitudeValid} />
          </label>
          <label className="transport-field">
            <span>Latitude</span>
            <input required type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} disabled={saving || moving} aria-invalid={!latitudeValid} />
          </label>
        </fieldset>

        <div className="transport-move-box">
          <div>
            <strong>Haritada Taşı</strong>
            <small>{moving ? 'Yeni konumu haritadan seçin.' : 'Durağın yeni koordinatını haritadan belirleyin.'}</small>
          </div>
          {moving
            ? <button type="button" className="transport-button secondary" onClick={cancelMove} disabled={saving}>Taşımayı İptal Et</button>
            : <button type="button" className="transport-button secondary" onClick={onStartMove} disabled={saving}>Haritada Taşı</button>}
        </div>

        {!longitudeValid && <p className="transport-validation" role="alert">Longitude -180 ile 180 arasında olmalıdır.</p>}
        {!latitudeValid && <p className="transport-validation" role="alert">Latitude -90 ile 90 arasında olmalıdır.</p>}
        {error && <p className="transport-form-error" role="alert">{error}</p>}

        <div className="transport-form-actions">
          <button type="button" className="transport-button secondary" onClick={onCancel} disabled={saving}>İptal</button>
          <button type="submit" className="transport-button" disabled={!canSubmit}>{saving ? 'Kaydediliyor…' : 'Kaydet'}</button>
        </div>
      </form>
    </MapSheet>
  )
}
