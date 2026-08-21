import { useEffect, useRef } from 'react'
import VectorLayer from 'ol/layer/Vector'
import VectorSource from 'ol/source/Vector'
import Fill from 'ol/style/Fill'
import Stroke from 'ol/style/Stroke'
import Style from 'ol/style/Style'
import { wkt4326ToFeature } from '../map/drawing.js'

/** Diğer katmanlarla çakışmaması için kendi sınıf adı (koyu tema filtresi). */
export const SCOPE_LAYER_CLASSNAME = 'scope-layer'

/**
 * "Yetki Alanım" sınırının GÖRSEL TANIMI — tek yer.
 *
 * Rengi değiştirmek isteyen biri yalnızca burayı düzenler; stil, katman
 * kurulumunun içine gömülü değildir. Bir tema ayarı ya da veritabanı alanı
 * DEĞİLDİR ve olmamalıdır: sınırın rengi bir yetkilendirme verisi değil, bir
 * sunum tercihidir.
 *
 * Renk MOR ailesindendir ve bunun sebebi vardır. Önceki açık mavi, OpenStreetMap
 * altlığındaki su, yol ve idari sınır çizgileriyle aynı ton ailesine düşüyor ve
 * kaybolup gidiyordu; kullanıcı sınırın nerede olduğunu ancak arayarak
 * bulabiliyordu. Mor, OSM'in kendi paletinde neredeyse hiç geçmediği için
 * altlıkla karışmaz ve uygulamanın kendi vurgu rengiyle de aynı ailedendir.
 *
 * Sınır, kullanıcının çizimlerinden AYRI okunmalıdır: nokta/çizgi/poligon
 * çizimleri kendi stillerini taşır ve bu katman onlarla karışmasın diye
 * KESİKLİ çizilir — renk ayırt edemeyen biri için de çizgi biçimi ayrımı kalır.
 */
export const SCOPE_STYLE = Object.freeze({
  /** Kenar rengi: uygulamanın mor vurgusuyla aynı aile, altlıkta kaybolmaz. */
  strokeColor: '#a855f7',
  /** İnce kesikli kenar, çizimlerin önüne görsel bir duvar örmez. */
  strokeWidth: 1.5,
  lineDash: [8, 6],
  /** Dolgu haritayı örtmez; sınırı çerçeveler, perde çekmez. */
  fillColor: 'rgba(168, 85, 247, 0.04)',
})

export const EXCLUDED_SCOPE_STYLE = Object.freeze({
  strokeColor: '#f59e0b',
  strokeWidth: 1.5,
  lineDash: [4, 4],
  fillColor: 'rgba(245, 158, 11, 0.08)',
})

export const SCOPE_FEATURE_KINDS = Object.freeze({ authorized: 'authorized', excluded: 'excluded' })

/** Builds both the effective polygon and explicit overlay features for its holes. */
export function buildScopeFeatures(scope) {
  if (!scope) return []

  const features = []
  for (const rings of scope.polygons) {
    const authorized = wkt4326ToFeature(polygonWkt(rings))
    if (authorized) {
      authorized.set('scopeKind', SCOPE_FEATURE_KINDS.authorized)
      features.push(authorized)
    }

    for (const hole of rings.slice(1)) {
      const excluded = wkt4326ToFeature(polygonWkt([hole]))
      if (!excluded) continue
      excluded.set('scopeKind', SCOPE_FEATURE_KINDS.excluded)
      features.push(excluded)
    }
  }

  return features
}

function polygonWkt(rings) {
  return `POLYGON (${rings
    .map((ring) => `(${ring.map(([lon, lat]) => `${lon} ${lat}`).join(', ')})`)
    .join(', ')})`
}

/**
 * Kullanıcının yetki alanını haritada gösteren katman.
 *
 * <b>Çizimlerin ALTINDA durur ve onları gizlemez.</b> Dolgu bilinçli olarak çok
 * şeffaftır: sınır, haritanın okunmasını zorlaştıran bir perde değil, bir
 * çerçevedir. İnce kesikli kenar, harita içeriğine baskın çıkmadan sınırı söyler.
 *
 * <b>Kısıtsız kullanıcı için HİÇBİR ŞEY çizilmez.</b> Dünyayı kaplayan sahte
 * bir kutu çizmek, var olmayan bir sınırı varmış gibi göstermek ve kutunun
 * kenarındaki bir çizimi sebepsiz şüpheli kılmak olurdu.
 *
 * <b>Salt görselleştirmedir.</b> Katman seçilemez, düzenlenemez ve silinemez;
 * çizim etkileşimleri onu hiç görmez.
 *
 * @param {import('ol/Map').default|null} map
 * @param {{ scope: object|null, visible: boolean }} options
 */
export default function useGeographicScopeLayer(map, { scope, visible = true }) {
  const layerRef = useRef(null)
  const sourceRef = useRef(null)

  useEffect(() => {
    if (!map) return undefined

    const source = new VectorSource()
    const authorizedStyle = new Style({
      fill: new Fill({ color: SCOPE_STYLE.fillColor }),
      stroke: new Stroke({
        color: SCOPE_STYLE.strokeColor,
        width: SCOPE_STYLE.strokeWidth,
        lineDash: [...SCOPE_STYLE.lineDash],
      }),
    })
    const excludedStyle = new Style({
      fill: new Fill({ color: EXCLUDED_SCOPE_STYLE.fillColor }),
      stroke: new Stroke({
        color: EXCLUDED_SCOPE_STYLE.strokeColor,
        width: EXCLUDED_SCOPE_STYLE.strokeWidth,
        lineDash: [...EXCLUDED_SCOPE_STYLE.lineDash],
      }),
    })
    const layer = new VectorLayer({
      source,
      className: SCOPE_LAYER_CLASSNAME,
      /* Çizim katmanının ALTINDA: kullanıcının kendi verisi sınırın üstünde
         kalmalıdır. */
      zIndex: 4,
      style: (feature) =>
        feature.get('scopeKind') === SCOPE_FEATURE_KINDS.excluded ? excludedStyle : authorizedStyle,
    })

    map.addLayer(layer)
    layerRef.current = layer
    sourceRef.current = source

    return () => {
      map.removeLayer(layer)
      layer.dispose()
      layerRef.current = null
      sourceRef.current = null
    }
  }, [map])

  useEffect(() => {
    const source = sourceRef.current
    if (!source) return

    source.clear()
    if (!scope) return

    source.addFeatures(buildScopeFeatures(scope))
  }, [scope])

  useEffect(() => {
    layerRef.current?.setVisible(visible)
  }, [visible])
}
