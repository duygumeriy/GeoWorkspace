import { useEffect, useMemo, useRef, useState } from 'react'
import VectorLayer from 'ol/layer/Vector.js'
import VectorSource from 'ol/source/Vector.js'
import Fill from 'ol/style/Fill.js'
import Stroke from 'ol/style/Stroke.js'
import Style from 'ol/style/Style.js'
import Text from 'ol/style/Text.js'
import { fetchLocationAnalysisPoints } from '../services/api.js'
import { FALLBACK_PRESENTATION, poiMarkerStyle, prewarmPoiBadges } from '../map/poiMarkerStyle.js'
import { markerSizeForResolution } from '../map/poiMarkerScale.js'
import {
  LOCATION_ANALYSIS_POI_CLASSNAME,
  LOCATION_ANALYSIS_POI_LABEL_CLASSNAME,
  LOCATION_ANALYSIS_POI_Z_INDEX,
  LOCATION_ANALYSIS_LABEL_DECLUTTER,
  analysisPoiLabelText,
  analysisPoisForCriterion,
  analysisPoiToFeature,
  heatmapLodForZoom,
} from '../map/locationAnalysis.js'

const GENERIC_ERROR = 'Analiz POI\'leri şu anda alınamadı.'

const messageFor = (error) => {
  if (error?.status === 403) return 'Bu analizi görüntüleme yetkiniz yok.'
  if (error?.status === 400) return error.message || 'Analiz parametreleri geçersiz.'
  return GENERIC_ERROR
}

const labelStyleCache = new Map()

function labelStyle(name, size, lod) {
  const text = analysisPoiLabelText(name, lod)
  if (!text) return null

  const key = `${lod}|${size}|${text}`
  const cached = labelStyleCache.get(key)
  if (cached) return cached

  const style = new Style({
    text: new Text({
      text,
      font: lod === 'very_near' ? '600 13px system-ui, sans-serif' : '600 11px system-ui, sans-serif',
      offsetY: -(size / 2 + 8),
      padding: [2, 3, 2, 3],
      fill: new Fill({ color: '#F8FAFC' }),
      stroke: new Stroke({ color: 'rgba(15, 23, 42, 0.92)', width: 3 }),
    }),
  })

  labelStyleCache.set(key, style)
  return style
}

/**
 * Analiz POI'leri — <b>vektör</b> katman, normal POI'lerle AYNI rozetlerle.
 *
 * <b>Neden raster değil.</b> Önceki gösterim sunucuda çizilmiş bir PNG'ydi ve
 * iki bedeli vardı: yakınlaşınca bitmap büyüdüğü için pikselleşiyordu, ve
 * noktalar projenin kendi kategori simgeleriyle DEĞİL genel mavi dairelerle
 * çiziliyordu. Aynı eczane, normal POI katmanında hap simgesiyle, analiz
 * katmanında anonim bir noktayla görünüyordu.
 *
 * <b>İkinci bir simge sistemi KURULMAZ.</b> Rozetler `poiMarkerStyle`'dan
 * gelir — normal POI'lerin kullandığı fonksiyonun aynısı — ve kategori
 * metadatası da aynı `categoryId → { iconKey, colorHex }` eşlemesinden okunur.
 * Bir yönetici kategorinin simgesini değiştirdiğinde her iki katman birden
 * değişir.
 *
 * <b>Ağırlıklı ısı haritası RASTER KALIR.</b> Bu hook yalnızca noktaların
 * gösterimini değiştirir; yoğunluk rasterini backend üretir ve aynı analiz
 * zarfı üzerindeki dört LOD bandında sunar.
 *
 * <b>Tüm tablo indirilmez.</b> Sunucu yalnızca aktif analize giren kayıtları
 * döndürür (Ankara + iki kök ölçüt için 1533) ve kendi üst sınırını uygular.
 */
