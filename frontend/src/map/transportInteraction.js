import {
  TRANSPORT_ROUTE_KIND,
  TRANSPORT_ROUTE_LAYER_CLASSNAME,
  TRANSPORT_ROUTE_PATH_KIND,
  TRANSPORT_ROUTE_PATH_LAYER_CLASSNAME,
  TRANSPORT_STOP_KIND,
  TRANSPORT_STOP_LAYER_CLASSNAME,
} from './transport.js'
import { findTransportVehicleAtPixel } from './transportVehicle.js'

export const STOP_HIT_TOLERANCE = 8
export const ROUTE_HIT_TOLERANCE = 6

/** Tıklamanın çözüldüğü hedef türleri. */
export const TRANSPORT_CLICK_TARGET = Object.freeze({
  VEHICLE: 'vehicle',
  STOP: 'stop',
  ROUTE: 'route',
  NONE: 'none',
})

/**
 * Bir pikselde hangi ulaşım nesnesinin seçildiğini çözer.
 *
 * <b>Öncelik AÇIKÇA yazılıdır</b> ve saf bir fonksiyondadır, böylece React'e
 * ya da bir tarayıcıya ihtiyaç duymadan sınanabilir:
 * <ol>
 *   <li><b>araç</b> — en üstteki katman; kendi balonunu açar, zincir çekilir</li>
 *   <li><b>durak</b> — daha ÖZGÜL nesne: çizginin üstündeki bir durak,
 *       çizgiye tıklanmış saymaz</li>
 *   <li><b>hesaplanmış rota</b>, sonra <b>önizleme çizgisi</b> — ikisi de AYNI
 *       kanonik <code>routeId</code>ye çözülür; hangisinin çizildiği seçim
 *       sonucunu değiştirmez</li>
 * </ol>
 *
 * Gizlenmiş güzergah seçilemez: kullanıcı onu bilerek kapatmıştır.
 */
export function resolveTransportClick(map, pixel, { isRouteVisible = () => true } = {}) {
  if (!map || !pixel) return { target: TRANSPORT_CLICK_TARGET.NONE, stop: null, routeId: null }

  const featureAt = (className, kind, tolerance) => map.forEachFeatureAtPixel(
    pixel,
    (feature, layer) =>
      layer?.getClassName?.().includes(className) && feature.get('featureKind') === kind
        ? feature
        : null,
    { hitTolerance: tolerance },
  ) ?? null

  if (findTransportVehicleAtPixel(map, pixel)) {
    return { target: TRANSPORT_CLICK_TARGET.VEHICLE, stop: null, routeId: null }
  }

  const stopFeature = featureAt(TRANSPORT_STOP_LAYER_CLASSNAME, TRANSPORT_STOP_KIND, STOP_HIT_TOLERANCE)
  if (stopFeature) {
    return {
      target: TRANSPORT_CLICK_TARGET.STOP,
      stop: stopFeature.get('transportStop') ?? null,
      routeId: null,
    }
  }

  const routeFeature = featureAt(TRANSPORT_ROUTE_PATH_LAYER_CLASSNAME, TRANSPORT_ROUTE_PATH_KIND, ROUTE_HIT_TOLERANCE)
    ?? featureAt(TRANSPORT_ROUTE_LAYER_CLASSNAME, TRANSPORT_ROUTE_KIND, ROUTE_HIT_TOLERANCE)

  if (routeFeature) {
    const routeId = routeFeature.get('routeId')
    if (isRouteVisible(routeId)) {
      return { target: TRANSPORT_CLICK_TARGET.ROUTE, stop: null, routeId }
    }
  }

  return { target: TRANSPORT_CLICK_TARGET.NONE, stop: null, routeId: null }
}
