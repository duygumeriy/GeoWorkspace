import { useCallback, useEffect, useRef, useState } from 'react'
import {
  fetchDeletedDrawings,
  fetchDeletedPois,
  readApiError,
  restoreDrawings,
  restorePoi,
} from '../services/api.js'
import {
  fetchDeletedTransportRoutes,
  fetchDeletedTransportStops,
  restoreTransportRoute,
  restoreTransportStop,
} from '../services/transportApi.js'

/**
 * Owns the "Çöp Kutusu" data: the caller's soft-deleted records — drawings AND
 * POIs — and the restore action over them.
 *
 * ## Neden tek panel, iki uç
 *
 * Çöp kutusu bir SORUYU yanıtlar: "ne sildim ve nasıl geri alırım?". Bu soru
 * kaydın hangi tabloda durduğuna bakmaz. POI için ikinci bir çöp kutusu ekranı
 * açmak, aynı arama/sıralama/geri yükleme akışını ikinci kez yazmak ve
 * kullanıcıyı "hangi çöp kutusuna bakayım" sorusuyla baş başa bırakmak olurdu.
 *
 * Uçlar yine de AYRI kalır (`/api/drawings/deleted`, `/api/poi/deleted`) çünkü
 * yetkileri ve kapsam kuralları ayrıdır: çizimler yalnızca sahibinindir; POI
 * ise `poi.manage` ile herkesin, `poi.delete` ile yalnızca kendi kayıtlarının
 * görüldüğü ortak bir envanterdir. Kapsamı sunucu belirler, bu hook yalnızca
 * iki listeyi birleştirir.
 *
 * <b>İki yarı SİMETRİKTİR.</b> Her kaynak yalnızca çağıranın yetkisi varsa
 * istenir ve kendi hatası kendi içinde kalır:
 *
 *   yalnızca çizim yetkisi  -> yalnızca çizim yarısı okunur
 *   yalnızca POI yetkisi    -> yalnızca POI yarısı okunur
 *   ikisi de                -> ikisi paralel okunur
 *   hiçbiri                 -> hiçbir istek açılmaz
 *
 * Bu simetri bir kolaylık değil, bir GEREKLİLİKTİR: yalnızca POI yetkisi olan
 * bir kullanıcı (ör. `map.view` + `poi.*` taşıyan özel bir rol)
 * `/api/drawings/deleted` çağrıldığında 403 alır ve o hata tüm paneli
 * düşürürse, kişi kendi sildiği POI'yi hiçbir zaman göremez.
 *
 * Panel yalnızca <b>istenen tüm kaynaklar</b> başarısız olduğunda hata
 * gösterir; biri gelirse liste çizilir — yarım bir çöp kutusu, hiç olmayandan
 * iyidir.
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
/**
 * Tek bir çöp kutusu kaynağını okur ve HİÇBİR koşulda fırlatmaz.
 *
 * Sonuç `{ ok, items }`tir: çağıran, "kaç kaynak gerçekten geldi" sorusunu
 * yanıtlayabilsin diye başarı bilgisi ayrı taşınır. Boş liste ile başarısız
 * istek aynı şey DEĞİLDİR — biri "çöp kutun boş", diğeri "okuyamadım"dır ve
 * panel ikisini farklı göstermek zorundadır.
 *
 * @param {() => Promise<Response>} request
 */
async function loadTrashSource(request) {
  try {
    const res = await request()
    if (!res.ok) return { ok: false, items: [] }

    const body = await res.json()
    return { ok: true, items: Array.isArray(body) ? body : [] }
  } catch {
    return { ok: false, items: [] }
  }
}

