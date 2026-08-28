import { useState } from 'react'
import MapSheet from './MapSheet.jsx'
import { formatLonLat } from '../../map/poi.js'
import './Transport.css'

const MAX_NAME_LENGTH = 200

export default function TransportStopForm({
  open,
  point,
  routes,
  saving,
  error,
  canGenerateRoutePath,
  onSave,
  onCancel,
}) {
  const [name, setName] = useState('')
  const [routeId, setRouteId] = useState(() => routes[0]?.id ?? '')
  const [generatePath, setGeneratePath] = useState(false)
  if (!open || !point) return null

  const selectedRouteId = Number(routeId)
  const selectedRoute = routes.find((route) => route.id === selectedRouteId)
  const canGenerateSelectedRoute = canGenerateRoutePath && (selectedRoute?.stopCount ?? 0) + 1 >= 2
  const canSubmit = name.trim().length > 0 && routes.some((route) => route.id === selectedRouteId) && !saving

  const submit = (event) => {
    event.preventDefault()
    if (!canSubmit) return
    onSave({
      name: name.trim(),
      routeId: selectedRouteId,
      generatePath: generatePath && canGenerateSelectedRoute,
      ...point,
    })
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

        <fieldset className="transport-route-picker" disabled={saving || routes.length === 0}>
          <legend>Güzergah</legend>
          {routes.length === 0 && <p>Etkin güzergah bulunmuyor</p>}
          {routes.map((route) => (
            <label key={route.id} className={`transport-route-option ${route.id === selectedRouteId ? 'is-selected' : ''}`}>
              <input type="radio" name="transport-route" value={route.id} checked={route.id === selectedRouteId} onChange={(event) => { setRouteId(event.target.value); setGeneratePath(false) }} />
              <span className="transport-route-option-swatch" style={{ backgroundColor: route.colorHex }} aria-label={`Renk ${route.colorHex}`} />
              <span className="transport-route-option-name">{route.name}</span>
              <small>{route.stopCount ?? 0} durak</small>
            </label>
          ))}
        </fieldset>

        {canGenerateRoutePath && selectedRoute && (
          <div className="transport-fast-route-option">
            <label>
              <input
                type="checkbox"
                checked={generatePath}
                onChange={(event) => setGeneratePath(event.target.checked)}
                disabled={saving || !canGenerateSelectedRoute}
              />
              <span>Durağı ekle ve rotayı hesapla</span>
            </label>
            {!canGenerateSelectedRoute && <small>Rota hesaplamak için ekleme sonrasında en az 2 durak olmalıdır.</small>}
          </div>
        )}

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
