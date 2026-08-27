import { useState } from 'react'
import MapSheet from './MapSheet.jsx'
import { formatLonLat } from '../../map/poi.js'
import './Transport.css'

const MAX_NAME_LENGTH = 200

export default function TransportStopForm({ open, point, routes, saving, error, onSave, onCancel }) {
  const [name, setName] = useState('')
  const [routeId, setRouteId] = useState(() => routes[0]?.id ?? '')
  if (!open || !point) return null

  const selectedRouteId = Number(routeId)
  const canSubmit = name.trim().length > 0 && routes.some((route) => route.id === selectedRouteId) && !saving

  const submit = (event) => {
    event.preventDefault()
    if (!canSubmit) return
    onSave({ name: name.trim(), routeId: selectedRouteId, ...point })
  }

  return (
    <MapSheet open title="Durak Ekle" onClose={onCancel} className="transport-sheet">
      <form className="transport-form" onSubmit={submit}>
        <label className="transport-field">
          <span>Durak Adı</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={MAX_NAME_LENGTH}
            disabled={saving}
            autoFocus
            placeholder="Örn. Kızılay"
          />
        </label>

        <label className="transport-field">
          <span>Güzergah</span>
          <select value={routeId} onChange={(event) => setRouteId(event.target.value)} disabled={saving || routes.length === 0}>
            {routes.length === 0 && <option value="">Etkin güzergah bulunmuyor</option>}
            {routes.map((route) => (
              <option key={route.id} value={route.id}>{route.name}</option>
            ))}
          </select>
        </label>

        <div className="transport-field transport-field--readonly">
          <span>Konum</span>
          <output>{formatLonLat(point.longitude, point.latitude)}</output>
          <small>Boylam, Enlem (EPSG:4326)</small>
        </div>

        {routes.length === 0 && (
          <p className="transport-form-note">Durak eklemek için önce etkin bir güzergah bulunmalıdır.</p>
        )}
        {error && <p className="transport-form-error" role="alert">{error}</p>}

        <div className="transport-form-actions">
          <button type="button" className="transport-button secondary" onClick={onCancel} disabled={saving}>İptal</button>
          <button type="submit" className="transport-button" disabled={!canSubmit}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </form>
    </MapSheet>
  )
}
