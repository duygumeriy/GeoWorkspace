import { useEffect } from 'react'
import { POI_FEATURE_KIND, POI_LAYER_CLASSNAME, featureToPoi } from '../map/poi.js'

/** Yakın ıskalamaları yok sayar, dokunmatikte hoşgörülü kalır. */
const HIT_TOLERANCE = 8

/**
 * POI'ye tıklayınca bilgi paneli.
 *
 * <b>İsabet denetimi YALNIZCA POI katmanına kapsanır.</b> İki koşul birlikte
 * aranır: feature POI katmanından gelmiş olmalı ve `featureKind` ayırt
 * edicisini taşımalıdır. Tek başına piksel araması, bir çizim noktasını ya da
 * geçici yerleştirme işaretini POI sanmaya açık kapı bırakırdı — ikisi de POI
 * DEĞİLDİR ve bilgi paneli açmamalıdır.
 *
 * <b>Aktif araç önceliklidir.</b> `enabled` yalnızca haritanın tıklamasının
 * sahibi olmayan bir modda true'dur; kullanıcı poligon çizerken bir tık
 * köşe noktasıdır, seçim değil.
 *
 * Çizim seçimiyle aynı yaklaşım kullanılır (`forEachFeatureAtPixel`), ayrı bir
 * `Select` etkileşimi eklenmez: ikinci bir etkileşim, tıklama sahipliğini
 * mevcut araçlarla paylaşmak zorunda kalırdı.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ enabled: boolean, onSelect: (poi: object|null) => void,
 *           isPoiVisible?: (poiId: number) => boolean }} options
 */
export default function usePoiInteraction(map, { enabled, onSelect, isPoiVisible = () => true }) {
  useEffect(() => {
    if (!map || !enabled) return undefined

    const findPoi = (pixel) =>
      map.forEachFeatureAtPixel(
        pixel,
        (feature, layer) =>
          layer?.getClassName?.().includes(POI_LAYER_CLASSNAME)
          && feature.get('featureKind') === POI_FEATURE_KIND
          && isPoiVisible(feature.get('poiId'))
            ? feature
            : null,
        { hitTolerance: HIT_TOLERANCE },
      )

    const handleClick = (event) => {
      const feature = findPoi(event.pixel)
      /* Boş haritaya tıklamak paneli kapatır — çizim seçimindeki davranışın
         aynısı. Panel içindeki denetimler haritanın dışındadır ve bu olayı
         hiç görmez. */
      onSelect(feature ? featureToPoi(feature) : null)
    }

    map.on('singleclick', handleClick)

    return () => {
      map.un('singleclick', handleClick)
    }
  }, [map, enabled, onSelect, isPoiVisible])
}
