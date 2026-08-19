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
  /** Kenarın altındaki koyu taban: açık altlıkta da kontrast bırakır. */
  haloColor: 'rgba(76, 29, 149, 0.55)',
  /** Öncekinden belirgin biçimde kalın; sınır aranmadan görülmelidir. */
  strokeWidth: 4,
  haloWidth: 7,
  /** Okunur, seyrek bir desen: sürekli çizgi bir çizim sanılabilirdi. */
  lineDash: [14, 8],
  /** Dolgu haritayı örtmez; sınırı çerçeveler, perde çekmez. */
  fillColor: 'rgba(168, 85, 247, 0.10)',
})

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
      /* İKİ çizgi üst üste: koyu bir taban ve onun üstünde mor kesikli kenar.
         Tek bir çizgi, açık altlıkta parlak bir zemine denk geldiğinde
         siliniyordu; taban, sınırın her altlıkta ve her temada okunmasını
         sağlar. Dolgu yalnızca en alttaki stile konur. */
      style: [
        new Style({
          fill: new Fill({ color: SCOPE_STYLE.fillColor }),
          stroke: new Stroke({ color: SCOPE_STYLE.haloColor, width: SCOPE_STYLE.haloWidth }),
        }),
        new Style({
          stroke: new Stroke({
            color: SCOPE_STYLE.strokeColor,
            width: SCOPE_STYLE.strokeWidth,
            lineDash: [...SCOPE_STYLE.lineDash],
          }),
        }),
      ],
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
