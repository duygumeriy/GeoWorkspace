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

/* --- Tıklamanın SEÇİMDEKİ karşılığı ---------------------------------------------
   `resolveTransportClick` NEYE tıklandığını söyler; bu fonksiyon o isabetin
   SEÇİM durumunda ne anlama geldiğini söyler. İkisini ayırmak, kararın
   React'siz ve tarayıcısız sınanabilmesini sağlar — kanca yalnızca sonucu
   uygular ve ikinci bir kural kitabı tutmaz. */

/** Bir ulaşım tıklamasının seçim üzerindeki sonucu. */
export const TRANSPORT_CLICK_ACTIONS = Object.freeze({
  /** Araç: balonunu kendi katmanı açar, seçim zinciri çekilir. */
  IGNORE: 'ignore',
  SELECT_STOP: 'selectStop',
  SELECT_ROUTE: 'selectRoute',
  /** Seçim bırakılır. Yalnızca GERÇEKTEN boş tıklamada güzergah da bırakılır. */
  CLEAR: 'clear',
})

/**
 * Bir isabetin seçim sonucunu belirler.
 *
 * <b>Sonuç YALNIZCA seçim taşır.</b> Tipte başlatma, durdurma, duraklatma,
 * izleme ya da takip için bir alan YOKTUR ve olmamalıdır: boş bir harita
 * tıklamasının çok kullanıcılı bir çalıştırmayı durdurabilmesi ya da bir
 * kamerayı bırakabilmesi yapısal olarak imkânsız kalmalıdır. Bu, yorumla değil
 * tipin ŞEKLİYLE garanti edilir.
 *
 * <b><code>clearsRoute</code> yalnızca hiçbir şeye tıklanmadığında doğrudur.</b>
 * Görünmez bir güzergaha ya da seçim işleyicisi olmayan bir güzergaha tıklamak
 * BOŞ tıklama değildir: kullanıcı gerçek bir nesneye dokunmuştur ve seçili
 * hattı kaybetmeyi beklemez. Ayrım olmasaydı, gizlenmiş bir hattın üstüne
 * tıklamak seçili hattı sessizce düşürürdü.
 *
 * @param {{ target?: string, stop?: object|null, routeId?: number|null }} hit
 * @param {{ canSelectRoute?: boolean }} [options]
 */
export function transportClickOutcome(hit, { canSelectRoute = true } = {}) {
  const target = hit?.target ?? TRANSPORT_CLICK_TARGET.NONE

  if (target === TRANSPORT_CLICK_TARGET.VEHICLE) {
    return Object.freeze({
      action: TRANSPORT_CLICK_ACTIONS.IGNORE,
      stop: null,
      routeId: null,
      clearsRoute: false,
    })
  }

  if (target === TRANSPORT_CLICK_TARGET.STOP) {
    return Object.freeze({
      action: TRANSPORT_CLICK_ACTIONS.SELECT_STOP,
      stop: hit?.stop ?? null,
      routeId: null,
      clearsRoute: false,
    })
  }

  if (target === TRANSPORT_CLICK_TARGET.ROUTE && canSelectRoute) {
    return Object.freeze({
      action: TRANSPORT_CLICK_ACTIONS.SELECT_ROUTE,
      stop: null,
      routeId: hit?.routeId ?? null,
      clearsRoute: false,
    })
  }

  return Object.freeze({
    action: TRANSPORT_CLICK_ACTIONS.CLEAR,
    stop: null,
    routeId: null,
    /* Güzergah YALNIZCA boş haritada bırakılır. Seçim işleyicisi olmayan bir
       güzergah isabeti mevcut davranışı korur: durak seçimi bırakılır, hat
       seçimi KORUNUR — tıklanan şey gerçek bir nesnedir. */
    clearsRoute: target === TRANSPORT_CLICK_TARGET.NONE,
  })
}
