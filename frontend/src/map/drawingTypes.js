/**
 * Single source of truth for the three drawing types.
 *
 * Everything that differs between point / line / polygon lives here: the
 * OpenLayers geometry type, the API paths, which style fields apply, the
 * Turkish label and the drawing hint. Nothing else in the app is allowed to
 * `switch` on the drawing type — it looks the answer up in this table instead.
 *
 * The default style below mirrors `DrawingStyleDefaults` on the backend. The
 * two languages cannot share a literal, but each side has exactly one place
 * where these numbers are written down.
 */

/** Application-wide default style (backend: DrawingStyleDefaults). */
export const DEFAULT_STYLE = Object.freeze({
  strokeColor: '#6D4AFF',
  strokeWidth: 3,
  fillColor: '#7C5CFF',
  fillOpacity: 0.25,
  pointRadius: 7,
  lineStyle: 'solid',
})

/** Ranges the backend validates; the sliders must not let the user exceed them. */
export const STYLE_LIMITS = Object.freeze({
  strokeWidth: { min: 1, max: 12 },
  fillOpacity: { min: 0, max: 1 },
  pointRadius: { min: 3, max: 20 },
})

/** Semantic line styles. The backend stores these words, never a JS dash array. */
export const LINE_STYLES = Object.freeze([
  { id: 'solid', label: 'Düz' },
  { id: 'dashed', label: 'Kesik' },
  { id: 'dotted', label: 'Noktalı' },
  { id: 'dashdot', label: 'Kesik-Nokta' },
])

/** Preset swatches offered by the color picker, plus a custom option in the UI. */
export const COLOR_PRESETS = Object.freeze([
  { id: 'purple', label: 'Mor', value: '#6D4AFF' },
  { id: 'blue', label: 'Mavi', value: '#2563EB' },
  { id: 'green', label: 'Yeşil', value: '#059669' },
  { id: 'orange', label: 'Turuncu', value: '#EA580C' },
  { id: 'red', label: 'Kırmızı', value: '#DC2626' },
])

/**
 * Drawing categories. Mirrors `DrawingCategories` on the backend, which is the
 * authority: an unknown value is rejected there with a 400. The two languages
 * cannot share a literal, so — as with the default style above — each side has
 * exactly one place where the list is written down.
 *
 * The order is the one the backend declares, so the dropdown and any
 * server-rendered list agree.
 */
export const DRAWING_CATEGORIES = Object.freeze([
  'Genel',
  'Envanter',
  'Çalışma Alanı',
  'Sınır',
  'Rota',
  'Referans Noktası',
  'Diğer',
])

/** Tag rules the backend enforces (DrawingMetadataValidator). */
export const TAG_LIMITS = Object.freeze({ maxCount: 10, maxLength: 40 })

/** Description limit the backend enforces (DrawingMetadataValidator). */
export const MAX_DESCRIPTION_LENGTH = 2000

/**
 * Cleans a tag list the way the backend will: trims, drops empties and removes
 * case-insensitive duplicates keeping the first spelling.
 *
 * Doing it client-side too means the chips the user sees are already the chips
 * that will be stored, rather than a list that quietly changes on save.
 */
export function normalizeTags(tags) {
  const seen = new Set()
  const result = []

  for (const tag of tags ?? []) {
    const trimmed = typeof tag === 'string' ? tag.trim() : ''
    if (!trimmed) continue

    const key = trimmed.toLocaleLowerCase('tr')
    if (seen.has(key)) continue

    seen.add(key)
    result.push(trimmed)
  }

  return result
}

export const DRAWING_TYPES = Object.freeze({
  point: {
    id: 'point',
    label: 'Nokta',
    plural: 'Noktalar',
    geometryType: 'Point',
    createPath: '/api/drawings/point',
    listPath: '/api/drawings/points',
    /** Style fields that are meaningful for this type (backend nulls the rest). */
    supports: { strokeColor: true, strokeWidth: true, fillColor: true, fillOpacity: false, pointRadius: true, lineStyle: false },
    hint: 'Haritada bir konuma tıklayın.',
    shortcut: 'P',
  },
  line: {
    id: 'line',
    label: 'Çizgi',
    plural: 'Çizgiler',
    geometryType: 'LineString',
    createPath: '/api/drawings/line',
    listPath: '/api/drawings/lines',
    supports: { strokeColor: true, strokeWidth: true, fillColor: false, fillOpacity: false, pointRadius: false, lineStyle: true },
    hint: 'Noktalar ekleyin · Çift tıklayarak bitirin · ESC ile iptal.',
    shortcut: 'L',
  },
  polygon: {
    id: 'polygon',
    label: 'Poligon',
    plural: 'Poligonlar',
    geometryType: 'Polygon',
    createPath: '/api/drawings/polygon',
    listPath: '/api/drawings/polygons',
    supports: { strokeColor: true, strokeWidth: true, fillColor: true, fillOpacity: true, pointRadius: false, lineStyle: true },
    hint: 'Alan sınırını oluşturun · Çift tıklayarak bitirin · ESC ile iptal.',
    shortcut: 'G',
  },
})

