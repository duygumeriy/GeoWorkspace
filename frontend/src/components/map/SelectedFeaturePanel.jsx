import { useEffect, useState } from 'react'
import MapSheet from './MapSheet.jsx'
import Button from '../ui/Button.jsx'
import useMediaQuery from '../../hooks/useMediaQuery.js'
import { DRAWING_TYPES } from '../../map/drawingTypes.js'
import {
  formatArea,
  formatLength,
  formatLonLat,
  measureArea,
  measureLength,
  measurePerimeter,
} from '../../map/measure.js'
import { toLonLat } from 'ol/proj'
import { FocusIcon, PaletteIcon, TrashIcon, ChevronIcon } from '../ui/icons/index.js'
import './SelectedFeaturePanel.css'

/** dd.MM.yyyy HH:mm, or an em dash when the API sent nothing. */
function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function Row({ label, value }) {
  return (
    <div className="selected-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

/**
 * Details of the currently selected drawing.
 *
 * Length, area and perimeter are computed from the live geometry with
 * `ol/sphere` rather than stored — a derived value in the database would only
 * be one more thing to keep in sync.
 */
export default function SelectedFeaturePanel({
  open,
  feature,
  geometry,
  onClose,
  onZoom,
  onEditStyle,
  onDelete,
  // False for drawings owned by someone else. Viewing, zooming and analysing
  // stay available — only mutation is withheld.
  canManage = true,
}) {
  // On phones the sheet opens as a one-line summary so it barely covers the
  // map; the full detail list is one tap away. Desktop has the room to show
  // everything at once, so it is always expanded there.
  const isPhone = useMediaQuery('(max-width: 640px)')
  const [expanded, setExpanded] = useState(false)

  // Collapse again whenever the selection changes on a phone.
  useEffect(() => {
    setExpanded(!isPhone)
  }, [isPhone, feature?.key])

  if (!open || !feature) return null

  const config = DRAWING_TYPES[feature.type]
  const measurements = []

  if (feature.type === 'point' && geometry) {
    const { lon, lat } = formatLonLat(toLonLat(geometry.getCoordinates()))
    measurements.push({ label: 'Boylam', value: lon }, { label: 'Enlem', value: lat })
  } else if (feature.type === 'line' && geometry) {
    measurements.push({ label: 'Uzunluk', value: formatLength(measureLength(geometry)) })
  } else if (feature.type === 'polygon' && geometry) {
    measurements.push(
      { label: 'Alan', value: formatArea(measureArea(geometry)) },
      { label: 'Çevre', value: formatLength(measurePerimeter(geometry)) },
    )
  }

  return (
    <MapSheet open={open} title="Seçili Çizim" onClose={onClose} className="selected-panel">
      {/* The always-visible summary. On a phone it doubles as the expander. */}
      {isPhone ? (
        <button
          type="button"
          className="selected-summary selected-summary--toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          <span className="selected-summary-title">
            {config.label} #{feature.databaseId}
          </span>
          {measurements[0] && <span className="selected-summary-metric">{measurements[0].value}</span>}
          <ChevronIcon size={15} className={`selected-summary-chevron ${expanded ? 'is-open' : ''}`} />
        </button>
      ) : (
        <div className="selected-summary">
          <span className="selected-summary-title">
            {config.label} #{feature.databaseId}
          </span>
          {measurements[0] && <span className="selected-summary-metric">{measurements[0].value}</span>}
        </div>
      )}

      {expanded && (
        <>
          <dl className="selected-rows">
            <Row label="Tür" value={config.label} />
            <Row label="ID" value={feature.databaseId} />
            {measurements.map((item) => (
              <Row key={item.label} label={item.label} value={item.value} />
            ))}
            <Row label="Oluşturma" value={formatDate(feature.createdDate)} />
            <Row label="Güncelleme" value={formatDate(feature.modifiedDate)} />
            <Row label="Oluşturan" value={feature.createdBy || '—'} />
            <Row label="Koordinat Sistemi" value="EPSG:4326" />
          </dl>

          <div className="selected-actions">
            <Button variant="ghost" className="selected-action" onClick={onZoom}>
              <FocusIcon size={16} />
              Haritada Ortala
            </Button>
            {canManage && (
              <>
                <Button variant="ghost" className="selected-action" onClick={onEditStyle}>
                  <PaletteIcon size={16} />
                  Stili Değiştir
                </Button>
                <Button variant="ghost" className="selected-action selected-action--danger" onClick={onDelete}>
                  <TrashIcon size={16} />
                  Sil
                </Button>
              </>
            )}
          </div>

          {!canManage && (
            <p className="selected-readonly" role="note">
              Bu çizim başka bir kullanıcıya ait. Görüntüleyebilir ve analizlerde kullanabilirsiniz,
              ancak düzenleyemez veya silemezsiniz.
            </p>
          )}
        </>
      )}
    </MapSheet>
  )
}
