import { useEffect, useRef } from 'react'
import {
  createTransportVehicleLayer,
  findTransportVehicleAtPixel,
  syncTransportVehicleFeature,
  vehicleCameraTarget,
} from '../map/transportVehicle.js'

/**
 * Canlı aracı MEVCUT haritaya ekler ve kamerayı yönetir.
 *
 * <b>İkinci bir harita ya da paralel bir ulaşım katman sistemi kurulmaz:</b>
 * kanca, <code>useTransportLayer</code> ile aynı <code>map</code> örneğine tek
 * bir vektör katmanı ekler ve söküldüğünde geri alır. Kararların tamamı saf
 * <code>transportVehicle.js</code> fonksiyonlarındadır; burada yalnızca
 * OpenLayers yan etkileri var.
 */
export default function useTransportVehicleLayer(map, {
  presentation = null,
  cameraDuration = 400,
  onVehicleClick = null,
} = {}) {
  const sourceRef = useRef(null)
  const layerRef = useRef(null)
  const followedSimulationRef = useRef(null)
  const animatingRef = useRef(false)

  useEffect(() => {
    if (!map) return undefined
    const { source, layer } = createTransportVehicleLayer()
    sourceRef.current = source
    layerRef.current = layer
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
      layerRef.current = null
      followedSimulationRef.current = null
    }
  }, [map])

  /* Feature yaşam döngüsü: tek kural, tek yazma yolu. Sunum null olduğunda
     (takip bırakıldı, rota değişti, sahiplik düştü) kaynak temizlenir —
     hayalet araç kalmaz. */
  useEffect(() => {
    syncTransportVehicleFeature(sourceRef.current, presentation)
    layerRef.current?.changed()
  }, [presentation])

  useEffect(() => {
    if (!map || !presentation?.followCamera) {
      // Takip bırakıldığında kamera ANINDA serbest kalır.
      followedSimulationRef.current = null
      return
    }

    const view = map.getView()
    const feature = sourceRef.current?.getFeatures()[0]
    const coordinate = feature?.getGeometry?.()?.getCoordinates?.()
    if (!coordinate) return

    const firstFrame = followedSimulationRef.current !== presentation.simulationId
    followedSimulationRef.current = presentation.simulationId

    /* İlk karede araç merkeze alınır (kullanıcı takibe yeni başladı);
       sonrasında yalnızca güvenli kutunun DIŞINA çıktığında kaydırılır.
       Her tick'te merkeze almak sürekli bir animasyon kuyruğu ve titreme
       üretirdi. Yakınlaştırmaya HİÇ dokunulmaz. */
    const target = firstFrame
      ? coordinate
      : vehicleCameraTarget({
        coordinate,
        center: view.getCenter(),
        resolution: view.getResolution(),
        size: map.getSize(),
      })

    if (!target || animatingRef.current) return

    animatingRef.current = true
    view.animate({ center: target, duration: cameraDuration }, () => {
      animatingRef.current = false
    })
  }, [map, presentation, cameraDuration])

  /* İsteğe bağlı isabet denetimi: yalnızca bir işleyici verilirse kaydedilir,
     böylece yönetim haritasının KENDİ mevcut tıklama dalı olduğu gibi kalır ve
     hiçbir ekranda ikinci bir dinleyici oluşmaz. */
  useEffect(() => {
    if (!map || typeof onVehicleClick !== 'function') return undefined
    const handleClick = (event) => {
      const feature = findTransportVehicleAtPixel(map, event.pixel)
      if (feature) onVehicleClick(feature.get('transportVehicle') ?? null, feature)
    }
    map.on('singleclick', handleClick)
    return () => map.un('singleclick', handleClick)
  }, [map, onVehicleClick])

  return { source: sourceRef, layer: layerRef }
}
