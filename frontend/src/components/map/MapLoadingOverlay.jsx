import PinIcon from '../ui/icons/PinIcon.jsx'
import './MapLoadingOverlay.css'

export default function MapLoadingOverlay({ visible }) {
  return (
    <div className={`map-loading-overlay ${visible ? 'is-visible' : ''}`} aria-hidden="true">
      <div className="map-loading-card">
        <span className="map-loading-pin">
          <PinIcon size={28} />
        </span>
        <p>Harita yükleniyor...</p>
      </div>
    </div>
  )
}
