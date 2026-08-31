import { TRANSPORT_STOP_KIND, TRANSPORT_STOP_LAYER_CLASSNAME } from './transport.js'
import { POI_FEATURE_KIND, POI_LAYER_CLASSNAME } from './poi.js'
import { WAYPOINT_SOURCES, waypointReference } from './journeyPlanning.js'

export const JOURNEY_PICK_TOLERANCE = 8

/**
 * Planlayıcı bir yuva için nokta beklerken bir tıklamanın neye denk geldiğini
 * çözer.
 *
 * <b>Mevcut zincir DEĞİŞTİRİLMEZ.</b> `resolveTransportClick` olduğu gibi
 * kalır ve normal seçim davranışını sürdürür; bu çözümleyici yalnızca bir yuva
 * SİLAHLIYKEN çalışır ve o sırada normal tıklama işleyicileri kapalıdır.
 * Böylece öncelik kayıt sırasına değil, açık bir moda bağlıdır.
 *
 * <b>Kimlik etiketten TÜRETİLMEZ.</b> Yalnızca feature üzerindeki kanonik
 * kayıt (`transportStop` / POI kaydı) okunur; ad benzerliğinden veri tabanı
 * kimliği tahmin edilmez.
 *
 * <b>Görünmeyen nesne seçilemez.</b> Kullanıcının kapattığı bir hattın durağı
 * ya da POI yetkisi olmayan birinin POI'si aday listesine hiç girmez.
 */
export function resolveJourneyPick(map, pixel, {
  allowPoi = false,
  isStopSelectable = () => true,
} = {}) {
  if (!map || !pixel) return null

  const stopFeature = map.forEachFeatureAtPixel(
    pixel,
    (feature, layer) =>
      layer?.getClassName?.().includes(TRANSPORT_STOP_LAYER_CLASSNAME)
      && feature.get('featureKind') === TRANSPORT_STOP_KIND
        ? feature
        : null,
    { hitTolerance: JOURNEY_PICK_TOLERANCE },
  )

  /* Durak POI'den ÖNCE gelir: mevcut zincirdeki "daha özgül olan kazanır"
     kuralıyla aynı yön. */
  if (stopFeature) {
    const record = stopFeature.get('transportStop')
    const id = record?.id ?? stopFeature.get('stopId')
    if (id != null && isStopSelectable(record?.routeId ?? stopFeature.get('routeId'))) {
      return waypointReference({
        source: WAYPOINT_SOURCES.STOP,
        id,
        label: record?.name ?? '',
        routeName: record?.routeName ?? '',
      })
    }
    return null
  }

  if (!allowPoi) return null

  const poiFeature = map.forEachFeatureAtPixel(
    pixel,
    (feature, layer) =>
      layer?.getClassName?.().includes(POI_LAYER_CLASSNAME)
      && feature.get('featureKind') === POI_FEATURE_KIND
        ? feature
        : null,
    { hitTolerance: JOURNEY_PICK_TOLERANCE },
  )

  if (!poiFeature) return null

  const id = poiFeature.get('poiId') ?? poiFeature.get('id')
  if (id == null) return null

  return waypointReference({
    source: WAYPOINT_SOURCES.POI,
    id,
    label: poiFeature.get('name') ?? '',
  })
}
