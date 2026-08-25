import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ImageLayer from 'ol/layer/Image.js'
import ImageStatic from 'ol/source/ImageStatic.js'
import { fetchPoiPresentationImage } from '../services/api.js'
import {
  POI_PRESENTATION_Z_INDEX,
  PRESENTATION_REQUEST_DEBOUNCE_MS,
  presentationBbox,
  presentationImageSize,
} from '../map/mapPresentation.js'

/**
 * POI envanterinin WMS yarısı: geçerli görüntü penceresi için kimlik
 * doğrulamalı tek bir raster.
 *
 * ## Neden çizim kancasının kopyası değil
 *
 * <see cref="useMapPresentationLayer"/> ÜÇ katmanı, tür başına görünürlüğü ve
 * "kaydedilmemiş düzenleme varken rasteri askıya al" durumunu yönetir. POI'de
 * bunların hiçbiri yoktur: tek katman, tek yetki, askıya alma yok (POI
 * düzenlemesi zaten AYRI bir taslak katmanında yürür ve kalıcı kaydı
 * kıpırdatmaz). O kancayı POI'ye genellemek, kullanılmayan üç kavramı da
 * beraberinde getirir ve iki çağıranı birbirine bağlardı.
 *
 * Paylaşılan şey MANTIK değil SÖZLEŞMEdir: bbox/boyut hesabı, debounce ve
 * z-index `map/mapPresentation.js` içinden okunur, dolayısıyla iki raster
 * backend'in aynı sınırlarını kullanır.
 *
 * ## Vektör katmanı KALIR
 *
 * Raster yalnızca GÖRÜNÜMÜ devralır. POI kimliği, tıklama, seçim ve bilgi
 * paneli hâlâ vektör feature'larına aittir — bu fazda GetFeatureInfo yoktur.
 * `active` bu yüzden dışarıya bildirilir: vektör stili onu okuyup kalıcı
 * işaretini çizmeyi bırakır (ama isabet denetimi için şeffaf hâlde kalır),
 * böylece aynı POI iki kez çizilmez.
 *
 * ## Yaşam döngüsü
 *
 * Kanıtlanmış çizim/ısı haritası döngüsünün aynısı: `moveend`/yeniden boyutta
 * debounce, geçersizleşen istek iptal, en son isteğin kazanması ve her Blob
 * URL'inin yerine yenisi geldiğinde ya da katman kalktığında serbest
 * bırakılması.
 *
 * ## Neden PİKSEL YOĞUNLUĞU bildirilir
 *
 * Görüntü, CSS boyutundan daha yoğun istenir (Retina'da iki katı) ve coğrafi
 * kapsama raptedilip CSS boyutuna küçültülür. SLD'deki her ÖLÇÜ pikseldir:
 * düzeltme olmadan 30 piksellik bir rozet ekranda 15 CSS pikseli, 12 piksellik
 * etiket ise 6 CSS pikseli olarak görünür. Üstelik GeoServer ölçek paydasını da
 * görüntü çözünürlüğünden hesapladığı için işaretçi bantları bir yakınlık
 * kademesi kayardı.
 *
 * Bu yüzden ÖLÇÜLEN yoğunluk sunucuya bildirilir ve sunucu çizim DPI'ını ondan
 * türetir; ikisi birden — boyut ve ölçek — düzeltilir. Tarayıcı yine hiçbir WMS
 * parametresi belirlemez.
 *
 * ## Neden ÇÖZÜNÜRLÜK de izlenir
 *
 * Raster bir <c>ImageStatic</c>'tir ve coğrafi bir kapsama RAPTEDİLMİŞTİR.
 * Ölçek değiştiğinde OpenLayers o bitmap'i geometrik olarak yeniden
 * boyutlandırır — çizim rasterinde bu DOĞRUDUR (bir poligon zaten haritayla
 * birlikte büyür), ama POI'de YANLIŞTIR: simge ve etiket ekran uzayında sabit
 * boyutlu sembollerdir. 30 piksellik bir işaret, yakınlaşma animasyonu boyunca
 * önce 15 piksele düşmüş gibi görünür, sonra yeni görüntü gelince 30'a
 * "zıplar". Kullanıcının gördüğü titreme/küçülme tam olarak budur.
 *
 * Çare SLD'de DEĞİLDİR — yerleşmiş ölçeklerde 20/24/30 piksel zaten doğrudur.
 * Görüntü, yalnızca ÜRETİLDİĞİ çözünürlükte gösterilir; ölçek değiştiği anda
 * çekilir ve POI'ler kendi vektör işaretleriyle çizilmeye devam eder (Faz
 * 4'ten beri var olan yedek). Yerleşen görünüm için yeni görüntü gelince
 * raster geri döner ve vektörler yeniden yalnızca-etkileşim moduna geçer.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ permitted: boolean, version?: number,
 *           activeRef?: { current: boolean },
 *           onChange?: ((isActive: boolean) => void)|null }} options
 *   `version` her BAŞARILI POI mutasyonundan sonra artar; rasterin
 *   tazelenmesini tetikleyen tek şey budur — istek gönderilmiş ama yazılmamış
 *   bir değişiklik için görüntü yenilenmez.
 */
