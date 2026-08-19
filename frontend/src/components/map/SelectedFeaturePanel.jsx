import { useEffect, useState } from 'react'
import MapSheet from './MapSheet.jsx'
import Button from '../ui/Button.jsx'
import TagInput from './TagInput.jsx'
import GeometryEditor from './GeometryEditor.jsx'
import useMediaQuery from '../../hooks/useMediaQuery.js'
import {
  COLOR_PRESETS,
  DRAWING_CATEGORIES,
  DRAWING_TYPES,
  MAX_DESCRIPTION_LENGTH,
  normalizeHex,
  primaryColorOf,
} from '../../map/drawingTypes.js'
import {
  formatArea,
  formatLength,
  formatLonLat,
  measureArea,
  measureLength,
  measurePerimeter,
} from '../../map/measure.js'
import { toLonLat } from 'ol/proj'
import { formatDateTime } from '../../map/datetime.js'
import {
  FocusIcon,
  PaletteIcon,
  TrashIcon,
  ChevronIcon,
  CheckIcon,
  CloseIcon,
  UndoIcon,
  RedoIcon,
} from '../ui/icons/index.js'
import './SelectedFeaturePanel.css'

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
 * "Düzenle" opens an edit session and splits the panel in two tabs:
 *
 *   Bilgiler — name, description, category, tags, colour
 *   Geometri — manual coordinates, vertex tools, live metrics, line tools
 *
 * Both tabs write into the SAME session, and so does the map: dragging a vertex,
 * typing a longitude and pressing "Uzat" are one geometry with one undo stack.
 * Nothing reaches the database until "Kaydet"; "İptal" restores the opening
 * snapshot without a request.
 *
 * The tabs are presentation only — switching between them neither commits nor
 * discards anything, so a user can move back and forth mid-edit freely.
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
  /** The `useEditSession` value; non-null exactly while editing. */
  session = null,
  editMode,
  onEditModeChange,
  /** Selects a vertex from the panel and nudges the map to it if it is off screen. */
  onSelectVertex,
  /** "Haritada Göster": centres the map on one vertex, keeping the zoom. */
  onFocusVertex,
  onCopyText,
  onNotify,
  // False for drawings owned by someone else. Viewing, zooming and analysing
  // stay available — only mutation is withheld.
  canManage = true,
  /* Eylem bazlı yetkiler. Tek bir `canManage` yetmez: silme yetkisi olup
     düzenleme yetkisi olmayan biri için "Düzenle"yi göstermek, kaydetmenin
     garanti 403 aldığı bir oturum açmak olurdu. Sahiplik (`canManage`) ile
     yetki AYRI eksenlerdir ve ikisi birden gerekir. */
  canEdit = true,
  canRestyle = true,
  canDelete = true,
}) {
  // On phones the sheet opens as a one-line summary so it barely covers the
  // map; the full detail list is one tap away. Desktop has the room to show
  // everything at once, so it is always expanded there.
  const isPhone = useMediaQuery('(max-width: 640px)')
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState('info')

  // Collapse again whenever the selection changes on a phone.
  useEffect(() => {
    setExpanded(!isPhone)
  }, [isPhone, feature?.key])

  // Every new edit session starts on "Bilgiler" and expanded: the form is
  // useless collapsed, and the geometry tab is the deeper of the two.
  useEffect(() => {
    if (!editing) return
    setTab('info')
    setExpanded(true)
  }, [editing, feature?.key])

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

  const draft = session?.draft ?? null
  /* The session is created by an effect, so it is still null on the first
     render after "Düzenle". `editing` therefore drives which SIDE is shown and
     `draft` only gates the form itself: for that one frame the panel shows just
     its summary rather than flashing the read-only actions the user has already
     left behind. */
  const isEditing = editing && Boolean(draft)

  return (
    <MapSheet
      open={open}
      title={isEditing ? 'Çizimi Düzenle' : 'Seçili Çizim'}
      onClose={isEditing ? onCancelEdit : onClose}
      // The coordinate rows carry full-text actions, which need more room than
      // the read-only detail list; the panel widens for the session and shrinks
      // back afterwards rather than permanently covering more of the map.
      className={`selected-panel ${isEditing ? 'is-editing' : ''}`}
    >
      {/* The always-visible summary. On a phone it doubles as the expander. */}
      {isPhone && !isEditing ? (
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
            {feature.description && <Row label="Açıklama" value={feature.description} />}
            {feature.category && <Row label="Kategori" value={feature.category} />}
            {feature.tags?.length > 0 && (
              <Row
                label="Etiketler"
                value={
                  <span className="selected-tags">
                    {feature.tags.map((tag) => (
                      <span key={tag} className="selected-tag">
                        {tag}
                      </span>
                    ))}
                  </span>
                }
              />
            )}
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
            <Row label="Oluşturma" value={formatDateTime(feature.createdDate)} />
            <Row label="Güncelleme" value={formatDateTime(feature.modifiedDate)} />
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
                {canEdit && (
                  <Button variant="ghost" className="selected-action" onClick={onStartEdit}>
                    <PaletteIcon size={16} />
                    Düzenle
                  </Button>
                )}
                {canRestyle && (
                  <Button variant="ghost" className="selected-action" onClick={onEditStyle}>
                    <PaletteIcon size={16} />
                    Stili Değiştir
                  </Button>
                )}
                {canDelete && (
                  <Button variant="ghost" className="selected-action selected-action--danger" onClick={onDelete}>
                    <TrashIcon size={16} />
                    Sil
                  </Button>
                )}
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

      {isEditing && (
        <div className="selected-edit">
          <div className="selected-tabs" role="tablist" aria-label="Düzenleme bölümleri">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'info'}
              className={`selected-tab ${tab === 'info' ? 'is-active' : ''}`}
              onClick={() => setTab('info')}
            >
              Bilgiler
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'geometry'}
              className={`selected-tab ${tab === 'geometry' ? 'is-active' : ''}`}
              onClick={() => setTab('geometry')}
            >
              Geometri
            </button>
          </div>

          {tab === 'info' ? (
            <InfoTab draft={draft} onChange={session.setDraftField} />
          ) : (
            <GeometryEditor
              type={session.type}
              coords={session.coords}
              segments={session.segments}
              metrics={session.metrics}
              validity={session.validity}
              editMode={editMode}
              onEditModeChange={onEditModeChange}
              // Selection is the session's, shared with the map overlay — the
              // row and the numbered marker are two views of one index.
              selectedVertex={session.selectedVertex}
              selectedEdge={session.selectedEdge}
              onSelectVertex={onSelectVertex}
              onSetVertex={session.setVertex}
              onAddVertexAfter={session.addVertexAfter}
              onAddVertexBefore={session.addVertexBefore}
              onSplitSelectedEdge={session.splitSelectedEdge}
              onRemoveVertex={session.removeVertex}
              onMoveVertex={session.moveVertex}
              onExtend={session.extend}
              onShorten={session.shorten}
              onTargetLength={session.setTargetLength}
              onFocusVertex={onFocusVertex}
              onCopy={onCopyText}
              onNotify={onNotify}
            />
          )}

          {/* History spans BOTH tabs: it is the session's geometry stack, not
              the geometry tab's, so an undo works from wherever the user is. */}
          <div className="selected-history">
            <button
              type="button"
              className="selected-history-btn"
              disabled={!session.canUndo}
              title={session.canUndo ? 'Geri Al' : 'Geri alınacak işlem yok'}
              aria-label="Geri Al"
              onClick={session.undo}
            >
              <UndoIcon size={14} />
              Geri Al
            </button>
            <button
              type="button"
              className="selected-history-btn"
              disabled={!session.canRedo}
              title={session.canRedo ? 'Yinele' : 'Yinelenecek işlem yok'}
              aria-label="Yinele"
              onClick={session.redo}
            >
              <RedoIcon size={14} />
              Yinele
            </button>
            <button
              type="button"
              className="selected-history-btn"
              disabled={!session.isDirty}
              title={session.isDirty ? 'Düzenleme başındaki hâline dön' : 'Değişiklik yok'}
              onClick={session.reset}
            >
              Orijinale Döndür
            </button>
          </div>

          <div className="selected-actions selected-actions--edit">
            <Button variant="ghost" className="selected-action" onClick={onCancelEdit} disabled={saving}>
              <CloseIcon size={16} />
              İptal
            </Button>
            <Button
              className="selected-action"
              onClick={onSaveEdit}
              disabled={!session.canSave || saving}
              title={session.canSave ? undefined : 'Ad ve koordinatlar geçerli olmalıdır'}
            >
              <CheckIcon size={16} />
              {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </Button>
          </div>

          {draft.name.trim().length === 0 && (
            <p className="selected-edit-error" role="alert">
              Ad boş olamaz.
            </p>
          )}
        </div>
      )}
    </MapSheet>
  )
}

/** Name, description, category, tags and colour — the "Bilgiler" tab. */
function InfoTab({ draft, onChange }) {
  return (
    <div className="selected-info-tab">
      <label className="selected-field">
        <span className="selected-field-label">Ad</span>
        <input
          className="selected-input"
          type="text"
          value={draft.name}
          maxLength={200}
          autoFocus
          placeholder="Çizim adı"
          onChange={(event) => onChange('name', event.target.value)}
        />
      </label>

      <label className="selected-field">
        <span className="selected-field-label">Açıklama</span>
        <textarea
          className="selected-input selected-textarea"
          value={draft.description}
          rows={3}
          maxLength={MAX_DESCRIPTION_LENGTH}
          placeholder="İsteğe bağlı açıklama"
          onChange={(event) => onChange('description', event.target.value)}
        />
      </label>

      <label className="selected-field">
        <span className="selected-field-label">Kategori</span>
        <select
          className="selected-input"
          value={draft.category}
          onChange={(event) => onChange('category', event.target.value)}
        >
          <option value="">Kategori yok</option>
          {DRAWING_CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </label>

      <div className="selected-field">
        <span className="selected-field-label" id="selected-tags-label">
          Etiketler
        </span>
        <TagInput id="selected-tags" value={draft.tags} onChange={(tags) => onChange('tags', tags)} />
      </div>

      <div className="selected-field">
        <span className="selected-field-label">Renk</span>
        <div className="selected-swatches" role="group" aria-label="Renk seçimi">
          {COLOR_PRESETS.map((preset) => {
            const isActive = normalizeHex(draft.color) === preset.value
            return (
              <button
                key={preset.id}
                type="button"
                className={`selected-swatch ${isActive ? 'is-active' : ''}`}
                style={{ '--swatch': preset.value }}
                aria-label={preset.label}
                aria-pressed={isActive}
                onClick={() => onChange('color', preset.value)}
              />
            )
          })}
          <label className="selected-swatch selected-swatch--custom" title="Özel renk">
            <input
              type="color"
              value={normalizeHex(draft.color) ?? '#6D4AFF'}
              aria-label="Özel renk seç"
              onChange={(event) => onChange('color', event.target.value)}
            />
          </label>
        </div>
      </div>
    </div>
  )
}
