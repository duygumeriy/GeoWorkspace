import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MapSheet from './MapSheet.jsx'
import Button from '../ui/Button.jsx'
import {
  ColorField,
  FillOpacityField,
  LineStyleField,
  PointRadiusField,
  StrokeWidthField,
} from './StyleControls.jsx'
import {
  DRAWING_TYPES,
  DRAWING_TYPE_LIST,
  defaultStyleFor,
  isSameStyle,
  normalizeAnyStyle,
  normalizeStyle,
} from '../../map/drawingTypes.js'
import { STYLE_PRESETS, presetStyleFor } from '../../map/stylePresets.js'
import { STYLE_PANEL_MODES } from '../../hooks/useWorkspaceMode.js'
import { PointIcon, LineIcon, PolygonIcon } from '../ui/icons/index.js'
import './StylePanel.css'

const TYPE_ICONS = { point: PointIcon, line: LineIcon, polygon: PolygonIcon }

/** Shared empty set: a fresh one per render would defeat memo comparisons. */
const EMPTY_TOUCHED = Object.freeze(new Set())

/** Human list: "Nokta, Çizgi ve Poligon". */
function joinTypes(typeIds) {
  const labels = typeIds.map((id) => DRAWING_TYPES[id].label)
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} ve ${labels.at(-1)}`
}

/**
 * The "Çizim Stili" editor.
 *
 * The mode is explicit rather than derived from "is a feature selected", which
 * is what previously let a type tab silently mean two different things. Each
 * mode has one job:
 *
 *  - drawing-default: edits the style the next drawing gets, and its type tabs
 *    change the ACTIVE DRAW TOOL — picking "Çizgi" here really does switch the
 *    toolbar and the OpenLayers interaction to line.
 *  - selected-feature: edits one record. The geometry type of an existing
 *    record cannot change, so the tabs are not rendered at all.
 *  - bulk-selection: edits several records. Only the fields the user actually
 *    touches are sent, and each field is applied only to the types it applies
 *    to; the rest of every record's style is left alone.
 */
export default function StylePanel({
  open,
  mode = STYLE_PANEL_MODES.drawingDefault,
  onClose,
  editingFeature,
  selectedFeatures = [],
  toolStyles,
  activeType,
  onSelectDrawTool,
  onSetToolStyle,
  onPreview,
  onPreviewPatch,
  onApply,
  onApplyPatch,
}) {
  const isEditing = mode === STYLE_PANEL_MODES.selectedFeature && Boolean(editingFeature)
  const isBulk = mode === STYLE_PANEL_MODES.bulkSelection

  /** Types present in a bulk selection; drives which controls make sense. */
  const bulkTypes = useMemo(() => {
    const seen = new Set(selectedFeatures.map((item) => item.type))
    return DRAWING_TYPE_LIST.filter((type) => seen.has(type.id)).map((type) => type.id)
  }, [selectedFeatures])

  // Every control still needs a type to label itself against; in bulk mode the
  // first selected type plays that role. It never restricts the values though —
  // see `normalize` below.
  const typeId = isEditing ? editingFeature.type : isBulk ? (bulkTypes[0] ?? 'polygon') : activeType

  /**
   * Bulk mode deliberately skips per-type applicability: with points and
   * polygons in one selection, normalizing against either would null out the
   * other's fields and freeze those controls. Each field is narrowed to the
   * records it applies to at apply time instead.
   */
  const normalize = useCallback(
    (style) => (isBulk ? normalizeAnyStyle(style) : normalizeStyle(typeId, style)),
    [isBulk, typeId],
  )

  const persisted = useMemo(
    () =>
      isEditing
        ? normalizeStyle(typeId, editingFeature.style)
        : isBulk
          ? // Seeded from the first selected record so the sliders open on a
            // real value rather than a default the user never chose.
            normalizeAnyStyle(selectedFeatures[0]?.style)
          : normalizeStyle(typeId, toolStyles[typeId]),
    [typeId, isEditing, isBulk, editingFeature, selectedFeatures, toolStyles],
  )

  /** Identity of what is being edited; changing it re-seeds the draft. */
  const seedKey = isEditing
    ? editingFeature.key
    : isBulk
      ? `bulk-${selectedFeatures.map((item) => item.key).join(',')}`
      : `tool-${typeId}`

  /**
   * Draft state is what the controls bind to.
   *
   * The re-seed happens during render rather than in an effect, because the two
   * must never disagree even for a single frame: switching the type tab from
   * Poligon to Nokta changes which controls are rendered immediately, and an
   * effect-based reset would hand the freshly-shown pointRadius slider the old
   * polygon draft, where that field is null. React's documented "adjust state
   * when props change" pattern re-renders before committing, so no inconsistent
   * frame ever reaches the DOM.
   */
  const [editState, setEditState] = useState(() => ({ key: seedKey, draft: persisted, touched: EMPTY_TOUCHED }))

  if (editState.key !== seedKey) {
    setEditState({ key: seedKey, draft: persisted, touched: EMPTY_TOUCHED })
  }

  // Resolved values, correct even in the render that triggered the re-seed.
  const seeded = editState.key === seedKey
  const draft = seeded ? editState.draft : persisted
  /** Bulk mode only: which fields the user has actually touched. */
  const touched = seeded ? editState.touched : EMPTY_TOUCHED

  /** Only the fields the user changed — the payload a bulk apply sends. */
  const patch = useMemo(() => {
    const result = {}
    for (const field of touched) result[field] = draft[field]
    return result
  }, [touched, draft])

  // Live preview for the selected feature; cleared when the panel goes away.
  useEffect(() => {
    if (!open || !isEditing) return undefined
    onPreview?.(editingFeature.key, draft)
    return () => onPreview?.(editingFeature.key, null)
  }, [open, isEditing, editingFeature?.key, draft, onPreview])

  // Bulk preview: every selected feature keeps its own style except the
  // patched fields, so the user sees exactly what "Uygula" would do.
  const bulkKeys = useMemo(() => selectedFeatures.map((item) => item.key), [selectedFeatures])

  useEffect(() => {
    if (!open || !isBulk) return undefined
    onPreviewPatch?.(bulkKeys, patch)
    return () => onPreviewPatch?.(bulkKeys, null)
  }, [open, isBulk, bulkKeys, patch, onPreviewPatch])

  const [saving, setSaving] = useState(false)

  // Mirrors `draft` so `update` can read the current value without putting the
  // parent's setState inside a state updater (that would run during render).
  const draftRef = useRef(draft)
  draftRef.current = draft

  const update = useCallback(
    (patchFields) => {
      const next = normalize({ ...draftRef.current, ...patchFields })
      setEditState((current) => ({
        key: current.key,
        draft: next,
        // Only touched fields travel in a bulk apply, so an untouched control
        // can never overwrite a style the user never looked at.
        touched: new Set([...current.touched, ...Object.keys(patchFields)]),
      }))
      // In tool mode there is no record to commit to, so the change is live.
      if (!isEditing && !isBulk) onSetToolStyle?.(typeId, next)
    },
    [normalize, typeId, isEditing, isBulk, onSetToolStyle],
  )

  const applyPreset = useCallback(
    (presetId) => update(presetStyleFor(presetId, typeId)),
    [update, typeId],
  )

  const resetToDefault = useCallback(() => update(defaultStyleFor(typeId)), [update, typeId])

  const handleApply = useCallback(async () => {
    if (isBulk) {
      setSaving(true)
      const ok = await onApplyPatch?.(bulkKeys, patch)
      setSaving(false)
      if (ok) onClose?.()
      return
    }
    if (!isEditing) {
      onClose?.()
      return
    }
    setSaving(true)
    const ok = await onApply?.(editingFeature.key, draft)
    setSaving(false)
    if (ok) onClose?.()
  }, [isBulk, onApplyPatch, bulkKeys, patch, isEditing, onApply, editingFeature, draft, onClose])

  const handleCancel = useCallback(() => {
    // Dropping the preview is enough: the features still hold their persisted style.
    if (isEditing) onPreview?.(editingFeature.key, null)
    if (isBulk) onPreviewPatch?.(bulkKeys, null)
    onClose?.()
  }, [isEditing, onPreview, editingFeature, isBulk, onPreviewPatch, bulkKeys, onClose])

  if (!open) return null

  const supports = DRAWING_TYPES[typeId].supports
  // In bulk mode a control is offered when ANY selected type supports it, and
  // is labelled with the types it will actually reach.
  const offers = (field) => (isBulk ? bulkTypes.some((id) => DRAWING_TYPES[id].supports[field]) : supports[field])

  /** "Yalnızca Poligon" note under a control that cannot reach the whole selection. */
  const scopeNote = (field) => {
    if (!isBulk) return null
    const applicable = bulkTypes.filter((id) => DRAWING_TYPES[id].supports[field])
    if (applicable.length === bulkTypes.length) return null
    return <p className="style-panel-scope">Yalnızca {joinTypes(applicable)} çizimlerine uygulanır.</p>
  }

  const dirty = isBulk ? touched.size > 0 : !isSameStyle(draft, persisted)
  const showFooterActions = isEditing || isBulk

  return (
    <MapSheet
      open={open}
      title="Çizim Stili"
      onClose={handleCancel}
      className="style-panel"
      footer={
        showFooterActions ? (
          <>
            <Button variant="ghost" onClick={handleCancel} className="style-panel-footer-btn">
              Vazgeç
            </Button>
            <Button onClick={handleApply} disabled={!dirty || saving} className="style-panel-footer-btn">
              {saving ? 'Uygulanıyor...' : 'Uygula'}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={resetToDefault} className="style-panel-footer-btn">
            Varsayılana Dön
          </Button>
        )
      }
    >
      {isEditing && (
        <p className="style-panel-context">
          {DRAWING_TYPES[typeId].label} #{editingFeature.databaseId} düzenleniyor
        </p>
      )}

      {isBulk && (
        <p className="style-panel-context">
          {selectedFeatures.length} çizim seçili · {joinTypes(bulkTypes)}
          <span className="style-panel-context-hint">Yalnızca değiştirdiğiniz özellikler uygulanır.</span>
        </p>
      )}

      {/* Type tabs exist ONLY in drawing-default mode. An existing record's
          geometry type cannot change, so in the other two modes there is
          nothing here to press by accident. */}
      {!isEditing && !isBulk && (
        <div className="style-panel-tabs" role="tablist" aria-label="Çizim türü">
          {DRAWING_TYPE_LIST.map((type) => {
            const Icon = TYPE_ICONS[type.id]
            const isActive = type.id === typeId
            return (
              <button
                key={type.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                className={`style-panel-tab ${isActive ? 'is-active' : ''}`}
                // Changes the canonical active tool, not a local copy of it:
                // the toolbar, the hint and the Draw interaction all follow.
                onClick={() => onSelectDrawTool?.(type.id)}
              >
                <Icon size={16} />
                <span>{type.label}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="style-panel-presets">
        <span className="style-field-label">Hazır Stiller</span>
        <div className="style-panel-preset-row">
          {STYLE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="style-panel-preset"
              onClick={() => applyPreset(preset.id)}
            >
              <span
                className="style-panel-preset-dot"
                style={{ '--preset-color': preset.style.strokeColor }}
                aria-hidden="true"
              />
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      <ColorField
        label={typeId === 'point' && !isBulk ? 'Renk' : 'Çizgi Rengi'}
        value={draft.strokeColor}
        onChange={(strokeColor) =>
          // A point exposes one colour; keep its dot fill in step with it.
          update(typeId === 'point' && !isBulk ? { strokeColor, fillColor: strokeColor } : { strokeColor })
        }
      />

      <StrokeWidthField value={draft.strokeWidth} onChange={(strokeWidth) => update({ strokeWidth })} />

      {offers('pointRadius') && (
        <div className="style-panel-field">
          <PointRadiusField value={draft.pointRadius} onChange={(pointRadius) => update({ pointRadius })} />
          {scopeNote('pointRadius')}
        </div>
      )}

      {offers('fillColor') && (typeId !== 'point' || isBulk) && (
        <div className="style-panel-field">
          <ColorField label="Dolgu Rengi" value={draft.fillColor} onChange={(fillColor) => update({ fillColor })} />
          {scopeNote('fillColor')}
        </div>
      )}

      {offers('fillOpacity') && (
        <div className="style-panel-field">
          <FillOpacityField value={draft.fillOpacity} onChange={(fillOpacity) => update({ fillOpacity })} />
          {scopeNote('fillOpacity')}
        </div>
      )}

      {offers('lineStyle') && (
        <div className="style-panel-field">
          <LineStyleField
            value={draft.lineStyle}
            strokeColor={draft.strokeColor}
            onChange={(lineStyle) => update({ lineStyle })}
          />
          {scopeNote('lineStyle')}
        </div>
      )}

      {isEditing && (
        <button type="button" className="style-panel-reset" onClick={resetToDefault}>
          Varsayılana Dön
        </button>
      )}
    </MapSheet>
  )
}
