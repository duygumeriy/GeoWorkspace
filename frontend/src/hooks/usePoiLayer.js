import { useCallback, useEffect, useRef, useState } from 'react'
import { createPoiLayer, poiToFeature } from '../map/poi.js'
import { fetchPois, readApiError } from '../services/api.js'

/**
 * Kalıcı POI katmanı: tek kaynak, tek katman, yetkiye bağlı yaşam döngüsü.
 *
 * <b>Katman bir kez kurulur.</b> Harita örneği değişmedikçe kaynak da katman da
 * yeniden yaratılmaz; veri geldiğinde yalnızca kaynağın içeriği değişir. POI
 * başına katman açmak (ya da her render'da katmanı yeniden kurmak) OpenLayers
 * nesnelerini çoğaltır ve dinleyici sızdırırdı.
 *
 * <b>Yetki CANLIDIR.</b> `permitted` false olduğu anda kaynak boşaltılır: veri
 * bir kez çekilmiş olması, yetkisi alınmış birinin onu görmeye devam etmesi
 * için sebep değildir. Aynı şekilde yetki yokken uç HİÇ çağrılmaz — garanti
 * 403 alacak bir istek açmanın anlamı yok.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ permitted: boolean, selectedId: number|null, showToast: Function }} deps
 */
export default function usePoiLayer(map, { permitted, selectedId, showToast }) {
  const sourceRef = useRef(null)
  const [loading, setLoading] = useState(false)

  /* Seçili POI stil fonksiyonundan okunur. Ref üzerinden okunması, seçim her
     değiştiğinde katmanı yeniden kurmayı gereksiz kılar. */
  const selectedIdRef = useRef(selectedId)
  selectedIdRef.current = selectedId

  /* Yalnızca EN YENİ isteğin sonucu yazılabilir: yetki değişimi ya da bir
     yenileme sırasında gelen eski cevap kaynağı geri saramaz. */
  const requestIdRef = useRef(0)

  /* --- Katman ------------------------------------------------------------- */

  useEffect(() => {
    if (!map) return undefined

    const { source, layer } = createPoiLayer(() => selectedIdRef.current)
    sourceRef.current = source
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
    }
  }, [map])

  /* Seçim değiştiğinde yalnızca yeniden çizim istenir; feature'lara dokunulmaz. */
  useEffect(() => {
    sourceRef.current?.changed()
  }, [selectedId])

  /* --- Veri --------------------------------------------------------------- */

  const load = useCallback(async () => {
    if (!permitted) return

    requestIdRef.current += 1
    const requestId = requestIdRef.current
    setLoading(true)

    try {
      const res = await fetchPois()
      if (!res.ok) throw new Error(await readApiError(res, 'POI kayıtları yüklenemedi.'))

      const records = await res.json()
      if (requestId !== requestIdRef.current) return

      const source = sourceRef.current
      if (!source) return

      /* Kaynak tek seferde değiştirilir: önce boşaltıp tek tek eklemek, her
         eklemede bir render tetikler ve arada boş bir kare gösterirdi. */
      source.clear()
      source.addFeatures(records.map(poiToFeature).filter(Boolean))
    } catch (error) {
      if (requestId !== requestIdRef.current) return
      /* Hata haritayı DÜŞÜRMEZ: diğer katmanlar çalışmaya devam eder ve
         kaynak son geçerli hâlinde kalır. Otomatik yeniden deneme yoktur —
         sonsuz döngüye dönüşebilirdi. */
      showToast?.('error', error.message || 'POI kayıtları yüklenemedi.')
    } finally {
      if (requestId === requestIdRef.current) setLoading(false)
    }
  }, [permitted, showToast])

  /* Tek tetikleyici: yetkinin varlığı. Her render'da değil, `permitted`
     değiştiğinde çalışır — sürekli yoklama yoktur. */
  useEffect(() => {
    if (permitted) {
      load()
      return
    }

    // Yetki yoksa (ya da alındıysa) uçan istek geçersizleşir ve kaynak boşalır.
    requestIdRef.current += 1
    sourceRef.current?.clear()
    setLoading(false)
  }, [permitted, load])

  /**
   * Yeni oluşturulan POI'yi AYNI eşlemeyle kaynağa ekler.
   *
   * Tam bir yeniden okuma yerine tek kayıt eklenir: sunucu yanıtı zaten
   * kaydın kanonik hâlidir ve ikinci bir GET, az önce yazılanı yeniden
   * indirmekten ibaret olurdu. Eşleme fonksiyonu listeyle aynıdır, dolayısıyla
   * iki yol arasında biçim farkı doğamaz.
   */
  const addPoi = useCallback((poi) => {
    const feature = poiToFeature(poi)
    if (feature) sourceRef.current?.addFeature(feature)
  }, [])

  return { loading, reload: load, addPoi }
}
