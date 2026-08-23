import { useCallback, useEffect, useRef, useState } from 'react'
import Draw from 'ol/interaction/Draw.js'
import { createPoiPendingLayer, toLonLat4326 } from '../map/poi.js'

/**
 * POI yerleştirme: tek noktalık geçici bir Draw etkileşimi.
 *
 * <b>Mod burada SAHİPLENİLMEZ.</b> `active`, ölçüm ve envanter analizinde
 * olduğu gibi `useWorkspaceMode`'dan gelir; etkileşim yalnızca o değerden
 * kurulur. Bu, POI yerleştirmenin çizim, seçim, ölçüm, analiz ve geometri
 * düzenleme etkileşimleriyle aynı anda canlı olamamasını yapısal olarak
 * garanti eder — hiçbir çağrı yerinin bunu ayrıca hatırlaması gerekmez.
 *
 * <b>Nokta hiçbir zaman çizim kaynağına girmez.</b> Kendi geçici kaynağı
 * vardır ve <c>/api/drawings/*</c> uçlarına ASLA gönderilmez; POI ile çizim
 * ayrı alan nesneleridir.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ active: boolean, onPlaced: (point: {longitude: number, latitude: number}) => void }} deps
 */
export default function usePoiPlacement(map, { active, onPlaced }) {
  const sourceRef = useRef(null)

  /** Yerleştirilmiş ama henüz kaydedilmemiş konum (EPSG:4326). */
  const [pending, setPending] = useState(null)

  /* Callback ref üzerinden okunur: kimliği değiştiğinde Draw etkileşiminin
     yeniden kurulması gerekmez — kurulup yıkılması, kullanıcı tam tıklarken
     etkileşimi kaybetmek demek olabilirdi. */
  const onPlacedRef = useRef(onPlaced)
  onPlacedRef.current = onPlaced

  /* --- Geçici katman ------------------------------------------------------- */

  useEffect(() => {
    if (!map) return undefined

    const { source, layer } = createPoiPendingLayer()
    sourceRef.current = source
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
    }
  }, [map])

  /* --- Yerleştirme etkileşimi ---------------------------------------------- */

  useEffect(() => {
    if (!map || !active) return undefined

    const source = sourceRef.current
    if (!source) return undefined

    const draw = new Draw({ source, type: 'Point' })
    map.addInteraction(draw)

    draw.on('drawstart', () => {
      /* Aynı anda tek bekleyen nokta: yenisi konduğunda eskisi gider, böylece
         form hiçbir zaman haritada olmayan bir konumu anlatmaz. */
      source.clear()
    })

    draw.on('drawend', (event) => {
      /* Gerçek 3857 → 4326 dönüşümü; Mercator matematiği elle yazılmaz.
         Değer yuvarlanmaz — yuvarlama yalnızca ekranda gösterim içindir. */
      const point = toLonLat4326(event.feature.getGeometry().getCoordinates())
      setPending(point)
      onPlacedRef.current?.(point)
    })

    const handleKeyDown = (keyEvent) => {
      if (keyEvent.key === 'Escape') draw.abortDrawing()
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      map.removeInteraction(draw)
      draw.dispose()
    }
  }, [map, active])

  /** Bekleyen noktayı ve işaretini temizler. */
  const clearPending = useCallback(() => {
    sourceRef.current?.clear()
    setPending(null)
  }, [])

  /* Mod kapandığında (araç kapatıldı, başka bir araç açıldı, yetki alındı)
     bekleyen işaret de gider: haritada, artık hiçbir formun anlatmadığı bir
     nokta kalmamalıdır. */
  useEffect(() => {
    if (!active) clearPending()
  }, [active, clearPending])

  return { pending, clearPending }
}
