import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import ImageLayer from 'ol/layer/Image'
import ImageStatic from 'ol/source/ImageStatic'
import Fill from 'ol/style/Fill'
import Style from 'ol/style/Style'
import { getVectorContext } from 'ol/render.js'
import { fetchLocationAnalysisImage } from '../services/api.js'
import { wkt4326ToFeature } from '../map/drawing.js'
import {
  DATA_PROJECTION,
  LOCATION_ANALYSIS_DEFAULT_OPACITY,
  LOCATION_ANALYSIS_RASTER_Z_INDEX,
  analysisAreaEnvelope,
  analysisAreaImageSize,
  heatmapLodForZoom,
  heatmapLodSpec,
  serializeBbox,
} from '../map/locationAnalysis.js'

const GENERIC_ERROR = 'Isı haritası şu anda üretilemedi. Yeniden deneyin.'

const messageFor = (error) => {
  if (error?.status === 403) return 'Bu analizi görüntüleme yetkiniz yok.'
  if (error?.status === 502) return 'Harita sunucusuna ulaşılamadı. Kısa süre sonra yeniden deneyin.'
  if (error?.status === 504) return 'Isı haritası zaman aşımına uğradı. Daha dar bir alan deneyin.'
  if (error?.status === 400) return error.message || 'Analiz parametreleri geçersiz.'
  return GENERIC_ERROR
}

/** Maskeyi çizerken kullanılan dolgu; rengin bir önemi yoktur, yalnızca ALFA sayar. */
const MASK_STYLE = new Style({ fill: new Fill({ color: '#000' }) })

/**
 * Ağırlıklı ısı haritası rasterinin yaşam döngüsü.
 *
 * <b>Raster GÖRÜNÜME değil ANALİZE aittir.</b> Her görüntü gönderilen
 * analizin aynı zarfını kullanır. Kaydırma ve aynı LOD içindeki zoom yeni
 * istek açmaz; yalnızca dört deterministik LOD sınırından biri geçildiğinde
 * farklı çözünürlük/çekirdek için yeniden istenir. Görünüme bağlı zarf
 * üretimi üç şeyi birden
 * bozuyordu: `vec:Heatmap` her görüntüyü kendi en yükseğine göre
 * normalleştirdiği için 1.0'ın anlamı her harekette değişiyor, sorulmamış bir
 * soru için sürekli istek açılıyor ve geç gelen bir yanıtın yanlış kapsama
 * oturması sürekli mümkün kalıyordu.
 *
 * <b>Yalnızca GÖNDERİLMİŞ analiz çizilir.</b> `analysis` propu formun canlı
 * hâli değil, "ANALİZİ BAŞLAT" anındaki anlık görüntüsüdür.
 */
