import { COLOR_PRESETS, DRAWING_CATEGORIES, DRAWING_TYPES, DRAWING_TYPE_IDS, normalizeHex } from './drawingTypes.js'

/**
 * The search / filter / sort / group pipeline behind the "Çizimlerim" panel.
 *
 * It lives outside the component because it is pure data work: given the list
 * of drawings and the four control values, it returns the groups to render.
 * The panel then only has to draw what it is handed.
 *
 * The backend has already applied the two rules that matter for correctness —
 * only the current user's records, and neither deleted nor inactive ones — so
 * nothing here is load-bearing for security or ownership. Everything below is
 * presentation over a list the server already narrowed.
 *
 * The dataset is one user's drawings, so filtering client-side keeps the panel
 * instant (no request per keystroke). If it ever grows past a few thousand
 * records this is the seam where server-side paging would go.
 */

/** Type filter options, "Tümü" first. */
export const TYPE_FILTERS = Object.freeze([
  { id: 'all', label: 'Tümü' },
  ...DRAWING_TYPE_IDS.map((id) => ({ id, label: DRAWING_TYPES[id].label })),
])

export const SORT_OPTIONS = Object.freeze([
  { id: 'newest', label: 'En Yeni' },
  { id: 'oldest', label: 'En Eski' },
  { id: 'name-asc', label: 'A → Z' },
  { id: 'name-desc', label: 'Z → A' },
  { id: 'updated', label: 'Son Güncellenen' },
])

/** Newest-first is the default the panel opens on. */
export const DEFAULT_SORT = 'newest'

export const GROUP_OPTIONS = Object.freeze([
  { id: 'none', label: 'Gruplama Yok' },
  { id: 'type', label: 'Türe Göre' },
  { id: 'date', label: 'Tarihe Göre' },
  { id: 'color', label: 'Renge Göre' },
  { id: 'category', label: 'Kategoriye Göre' },
  /* "Bölgeye Göre" is deliberately absent: the repository has no authoritative
     administrative-boundary dataset, and inventing city/district values — or
     pulling them from an external service — would put unverifiable data in
     front of the user. The option belongs here the day such a dataset exists. */
])

export const DEFAULT_GROUP = 'none'

/* --- Colour ---------------------------------------------------------------
   A drawing's colour is its stroke, the one field every type has (fill is
   absent on lines). Presets get their Turkish name; anything else is a custom
   colour and is shown by its hex. */

/** Preset hex -> Turkish label, for filter options and group headers. */
const PRESET_LABELS = new Map(COLOR_PRESETS.map((preset) => [preset.value, preset.label]))

/** The colour a drawing is filtered and grouped by. */
export function colorOf(item) {
  return normalizeHex(item?.style?.strokeColor) ?? ''
}

/** "Mor" for a preset, "#A1B2C3" for a custom colour. */
export function colorLabel(hex) {
  return PRESET_LABELS.get(hex) ?? hex
}

/**
 * Colour filter options built from the drawings actually present.
 *
 * Deliberately data-driven rather than a fixed list of every preset: offering
 * "Kırmızı" when nothing red exists is a dead end, and a fixed list could never
 * cover custom colours anyway. The dropdown therefore stays as short as the
 * dataset allows, which is what keeps it from filling with dozens of chips.
 *
 * @returns {Array<{ id: string, label: string, count: number }>} "Tüm Renkler" first.
 */
export function colorFilterOptions(drawings) {
  const counts = new Map()

  for (const item of drawings) {
    const hex = colorOf(item)
    if (!hex) continue
    counts.set(hex, (counts.get(hex) ?? 0) + 1)
  }

  const options = [...counts.entries()]
    // Presets first in their declared order, then custom colours by hex, so the
    // list is stable between renders instead of following insertion order.
    .sort(([a], [b]) => presetIndex(a) - presetIndex(b) || a.localeCompare(b))
    .map(([hex, count]) => ({ id: hex, label: colorLabel(hex), count }))

  return [{ id: 'all', label: 'Tüm Renkler', count: drawings.length }, ...options]
}

function presetIndex(hex) {
  const index = COLOR_PRESETS.findIndex((preset) => preset.value === hex)
  // Custom colours sort after every preset.
  return index === -1 ? COLOR_PRESETS.length : index
}