export default function useLocationAnalysisPoiLayer(map, {
  analysis,
  permitted,
  visible,
  categoryPresentation,
  categories,
  criterionSlug,
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [count, setCount] = useState(0)
  const [truncated, setTruncated] = useState(false)
  const sourceRef = useRef(null)
  const viewRef = useRef(null)
  const allRowsRef = useRef([])

  const focusRef = useRef({ categories, criterionSlug })
  focusRef.current = { categories, criterionSlug }

  /* Stil fonksiyonu her POI için her karede çağrılır; ref üzerinden okumak,
     eşleme değiştiğinde katmanı yeniden kurmayı gereksiz kılar. */
  const presentationRef = useRef(categoryPresentation)
  presentationRef.current = categoryPresentation

  const resolutionRef = useRef(undefined)

  const analysisKey = analysis
    ? JSON.stringify([analysis.areaWkts, analysis.criteria])
    : ''

  const active = Boolean(map && analysis && permitted && visible)

  useEffect(() => {
    if (!active) {
      allRowsRef.current = []
      setLoading(false)
      setError(null)
      setCount(0)
      setTruncated(false)
      return undefined
    }

    const source = new VectorSource()
    sourceRef.current = source

    const layer = new VectorLayer({
      source,
      /* Kendi tuvali: isabet denetimi katmanı sınıfıyla ayırt eder ve normal
         POI katmanıyla karışmaz. */
      className: LOCATION_ANALYSIS_POI_CLASSNAME,
      zIndex: LOCATION_ANALYSIS_POI_Z_INDEX,
      style: (feature) => {
        const presentation =
          presentationRef.current?.get(feature.get('categoryId')) ?? FALLBACK_PRESENTATION

        return poiMarkerStyle({
          iconKey: presentation.iconKey,
          colorHex: presentation.colorHex,
          /* Boyut normal POI'lerle AYNI ölçek bantlarından gelir: iki katman
             yan yana dururken farklı boyut kuralları kullanmak, aynı yerin iki
             farklı ölçekte çizildiği izlenimi verirdi. */
          size: markerSizeForResolution(resolutionRef.current),
          selected: false,
          /* Raster YOK: rozet her zaman vektörden çizilir. */
          rasterActive: false,
        })
      },
    })

    /* Etiketler ayrı katmandadır: declutter yalnızca metinleri eler,
       kategori rozetlerini değil. Aynı VectorSource kullanıldığı için konum ve
       yaşam döngüsü birebirdir; DOM etiketi yoktur. */
    const labelLayer = new VectorLayer({
      source,
      className: LOCATION_ANALYSIS_POI_LABEL_CLASSNAME,
      zIndex: LOCATION_ANALYSIS_POI_Z_INDEX,
      declutter: LOCATION_ANALYSIS_LABEL_DECLUTTER,
      style: (feature) => labelStyle(
        feature.get('name'),
        markerSizeForResolution(resolutionRef.current),
        heatmapLodForZoom(viewRef.current?.getZoom()),
      ),
    })
    layer.set('name', 'location-analysis-poi')
    labelLayer.set('name', 'location-analysis-poi-labels')
    map.addLayer(layer)
    map.addLayer(labelLayer)

    /* Ölçek bandı değişince yeniden çizilir. `moveend` DEĞİL `change:resolution`
       dinlenir: kaydırma boyutu etkilemez ve boşuna çizim tetiklemez. */
    const view = map.getView()
    viewRef.current = view
    resolutionRef.current = view.getResolution()

    const handleResolution = () => {
      resolutionRef.current = view.getResolution()
      layer.changed()
      labelLayer.changed()
    }

    view.on('change:resolution', handleResolution)

    const controller = new AbortController()
    let activeRequest = true

    const load = async () => {
      setLoading(true)
      setError(null)

      try {
        const body = await fetchLocationAnalysisPoints({
          areaWkts: analysis.areaWkts,
          criteria: analysis.criteria,
          signal: controller.signal,
        })

        if (!activeRequest || controller.signal.aborted) return

        const rows = body?.pois ?? []
        allRowsRef.current = rows
        const focusedRows = analysisPoisForCriterion(
          rows,
          focusRef.current.categories,
          focusRef.current.criterionSlug,
        )

        /* Rozetler veri gelir gelmez ISITILIR. OpenLayers bir `Icon`'un
           kaynağını asenkron çözer; ısıtmadan ilk kare boş çizilir ve
           kullanıcı noktaların "sonradan belirdiğini" görür. Normal POI
           katmanı da aynı şeyi yapar. */
        prewarmPoiBadges(
          [...new Set(rows.map((row) => row.categoryId))]
            .map((id) => presentationRef.current?.get(id) ?? FALLBACK_PRESENTATION),
        )

        source.clear()
        source.addFeatures(focusedRows.map(analysisPoiToFeature).filter(Boolean))

        setCount(focusedRows.length)
        setTruncated(Boolean(body?.truncated))
      } catch (loadError) {
        if (loadError?.name === 'AbortError' || controller.signal.aborted) return
        setError(messageFor(loadError))
        setCount(0)
      } finally {
        if (activeRequest && !controller.signal.aborted) setLoading(false)
      }
    }

    load()

    return () => {
      activeRequest = false
      controller.abort()
      view.un('change:resolution', handleResolution)
      map.removeLayer(layer)
      map.removeLayer(labelLayer)
      source.clear()
      layer.dispose()
      labelLayer.dispose()
      if (viewRef.current === view) viewRef.current = null
      if (sourceRef.current === source) sourceRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, analysisKey, permitted, visible])

  /* Ölçüt görünümü yalnızca eldeki birleşik listeyi süzer. Alan/ölçüt
     analizi değişmediği için backend yeniden çağrılmaz; birleşiğe dönmek de
     aynı satırları eksiksiz geri koyar. */
  useEffect(() => {
    const source = sourceRef.current
    if (!source) return

    const focusedRows = analysisPoisForCriterion(allRowsRef.current, categories, criterionSlug)
    source.clear()
    source.addFeatures(focusedRows.map(analysisPoiToFeature).filter(Boolean))
    setCount(focusedRows.length)
  }, [categories, criterionSlug])

  return useMemo(
    () => ({ loading, error, count, truncated }),
    [loading, error, count, truncated],
  )
}
