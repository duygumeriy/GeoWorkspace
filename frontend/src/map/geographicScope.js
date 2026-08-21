import WKT from 'ol/format/WKT'
import Polygon from 'ol/geom/Polygon'
import { toLonLat } from 'ol/proj'
import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import lineIntersect from '@turf/line-intersect'
import { lineString, multiLineString, multiPolygon, polygon as turfPolygon } from '@turf/helpers'
import { DATA_PROJECTION } from './drawing.js'

/**
 * Kullanıcının yürürlükteki coğrafi yetki alanı ve "bu geometri içeride mi"
 * sorusunun istemci tarafındaki cevabı.
 *
 * <b>Burası bir GÜVENLİK SINIRI DEĞİLDİR.</b> Backend her çizim isteğinde aynı
 * soruyu PostGIS/NetTopologySuite ile yeniden sorar ve alan dışındaki isteğe
 * 403 döner. Buradaki hesap yalnızca kullanıcıyı, sonradan reddedilecek bir
 * çizimi bitirmeye ve üstüne bir de ad/renk girmeye zorlamamak içindir.
 *
 * <b>Kural backend'in Covers semantiğini yansıtır:</b> geometrinin TAMAMI
 * alanın içinde olmalıdır ve SINIR içeriye dâhildir. Alanın kenarına çizilen
 * bir nokta ya da tam sınır boyunca giden bir çizgi reddedilmez — kullanıcının
 * alanının kenarı, alanının dışı değildir.
 *
 * <b>Köşe denetimi TEK BAŞINA yeterli değildir</b> ve burada yalnızca köşelere
 * bakılmaz. İçbükey bir alanın girintisinden ya da kopuk iki bölgenin
 * arasındaki boşluktan geçen bir çizginin İKİ UCU DA içeride olabilir; aradaki
 * bölüm değildir. Bu yüzden her kenar, alanın sınırıyla kesiştiği noktalardan
 * bölünür ve ortaya çıkan her parçanın ORTA NOKTASI ayrıca sınanır.
 */

const wktFormat = new WKT()

/**
 * Sunucudan gelen WKT'yi sınanabilir bir kapsama çevirir.
 *
 * @param {string|null|undefined} wkt EPSG:4326 Polygon veya MultiPolygon
 * @returns {{ area: object, boundary: object, polygons: number[][][][] }|null}
 */
export function parseScope(wkt) {
  if (!wkt) return null

  let geometry
  try {
    // Dönüşüm YOK: WKT zaten boylam/enlemdir ve turf de öyle çalışır.
    geometry = wktFormat.readGeometry(wkt)
  } catch {
    /* Bozuk bir WKT "kısıt yok" ANLAMINA GELMEZ. null döndürmek, çağıranın
       kapsamı hiç öğrenemediğini bildirir; çağıran da bunu "her yere
       çizilebilir" diye yorumlamaz (bkz. useGeographicScope). */
    return null
  }

  const type = geometry.getType()
  const polygons =
    type === 'Polygon'
      ? [geometry.getCoordinates()]
      : type === 'MultiPolygon'
        ? geometry.getCoordinates()
        : null

  if (!polygons?.length) return null

  return {
    /** Nokta içerme sınamaları için tek bir çok-parçalı yüzey. */
    area: multiPolygon(polygons),
    /** Kenar kesişimi için TÜM halkalar (dış halkalar ve delikler). */
    boundary: multiLineString(polygons.flat()),
    /** Haritaya çizmek için ham halka listesi. */
    polygons,
  }
}

/** Boylam/enlem noktası alanın içinde (veya sınırında) mi. */
export function isLonLatInsideScope(scope, lonLat) {
  if (!scope) return true
  /* `ignoreBoundary` verilmez: varsayılan olarak SINIR İÇERİDEDİR. Bu,
     backend'in Contains değil Covers kullanmasının birebir karşılığıdır. */
  return booleanPointInPolygon(lonLat, scope.area)
}

/** Harita koordinatı (EPSG:3857) alanın içinde mi. */
export function isMapCoordinateInsideScope(scope, coordinate) {
  if (!scope) return true
  return isLonLatInsideScope(scope, toLonLat(coordinate))
}

/**
 * İki nokta arasındaki DOĞRU PARÇASININ tamamı alanın içinde mi.
 *
 * Uçlara bakmak yetmez: parça, alandan çıkıp yeniden girebilir. Parça, alan
 * sınırıyla kesiştiği her noktadan bölünür ve her bölümün orta noktası
 * sınanır — dışarı çıkan bir bölüm varsa orta noktası dışarıdadır.
 */