export default function useLocationAnalysisLayer(map, { analysis, permitted, criterionSlug }) {
  const [opacity, setOpacityState] = useState(LOCATION_ANALYSIS_DEFAULT_OPACITY)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [hasImage, setHasImage] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [lod, setLod] = useState(null)
  const layerRef = useRef(null)
  const opacityRef = useRef(LOCATION_ANALYSIS_DEFAULT_OPACITY)

  const setOpacity = useCallback((next) => {
    const value = Math.min(1, Math.max(0, Number(next)))
    opacityRef.current = value
    setOpacityState(value)
    layerRef.current?.setOpacity(value)
  }, [])

  const refresh = useCallback(() => setRefreshVersion((value) => value + 1), [])

  /* Yalnızca BANT değişimi state değiştirir. Kaydırma resolution olayı
     üretmez; aynı bant içindeki zoom ise aynı string'i set eder ve React yeni
     raster etkisi başlatmaz. */
  useLayoutEffect(() => {
    if (!map) {
      setLod(null)
      return undefined
    }

    const view = map.getView()
    const syncLod = () => setLod(heatmapLodForZoom(view.getZoom()))
    syncLod()
    view.on('change:resolution', syncLod)

    return () => view.un('change:resolution', syncLod)
  }, [map])

  /* Anlık görüntünün kimliği: alan ve ölçütler değişince efekt yeniden kurulur
     ve eski raster ile isteği birlikte gider. Nesne kimliğine güvenmek, her
     render'da yeni bir istek açardı. */
  const analysisKey = analysis
    ? JSON.stringify([analysis.areaWkts, analysis.criteria, criterionSlug ?? ''])
    : ''

  useEffect(() => {
    if (!map || !analysis || !permitted || !lod) {
      setLoading(false)
      setError(null)
      setHasImage(false)
      return undefined
    }

    const layer = new ImageLayer({
      /* KENDİ tuvali: maske `destination-in` ile uygulanır ve paylaşılan bir
         tuvalde bu, altındaki temel haritayı da silerdi. */
      className: 'location-analysis-layer',
      opacity: opacityRef.current,
      zIndex: LOCATION_ANALYSIS_RASTER_Z_INDEX,
    })
    layer.set('name', 'location-analysis-heatmap')
    layerRef.current = layer
    map.addLayer(layer)

    /* --- Alan maskesi ------------------------------------------------------

       <b>Kırpma GERÇEK poligonla yapılır, sınırlayıcı kutuyla DEĞİL.</b>
       İstenen pencere bir dikdörtgendir ve ısı çekirdeği kaynak noktanın
       ötesine taşar; yalnızca kutuya kırpmak, seçilmemiş komşu illerin
       üzerinde boyalı bir kenar bırakırdı. Maske analizin kendi
       `AreaWkts`'inden kurulur — yani ekranda görünen sınır ile sunucunun
       süzdüğü geometri AYNI kaynaktır.

       Çok parçalı alanlarda her parça ayrı çizilir; parçalar sahte bir
       bağlayıcı poligonla BİRLEŞTİRİLMEZ. */
    const maskGeometries = (analysis.areaWkts ?? [])
      .map((wkt) => wkt4326ToFeature(wkt)?.getGeometry())
      .filter(Boolean)

    const clip = (event) => {
      if (maskGeometries.length === 0) return
      const context = event.context
      context.save()
      /* `destination-in`: hâlihazırda çizilmiş rasterden YALNIZCA maskenin
         örttüğü pikseller kalır, kalanların alfası sıfırlanır. */
      context.globalCompositeOperation = 'destination-in'
      const vectorContext = getVectorContext(event)
      vectorContext.setStyle(MASK_STYLE)
      for (const geometry of maskGeometries) vectorContext.drawGeometry(geometry)
      context.restore()
    }

    layer.on('postrender', clip)

    let active = true
    let controller = null
    let currentBlobUrl = null

    const load = async () => {
      /* Pencere ANALİZDEN türetilir: haritanın o anki görünümü İSTEĞE HİÇ
         GİRMEZ. Buradaki tek girdi `areaWkts`'tir. */
      const bbox = analysisAreaEnvelope(analysis.areaWkts)
      const serialized = serializeBbox(bbox)
      const size = analysisAreaImageSize(bbox, heatmapLodSpec(lod))
      if (!serialized || !size) {
        setError(GENERIC_ERROR)
        return
      }

      controller?.abort()
      controller = new AbortController()
      const signal = controller.signal
      setLoading(true)
      setError(null)

      try {
        const blob = await fetchLocationAnalysisImage({
          areaWkts: analysis.areaWkts,
          criteria: analysis.criteria,
          bbox: serialized,
          ...size,
          /* Oran 1'dir ve bu ARTIK doğrudur: raster ekran değil ALAN
             çözünürlüğündedir, dolayısıyla ısı çekirdeğinin yarıçapı da
             coğrafi bir ölçüdür. Cihazın piksel yoğunluğuna göre yarıçap
             ölçeklemek, aynı analizin iki farklı ekranda farklı yayılım
             göstermesi olurdu. */
          pixelRatio: 1,
          /* Boşsa ağırlıklı birleşik yüzey; doluysa yalnızca o ölçütün saf
             yoğunluğu. Ölçütün KENDİSİ değişmez — yalnızca hangi
             kategorilerin çizildiği değişir. */
          criterionSlug: criterionSlug || undefined,
          heatmapLod: lod,
          signal,
        })

        if (!active || signal.aborted) return

        const nextBlobUrl = URL.createObjectURL(blob)

        /* Kaynak EPSG:4326 OLARAK tanımlanır ve görünüm 3857'dir: yeniden
           projeksiyonu OpenLayers yapar ve her yakınlaştırma düzeyinde AYNI
           coğrafyaya oturur. Coğrafi bir PNG'yi Web Mercator kapsamıymış gibi
           göstermek, görüntüyü enlemle artan bir hatayla kaydırırdı. */
        const source = new ImageStatic({
          url: nextBlobUrl,
          imageExtent: [...bbox],
          projection: DATA_PROJECTION,
          interpolate: true,
        })

        const previousBlobUrl = currentBlobUrl
        currentBlobUrl = nextBlobUrl
        layer.setSource(source)
        map.render()
        if (previousBlobUrl) URL.revokeObjectURL(previousBlobUrl)
        setHasImage(true)
      } catch (loadError) {
        if (loadError?.name !== 'AbortError' && active) {
          setError(messageFor(loadError))
        }
      } finally {
        if (active && !signal.aborted) setLoading(false)
      }
    }

    /* `moveend` DİNLENMEZ. Görüntü analiz girdileri, LOD bandı değiştiğinde
       ya da açıkça `refresh()` çağrıldığında üretilir. */
    load()

    return () => {
      active = false
      controller?.abort()
      layer.un('postrender', clip)
      map.removeLayer(layer)
      layer.setSource(null)
      layer.dispose()
      if (currentBlobUrl) URL.revokeObjectURL(currentBlobUrl)
      if (layerRef.current === layer) layerRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, analysisKey, permitted, refreshVersion, lod])

  return { opacity, setOpacity, loading, error, hasImage, refresh, lod }
}
