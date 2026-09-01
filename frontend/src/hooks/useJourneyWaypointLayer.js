import { useEffect, useRef } from 'react'
import {
  createJourneyWaypointLayer,
  syncJourneyWaypointFeatures,
} from '../map/journeyWaypoints.js'

/**
 * Yolculuğun geçiş noktalarını MEVCUT haritaya çizer.
 *
 * <b>Kendi katmanı vardır</b> ve mevcut POI/durak katmanlarına DOKUNMAZ: bir
 * yolculuğun noktalarını o katmanlara yazmak, kalıcı kayıtlarla geçici bir
 * planı aynı kaynakta karıştırmak olurdu. İkinci bir harita da kurulmaz.
 *
 * <b>Kamera OYNATILMAZ.</b> Noktalar yalnızca çizilir; uyum ve takip
 * kararlarının sahibi önizleme/araç kancalarıdır.
 */
export default function useJourneyWaypointLayer(map, { waypoints = null } = {}) {
  const sourceRef = useRef(null)
  const layerRef = useRef(null)

  useEffect(() => {
    if (!map) return undefined
    const { source, layer } = createJourneyWaypointLayer()
    sourceRef.current = source
    layerRef.current = layer
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
      layerRef.current = null
    }
  }, [map])

  /* Tek yazma yolu. `null` geçmek (bırakma, yetki düşmesi, planlayıcıya dönüş)
     katmanı boşaltır — hayalet nokta kalmaz. */
  useEffect(() => {
    syncJourneyWaypointFeatures(sourceRef.current, waypoints)
    layerRef.current?.changed()
  }, [waypoints])
}
