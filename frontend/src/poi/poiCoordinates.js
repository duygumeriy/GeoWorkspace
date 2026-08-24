/**
 * POI koordinatının TEK yorumu: doğrulama, gösterim biçimi ve "değişti mi"
 * kararı.
 *
 * Konum artık düzenlenebilir bir alandır ve iki ayrı yerden düzenlenir —
 * formdaki boylam/enlem kutuları ve haritada sürüklenen taslak işaret. İkisinin
 * de aynı sayıyı, aynı sınırlarla ve aynı eşitlik ölçüsüyle üretmesi gerekir;
 * bu yüzden kural burada bir kez tanımlanır.
 *
 * <b>Değerler EPSG:4326'dır.</b> Haritanın kendi projeksiyonu (EPSG:3857)
 * yalnızca `map/poi.js` içindeki dönüşüm yardımcılarında görünür; bu modül
 * boylam/enlem dışında bir birim tanımaz.
 *
 * <b>Doğrulama istemcide yalnızca UX içindir.</b> Sınırların sahibi sunucudur
 * (<c>PoiAttributeValidator</c>); buradaki kontroller garanti reddedilecek bir
 * isteği açmamak içindir.
 */

export const LONGITUDE_LIMIT = 180
export const LATITUDE_LIMIT = 90

/**
 * İki koordinatı "aynı" sayan eşik: 1e-7 derece, ekvatorda ~1.1 cm.
 *
 * <b>Neden ham eşitlik değil.</b> Haritada sürüklenen nokta EPSG:3857'de
 * yaşar ve 4326'ya geri çevrilirken son basamaklarda kayan nokta gürültüsü
 * doğar. Ham karşılaştırma, kullanıcı işarete yalnızca dokunup bıraktığında
 * bile formu "kirli" gösterirdi. Eşik, o gürültünün büyüklük mertebesinin çok
 * üstünde ama gerçek bir taşımanın (metrelerce) çok altındadır: santimetrenin
 * altındaki bir fark kimsenin niyetle yaptığı bir taşıma değildir.
 *
 * Tarih/saat mantığıyla hiçbir ilgisi yoktur; yalnızca sayısal bir toleranstır.
 */
export const COORDINATE_EPSILON = 1e-7

/**
 * Gösterim/giriş hassasiyeti: 7 ondalık (~1.1 cm).
 *
 * Kalıcı değer YUVARLANMAZ — bu yalnızca kutuya yazılan metindir. Taslağın
 * sayısal değeri, kullanıcı gerçekten bir şey yazana ya da işareti taşıyana
 * kadar sunucudan gelen değerin ta kendisi olarak kalır.
 */
const INPUT_DECIMALS = 7

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

export function isValidLongitude(value) {
  return isFiniteNumber(value) && value >= -LONGITUDE_LIMIT && value <= LONGITUDE_LIMIT
}

export function isValidLatitude(value) {
  return isFiniteNumber(value) && value >= -LATITUDE_LIMIT && value <= LATITUDE_LIMIT
}

/**
 * Kutudaki metni sayıya çevirir.
 *
 * Boş metin, kısmi girdi ("-", "32."), harf içeren metin ve NaN/Infinity
 * <c>null</c> döner — ONARILMAZ ve 0'a düşürülmez. Eksik bir koordinatı
 * sessizce sıfır saymak, POI'yi Gine Körfezi'ne taşımak olurdu.
 */
export function parseCoordinateInput(text) {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null

  const trimmed = (text ?? '').trim().replace(',', '.')
  if (trimmed.length === 0) return null
  // Number('') === 0 ve Number(' ') === 0; katı bir biçim sınaması şarttır.
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed)) return null

  const value = Number(trimmed)
  return Number.isFinite(value) ? value : null
}

/** Kutuya yazılacak metin. Kalıcı değeri DEĞİL, yalnızca gösterimi biçimler. */
export function formatCoordinateInput(value) {
  if (!isFiniteNumber(value)) return ''
  // Sondaki sıfırlar atılır: "32.8597000" değil "32.8597".
  return String(Number(value.toFixed(INPUT_DECIMALS)))
}

/**
 * Bir koordinat ÇİFTİNİ doğrular.
 *
 * Çift olarak sınanır çünkü yarım bir koordinat diye bir şey yoktur: yalnızca
 * boylamı geçerli olan bir nokta haritada bir yer göstermez.
 *
 * @returns {{ valid: boolean, errors: { longitude?: string, latitude?: string } }}
 */
export function validateCoordinatePair(coordinate) {
  const errors = {}

  if (!isValidLongitude(coordinate?.longitude)) {
    errors.longitude = `Boylam -${LONGITUDE_LIMIT} ile ${LONGITUDE_LIMIT} arasında bir sayı olmalıdır.`
  }

  if (!isValidLatitude(coordinate?.latitude)) {
    errors.latitude = `Enlem -${LATITUDE_LIMIT} ile ${LATITUDE_LIMIT} arasında bir sayı olmalıdır.`
  }

  return { valid: Object.keys(errors).length === 0, errors }
}

/** Çift, sunulabilir bir konum mu (ikisi de var ve aralıkta). */
export function isValidCoordinate(coordinate) {
  return validateCoordinatePair(coordinate).valid
}

/**
 * İki konum ANLAMCA aynı mı (bkz. <see cref="COORDINATE_EPSILON"/>).
 *
 * Nesne kimliği karşılaştırılmaz: her sürükleme yeni bir nesne üretir ve
 * kimlik kıyası her dokunuşu "taşındı" sayardı.
 */
export function coordinatesEqual(left, right, epsilon = COORDINATE_EPSILON) {
  if (!left || !right) return left === right

  if (!isFiniteNumber(left.longitude) || !isFiniteNumber(right.longitude)) return false
  if (!isFiniteNumber(left.latitude) || !isFiniteNumber(right.latitude)) return false

  return (
    Math.abs(left.longitude - right.longitude) <= epsilon
    && Math.abs(left.latitude - right.latitude) <= epsilon
  )
}