/** Stable ordering used by toolbars, layer toggles and load loops. */
export const DRAWING_TYPE_IDS = Object.freeze(['point', 'line', 'polygon'])

export const DRAWING_TYPE_LIST = Object.freeze(DRAWING_TYPE_IDS.map((id) => DRAWING_TYPES[id]))

export function drawingType(typeId) {
  return DRAWING_TYPES[typeId] ?? null
}

/** Path of a single record, used by PATCH .../style and DELETE. */
export function drawingItemPath(typeId, id) {
  return `${DRAWING_TYPES[typeId].createPath}/${id}`
}

/**
 * Default style for a type, with fields that do not apply to it set to null —
 * matching exactly what the backend stores and returns.
 */
export function defaultStyleFor(typeId) {
  return applyApplicability(typeId, DEFAULT_STYLE)
}

/** Clamps a number into an inclusive range. */
export function clamp(value, { min, max }) {
  return Math.min(max, Math.max(min, value))
}

/** Normalizes any user/API-supplied hex to uppercase `#RRGGBB`, or null. */
export function normalizeHex(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  // Expand the #RGB shorthand a native color input may hand back.
  const expanded = /^#[0-9a-fA-F]{3}$/.test(withHash)
    ? `#${withHash[1]}${withHash[1]}${withHash[2]}${withHash[2]}${withHash[3]}${withHash[3]}`
    : withHash
  return /^#[0-9a-fA-F]{6}$/.test(expanded) ? expanded.toUpperCase() : null
}

/**
 * Produces a complete, in-range style object for a type: missing fields fall
 * back to the default, out-of-range numbers are clamped, unknown line styles
 * are dropped, and fields that do not apply to the type become null.
 */
export function normalizeStyle(typeId, style) {
  const supports = DRAWING_TYPES[typeId].supports
  const source = style ?? {}

  const strokeColor = normalizeHex(source.strokeColor) ?? DEFAULT_STYLE.strokeColor
  const strokeWidth = clamp(
    Number.isFinite(Number(source.strokeWidth)) ? Math.round(Number(source.strokeWidth)) : DEFAULT_STYLE.strokeWidth,
    STYLE_LIMITS.strokeWidth,
  )

  const fillColor = supports.fillColor
    ? (normalizeHex(source.fillColor) ?? DEFAULT_STYLE.fillColor)
    : null

  const fillOpacity = supports.fillOpacity
    ? clamp(
        Number.isFinite(Number(source.fillOpacity)) ? Number(source.fillOpacity) : DEFAULT_STYLE.fillOpacity,
        STYLE_LIMITS.fillOpacity,
      )
    : null

  const pointRadius = supports.pointRadius
    ? clamp(
        Number.isFinite(Number(source.pointRadius)) ? Math.round(Number(source.pointRadius)) : DEFAULT_STYLE.pointRadius,
        STYLE_LIMITS.pointRadius,
      )
    : null

  const lineStyle = supports.lineStyle
    ? (LINE_STYLES.some((item) => item.id === source.lineStyle) ? source.lineStyle : DEFAULT_STYLE.lineStyle)
    : null

  return { strokeColor, strokeWidth, fillColor, fillOpacity, pointRadius, lineStyle }
}

/**
 * Normalizes every field without applying any type's applicability rules.
 *
 * Used only by the bulk style editor: with a mixed selection there is no single
 * type to normalize against (a point has no lineStyle, a polygon has no
 * pointRadius), and nulling by type would silently disable the very control the
 * user is reaching for. Applicability is enforced later, per record, by
 * `applyStylePatch` on the client and by the validator on the backend.
 */
