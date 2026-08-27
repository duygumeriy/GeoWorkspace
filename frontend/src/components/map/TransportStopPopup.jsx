import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Overlay from 'ol/Overlay.js'
import { fromLonLat } from 'ol/proj.js'
import { Crosshair, Pencil, Route, Trash2 } from 'lucide-react'
import IconButton from '../ui/IconButton.jsx'
import { CloseIcon } from '../ui/icons/index.js'
import './Transport.css'

const COORDINATE_DIGITS = 5

export default function TransportStopPopup({
  map,
  stop,
  onClose,
  onZoom,
  onShowRoute,
  onEdit,
  onDelete,
  canEdit = false,
  canDelete = false,
  busy = false,
}) {
  const containerRef = useRef(null)
  if (containerRef.current === null && typeof document !== 'undefined') {
    containerRef.current = document.createElement('div')
  }
  const overlayRef = useRef(null)
  const active = Boolean(stop)

  useEffect(() => {
    const container = containerRef.current
    /* The component stays in MapPage so it can reuse the same safe portal
       target, but an OpenLayers overlay exists only while a stop popup is
       actually active. A dormant overlay would permanently add a second
       .ol-overlay-container beside Location Analysis. */
    if (!map || !container || !active) return undefined
    const overlay = new Overlay({
      element: container,
      positioning: 'bottom-center',
      offset: [0, -14],
      stopEvent: true,
      autoPan: { animation: { duration: 200 }, margin: 24 },
    })
    overlayRef.current = overlay
    map.addOverlay(overlay)
    return () => {
      overlay.setPosition(undefined)
      map.removeOverlay(overlay)
      if (overlayRef.current === overlay) overlayRef.current = null
    }
  }, [map, active])

  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    overlay.setPosition(stop ? fromLonLat([stop.longitude, stop.latitude]) : undefined)
  }, [map, stop])

  if (!containerRef.current) return null

  return createPortal(
    <div className={`transport-stop-popup ${stop ? 'is-open' : ''}`}>
      {stop && (
        <div className="transport-popup-card" role="dialog" aria-label="Durak bilgisi">
          <header>
            <strong>{stop.name || 'İsimsiz Durak'}</strong>
            <IconButton label="Durak bilgisini kapat" onClick={onClose}>
              <CloseIcon size={16} />
            </IconButton>
          </header>
          <dl>
            <div><dt>Durak Adı</dt><dd>{stop.name || '—'}</dd></div>
            <div>
              <dt>Güzergah</dt>
              <dd className="transport-route-name">
                <span className="transport-route-color" style={{ backgroundColor: stop.colorHex }} aria-hidden="true" />
                {stop.routeName || '—'}
              </dd>
            </div>
            <div><dt>Sıra</dt><dd>{stop.sequenceOrder}</dd></div>
            <div>
              <dt>Konum</dt>
              <dd>{stop.latitude.toFixed(COORDINATE_DIGITS)}, {stop.longitude.toFixed(COORDINATE_DIGITS)}</dd>
            </div>
          </dl>
          <div className="transport-popup-actions">
            <button type="button" className="transport-popup-action" onClick={() => onZoom?.(stop)}>
              <Crosshair size={14} aria-hidden="true" /> Durağa Zoom Yap
            </button>
            <button type="button" className="transport-popup-action" onClick={() => onShowRoute?.(stop.routeId)}>
              <Route size={14} aria-hidden="true" /> Güzergahı Göster
            </button>
            {canEdit && (
              <button type="button" className="transport-popup-action" onClick={() => onEdit?.(stop)} disabled={busy}>
                <Pencil size={14} aria-hidden="true" /> Düzenle
              </button>
            )}
            {canDelete && (
              <button type="button" className="transport-popup-action danger" onClick={() => onDelete?.(stop)} disabled={busy}>
                <Trash2 size={14} aria-hidden="true" /> Sil
              </button>
            )}
          </div>
        </div>
      )}
    </div>,
    containerRef.current,
  )
}
