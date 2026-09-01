import { useEffect, useRef } from 'react'
import { fromLonLat } from 'ol/proj.js'
import {
  createJourneyCameraLock,
  createJourneyVehicleLayer,
  findJourneyVehicleAtPixel,
  journeyCameraOwner,
  syncJourneyVehicleFeature,
} from '../map/journeyVehicle.js'
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
  /** İşaretçiye tıklandığında çağrılır; verilmezse hiç dinleyici kurulmaz. */
  onVehicleClick = null,
  /**
   * Tıklama/balon sahipliği.
   *
   * Yalnızca İSABET DENETİMİNİ kapatır: katman, çizim, canlı güncellemeler ve
   * takip kamerası bu bayraktan HİÇ etkilenmez. Yolculuk noktası seçimi
   * silahlıyken tıklamanın sahibi odur (Faz 5E-B · Dilim 1).
   */
  clickEnabled = true,
} = {}) {
  const sourceRef = useRef(null)
  const layerRef = useRef(null)

  /* Kamera kilidi + sahiplik kuşağı. Tek bir bayrak yetmez: OpenLayers yeni
     bir animasyon başlatıldığında ESKİSİNİN geri çağrısını da tetikler ve o
     geç geri çağrı, yeni sahibin kilidini açardı. Kural saf modüldedir. */
  const cameraLockRef = useRef(null)
  if (cameraLockRef.current === null) cameraLockRef.current = createJourneyCameraLock()

  /** Kameranın şu an SAHİBİ olan çalıştırma; sahip yoksa null. */
  const followedSimulationRef = useRef(null)

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
      /* Sökülmede uçan animasyonun geri çağrısı ARTIK GELMEYEBİLİR; kilidi
         burada bırakmak, aynı harita yeniden bağlandığında takibi kalıcı
         olarak kilitlerdi. Kuşak da atlar: yoldaki geri çağrı yeni kilide
         dokunamaz. */
      cameraLockRef.current.invalidate()
      followedSimulationRef.current = null
    }
  }, [map])

  /* Feature yaşam döngüsü: tek yazma yolu. Sunum null olduğunda (durduruldu,
     panel temizlendi, yetki düştü) kaynak temizlenir. */
  useEffect(() => {
    syncJourneyVehicleFeature(sourceRef.current, presentation)
    layerRef.current?.changed()
  }, [presentation])

  /* Kamera SAHİPLİĞİNİN yaşam döngüsü — animasyon kararından ÖNCE gelir ki
     aynı commit'te devralan taraf temiz bir bayrakla başlasın.

     Sahiplik üç şekilde biter ve üçünde de uçan animasyon artık bizim
     değildir: takip kapatıldı, araç kayboldu (durduruldu/bırakıldı/yetki
     düştü) ya da başka bir çalıştırma devraldı. Aynı yolculuk takip
     edilmeye devam ederken bayrağa DOKUNULMAZ — kısma (throttle) davranışı
     korunur, yoksa her tick yeni bir animasyon kuyruğu doğardı. */
  useEffect(() => {
    const owner = journeyCameraOwner({ following, presentation })
    if (owner === followedSimulationRef.current) return

    followedSimulationRef.current = owner
    /* Kuşak atlar: bu andan sonra gelen ESKİ geri çağrılar kilide dokunamaz. */
    cameraLockRef.current.invalidate()
  }, [following, presentation])

  /* İsteğe bağlı isabet denetimi — paylaşılan araçtakiyle AYNI sözleşme:
     yalnızca bir işleyici verildiğinde kaydedilir, böylece hiçbir ekranda
     ikinci bir dinleyici oluşmaz. */
  useEffect(() => {
    if (!map || !clickEnabled || typeof onVehicleClick !== 'function') return undefined

    const handleClick = (event) => {
      const feature = findJourneyVehicleAtPixel(map, event.pixel)
      if (feature) onVehicleClick(feature.get('simulationId') ?? null, feature)
    }

    map.on('singleclick', handleClick)
    return () => map.un('singleclick', handleClick)
  }, [map, onVehicleClick, clickEnabled])

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

    const lock = cameraLockRef.current
    if (!target || lock.isAnimating) return

    // Jeton, geri çağrının HANGİ sahipliğe ait olduğunu taşır.
    const token = lock.begin()
    view.animate(
      // ZUM VERİLMEZ: kullanıcının yakınlaştırması korunur.
      { center: target, duration: cameraDuration },
      /* Kilit yalnızca KENDİ kuşağındaysa bırakılır; sahiplik değiştiyse bu
         geri çağrı sessizce yutulur. */
      () => { lock.release(token) },
    )
  }, [map, following, presentation, cameraDuration])
}
