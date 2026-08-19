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
 * Kullanıcının yetki alanını haritada gösteren katman.
 *
 * <b>Çizimlerin ALTINDA durur ve onları gizlemez.</b> Dolgu bilinçli olarak çok
 * şeffaftır: sınır, haritanın okunmasını zorlaştıran bir perde değil, bir
 * çerçevedir. Kalın kesikli kenar, sınırın nerede olduğunu dolguya bakmadan da
 * söyler.
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
    const layer = new VectorLayer({
      source,
      className: SCOPE_LAYER_CLASSNAME,
      /* Çizim katmanının ALTINDA: kullanıcının kendi verisi sınırın üstünde
         kalmalıdır. */
      zIndex: 4,
      style: new Style({
        fill: new Fill({ color: 'rgba(0, 209, 255, 0.07)' }),
        stroke: new Stroke({ color: '#00d1ff', width: 2.5, lineDash: [10, 6] }),
      }),
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

    /* MultiPolygon'un TÜM bileşenleri çizilir. Yalnızca ilkini çizmek,
       kullanıcının ikinci bölgesini haritada yokmuş gibi göstermek olurdu. */
    for (const rings of scope.polygons) {
      const wkt = `POLYGON (${rings
        .map((ring) => `(${ring.map(([lon, lat]) => `${lon} ${lat}`).join(', ')})`)
        .join(', ')})`
      const feature = wkt4326ToFeature(wkt)
      if (feature) source.addFeature(feature)
    }
  }, [scope])

  useEffect(() => {
    layerRef.current?.setVisible(visible)
  }, [visible])
}
