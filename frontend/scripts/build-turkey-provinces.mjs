/**
 * Türkiye il sınırları veri kümesini üretir.
 *
 * ÇALIŞMA ZAMANINDA KULLANILMAZ. Bu betik bir GELİŞTİRME aracıdır: uzak veri
 * kümesini indirir, Türkiye'ye ait kayıtları ayıklar, sadeleştirir ve
 * `src/map/data/turkeyProvinces.json` dosyasını yazar. Uygulama ve testler
 * yalnızca o dosyayı okur — hiçbir istek ağa çıkmaz.
 *
 * Kaynağın tam künyesi, lisansı ve burada uygulanan işlemler
 * `docs/geographic-data-sources.md` dosyasındadır.
 *
 * Betik ayrıca 7 coğrafi bölgeyi İL SINIRLARININ BİRLEŞİMİNDEN üretir. Bu bir
 * YAKLAŞIMDIR ve öyle etiketlenir: resmî coğrafi bölge sınırları il sınırlarını
 * birebir takip etmez, bazı iller iki bölgeye bölünür. Birleştirme burada —
 * derleme zamanında — yapılır ki uygulama çalışırken bir topoloji kütüphanesi
 * taşımak zorunda kalmasın.
 *
 * Kullanım:
 *   node scripts/build-turkey-provinces.mjs                 # kaynağı indirir
 *   node scripts/build-turkey-provinces.mjs <yerel-dosya>   # indirilmişi kullanır
 */

import { writeFileSync, readFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import union from '@turf/union'
import { REGION_PROVINCE_CODES, REGIONS } from './turkeyRegions.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUTPUT = resolve(HERE, '../src/map/data/turkeyProvinces.json')

const SOURCE_URL =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson'

/**
 * Douglas–Peucker toleransı, DERECE cinsinden.
 *
 * Sadeleştirme bir yetki sınırını değiştirdiği için olabildiğince ölçülüdür:
 * 0.002° Türkiye enlemlerinde yaklaşık 170–220 metredir. Kaynağın kendisi
 * zaten 1:10.000.000 ölçek için genelleştirilmiş kartografik bir sınırdır,
 * dolayısıyla asıl belirsizlik buradan değil kaynaktan gelir — ve bu, hem
 * belgede hem de arayüzde açıkça söylenir.
 */
const TOLERANCE = 0.002

/** Koordinat başına ondalık basamak. 4 basamak ≈ 11 metre. */
const PRECISION = 4

/**
 * Sadeleştirmenin ASLA bozamayacağı asgari halka: kapalı bir üçgen.
 *
 * Bir halka bu sınırın altına düşecekse sadeleştirme O HALKA İÇİN atlanır.
 * Alternatif — halkayı atmak — küçük adaları ve kopuk parçaları sessizce yok
 * etmek olurdu; il sınırının bir bölümünün haritadan silinmesi demektir.
 */
const MIN_RING_POINTS = 4

async function loadSource(argument) {
  if (argument) return JSON.parse(readFileSync(resolve(argument), 'utf8'))

  const response = await fetch(SOURCE_URL)
  if (!response.ok) throw new Error(`Kaynak indirilemedi: HTTP ${response.status}`)
  return response.json()
}

/** Bir noktanın, iki uç arasındaki doğruya dik uzaklığı (derece düzleminde). */
function perpendicularDistance([x, y], [x1, y1], [x2, y2]) {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(x - x1, y - y1)
  const t = ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)
  const clamped = Math.max(0, Math.min(1, t))
  return Math.hypot(x - (x1 + clamped * dx), y - (y1 + clamped * dy))
}

function douglasPeucker(points, tolerance) {
  if (points.length < 3) return points

  let maxDistance = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(points[i], points[0], points.at(-1))
    if (distance > maxDistance) {
      maxDistance = distance
      index = i
    }
  }

  if (maxDistance <= tolerance) return [points[0], points.at(-1)]

  return [
    ...douglasPeucker(points.slice(0, index + 1), tolerance).slice(0, -1),
    ...douglasPeucker(points.slice(index), tolerance),
  ]
}

const round = (value) => Number(value.toFixed(PRECISION))

/** Halkayı sadeleştirir; sonuç geçersiz olacaksa HALKA OLDUĞU GİBİ KALIR. */
function simplifyRing(ring) {
  const simplified = douglasPeucker(ring, TOLERANCE)
  const source = simplified.length >= MIN_RING_POINTS ? simplified : ring

  const rounded = source.map(([lon, lat]) => [round(lon), round(lat)])

  // Yuvarlama art arda gelen noktaları çakıştırabilir; halka kapalı kalmalıdır.
  const deduped = rounded.filter(
    (point, i) => i === 0 || point[0] !== rounded[i - 1][0] || point[1] !== rounded[i - 1][1],
  )
  const [first] = deduped
  const last = deduped.at(-1)
  if (first[0] !== last[0] || first[1] !== last[1]) deduped.push([...first])

  return deduped.length >= MIN_RING_POINTS ? deduped : rounded
}

