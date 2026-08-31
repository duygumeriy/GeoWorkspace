import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import Overlay from 'ol/Overlay.js'
import { fromLonLat } from 'ol/proj.js'
import IconButton from '../ui/IconButton.jsx'
import { CloseIcon } from '../ui/icons/index.js'
import './Transport.css'

/**
 * Hareket eden aracın bilgi balonu.
 *
 * Durak popup'ıyla AYNI sözleşme: overlay yalnızca açıkken yaratılır, içerik
 * React portalı ile taşınır ve kart aynı <code>.transport-popup-card</code>
 * biçimini kullanır. Yeni bir popup sistemi kurulmaz.
 *
 * <b>Açıkken güncellenir:</b> konum ve alanlar doğrudan canlı sunum
 * modelinden gelir, dolayısıyla yeni bir sunucu durumu geldiğinde balon da
 * kullanıcı hiçbir şey yapmadan tazelenir.
 */
export default function TransportVehiclePopup({ map, vehicle, onClose }) {
  const containerRef = useRef(null)
  if (containerRef.current === null && typeof document !== 'undefined') {
    containerRef.current = document.createElement('div')
  }
  const overlayRef = useRef(null)
  const active = Boolean(vehicle)

  useEffect(() => {
    const container = containerRef.current
    if (!map || !container || !active) return undefined
    const overlay = new Overlay({
      element: container,
      positioning: 'bottom-center',
      offset: [0, -18],
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
    overlay.setPosition(vehicle ? fromLonLat([vehicle.longitude, vehicle.latitude]) : undefined)
  }, [map, vehicle])

  if (!containerRef.current) return null

  return createPortal(
    <div className={`transport-vehicle-popup ${vehicle ? 'is-open' : ''}`}>
      {vehicle && (
        <div className="transport-popup-card" role="dialog" aria-label="Simülasyon aracı bilgisi">
          <header>
            <strong>{vehicle.routeName}</strong>
            <IconButton label="Araç bilgisini kapat" onClick={onClose}>
              <CloseIcon size={16} />
            </IconButton>
          </header>
          <dl>
            <div>
              <dt>Güzergah</dt>
              <dd className="transport-route-name">
                <span className="transport-route-color" style={{ backgroundColor: vehicle.colorHex }} aria-hidden="true" />
                {vehicle.routeName}
              </dd>
            </div>
            <div><dt>Durum</dt><dd>{vehicle.statusLabel}</dd></div>
            {/* Yüzde sunucudan gelir; tarayıcı ilerleme hesaplamaz. */}
            <div>
              <dt>İlerleme</dt>
              <dd aria-live="polite">{vehicle.progressLabel}</dd>
            </div>
            <div><dt>Canlı</dt><dd>{vehicle.liveLabel}</dd></div>
          </dl>
        </div>
      )}
    </div>,
    containerRef.current,
  )
}
