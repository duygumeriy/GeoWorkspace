import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchDeletedDrawings, readApiError, restoreDrawings } from '../services/api.js'

/**
 * Owns the "Çöp Kutusu" data: the caller's soft-deleted drawings and the restore
 * action over them.
 *
 * Kept out of `useDrawingWorkspace` on purpose. That hook owns the OpenLayers
 * source, and every record in it is by definition a *live* one — putting deleted
 * rows in the same place would mean the map's source and the map's truth are no
 * longer the same list. The trash is a separate, read-mostly view that is only
 * fetched while its panel is open, so an unopened panel costs nothing.
 *
 * Restoring is deliberately NOT a second restore implementation: it posts to the
 * same `/api/drawings/restore` endpoint that undo already uses, with the same
 * `{ type, id }` payload. Ownership, geometry, name and style all stay on the
 * server side of that call.
 *
 * @param {{ active: boolean, showToast: Function, onRestored?: () => (void|Promise<void>) }} deps
 *   `active` is the panel's open state — the list loads when it turns true.
 *   `onRestored` refreshes whatever shows live drawings (the map), so a restored
 *   record reappears without the user reloading the page.
 */
export default function useTrash({ active, showToast, onRestored = null }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(false)
  /** Non-null when the last load failed; drives the panel's error state. */
  const [error, setError] = useState(null)
  /** `type:id` of the record currently being restored, so its row can wait. */
  const [restoringKey, setRestoringKey] = useState(null)

  /* Every load carries a token. A response from a load the user has already
     navigated away from (panel closed, or a newer "Tekrar Dene" in flight) is
     dropped instead of overwriting fresher state. */
  const requestRef = useRef(0)

  const load = useCallback(async () => {
    const token = (requestRef.current += 1)
    setLoading(true)
    setError(null)

    try {
      const res = await fetchDeletedDrawings()
      if (!res.ok) throw new Error(await readApiError(res, 'Silinen çizimler yüklenemedi'))

      const body = await res.json()
      if (token !== requestRef.current) return false

      setItems(Array.isArray(body) ? body : [])
      return true
    } catch (loadError) {
      if (token !== requestRef.current) return false
      // A failed trash load must not take the map down; it is its own panel.
      setError(loadError?.message || 'Silinen çizimler yüklenemedi.')
      return false
    } finally {
      if (token === requestRef.current) setLoading(false)
    }
  }, [])

  // Loaded when the panel opens rather than once at mount: the list is a
  // snapshot of what has been deleted, and deletions keep happening while the
  // app is open, so re-reading on each open is what keeps it truthful.
  useEffect(() => {
    if (!active) return
    load()
  }, [active, load])

  /**
   * "Geri Yükle" for one record.
   *
   * On success the row leaves the list immediately — it is no longer deleted, so
   * showing it in the trash would be a lie — and `onRestored` brings it back
   * onto the map. Both happen without a page reload.
   *
   * @param {{ type: string, drawing: { id: number, name?: string } }} item
   * @returns {Promise<boolean>}
   */
  const restore = useCallback(
    async (item) => {
      const type = item?.type
      const id = item?.drawing?.id
      if (!type || !id) return false

      const key = `${type}:${id}`
      setRestoringKey(key)

      try {
        // The same endpoint and the same payload undo uses. Only the record's
        // identity travels; the server keeps ownership and content.
        const res = await restoreDrawings([{ type, id }])
        if (!res.ok) throw new Error(await readApiError(res, 'Çizim geri yüklenemedi'))

        setItems((current) =>
          current.filter((entry) => !(entry.type === type && entry.drawing?.id === id)),
        )
        // The map is the other half of the answer: the record has to reappear
        // there, not just vanish from here.
        await onRestored?.()
        showToast('success', 'Çizim geri yüklendi.')
        return true
      } catch (restoreError) {
        showToast('error', restoreError?.message || 'Çizim geri yüklenemedi.')
        return false
      } finally {
        setRestoringKey(null)
      }
    },
    [onRestored, showToast],
  )

  return { items, loading, error, restoringKey, reload: load, restore }
}
