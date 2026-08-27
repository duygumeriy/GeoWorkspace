import { TYPE_FILTERS, foldForSearch } from './drawingFilters.js'

/**
 * The search / type-filter / sort pipeline behind the "Çöp Kutusu" panel.
 *
 * It lives outside the component for the same reason `buildDrawingView` does:
 * given the deleted records and the three control values, it returns the list to
 * render, and the panel only has to draw what it is handed.
 *
 * The drawing type filter options are NOT redefined here — they come from
 * `TYPE_FILTERS` in `drawingFilters.js`, which is derived from the canonical
 * `DRAWING_TYPES` table. So "point" / "line" / "polygon" are written down once
 * in the app, and a trash chip can never drift from the type it filters. POI is
 * appended as a FOURTH chip (see `TRASH_TYPE_FILTERS`) rather than being added
 * to `DRAWING_TYPES`: a POI is not a drawing, and putting it in that table
 * would sweep it into the drawings list, bulk selection and the style editor.
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
/**
 * Çöp Kutusu'nun tür çipleri: üç çizim türü + POI.
 *
 * POI ayrı bir satır olarak eklenir çünkü ayrı bir kayıttır — ayrı tablo, ayrı
 * uçlar, ayrı yetkiler. Çöp kutusu ikisini de temsil edebilmelidir ("silinen
 * neydi?"), ama bu onları aynı tür yapmaz.
 */
export const TRASH_TYPE_FILTERS = Object.freeze([
  ...TYPE_FILTERS,
  { id: 'poi', label: 'POI' },
  { id: 'transport-stop', label: 'Durak' },
  { id: 'transport-route', label: 'Güzergah' },
])

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

/**
 * Kaydın kendisi: çizim girişlerinde `drawing`, POI girişlerinde `poi`.
 *
 * İki sarmalayıcı da AYNI şekli taşır (id + name), dolayısıyla listenin
 * arama/sıralama işi tek bir okuma üzerinden yürür ve panelde tür başına ikinci
 * bir kod yolu doğmaz.
 */
export function trashRecordOf(item) {
  return item?.drawing ?? item?.poi ?? item?.stop ?? item?.route ?? null
}

/** Stable tiebreaker: two records deleted in the same batch share a timestamp. */
function idOf(item) {
  return trashRecordOf(item)?.id ?? 0
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
    return foldForSearch(trashRecordOf(item)?.name ?? '').includes(needle)
  })

  const sorted = [...filtered].sort(COMPARATORS[sort] ?? COMPARATORS[DEFAULT_TRASH_SORT])

  return { items: sorted, matchCount: sorted.length }
}
