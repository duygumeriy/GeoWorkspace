/**
 * Elle girilen koordinatlardan alan üretimi.
 *
 * <b>Birim EPSG:4326'dır: boylam, enlem.</b> Sıra bilinçli olarak (lon, lat)'tır
 * — WKT'nin, GeoJSON'un ve bu projedeki tüm çizim uçlarının sırası budur.
 * Arayüz her satırda hangi kutunun hangisi olduğunu açıkça yazar, çünkü
 * (lat, lon) sırası da yaygındır ve karıştırıldığında poligon sessizce
 * Türkiye'nin dışına düşer.
 *
 * <b>Metrik koordinat KABUL EDİLMEZ.</b> Web Mercator (EPSG:3857) metre
 * değerleri — örneğin 3561000 — aralık denetimine takılır ve anlaşılır bir
 * mesajla reddedilir. Sessizce 4326 sanmak, kullanıcının alanını dünyanın
 * bambaşka bir yerine taşımak olurdu.
 */

/** Poligonun kapanmadan önceki en az köşe sayısı. */
export const MIN_VERTICES = 3

const LON_RANGE = [-180, 180]
const LAT_RANGE = [-90, 90]

/**
 * Serbest metinden köşe listesi.
 *
 * Kabul edilen biçim satır başına bir köşedir; ayırıcı virgül, noktalı virgül,
 * sekme ya da boşluk olabilir. Ondalık ayırıcı olarak virgül KABUL EDİLMEZ:
 * "32,85 39,92" ile "32.85, 39.92" arasındaki farkı tahmin etmek, yanlış
 * tahminde alanı bambaşka bir yere taşırdı.
 *
 * @param {string} text
 * @returns {{ coords: number[][], error: string|null }}
 */
export function parseCoordinateText(text) {
  const lines = (text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'))

  if (lines.length === 0) {
    return { coords: [], error: null }
  }

  const coords = []

  for (const [index, line] of lines.entries()) {
    const parts = line.split(/[,;\t ]+/).filter(Boolean)

    if (parts.length !== 2) {
      return { coords: [], error: `${index + 1}. satırda iki değer bekleniyor: boylam ve enlem.` }
    }

    const lon = Number(parts[0])
    const lat = Number(parts[1])

    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      return { coords: [], error: `${index + 1}. satırdaki değerler sayı değil.` }
    }

    if (lon < LON_RANGE[0] || lon > LON_RANGE[1]) {
      return { coords: [], error: `${index + 1}. satırdaki boylam ${LON_RANGE[0]}..${LON_RANGE[1]} aralığında olmalı.` }
    }

    if (lat < LAT_RANGE[0] || lat > LAT_RANGE[1]) {
      return { coords: [], error: `${index + 1}. satırdaki enlem ${LAT_RANGE[0]}..${LAT_RANGE[1]} aralığında olmalı.` }
    }

    coords.push([lon, lat])
  }

  return { coords, error: null }
}

/** İki köşe aynı yer mi (kapanış köşesini saymamak için). */
const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1]

/**
 * Köşe listesinden EPSG:4326 Polygon WKT'si.
 *
 * Halka OTOMATİK KAPATILIR: kullanıcıdan ilk köşeyi sonda tekrar etmesini
 * beklemek, WKT'nin bir uygulama detayını arayüze sızdırmak olurdu. Zaten
 * kapalı gönderilmişse ikinci kez kapatılmaz.
 *
 * @param {number[][]} coords
 * @returns {{ wkt: string|null, error: string|null }}
 */
export function coordinatesToPolygonWkt(coords) {
  const distinct = coords.filter((point, index) => index === 0 || !samePoint(point, coords[index - 1]))

  const open =
    distinct.length > 1 && samePoint(distinct[0], distinct.at(-1)) ? distinct.slice(0, -1) : distinct

  if (open.length < MIN_VERTICES) {
    return {
      wkt: null,
      error: `Bir alan için en az ${MIN_VERTICES} farklı köşe gerekir; şu an ${open.length} köşe var.`,
    }
  }

  const ring = [...open, open[0]]
  return { wkt: `POLYGON ((${ring.map(([lon, lat]) => `${lon} ${lat}`).join(', ')}))`, error: null }
}

/**
 * Metinden doğrudan WKT'ye.
 *
 * <b>Topolojik geçerlilik burada SINANMAZ.</b> Kendisiyle kesişen bir halkayı
 * tarayıcıda tespit etmek ayrı bir geometri kütüphanesi taşımak demekti;
 * backend bunu zaten aynı parser'la denetler ve anlaşılır bir 400 döner.
 * Buradaki denetimler yalnızca "sunucuya gitmeye bile değmeyecek" hataları —
 * eksik köşe, sayı olmayan değer, aralık dışı koordinat — erken yakalar.
 */
export function coordinateTextToWkt(text) {
  const { coords, error } = parseCoordinateText(text)
  if (error) return { wkt: null, error }
  if (coords.length === 0) return { wkt: null, error: null }
  return coordinatesToPolygonWkt(coords)
}

/** Köşe listesini düzenleyici metnine çevirir (var olan alanı düzenlerken). */
export function coordinatesToText(coords) {
  return coords.map(([lon, lat]) => `${lon}, ${lat}`).join('\n')
}