/**
 * Bir feature'ın geometrisini POLİGON LİSTESİNE çevirir.
 *
 * MultiPolygon parçaları BİRLEŞTİRİLMEZ ve ATILMAZ: her parça kendi poligonu
 * olarak listeye girer. Saklama modeli satır başına tek Polygon olduğu için,
 * adaları olan bir il birden çok satır hâline gelir — parçalarından biri
 * sessizce kaybolmaz.
 */
function toPolygons(geometry) {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates
  return polygons.map((rings) => rings.map(simplifyRing))
}

const source = await loadSource(process.argv[2])

const provinces = source.features
  .filter((feature) => feature.properties?.adm0_a3 === 'TUR')
  .map((feature) => {
    const { iso_3166_2: iso, name, name_tr: nameTr } = feature.properties
    return {
      // TR-06 gibi ISO 3166-2 kodu: kararlı, resmî ve okunabilir bir anahtar.
      code: iso,
      name: nameTr || name,
      polygons: toPolygons(feature.geometry),
    }
  })
  .sort((a, b) => a.name.localeCompare(b.name, 'tr'))

if (provinces.length !== 81) {
  throw new Error(`81 il bekleniyordu, ${provinces.length} bulundu. Kaynak değişmiş olabilir.`)
}

const missingCode = provinces.find((province) => !/^TR-\d{2}$/.test(province.code ?? ''))
if (missingCode) throw new Error(`Geçersiz il kodu: ${JSON.stringify(missingCode.code)}`)

/* --- Bölgeler: il birleşimi --------------------------------------------------
   Her bölge, kendisine bağlanan illerin poligonlarının GERÇEK mekânsal
   birleşimidir. Kapsayan dikdörtgen ya da halkaları uç uca eklemek DEĞİLDİR:
   ikisi de hiçbir ilin kapsamadığı yerleri bölgenin içindeymiş gibi
   gösterirdi. Birleşim komşu illerin ortak sınırlarını eritir; kopuk parçalar
   (adalar) ayrı poligon olarak kalır ve atılmaz. */

const byCode = new Map(provinces.map((province) => [province.code, province]))

const asFeature = (rings) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } })

function unionOf(polygonList) {
  let merged = null
  for (const rings of polygonList) {
    const feature = asFeature(rings)
    merged = merged === null ? feature : union({ type: 'FeatureCollection', features: [merged, feature] })
    if (merged === null) throw new Error('Bölge birleşimi başarısız oldu.')
  }
  return merged.geometry.type === 'Polygon' ? [merged.geometry.coordinates] : merged.geometry.coordinates
}

const regions = REGIONS.map(({ key, name }) => {
  const codes = REGION_PROVINCE_CODES[key]
  const polygonList = codes.flatMap((code) => {
    const province = byCode.get(code)
    if (!province) throw new Error(`${key} bölgesinde tanınmayan il kodu: ${code}`)
    return province.polygons
  })

  return {
    key,
    name,
    provinceCodes: codes,
    // Yuvarlama birleşimden SONRA tekrarlanır: turf ara hesaplarda daha uzun
    // ondalıklar üretebilir ve dosya gereksiz büyürdü.
    polygons: unionOf(polygonList).map((rings) =>
      rings.map((ring) => ring.map(([lon, lat]) => [round(lon), round(lat)])),
    ),
  }
})

const assigned = Object.values(REGION_PROVINCE_CODES).flat()
if (assigned.length !== 81 || new Set(assigned).size !== 81) {
  throw new Error('Bölge eşlemesi 81 ilin her birini tam olarak bir kez içermelidir.')
}

mkdirSync(dirname(OUTPUT), { recursive: true })
writeFileSync(OUTPUT, `${JSON.stringify({ provinces, regions })}\n`, 'utf8')

const count = (items) =>
  items.reduce((sum, item) => sum + item.polygons.reduce((s, rs) => s + rs.reduce((n, r) => n + r.length, 0), 0), 0)

console.log(
  `${provinces.length} il (${provinces.reduce((s, p) => s + p.polygons.length, 0)} poligon, ${count(provinces)} nokta), ` +
    `${regions.length} bölge (${regions.reduce((s, r) => s + r.polygons.length, 0)} poligon, ${count(regions)} nokta) -> ${OUTPUT}`,
)
