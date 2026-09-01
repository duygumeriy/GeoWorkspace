import { TRANSPORT_STOP_KIND, TRANSPORT_STOP_LAYER_CLASSNAME } from './transport.js'
import { POI_FEATURE_KIND, POI_LAYER_CLASSNAME } from './poi.js'
import { WAYPOINT_SOURCES, waypointReference } from './journeyPlanning.js'

export const JOURNEY_PICK_TOLERANCE = 8

/** Seçim kipinin imleci. Tek bir yerde durur ki geri alma da aynı değeri bilsin. */
export const JOURNEY_PICK_CURSOR = 'crosshair'

/**
 * Seçim kipi boyunca imlecin SAHİPLİĞİNİ alır.
 *
 * <b>Önceki değer korunur ve aynen geri verilir.</b> Körlemesine boş dizeye
 * çekmek, imleci başkası (bir başka kip ya da sayfa stili) ayarlamışsa onun
 * durumunu sessizce silerdi. Aynı sahiplik deseni durak taşımada da
 * kullanılıyor; ikinci bir imleç yöneticisi kurulmaz.
 *
 * <b>Sahiplik SORGULANIR.</b> Bırakırken imleç artık bizimki değilse (araya
 * başka bir sahip girmiş) hiçbir şey yazılmaz — geç kalan bir geri alma,
 * güncel sahibin imlecini ezmemelidir.
 *
 * @param {HTMLElement | null | undefined} element haritanın hedef elemanı
 * @returns {() => void} imleci önceki değerine döndüren geri alma
 */
export function claimJourneyPickCursor(element) {
  if (!element?.style) return () => {}

  const previous = element.style.cursor ?? ''
  element.style.cursor = JOURNEY_PICK_CURSOR

  return () => {
    if (element.style.cursor !== JOURNEY_PICK_CURSOR) return
    element.style.cursor = previous
  }
}

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