export default function useTrash({
  active,
  showToast,
  onRestored = null,
  /* Her yarı KENDİ yetkisine bağlıdır; yetkisi olmayan uç HİÇ çağrılmaz —
     garanti 403 alacak bir istek açmanın anlamı yok. */
  includeDrawings = false,
  includePois = false,
  includeTransportStops = false,
  includeTransportRoutes = false,
  /** Geri yüklenen POI'yi haritaya geri koyar. */
  onPoiRestored = null,
  onTransportRestored = null,
}) {
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

    /* İstenen kaynaklar PARALEL okunur: ikisi de bağımsızdır ve sırayla
       beklemek paneli iki tur gecikmeye uğratırdı. Yetkisi olmayan kaynak
       listeye hiç girmez, dolayısıyla isteği de açılmaz. */
    const sources = [
      ...(includeDrawings ? [loadTrashSource(fetchDeletedDrawings)] : []),
      ...(includePois ? [loadTrashSource(fetchDeletedPois)] : []),
      ...(includeTransportStops ? [loadTrashSource(async () => {
        const response = await fetchDeletedTransportStops()
        if (!response.ok) return response
        const rows = await response.json()
        return new Response(JSON.stringify(rows.map((stop) => ({ type: 'transport-stop', stop, deletedAt: stop.modifiedDate }))), { status: 200, headers: { 'Content-Type': 'application/json' } })
      })] : []),
      ...(includeTransportRoutes ? [loadTrashSource(async () => {
        const response = await fetchDeletedTransportRoutes()
        if (!response.ok) return response
        const rows = await response.json()
        return new Response(JSON.stringify(rows.map((route) => ({ type: 'transport-route', route, deletedAt: route.modifiedDate }))), { status: 200, headers: { 'Content-Type': 'application/json' } })
      })] : []),
    ]

    if (sources.length === 0) {
      // Geri yükleyebileceği hiçbir tür yok: istek açılmaz, liste boştur.
      if (token === requestRef.current) {
        setItems([])
        setLoading(false)
      }
      return true
    }

    const results = await Promise.all(sources)

    if (token !== requestRef.current) return false

    setLoading(false)

    /* Hata YALNIZCA istenen her kaynak düştüğünde gösterilir. Biri geldiyse
       elde gerçek veri vardır ve onu bir hata ekranının arkasına saklamak,
       kullanıcıya geri yükleyebileceği kayıtları göstermemek olurdu. */
    if (results.every((result) => !result.ok)) {
      setItems([])
      setError('Silinen kayıtlar yüklenemedi.')
      return false
    }

    setItems(results.flatMap((result) => result.items))
    return true
  }, [includeDrawings, includePois, includeTransportStops, includeTransportRoutes])

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
      const record = item?.drawing ?? item?.poi ?? item?.stop ?? item?.route
      const id = record?.id
      if (!type || !id) return false

      const isPoi = type === 'poi'
      const key = `${type}:${id}`
      setRestoringKey(key)

      try {
        /* Tür başına DOĞRU uç çağrılır; ikisi de "geri yükle" eyleminin
           sunucudaki tek gerçekleştirimidir. Sahiplik, geometri, ad ve
           kategori sunucu tarafında kalır — istek yalnızca kaydın kimliğini
           taşır. */
        const isTransportStop = type === 'transport-stop'
        const isTransportRoute = type === 'transport-route'
        const res = isPoi
          ? await restorePoi(id)
          : isTransportStop
            ? await restoreTransportStop(id)
            : isTransportRoute
              ? await restoreTransportRoute(id)
              : await restoreDrawings([{ type, id }])
        if (!res.ok) throw new Error(await readApiError(res, 'Kayıt geri yüklenemedi'))

        /* POI geri yükleme kaydın kanonik hâlini döndürür ve o hâl doğrudan
           haritaya konur; ikinci bir GET, az önce okunanı yeniden indirmek
           olurdu. */
        const restored = isPoi || isTransportStop || isTransportRoute ? await res.json() : null

        setItems((current) =>
          current.filter((entry) => !(entry.type === type && (entry.drawing ?? entry.poi ?? entry.stop ?? entry.route)?.id === id)),
        )

        // Haritanın öbür yarısı: kaydın oradan da geri gelmesi gerekir.
        if (isPoi) await onPoiRestored?.(restored)
        else if (isTransportStop || isTransportRoute) await onTransportRestored?.(restored, type)
        else await onRestored?.()

        showToast('success', isPoi ? 'POI geri yüklendi.' : isTransportStop ? 'Durak geri yüklendi.' : isTransportRoute ? 'Güzergah geri yüklendi.' : 'Çizim geri yüklendi.')
        return true
      } catch (restoreError) {
        showToast('error', restoreError?.message || 'Kayıt geri yüklenemedi.')
        return false
      } finally {
        setRestoringKey(null)
      }
    },
    [onRestored, onPoiRestored, onTransportRestored, showToast],
  )

  return { items, loading, error, restoringKey, reload: load, restore }
}