export function isSegmentInsideScope(scope, from, to) {
  if (!scope) return true
  if (!isLonLatInsideScope(scope, from) || !isLonLatInsideScope(scope, to)) return false

  const [x1, y1] = from
  const [x2, y2] = to
  const dx = x2 - x1
  const dy = y2 - y1

  // Sıfır uzunluklu parça: uçları zaten sınandı.
  if (dx === 0 && dy === 0) return true

  const crossings = lineIntersect(lineString([from, to]), scope.boundary)
    .features.map((hit) => parameterOf(hit.geometry.coordinates, x1, y1, dx, dy))
    .filter((t) => t > 0 && t < 1)

  const stops = [0, ...crossings, 1].sort((a, b) => a - b)

  for (let i = 0; i < stops.length - 1; i += 1) {
    const middle = (stops[i] + stops[i + 1]) / 2
    if (!isLonLatInsideScope(scope, [x1 + dx * middle, y1 + dy * middle])) return false
  }

  return true
}

/** Noktanın parça üzerindeki 0..1 konumu; daha uzun eksene göre okunur. */
function parameterOf([x, y], x1, y1, dx, dy) {
  return Math.abs(dx) >= Math.abs(dy) ? (x - x1) / dx : (y - y1) / dy
}

/** Köşe dizisinin (açık ya da kapalı) tamamı alanın içinde mi. */
function isPathInsideScope(scope, path) {
  for (let i = 0; i < path.length - 1; i += 1) {
    if (!isSegmentInsideScope(scope, path[i], path[i + 1])) return false
  }
  // Tek köşeli yol (dejenere çizim) için uçlar da sınanmalıdır.
  return path.length !== 1 || isLonLatInsideScope(scope, path[0])
}

/**
 * Haritadaki bir OpenLayers geometrisinin TAMAMI alanın içinde mi.
 *
 * Aday sınırının tamamı yetkili alanda olmalı ve aday yüzey, yetki alanındaki
 * hiçbir iç deliği kapsamamalıdır. İkinci koşul özellikle önemlidir: büyük bir
 * aday poligonun bütün köşeleri ve kenarları yetkili alanda kalırken, ortasında
 * bütünüyle çevrelediği küçük bir yasak delik bulunabilir.
 *
 * @param {import('ol/geom/Geometry').default|null|undefined} geometry EPSG:3857
 */
export function isGeometryInsideScope(scope, geometry) {
  if (!scope) return true
  if (!geometry) return false

  const toLonLatPath = (coords) => coords.map((coordinate) => toLonLat(coordinate))

  switch (geometry.getType()) {
    case 'Point':
      return isLonLatInsideScope(scope, toLonLat(geometry.getCoordinates()))

    case 'LineString':
      return isPathInsideScope(scope, toLonLatPath(geometry.getCoordinates()))

    case 'Polygon':
      return isPolygonInsideScope(scope, geometry.getCoordinates().map(toLonLatPath))

    case 'MultiPolygon':
      return geometry
        .getCoordinates()
        .every((rings) => isPolygonInsideScope(scope, rings.map(toLonLatPath)))

    default:
      /* Tanınmayan tip için "içeride" demek, bilinmeyen bir şeyi güvenli
         saymak olurdu. Backend zaten kendi denetimini yapar; burada engel
         çıkarmamak için izin verilir ve karar sunucuya bırakılır. */
      return true
  }
}

function isPolygonInsideScope(scope, rings) {
  // Dış halka ve varsa adayın kendi delikleri sınırdan dışarı taşmamalıdır.
  if (!rings.every((ring) => isPathInsideScope(scope, ring))) return false

  const candidate = turfPolygon(rings)

  /* Aday sınırı bir yetki deliğine hiç dokunmadan onu bütünüyle çevreleyebilir.
     Her yetki deliğinin OpenLayers tarafından hesaplanan gerçek bir iç noktası
     aday yüzeydeyse, backend Covers ile aynı nedenle aday reddedilir. */
  for (const scopePolygon of scope.polygons) {
    for (const hole of scopePolygon.slice(1)) {
      const interior = new Polygon([hole]).getInteriorPoint().getCoordinates()
      if (booleanPointInPolygon(interior, candidate)) return false
    }
  }

  return true
}

/**
 * Boylam/enlem halkasından turf poligonu — kapsam DIŞINDA kalan yerlerde
 * (örneğin yönetim ekranının önizlemesi) tek tek poligon sınamak için.
 */
export function lonLatPolygon(rings) {
  return turfPolygon(rings)
}

export { DATA_PROJECTION }
