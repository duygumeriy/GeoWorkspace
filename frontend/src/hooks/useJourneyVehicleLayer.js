import { useEffect, useRef } from 'react'
import { fromLonLat } from 'ol/proj.js'
import { createJourneyVehicleLayer, syncJourneyVehicleFeature } from '../map/journeyVehicle.js'
import { vehicleCameraTarget } from '../map/transportVehicle.js'

/**
 * Kişisel yolculuk işaretçisini MEVCUT haritaya ekler ve kamerayı yönetir.
 *
 * <b>İkinci bir harita ya da paralel bir katman sistemi kurulmaz</b> ve
 * paylaşılan araç katmanına DOKUNULMAZ: bu kanca kendi vektör katmanını ekler,
 * söküldüğünde geri alır.
 *
 * <b>Kamera Faz 4 ilkesini yeniden kullanır.</b> Güvenli kutu hesabı zaten saf
 * ve sağlayıcıdan bağımsız olan <code>vehicleCameraTarget</code>'tadır; ikinci
 * bir kopya yazmak, zamanla iki farklı takip davranışı demekti. İşaretçi
 * merkezdeki güvenli bölgeden ÇIKMADIKÇA kamera oynamaz ve zum HİÇ
 * sıfırlanmaz — kullanıcının yakınlaştırmasıyla güreşilmez.
 */
export default function useJourneyVehicleLayer(map, {
  presentation = null,
  following = false,
  cameraDuration = 400,
} = {}) {
  const sourceRef = useRef(null)
  const layerRef = useRef(null)
  const animatingRef = useRef(false)

  useEffect(() => {
    if (!map) return undefined
    const { source, layer } = createJourneyVehicleLayer()
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

  /* Feature yaşam döngüsü: tek yazma yolu. Sunum null olduğunda (durduruldu,
     panel temizlendi, yetki düştü) kaynak temizlenir. */
  useEffect(() => {
    syncJourneyVehicleFeature(sourceRef.current, presentation)
    layerRef.current?.changed()
  }, [presentation])

  useEffect(() => {
    if (!map || !following || !presentation) return
    if (!Number.isFinite(presentation.longitude) || !Number.isFinite(presentation.latitude)) return

    const view = map.getView()
    const coordinate = fromLonLat([presentation.longitude, presentation.latitude])

    /* Güvenli kutu: yalnızca işaretçi merkezden yeterince uzaklaştığında
       kaydırılır. Her tick'te merkeze almak, haritayı sürekli titretirdi. */
    const target = vehicleCameraTarget({
      coordinate,
      center: view.getCenter(),
      resolution: view.getResolution(),
      size: map.getSize(),
    })

    if (!target || animatingRef.current) return

    animatingRef.current = true
    view.animate(
      // ZUM VERİLMEZ: kullanıcının yakınlaştırması korunur.
      { center: target, duration: cameraDuration },
      () => { animatingRef.current = false },
    )
  }, [map, following, presentation, cameraDuration])
}