/* --- Category -------------------------------------------------------------- */

/** Header and filter label for drawings with no category set. */
export const NO_CATEGORY_LABEL = 'Kategori Yok'

export const CATEGORY_FILTERS = Object.freeze([
  { id: 'all', label: 'Tümü' },
  ...DRAWING_CATEGORIES.map((category) => ({ id: category, label: category })),
  // Its own option rather than an absence: "which drawings did I forget to
  // categorise" is a question worth being able to ask.
  { id: 'none', label: NO_CATEGORY_LABEL },
])

function categoryOf(item) {
  return (item?.category ?? '').trim()
}

/**
 * Folds a string for searching: Turkish-aware lowercasing plus diacritic
 * removal, so "cizim" finds "Çizim" and "SAHA" finds "saha".
 *
 * The `tr` locale matters for the dotted/dotless i: without it "İSTANBUL"
 * lowercases to "i̇stanbul" and stops matching a typed "istanbul".
 */
export function foldForSearch(value) {
  if (typeof value !== 'string') return ''

  return value
    .toLocaleLowerCase('tr')
    .normalize('NFD')
    // Strip combining marks (the accents NFD just separated out).
    .replace(/[\u0300-\u036f]/g, '')
    // ı and ğ have no combining-mark decomposition; map them explicitly.
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .trim()
}

/** Sort keys. Missing dates sort as 0 so they land at the "oldest" end. */
function timeOf(value) {
  if (!value) return 0
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? 0 : time
}

/**
 * Compares two names, pushing empty ones to the end in BOTH directions.
 *
 * A record with no name is not "first alphabetically"; it is missing data, and
 * the user looking for it alphabetically will not find it at the top either
 * way. Keeping it last in A→Z and Z→A alike makes the order deterministic
 * rather than an artefact of which direction was picked.
 */
function compareNames(a, b, direction) {
  const left = (a.name ?? '').trim()
  const right = (b.name ?? '').trim()

  if (!left && !right) return a.databaseId - b.databaseId
  if (!left) return 1
  if (!right) return -1

  const result = left.localeCompare(right, 'tr', { sensitivity: 'base', numeric: true })
  // Ties broken by id so the order never shuffles between renders.
  return result !== 0 ? result * direction : a.databaseId - b.databaseId
}

const COMPARATORS = {
  newest: (a, b) => timeOf(b.createdDate) - timeOf(a.createdDate) || b.databaseId - a.databaseId,
  oldest: (a, b) => timeOf(a.createdDate) - timeOf(b.createdDate) || a.databaseId - b.databaseId,
  'name-asc': (a, b) => compareNames(a, b, 1),
  'name-desc': (a, b) => compareNames(a, b, -1),
  updated: (a, b) => timeOf(b.modifiedDate) - timeOf(a.modifiedDate) || b.databaseId - a.databaseId,
}

/* --- Date buckets ---------------------------------------------------------
   Computed in the viewer's LOCAL time on purpose: "Bugün" has to mean today
   where the user is. The stored values stay UTC; only the bucketing is local. */

const DATE_BUCKETS = Object.freeze([
  { id: 'today', label: 'Bugün' },
  { id: 'yesterday', label: 'Dün' },
  { id: 'week', label: 'Bu Hafta' },
  { id: 'older', label: 'Daha Eski' },
])

function startOfLocalDay(date) {
  const copy = new Date(date)
  copy.setHours(0, 0, 0, 0)
  return copy.getTime()
}

function dateBucketOf(value, now = new Date()) {
  const time = timeOf(value)
  if (!time) return 'older'

  const today = startOfLocalDay(now)
  const dayMs = 24 * 60 * 60 * 1000

  if (time >= today) return 'today'
  if (time >= today - dayMs) return 'yesterday'
  // "Bu Hafta" = the last seven days, not the calendar week: it stays useful
  // on a Monday, when a calendar week would be almost empty.
  if (time >= today - 6 * dayMs) return 'week'
  return 'older'
}

