import { useEffect, useRef, useState } from 'react'
import Collection from 'ol/Collection.js'
import Feature from 'ol/Feature.js'
import Point from 'ol/geom/Point.js'
import Translate from 'ol/interaction/Translate.js'
import { fromLonLat } from 'ol/proj.js'
import { MAP_PROJECTION, createPoiDraftLayer, toLonLat4326 } from '../map/poi.js'

/**
 * Düzenlenmekte olan POI'nin TASLAK konumu: geçici işaret ve taşıma etkileşimi.
 *
 * <b>Kalıcı kaynağa dokunulmaz.</b> İşaret kendi katmanındadır ve kaydın
 * kendisi başarılı bir güncellemeye kadar yerinde durur; aksi hâlde reddedilen
 * bir istekten sonra harita, veritabanında olmayan bir konumu anlatırdı.
 *
 * <b>Yalnızca DÜZENLENEN kayıt taşınır.</b> `Translate`, tek elemanlı bir
 * `Collection` ile kurulur: başka bir POI, bir çizim ya da ölçüm noktası bu
 * etkileşimle hiçbir koşulda hareket etmez. Etkileşim ancak "Haritada Taşı"
 * açıkken eklenir ve düzenleme kapandığı anda (kaydet, iptal, bağlam devri,
 * yetki kaybı) kaldırılır — sürüklenebilir bir işaret, kendisini açıklayan
 * form olmadan ekranda kalamaz.
 *
 * Yeni konum yalnızca sürükleme BİTTİĞİNDE bildirilir: her piksel için state
 * yazmak, formun her karede yeniden çizilmesi demek olurdu ve okunan değer
 * zaten bırakılan noktadır.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{
 *   active: boolean,
 *   coordinate: { longitude: number, latitude: number } | null,
 *   movable: boolean,
 *   onMove: (coordinate: { longitude: number, latitude: number }) => void,
 * }} deps
 */
export default function usePoiEditDraft(map, { active, coordinate, movable, onMove }) {
  const sourceRef = useRef(null)
  const featureRef = useRef(null)

  /* Etkileşim, feature GERÇEKTEN kurulduktan sonra eklenebilmelidir; ref bir
     render tetiklemediği için varlığı ayrıca duyurulur. */
  const [featureReady, setFeatureReady] = useState(false)

  const onMoveRef = useRef(onMove)
  onMoveRef.current = onMove

  const longitude = coordinate?.longitude
  const latitude = coordinate?.latitude

  /* --- Geçici katman ------------------------------------------------------- */

  useEffect(() => {
    if (!map) return undefined

    const { source, layer } = createPoiDraftLayer()
    sourceRef.current = source
    map.addLayer(layer)

    return () => {
      map.removeLayer(layer)
      source.clear()
      sourceRef.current = null
      featureRef.current = null
      setFeatureReady(false)
    }
  }, [map])

  /* --- İşaretin konumu ----------------------------------------------------- */

  useEffect(() => {
    const source = sourceRef.current
    if (!source) return

    if (!active || !Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      // Düzenleme bitti ya da konum geçici olarak geçersiz: işaret kalmaz.
      source.clear()
      featureRef.current = null
      setFeatureReady(false)
      return
    }

    const position = fromLonLat([longitude, latitude], MAP_PROJECTION)

    if (featureRef.current) {
      // Aynı feature taşınır: yeniden yaratmak, süregelen bir taşıma
      // etkileşiminin tuttuğu nesneyi elinden almak olurdu.
      featureRef.current.getGeometry().setCoordinates(position)
      return
    }

    const feature = new Feature({ geometry: new Point(position) })
    featureRef.current = feature
    source.addFeature(feature)
    setFeatureReady(true)
  }, [active, longitude, latitude])

  /* --- Taşıma etkileşimi --------------------------------------------------- */

  useEffect(() => {
    if (!map || !active || !movable || !featureReady) return undefined

    const feature = featureRef.current
    if (!feature) return undefined

    const translate = new Translate({ features: new Collection([feature]) })
    map.addInteraction(translate)

    translate.on('translateend', (event) => {
      const geometry = event.features.item(0)?.getGeometry()
      if (!geometry) return
      // Gerçek 3857 → 4326 dönüşümü; Mercator matematiği elle yazılmaz.
      onMoveRef.current?.(toLonLat4326(geometry.getCoordinates()))
    })

    return () => {
      map.removeInteraction(translate)
      translate.dispose()
    }
  }, [map, active, movable, featureReady])
}
