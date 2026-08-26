import { useCallback, useEffect, useRef, useState } from 'react'
import Draw from 'ol/interaction/Draw'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Style from 'ol/style/Style'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import { geometryToWkt4326, wkt4326ToFeature } from '../map/drawing.js'
import { isGeometryInsideScope } from '../map/geographicScope.js'
import {
  LOCATION_ANALYSIS_AREA_COLOR,
  LOCATION_ANALYSIS_AREA_Z_INDEX,
} from '../map/locationAnalysis.js'

/**
 * Konum analizinin HEDEF ALANI: geçici sınır katmanı + poligon çizimi.
 *
 * <b>Coğrafi yetki alanıyla karıştırılmaz.</b> Bu katman `geographic_authorizations`
 * kaynağını ne okur ne yazar. Orası kalıcı bir YAZMA sınırıdır; burası bir
 * sorgunun geçici hedefidir ve sayfa yenilendiğinde kaybolur. İkisi aynı anda
 * görünebilir: kapsam mor (z 4), analiz alanı kehribar (z 11).
 *
 * <b>Mod BURADA sahiplenilmez.</b> `active` değeri `useWorkspaceMode`'dan gelir
 * — envanter analizi, ölçüm ve POI yerleştirmeyle aynı sözleşme. Draw
 * etkileşiminin başka bir araçla aynı anda canlı olamamasını sağlayan şey budur.
 *
 * <b>Haritadaki geometri 3857 kalır, yük 4326 olur.</b> `drawend` sırasında
 * geometri KOPYALANMADAN dönüştürülmez: `geometryToWkt4326` yazarken projeksiyon
 * çevirisi yapar ve haritadaki feature'a dokunmaz. Yerinde dönüştürmek, çizilen
 * sınırı ekranda Gine Körfezi'ne taşırdı.
 */
export default function useLocationAnalysisArea(map, { active, scope, onRejected }) {
  const sourceRef = useRef(null)

  /* Ref üzerinden okunur: kapsam ya da geri çağırım değiştiğinde çizim
     etkileşimini söküp yeniden kurmak, kullanıcının o an çizdiği poligonu
     kaybettirirdi. */
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const onRejectedRef = useRef(onRejected)
  onRejectedRef.current = onRejected

  const [areaWkts, setAreaWkts] = useState([])
  const [areaLabel, setAreaLabel] = useState('')

  /* --- Geçici sınır katmanı ------------------------------------------------ */

  useEffect(() => {
    if (!map) return undefined

    const source = new VectorSource()
    const layer = new VectorLayer({
      source,
      className: 'location-analysis-area-layer',
      zIndex: LOCATION_ANALYSIS_AREA_Z_INDEX,
      style: new Style({
        stroke: new Stroke({ color: LOCATION_ANALYSIS_AREA_COLOR, width: 2.5, lineDash: [10, 6] }),
        /* Dolgu ÇOK açıktır: sınır okunabilir kalmalı ama altındaki ısı
           haritası da görünmelidir — alanı boyamak, analizin sonucunu kendi
           sınırıyla örtmek olurdu. */
        fill: new Fill({ color: 'rgba(245, 158, 11, 0.08)' }),
      }),
    })
    layer.set('name', 'location-analysis-area')

    sourceRef.current = source
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
      layer.dispose()
      sourceRef.current = null
    }
  }, [map])

  /* --- Alanı yerleştirme --------------------------------------------------- */

  /** Haritadaki sınırı 4326 WKT listesinden yeniden kurar. */
  const showAreas = useCallback((wkts) => {
    const source = sourceRef.current
    if (!source) return

    source.clear()

    for (const wkt of wkts) {
      const feature = wkt4326ToFeature(wkt)
      if (feature) source.addFeature(feature)
    }
  }, [])

  /**
   * İl seçimi. Çok parçalı iller birden çok WKT üretir ve hepsi korunur.
   */
  const setProvinceArea = useCallback(
    (wkts, label) => {
      setAreaWkts(wkts)
      setAreaLabel(label)
      showAreas(wkts)
    },
    [showAreas],
  )

  const clearArea = useCallback(() => {
    sourceRef.current?.clear()
    setAreaWkts([])
    setAreaLabel('')
  }, [])

  /** Seçilen alana yakınlaş — mevcut harita konvansiyonu. */
  const fitToArea = useCallback(() => {
    const source = sourceRef.current
    if (!map || !source || source.getFeatures().length === 0) return

    const extent = source.getExtent()
    if (!extent || !extent.every(Number.isFinite) || extent[0] > extent[2]) return

    map.getView().fit(extent, { padding: [64, 64, 64, 64], duration: 250, maxZoom: 14 })
  }, [map])

  /* --- Poligon çizimi ------------------------------------------------------- */

  useEffect(() => {
    if (!map || !active) return undefined

    const source = sourceRef.current
    if (!source) return undefined

    const draw = new Draw({ source, type: 'Polygon' })
    map.addInteraction(draw)

    draw.on('drawstart', () => {
      /* Tek hedef alan: yeni bir çizim başladığı anda önceki sınır gider.
         Biriken poligonlar, kullanıcının sandığından daha geniş bir alanı
         analiz etmek olurdu. */
      source.clear()
      setAreaWkts([])
      setAreaLabel('')
    })

    draw.on('drawend', (event) => {
      const geometry = event.feature.getGeometry()

      /* <b>Coğrafi yetki burada da uygulanır.</b> Sunucu isteği zaten
         reddeder; ama kullanıcıyı bir alan çizip ölçütleri doldurduktan
         sonra 403 ile karşılamak, nedenini anlamadığı bir hata göstermek
         olurdu. Yüklem çizim aracının kullandığının AYNISIDIR — iki ekranda
         iki farklı "içeride mi" tanımı doğmasın diye. */
      if (!isGeometryInsideScope(scopeRef.current, geometry)) {
        source.clear()
        setAreaWkts([])
        setAreaLabel('')
        onRejectedRef.current?.(
          'Çizilen alan coğrafi yetki alanınızın dışında. Analizi yalnızca yetkili olduğunuz bölgede çalıştırabilirsiniz.',
        )
        return
      }

      /* Haritadaki feature 3857 kalır; yalnızca YÜK 4326'ya çevrilir —
         çizimlerin ve envanter analizinin kullandığı yardımcının aynısı. */
      const wkt = geometryToWkt4326(geometry)
      setAreaWkts([wkt])
      setAreaLabel('Haritada çizilen alan')
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

  return { areaWkts, areaLabel, setProvinceArea, clearArea, fitToArea }
}