/**
 * The text a search matches against.
 *
 * Name, description, category and tags are folded together once per item rather
 * than tested field by field, so a query like "ankara depo" is checked against
 * one string. The concatenation is cheap next to the folding itself, and the
 * whole pipeline still runs over one user's drawings in memory — see the note at
 * the top of this file for where server-side paging would go if that changes.
 */
function searchableText(item) {
  return foldForSearch(
    [item.name, item.description, item.category, ...(item.tags ?? [])].filter(Boolean).join(' '),
  )
}

/**
 * Runs the whole pipeline.
 *
 *   drawings -> search -> type -> colour -> category -> sort -> group
 *
 * Filters compose: each narrows what the previous one produced, so a red polygon
 * in "Rota" is found by any combination of the four. None of them is a security
 * boundary — the server already returned only this user's active records.
 *
 * @param {Array} drawings descriptors from the workspace
 * @param {{ search?: string, type?: string, color?: string, category?: string,
 *           sort?: string, group?: string }} controls
 * @returns {{ groups: Array<{ id: string, label: string, items: Array }>,
 *             matchCount: number }}
 *   `groups` always has at least one entry when anything matched; ungrouped
 *   results come back as a single unlabelled group so the panel renders one way.
 */
export function buildDrawingView(
  drawings,
  { search = '', type = 'all', color = 'all', category = 'all', sort = DEFAULT_SORT, group = DEFAULT_GROUP } = {},
) {
  const needle = foldForSearch(search)

  const filtered = drawings.filter((item) => {
    if (type !== 'all' && item.type !== type) return false
    if (color !== 'all' && colorOf(item) !== color) return false

    if (category !== 'all') {
      const itemCategory = categoryOf(item)
      // 'none' is the explicit "uncategorised" bucket, not a category name.
      if (category === 'none' ? itemCategory !== '' : itemCategory !== category) return false
    }

    if (!needle) return true
    return searchableText(item).includes(needle)
  })

  const sorted = [...filtered].sort(COMPARATORS[sort] ?? COMPARATORS[DEFAULT_SORT])

  if (group === 'color') {
    /* Groups follow the filtered data, in the same preset-then-custom order the
       colour dropdown uses. `swatch` travels with the group so the header can
       show the colour itself rather than only naming it. */
    const byColor = new Map()

    for (const item of sorted) {
      const hex = colorOf(item)
      if (!byColor.has(hex)) byColor.set(hex, [])
      byColor.get(hex).push(item)
    }

    return {
      matchCount: sorted.length,
      groups: [...byColor.entries()]
        .sort(([a], [b]) => presetIndex(a) - presetIndex(b) || a.localeCompare(b))
        .map(([hex, items]) => ({ id: hex, label: colorLabel(hex), swatch: hex, items })),
    }
  }

  if (group === 'category') {
    return {
      matchCount: sorted.length,
      groups: [
        ...DRAWING_CATEGORIES.map((name) => ({
          id: name,
          label: name,
          items: sorted.filter((item) => categoryOf(item) === name),
        })),
        // Uncategorised drawings last: they are the leftover bucket, not a
        // category that competes with the named ones for attention.
        { id: 'none', label: NO_CATEGORY_LABEL, items: sorted.filter((item) => categoryOf(item) === '') },
      ].filter((entry) => entry.items.length > 0),
    }
  }

  if (group === 'type') {
    return {
      matchCount: sorted.length,
      groups: DRAWING_TYPE_IDS
        .map((typeId) => ({
          id: typeId,
          label: DRAWING_TYPES[typeId].plural,
          items: sorted.filter((item) => item.type === typeId),
        }))
        // Empty type groups are noise; the counts are already in the headers.
        .filter((entry) => entry.items.length > 0),
    }
  }

  if (group === 'date') {
    const now = new Date()
    return {
      matchCount: sorted.length,
      groups: DATE_BUCKETS.map((bucket) => ({
        id: bucket.id,
        label: bucket.label,
        items: sorted.filter((item) => dateBucketOf(item.createdDate, now) === bucket.id),
      })).filter((entry) => entry.items.length > 0),
    }
  }

  return {
    matchCount: sorted.length,
    groups: sorted.length ? [{ id: 'all', label: null, items: sorted }] : [],
  }
}