export function normalizeAnyStyle(style) {
  const source = style ?? {}

  return {
    strokeColor: normalizeHex(source.strokeColor) ?? DEFAULT_STYLE.strokeColor,
    strokeWidth: clamp(
      Number.isFinite(Number(source.strokeWidth)) ? Math.round(Number(source.strokeWidth)) : DEFAULT_STYLE.strokeWidth,
      STYLE_LIMITS.strokeWidth,
    ),
    fillColor: normalizeHex(source.fillColor) ?? DEFAULT_STYLE.fillColor,
    fillOpacity: clamp(
      Number.isFinite(Number(source.fillOpacity)) ? Number(source.fillOpacity) : DEFAULT_STYLE.fillOpacity,
      STYLE_LIMITS.fillOpacity,
    ),
    pointRadius: clamp(
      Number.isFinite(Number(source.pointRadius)) ? Math.round(Number(source.pointRadius)) : DEFAULT_STYLE.pointRadius,
      STYLE_LIMITS.pointRadius,
    ),
    lineStyle: LINE_STYLES.some((item) => item.id === source.lineStyle) ? source.lineStyle : DEFAULT_STYLE.lineStyle,
  }
}

/** Nulls out every field the type does not support, keeping the rest as-is. */
function applyApplicability(typeId, style) {
  const supports = DRAWING_TYPES[typeId].supports
  return {
    strokeColor: style.strokeColor,
    strokeWidth: style.strokeWidth,
    fillColor: supports.fillColor ? style.fillColor : null,
    fillOpacity: supports.fillOpacity ? style.fillOpacity : null,
    pointRadius: supports.pointRadius ? style.pointRadius : null,
    lineStyle: supports.lineStyle ? style.lineStyle : null,
  }
}

/**
 * Style fields in the order the editor shows them, with the label used when a
 * field has to be explained ("yalnızca poligonlara uygulanır").
 */
export const STYLE_FIELDS = Object.freeze([
  { id: 'strokeColor', label: 'Çizgi rengi' },
  { id: 'strokeWidth', label: 'Çizgi kalınlığı' },
  { id: 'pointRadius', label: 'Nokta yarıçapı' },
  { id: 'fillColor', label: 'Dolgu rengi' },
  { id: 'fillOpacity', label: 'Dolgu saydamlığı' },
  { id: 'lineStyle', label: 'Çizgi deseni' },
])

/** Which drawing types a style field is meaningful for. */
export function typesSupporting(field) {
  return DRAWING_TYPE_IDS.filter((typeId) => DRAWING_TYPES[typeId].supports[field])
}

/**
 * Applies only the fields present in `patch`, and only where the type supports
 * them, on top of an existing style.
 *
 * This is what makes a mixed bulk selection behave correctly: changing
 * `fillOpacity` with two points, one line and one polygon selected reaches the
 * polygon and leaves the other three exactly as they were. The backend applies
 * the same rule to the stored columns, so the map and the database agree.
 */
export function applyStylePatch(typeId, base, patch) {
  const supports = DRAWING_TYPES[typeId].supports
  const next = { ...normalizeStyle(typeId, base) }

  for (const [field, value] of Object.entries(patch ?? {})) {
    if (value === undefined || value === null) continue
    if (supports[field]) next[field] = value
  }

  return normalizeStyle(typeId, next)
}

/**
 * The style patch for the single "Renk" the attribute popup asks for.
 *
 * The popup deliberately exposes one colour rather than the full style editor:
 * it is the required attribute the assignment asks for, and the detailed
 * stroke/fill controls stay where they already are (the style panel). One hex
 * therefore has to reach every colour column the type actually has — stroke
 * always, fill wherever the type supports it — so a point or polygon saved
 * "red" reads as red on the map instead of red-outlined-purple.
 *
 * @returns {object|null} null when the hex is not a valid `#RRGGBB`.
 */
export function colorPatchFor(typeId, hex) {
  const color = normalizeHex(hex)
  if (!color) return null

  return DRAWING_TYPES[typeId].supports.fillColor
    ? { strokeColor: color, fillColor: color }
    : { strokeColor: color }
}

/** The colour the popup shows for a style: the stroke, which every type has. */
export function primaryColorOf(style) {
  return normalizeHex(style?.strokeColor) ?? DEFAULT_STYLE.strokeColor
}

/** True when two styles are identical field by field. */
export function isSameStyle(a, b) {
  if (!a || !b) return a === b
  return (
    a.strokeColor === b.strokeColor &&
    a.strokeWidth === b.strokeWidth &&
    a.fillColor === b.fillColor &&
    a.fillOpacity === b.fillOpacity &&
    a.pointRadius === b.pointRadius &&
    a.lineStyle === b.lineStyle
  )
}
