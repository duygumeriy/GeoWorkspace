/* İçe aktarma niteliği (`with { type: 'json' }`) STANDARTTIR ve iki tarafı
   birden çalıştırır: Vite paketlemeyi zaten yapıyordu, Node ise nitelik
   olmadan bir JSON modülünü ESM olarak yükleyemez. Niteliksiz hâli, bu
   modülü kullanan her şeyi birim testlerinin dışında bırakıyordu. */
import data from './data/turkeyProvinces.json' with { type: 'json' }

/**
 * Türkiye il ve coğrafi bölge sınırları — YEREL veri kümesi.
 *
 * <b>Çalışma zamanında hiçbir ağ isteği yapılmaz.</b> Veri uygulamayla birlikte
 * paketlenir. Uzak bir servise bağlanmak, yönetici ekranını üçüncü taraf bir
 * servisin ayakta olmasına bağlar, testleri canlı internete muhtaç kılar ve en
 * kötüsü, sessizce değişen bir sınırın kaydedilmiş bir yetki alanının anlamını
 * kaydırmasına izin verirdi.
 *
 * <b>Sınırlar UYDURULMAMIŞTIR.</b> Kaynak, lisans (kamu malı), indirilme tarihi
 * ve uygulanan sadeleştirme `docs/geographic-data-sources.md` dosyasındadır.
 * Betik: `scripts/build-turkey-provinces.mjs`.
 *
 * <b>Bu veri bir yetkilendirme kaynağı DEĞİLDİR.</b> Buradan üretilen poligon,
 * yöneticinin kaydetmeyi seçtiği bir BAŞLANGIÇ geometrisidir; kaydedildikten
 * sonra yetkinin kaynağı veritabanındaki poligonun kendisi olur. Veri kümesi
 * ileride güncellenirse, kaydedilmiş alanlar değişmez.
 */

/** Kaydedilecek alanın kaynağı — backend'in `GeographicAreaSource` enum'u. */
export const AREA_SOURCES = Object.freeze({
  MANUAL: 'ManualPolygon',
  PROVINCE: 'Province',
  REGION: 'Region',
  COORDINATES: 'Coordinates',
})

/** 81 il, Türkçe alfabetik sırada. */
export const PROVINCES = Object.freeze(data.provinces)

/** 7 coğrafi bölge. */
export const REGIONS = Object.freeze(data.regions)

/**
 * Bölge kapsamının ne OLMADIĞINI söyleyen etiket.
 *
 * Resmî coğrafi bölge sınırları il sınırlarını birebir takip etmez; buradaki
 * bölgeler illerin birleşimidir. Bu cümle arayüzde GÖRÜNÜR — yaklaşık bir
 * sınırı resmî bir sınır gibi sunmak, yöneticinin doğru sandığı bir kapsamla
 * yetki vermesi olurdu.
 */
export const REGION_APPROXIMATION_NOTE =
  'İl sınırlarının birleşiminden oluşturulan yaklaşık bölge kapsamı. ' +
  'Resmî coğrafi bölge sınırları il sınırlarını birebir takip etmez.'

const provinceByCode = new Map(PROVINCES.map((province) => [province.code, province]))
const regionByKey = new Map(REGIONS.map((region) => [region.key, region]))

export function provinceByCodeOrNull(code) {
  return provinceByCode.get(code) ?? null
}

export function regionByKeyOrNull(key) {
  return regionByKey.get(key) ?? null
}

/**
 * Halka listesini EPSG:4326 Polygon WKT'sine çevirir.
 *
 * OpenLayers üzerinden geçirilmez: veri zaten boylam/enlem olarak durur ve
 * 4326 → 3857 → 4326 gidiş dönüşü, hiçbir şey kazandırmadan her koordinata
 * yuvarlama hatası eklerdi.
 *
 * @param {number[][][]} rings dış halka ve varsa iç halkalar
 * @returns {string}
 */
export function ringsToWkt(rings) {
  const parts = rings.map((ring) => `(${ring.map(([lon, lat]) => `${lon} ${lat}`).join(', ')})`)
  return `POLYGON (${parts.join(', ')})`
}

/**
 * Bir ilin kaydedilebilir alanları.
 *
 * <b>Parçalar BİRLEŞTİRİLMEZ ve ATILMAZ.</b> Saklama modeli satır başına tek
 * Polygon olduğu için, adaları olan bir il birden çok alan üretir; her biri
 * kendi adıyla listelenir. Yalnızca en büyük parçayı almak, o ilin adalarını
 * sessizce yetki alanının dışında bırakmak olurdu.
 *
 * @param {string} code ISO 3166-2 (`TR-06`)
 * @returns {{ name: string, wkt: string, sourceType: string, sourceKey: string }[]}
 */
export function provinceAreas(code) {
  const province = provinceByCode.get(code)
  if (!province) return []

  return province.polygons.map((rings, index) => ({
    name: province.polygons.length === 1 ? province.name : `${province.name} (${index + 1})`,
    wkt: ringsToWkt(rings),
    sourceType: AREA_SOURCES.PROVINCE,
    sourceKey: province.code,
  }))
}

/**
 * Bir coğrafi bölgenin kaydedilebilir alanları.
 *
 * Birleşim DERLEME zamanında yapılmıştır (bkz. betik): komşu illerin ortak
 * sınırları erimiş, kopuk parçalar korunmuştur. Bu yüzden bir bölge çoğunlukla
 * tek bir alan üretir, adaları olanlar birkaç tane.
 *
 * @param {string} key bölge anahtarı (`IC_ANADOLU`)
 */
export function regionAreas(key) {
  const region = regionByKey.get(key)
  if (!region) return []

  return region.polygons.map((rings, index) => ({
    name: region.polygons.length === 1 ? `${region.name} Bölgesi` : `${region.name} Bölgesi (${index + 1})`,
    wkt: ringsToWkt(rings),
    sourceType: AREA_SOURCES.REGION,
    sourceKey: region.key,
  }))
}
