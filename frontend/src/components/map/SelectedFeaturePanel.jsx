import { useEffect, useRef, useState } from 'react'
import MapSheet from './MapSheet.jsx'
import Button from '../ui/Button.jsx'
import useMediaQuery from '../../hooks/useMediaQuery.js'
import { COLOR_PRESETS, DRAWING_TYPES, normalizeHex, primaryColorOf } from '../../map/drawingTypes.js'
import {
  formatArea,
  formatLength,
  formatLonLat,
  measureArea,
  measureLength,
  measurePerimeter,
} from '../../map/measure.js'
import { toLonLat } from 'ol/proj'
import { FocusIcon, PaletteIcon, TrashIcon, ChevronIcon, CheckIcon, CloseIcon } from '../ui/icons/index.js'
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
 * Details of the currently selected drawing, and the place it is edited from.
 *
 * Length, area and perimeter are computed from the live geometry with
 * `ol/sphere` rather than stored — a derived value in the database would only
 * be one more thing to keep in sync.
 *
 * ## Edit mode
 *
 * "Düzenle" turns the read-only rows into a small form (name + colour) and asks
 * the map to enter geometry-edit mode, so all three edits are part of ONE
 * session ending in a single "Kaydet". Nothing is written until then: "İptal"
 * restores the old name, the old colour and — via the map's snapshot — the old
 * geometry.
 */
export default function SelectedFeaturePanel({
  open,
  feature,
  geometry,
  onClose,
  onZoom,
  onEditStyle,
  onDelete,
  // Edit session, owned by the map so the OpenLayers interactions and this
  // form enter and leave it together.
  editing = false,
  saving = false,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  // False for drawings owned by someone else. Viewing, zooming and analysing
  // stay available — only mutation is withheld.
  canManage = true,
}) {
  // On phones the sheet opens as a one-line summary so it barely covers the
  // map; the full detail list is one tap away. Desktop has the room to show
  // everything at once, so it is always expanded there.
  const isPhone = useMediaQuery('(max-width: 640px)')
  const [expanded, setExpanded] = useState(false)

  /** Draft values, live only while editing. */
  const [draftName, setDraftName] = useState('')
  const [draftColor, setDraftColor] = useState('')

  // Collapse again whenever the selection changes on a phone.
  useEffect(() => {
    setExpanded(!isPhone)
  }, [isPhone, feature?.key])

  /* Seeds the form from the record when an edit session opens.

     The guard is what makes this safe to run on every `feature` change: the
     descriptor is a fresh object on each sync (dragging a vertex re-renders
     it), and re-seeding then would overwrite whatever the user had typed.
     Keying the seed to the record identity means it happens exactly once per
     session, and selecting a different drawing mid-edit re-seeds correctly
     instead of leaving the previous record's name in the inputs. */
  const seededKeyRef = useRef(null)

  useEffect(() => {
    if (!editing || !feature) {
      seededKeyRef.current = null
      return
    }
    if (seededKeyRef.current === feature.key) return

    seededKeyRef.current = feature.key
    setDraftName(feature.name ?? '')
    setDraftColor(primaryColorOf(feature.style))
    // The form is useless collapsed, so editing always expands the sheet.
    setExpanded(true)
  }, [editing, feature])

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

  const trimmedName = draftName.trim()
  // Same rule the backend enforces, checked here only to keep the user from
  // making a request that is certain to fail.
  const canSave = trimmedName.length > 0 && trimmedName.length <= 200 && !saving

  const handleSave = () => {
    if (!canSave) return
    onSaveEdit?.({ name: trimmedName, color: normalizeHex(draftColor) ?? primaryColorOf(feature.style) })
  }

  return (
    <MapSheet
      open={open}
      title={editing ? 'Çizimi Düzenle' : 'Seçili Çizim'}
      onClose={editing ? onCancelEdit : onClose}
      className="selected-panel"
    >
      {/* The always-visible summary. On a phone it doubles as the expander. */}
      {isPhone && !editing ? (
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

      {expanded && !editing && (
        <>
          <dl className="selected-rows">
            <Row label="Ad" value={feature.name || '—'} />
            <Row label="Tür" value={config.label} />
            <Row
              label="Renk"
              value={
                <span className="selected-color">
                  <span
                    className="selected-color-dot"
                    style={{ '--dot': primaryColorOf(feature.style) }}
                    aria-hidden="true"
                  />
                  {primaryColorOf(feature.style)}
                </span>
              }
            />
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
                <Button variant="ghost" className="selected-action" onClick={onStartEdit}>
                  <PaletteIcon size={16} />
                  Düzenle
                </Button>
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

      {editing && (
        <div className="selected-edit">
          <label className="selected-field">
            <span className="selected-field-label">Ad</span>
            <input
              className="selected-input"
              type="text"
              value={draftName}
              maxLength={200}
              autoFocus
              placeholder="Çizim adı"
              onChange={(event) => setDraftName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleSave()
              }}
            />
          </label>

          <div className="selected-field">
            <span className="selected-field-label">Renk</span>
            <div className="selected-swatches" role="group" aria-label="Renk seçimi">
              {COLOR_PRESETS.map((preset) => {
                const isActive = normalizeHex(draftColor) === preset.value
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`selected-swatch ${isActive ? 'is-active' : ''}`}
                    style={{ '--swatch': preset.value }}
                    aria-label={preset.label}
                    aria-pressed={isActive}
                    onClick={() => setDraftColor(preset.value)}
                  />
                )
              })}
              <label className="selected-swatch selected-swatch--custom" title="Özel renk">
                <input
                  type="color"
                  value={normalizeHex(draftColor) ?? '#6D4AFF'}
                  aria-label="Özel renk seç"
                  onChange={(event) => setDraftColor(event.target.value)}
                />
              </label>
            </div>
          </div>

          {/* Geometry is edited on the map itself, not in this form. */}
          <p className="selected-edit-hint" role="note">
            {feature.type === 'point'
              ? 'Konumu değiştirmek için haritadaki noktayı sürükleyin.'
              : 'Şekli değiştirmek için haritadaki köşe noktalarını sürükleyin.'}
          </p>

          <div className="selected-actions selected-actions--edit">
            <Button variant="ghost" className="selected-action" onClick={onCancelEdit} disabled={saving}>
              <CloseIcon size={16} />
              İptal
            </Button>
            <Button className="selected-action" onClick={handleSave} disabled={!canSave}>
              <CheckIcon size={16} />
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </div>

          {trimmedName.length === 0 && (
            <p className="selected-edit-error" role="alert">
              Ad boş olamaz.
            </p>
          )}
        </div>
      )}
    </MapSheet>
  )
}
