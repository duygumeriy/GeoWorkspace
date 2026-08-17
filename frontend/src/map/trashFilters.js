import { foldForSearch } from './drawingFilters.js'

/**
 * The search / type-filter / sort pipeline behind the "Çöp Kutusu" panel.
 *
 * It lives outside the component for the same reason `buildDrawingView` does:
 * given the deleted records and the three control values, it returns the list to
 * render, and the panel only has to draw what it is handed.
 *
 * The type filter options themselves are NOT redefined here — the panel reuses
 * `TYPE_FILTERS` from `drawingFilters.js`, which is derived from the canonical
 * `DRAWING_TYPES` table. So "point" / "line" / "polygon" are written down once
 * in the app, and a trash chip can never drift from the type it filters.
 *
 * Nothing here is a security boundary: the server returned only records that are
 * deleted AND owned by the caller. Everything below is presentation over a list
 * the server already narrowed.
 */

/**
 * Sort options, deliberately just two.
 *
 * A trash list is answering one question — "what did I delete, and when?" — so
 * the only ordering that earns a control is the deletion time. Name and colour
 * sorting belong in "Çizimlerim", where the list is something you browse rather
 * than something you recover from.
 */
export const TRASH_SORT_OPTIONS = Object.freeze([
  { id: 'newest', label: 'En Son Silinen' },
  { id: 'oldest', label: 'En Eski Silinen' },
])

/** Most recently deleted first — what the panel opens on. */
export const DEFAULT_TRASH_SORT = 'newest'

/** Sort key. A missing date sorts as 0 so it lands at the "oldest" end. */
function deletedTimeOf(item) {
  if (!item?.deletedAt) return 0
  const time = new Date(item.deletedAt).getTime()
  return Number.isNaN(time) ? 0 : time
}

/** Stable tiebreaker: two records deleted in the same batch share a timestamp. */
function idOf(item) {
  return item?.drawing?.id ?? 0
}

const COMPARATORS = {
  newest: (a, b) => deletedTimeOf(b) - deletedTimeOf(a) || idOf(b) - idOf(a),
  oldest: (a, b) => deletedTimeOf(a) - deletedTimeOf(b) || idOf(a) - idOf(b),
}

/**
 * Runs the pipeline: `items -> type -> search -> sort`.
 *
 * The search matches the name only. That is the question the trash is asked
 * ("where is the thing I called Ankara?"), and it is what the panel's own
 * placeholder promises; folding in description and tags the way "Çizimlerim"
 * does would make a query match rows whose visible title has nothing to do with
 * what was typed. Matching is Turkish-aware and diacritic-insensitive through
 * the shared `foldForSearch`, so "ankara" finds "Ankara" and "cizim" finds
 * "Çizim".
 *
 * @param {Array<{ type: string, deletedAt: string|null, drawing: object }>} items
 * @param {{ search?: string, type?: string, sort?: string }} controls
 * @returns {{ items: Array, matchCount: number }}
 */
export function buildTrashView(items, { search = '', type = 'all', sort = DEFAULT_TRASH_SORT } = {}) {
  const needle = foldForSearch(search)

  const filtered = items.filter((item) => {
    if (type !== 'all' && item.type !== type) return false
    if (!needle) return true
    return foldForSearch(item.drawing?.name ?? '').includes(needle)
  })

  const sorted = [...filtered].sort(COMPARATORS[sort] ?? COMPARATORS[DEFAULT_TRASH_SORT])

  return { items: sorted, matchCount: sorted.length }
}
