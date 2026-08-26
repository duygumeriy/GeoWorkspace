import { useCallback, useEffect, useState } from 'react'
import {
  LOCATION_ANALYSIS_POI_CLASSNAME,
  LOCATION_ANALYSIS_POI_FEATURE_KIND,
  featureToAnalysisPoi,
} from '../map/locationAnalysis.js'

/** Normal POI etkileşimiyle AYNI hoşgörü: yakın ıskalamalar yutulmaz. */
const HIT_TOLERANCE = 8

/**
 * Analiz POI'sine tıklayınca kaydın kartı.
 *
 * <b>Sunucuya SORULMAZ ve bu bir sadeleşmedir.</b> Noktalar artık gerçek
 * OpenLayers feature'larıdır; kimlik zaten tarayıcıda, feature'ın üzerindedir.
 * Raster döneminde piksel bir kayıt kimliği taşımadığı için her tıklama bir
 * PostGIS sorgusu açmak zorundaydı; vektörde o sorgu gereksiz bir gidiş dönüş
 * olurdu.
 *
 * <b>İsabet denetimi YALNIZCA analiz katmanına kapsanır.</b> İki koşul birlikte
 * aranır — feature analiz katmanından gelmiş olmalı ve kendi `featureKind`
 * ayırt edicisini taşımalıdır. Tek başına piksel araması, normal bir POI'yi ya
 * da bir çizim noktasını analiz kaydı sanmaya açık kapı bırakırdı. Kalıp
 * `usePoiInteraction` ile birebir aynıdır; ikinci bir `Select` etkileşimi
 * eklenmez.
 *
 * <b>Aktif araç önceliklidir.</b> `enabled` yalnızca haritanın tıklamasının
 * sahibi olmayan bir modda true'dur.
 */
export default function useLocationAnalysisPoiInspect(map, { analysis, permitted, visible, enabled }) {
  const [poi, setPoi] = useState(null)

  const close = useCallback(() => setPoi(null), [])

  const active = Boolean(map && analysis && permitted && visible && enabled)

  /* Analiz, görünürlük ya da yetki değişince açık kart KAPANIR: gösterilen
     kayıt ÖNCEKİ analize aitti ve yeni bir analizin sonucuymuş gibi ekranda
     kalması, kullanıcının yanlış bir cevaba bakması olurdu. */
  const analysisKey = analysis ? JSON.stringify([analysis.areaWkts, analysis.criteria]) : ''

  useEffect(() => {
    setPoi(null)
  }, [analysisKey, permitted, visible])

  useEffect(() => {
    if (!active) return undefined

    const findFeature = (pixel) =>
      map.forEachFeatureAtPixel(
        pixel,
        (feature, layer) =>
          layer?.getClassName?.().includes(LOCATION_ANALYSIS_POI_CLASSNAME)
          && feature.get('featureKind') === LOCATION_ANALYSIS_POI_FEATURE_KIND
            ? feature
            : null,
        { hitTolerance: HIT_TOLERANCE },
      )

    const handleClick = (event) => {
      const feature = findFeature(event.pixel)
      /* Boş haritaya tıklamak kartı kapatır — normal POI bilgi panelindeki
         davranışın aynısı. */
      setPoi(feature ? featureToAnalysisPoi(feature) : null)
    }

    map.on('singleclick', handleClick)

    return () => {
      map.un('singleclick', handleClick)
    }
  }, [map, active])

  /* `loading` ve `error` KORUNUR ama artık hep boştur: kimlik yereldir,
     açılacak bir ağ isteği yoktur. Alanları kaldırmak çağıranı da
     değiştirmeyi gerektirirdi ve kart sözleşmesi aynı kalsın. */
  return { poi, loading: false, error: null, close }
}