export default function usePoiPresentationLayer(
  map,
  { permitted, version = 0, activeRef = null, onChange = null },
) {
  const [active, setActive] = useState(false)
  const [error, setError] = useState(null)

  /* Yükleme sırasında okunur: değişen bir handler rasteri yeniden kurmamalı —
     yeniden kurmak, tam gelmek üzere olan bir isteği iptal eder ve haritayı
     titretirdi. */
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const versionRef = useRef(version)
  versionRef.current = version

  /** Katmanın canlı durumu; effect'lerden erişilebilir. */
  const entryRef = useRef(null)

  const setLayerActive = useCallback(
    (value) => {
      /* Yalnızca DEĞİŞİMDE haber verilir. Vektör stil fonksiyonu React dışında
         çalışır ve cevabın değiştiğini ancak bu bildirimle öğrenir; ama cevap
         değişmediyse bildirmek, yakınlaşma animasyonu boyunca kare başına bir
         yeniden çizim istemek olurdu. */
      const changed = activeRef ? activeRef.current !== value : true
      if (activeRef) activeRef.current = value
      setActive((current) => (current === value ? current : value))
      if (changed) onChangeRef.current?.(value)
    },
    [activeRef],
  )

  /* Tazeleme, katmanı yeniden kurmak DEĞİLDİR: katmanı kaldırıp yeniden
     eklemek elindeki görüntüyü de atar ve haritayı bir istek boyunca boş
     bırakırdı. Yükleyici bu yüzden bir ref üzerinden yayımlanır. */
  const scheduleLoadRef = useRef(null)

  /**
   * Rasterin ekranda olup olmadığına karar veren TEK yüklem.
   *
   * Görüntü ancak GEÇERLİ sürüm için üretilmişse gösterilir: aksi hâlde
   * taşınmış bir POI, kalıcı görüntüde eski konumunda hayalet olarak kalırdı.
   */
  const syncLayer = useCallback(() => {
    const entry = entryRef.current
    if (!entry) return

    /* Görüntü, ÜRETİLDİĞİ çözünürlükte gösterilir. Ölçek değiştiği anda
       yüklem düşer, raster çekilir ve POI'ler vektör işaretlerine döner;
       böylece hiçbir zaman geometrik olarak ölçeklenmiş bir simge/etiket
       görülmez. Kaydırmada (pan) çözünürlük değişmez, dolayısıyla raster
       yerinde kalır — sorun yalnızca ölçek değişimindedir. */
    const resolution = map?.getView()?.getResolution() ?? null

    const shown =
      !entry.failed
      && entry.imageVersion !== null
      && entry.imageVersion === versionRef.current
      && entry.imageResolution !== null
      && resolution !== null
      && entry.imageResolution === resolution

    entry.layer.setVisible(shown)
    setLayerActive(shown)
  }, [map, setLayerActive])

  useEffect(() => {
    if (!map || !permitted) {
      /* Yetki yoksa katman HİÇ kurulmaz ve uç HİÇ çağrılmaz: garanti 403
         alacak istekleri döngüye sokmanın anlamı yok. Vektörler kendi normal
         stillerine döner, dolayısıyla harita boş kalmaz. */
      entryRef.current = null
      setLayerActive(false)
      setError(null)
      return undefined
    }

    let disposed = false
    let timer = null

    const layer = new ImageLayer({
      className: 'poi-presentation-layer',
      zIndex: POI_PRESENTATION_Z_INDEX,
      // Geçerli sürüm için bir görüntü gelene kadar hiçbir şey çizilmez.
      visible: false,
    })
    layer.set('name', 'poi-presentation')
    map.addLayer(layer)

    const entry = {
      layer,
      controller: null,
      requestNumber: 0,
      blobUrl: null,
      /** Görüntünün üretildiği `version`; null = henüz görüntü yok. */
      imageVersion: null,
      /** Görüntünün üretildiği görünüm çözünürlüğü; ölçek eşleşmesi buna bakar. */
      imageResolution: null,
      failed: false,
    }
    entryRef.current = entry

    const load = async () => {
      const size = map.getSize()
      const view = map.getView()
      if (!size || size[0] <= 0 || size[1] <= 0 || view.getProjection().getCode() !== 'EPSG:3857') return

      const extent = view.calculateExtent(size)
      const bbox = presentationBbox(extent)
      if (!bbox) return

      setError(null)
      const requestSize = presentationImageSize(size, window.devicePixelRatio)
      const requestedVersion = versionRef.current
      const requestedResolution = view.getResolution()

      entry.controller?.abort()
      entry.controller = new AbortController()
      const thisRequest = ++entry.requestNumber

      try {
        const blob = await fetchPoiPresentationImage({
          bbox,
          /* `requestSize` genişlik, yükseklik VE ölçülen yoğunluğu birlikte
             taşır; üçü tek bir hesaptan çıkar ve ayrışamaz. */
          ...requestSize,
          signal: entry.controller.signal,
        })
        if (disposed || entry.controller.signal.aborted || thisRequest !== entry.requestNumber) return

        const nextBlobUrl = URL.createObjectURL(blob)
        entry.layer.setSource(
          new ImageStatic({
            url: nextBlobUrl,
            imageExtent: [...extent],
            projection: view.getProjection(),
            interpolate: true,
          }),
        )

        const previousBlobUrl = entry.blobUrl
        entry.blobUrl = nextBlobUrl
        map.render()
        if (previousBlobUrl) URL.revokeObjectURL(previousBlobUrl)

        entry.imageVersion = requestedVersion
        entry.imageResolution = requestedResolution
        entry.failed = false
        syncLayer()
      } catch (loadError) {
        if (loadError?.name === 'AbortError' || disposed || thisRequest !== entry.requestNumber) return
        /* Görünür başarısızlık, boş harita DEĞİL: raster başarısız işaretlenir,
           ekrandan kalkar ve POI'ler kendi vektör işaretleriyle çizilmeye
           devam eder. Bir render servisi düştü diye envanter kaybolmaz. */
        entry.failed = true
        syncLayer()
        setError('POI görünümü şu anda yenilenemedi.')
      }
    }

    const scheduleLoad = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, PRESENTATION_REQUEST_DEBOUNCE_MS)
    }

    /* Ölçek değişimi yalnızca GÖRÜNÜRLÜĞÜ değerlendirir, istek AÇMAZ: istek
       yerleşmiş görünüm için `moveend`'de ve mevcut debounce ile gider,
       dolayısıyla animasyon kare başına backend'i dövmez. */
    const onResolutionChange = () => syncLayer()

    scheduleLoadRef.current = scheduleLoad
    map.getView().on('change:resolution', onResolutionChange)
    map.on('moveend', scheduleLoad)
    map.on('change:size', scheduleLoad)
    scheduleLoad()

    return () => {
      disposed = true
      window.clearTimeout(timer)
      map.getView().un('change:resolution', onResolutionChange)
      map.un('moveend', scheduleLoad)
      map.un('change:size', scheduleLoad)
      if (scheduleLoadRef.current === scheduleLoad) scheduleLoadRef.current = null

      entry.requestNumber += 1
      entry.controller?.abort()
      map.removeLayer(entry.layer)
      entry.layer.setSource(null)
      entry.layer.dispose()
      if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl)
      entry.blobUrl = null
      if (entryRef.current === entry) entryRef.current = null
      setLayerActive(false)
    }
  }, [map, permitted, setLayerActive, syncLayer])

  /* Her BAŞARILI POI mutasyonu görüntüyü geçersizleştirir. Gizleme hemen olur
     ki silinmiş ya da taşınmış bir POI hayalet olarak kalmasın; yerine geleni
     istemek hemen ardından gelir. İlk sürüm tetikleyici DEĞİLDİR — katmanın
     kurulumu zaten bir kez yükler. */
  const lastVersionRef = useRef(version)
  useEffect(() => {
    if (lastVersionRef.current === version) return
    lastVersionRef.current = version
    syncLayer()
    scheduleLoadRef.current?.()
  }, [version, syncLayer])

  return useMemo(() => ({ active, error }), [active, error])
}
