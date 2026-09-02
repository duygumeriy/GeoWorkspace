import { useEffect, useMemo, useRef } from 'react'
import {
  createTransportVehicleLayer,
  findTransportVehicleAtPixel,
  syncTransportVehicleFeatures,
  vehicleCameraTarget,
  vehicleFeatureId,
} from '../map/transportVehicle.js'

/**
 * Canlı araçları MEVCUT haritaya ekler ve kamerayı yönetir.
 *
 * <b>İkinci bir harita ya da paralel bir ulaşım katman sistemi kurulmaz:</b>
 * kanca, <code>useTransportLayer</code> ile aynı <code>map</code> örneğine tek
 * bir vektör katmanı ekler ve söküldüğünde geri alır. Kararların tamamı saf
 * <code>transportVehicle.js</code> fonksiyonlarındadır; burada yalnızca
 * OpenLayers yan etkileri var.
 *
 * <b>Araç ÇOĞULDUR (Faz 4A).</b> Kullanıcı aynı anda birçok hattı izleyebilir;
 * kanca "tek bir global araç" varsayımını taşımaz. Feature yaşam döngüsü
 * ANAHTARLI uzlaştırmayla yürür (rota + çalıştırma): eklenen eklenir,
 * güncellenen taşınır, istenmeyen kaldırılır — biriktirme de her karede
 * yeniden yaratma da yoktur.
 *
 * <b>Kamera EN FAZLA bir araçtadır.</b> Görünürlük ile kamera sahipliği ayrı
 * sorulardır: <code>followCamera</code> taşımayan araçlar tam olarak aynı
 * canlılıkla çizilmeye devam eder.
 */
export default function useTransportVehicleLayer(map, {
  presentations = [],
  cameraDuration = 400,
  onVehicleClick = null,
  /**
   * Tıklama/balon sahipliği.
   *
   * Yalnızca İSABET DENETİMİNİ kapatır: katman, araçların çizimi, canlı
   * güncellemeler ve takip kamerası bu bayraktan HİÇ etkilenmez. Harita
   * tıklamasının sahibi başka bir kipken (yolculuk noktası seçimi) araçları
   * gizlemek ya da akışlarını durdurmak, tıklamayı susturmaktan tamamen farklı
   * bir şey olurdu.
   */
  clickEnabled = true,
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

  /* Feature yaşam döngüsü: tek kural, tek yazma yolu. Liste boşaldığında
     (izleme temizlendi, hepsi terminal oldu) kaynak da boşalır — hayalet araç
     kalmaz. */
  useEffect(() => {
    syncTransportVehicleFeatures(sourceRef.current, presentations)
    layerRef.current?.changed()
  }, [presentations])

  /* KAMERA sahibi EN FAZLA bir araçtır. Diğer araçların varlığı, hareketi ve
     canlılığı bu seçimden HİÇ etkilenmez. */
  const followed = useMemo(
    () => (Array.isArray(presentations) ? presentations : [])
      .find((presentation) => presentation?.followCamera) ?? null,
    [presentations],
  )

  useEffect(() => {
    if (!map || !followed) {
      // Takip bırakıldığında kamera ANINDA serbest kalır; araçlar kalır.
      followedSimulationRef.current = null
      return
    }

    const view = map.getView()
    const feature = sourceRef.current?.getFeatureById(
      vehicleFeatureId(followed.routeId, followed.simulationId),
    )
    const coordinate = feature?.getGeometry?.()?.getCoordinates?.()
    if (!coordinate) return

    const firstFrame = followedSimulationRef.current !== followed.simulationId
    followedSimulationRef.current = followed.simulationId

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
  }, [map, followed, cameraDuration])

  /* İsteğe bağlı isabet denetimi: yalnızca bir işleyici verilirse kaydedilir,
     böylece yönetim haritasının KENDİ mevcut tıklama dalı olduğu gibi kalır ve
     hiçbir ekranda ikinci bir dinleyici oluşmaz.

     Tıklanan feature'ın KENDİ sunumu verilir — küresel bir "seçili araç"
     DEĞİL. Birden fazla işaretçi varken küresel bir model, hangisine
     tıklanırsa tıklansın aynı balonu açardı. */
  useEffect(() => {
    if (!map || !clickEnabled || typeof onVehicleClick !== 'function') return undefined
    const handleClick = (event) => {
      const feature = findTransportVehicleAtPixel(map, event.pixel)
      if (feature) onVehicleClick(feature.get('transportVehicle') ?? null, feature)
    }
    map.on('singleclick', handleClick)
    return () => map.un('singleclick', handleClick)
  }, [map, onVehicleClick, clickEnabled])

  return { source: sourceRef, layer: layerRef }
}
