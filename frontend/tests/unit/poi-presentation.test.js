import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  POI_PRESENTATION_Z_INDEX,
  PRESENTATION_Z_INDEX,
} from '../../src/map/mapPresentation.js'
import { HEATMAP_LAYER_Z_INDEX } from '../../src/map/heatmap.js'
import {
  POI_DRAFT_LAYER_Z_INDEX,
  POI_LAYER_Z_INDEX,
  POI_PENDING_LAYER_Z_INDEX,
  createPoiLayer,
} from '../../src/map/poi.js'
import {
  MARKER_BANDS,
  MARKER_SIZES,
  markerBandForResolution,
  markerSizeForResolution,
  scaleDenominatorFor,
} from '../../src/map/poiMarkerScale.js'
import {
  SELECTION_COLOR,
  markerCacheSizes,
  poiBadgeDataUri,
  poiMarkerStyle,
  prewarmPoiBadges,
} from '../../src/map/poiMarkerStyle.js'

/**
 * Faz 4 — POI'nin kalıcı görünümü GeoServer WMS'ten gelir.
 *
 * Burada kanıtlanan iki şey var:
 *
 *   1. tarayıcı GeoServer'a DOĞRUDAN gitmez — yalnızca uygulamanın kimlik
 *      doğrulamalı ucunu bilir,
 *   2. raster devraldığında vektör aynı POI'yi İKİNCİ kez çizmez, ama
 *      tıklanabilir kalır (bu fazda GetFeatureInfo yoktur, kimlik hâlâ
 *      vektördedir).
 */

const isTransparent = (color) => /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)$/.test(color)

const poiFeature = (id, categoryId = 3) => ({
  get: (key) => {
    if (key === 'poiId') return id
    if (key === 'categoryId') return categoryId
    return undefined
  },
})

/** Kategori sunum metadatası; gerçekte `GET /api/poi/categories`ten gelir. */
const presentation = (categoryId) =>
  categoryId === 3 ? { iconKey: 'pill', colorHex: '#EF4444' } : null

/* Lucide gövdelerinden birer imza parçası. Tam yolu kopyalamak, kütüphane
   simgeyi rötuşladığında kırılan kırılgan bir test olurdu. */
const pillGlyph = 'm8.5 8.5 7 7'

/** Web Mercator: ekvatorda zoom → çözünürlük (metre/piksel). */
const resolutionAt = (zoom) => 156543.03392804097 / 2 ** zoom
const mapPinGlyph = 'M20 10c0 4.993-5.539 10.193-7.399 11.799'

/* --- Katman sırası ------------------------------------------------------------ */

test('the POI raster sits above the drawing rasters and below every interaction layer', () => {
  // Küçük bir nokta, büyük bir poligon görüntüsünün altında kalmamalıdır.
  assert.ok(POI_PRESENTATION_Z_INDEX > PRESENTATION_Z_INDEX.polygon)
  assert.ok(POI_PRESENTATION_Z_INDEX > PRESENTATION_Z_INDEX.line)
  assert.ok(POI_PRESENTATION_Z_INDEX > PRESENTATION_Z_INDEX.point)
  assert.ok(POI_PRESENTATION_Z_INDEX > HEATMAP_LAYER_Z_INDEX)

  /* Geçici düzenleme/yerleştirme işaretleri kalıcı görüntünün ÜSTÜNDE kalır:
     kullanıcının az önce koyduğu ya da sürüklediği nokta hiçbir zaman bir
     rasterin altında kaybolmamalıdır. */
  assert.ok(POI_PRESENTATION_Z_INDEX < POI_LAYER_Z_INDEX)
  assert.ok(POI_PRESENTATION_Z_INDEX < POI_PENDING_LAYER_Z_INDEX)
  assert.ok(POI_PRESENTATION_Z_INDEX < POI_DRAFT_LAYER_Z_INDEX)
})

test('no existing layer had to be renumbered', () => {
  // 11 zaten boştu: çizim vektörleri 10, bekleyen çizim 12.
  assert.equal(POI_PRESENTATION_Z_INDEX, 11)
})

/* --- Dört görsel durum --------------------------------------------------------
   Faz 5B: bir POI HİÇBİR durumda genel bir mavi noktaya dönüşmez. Raster gelir
   gider, seçim değişir, harita yakınlaşır — kategori kimliği hep durur. */

const iconOf = (styles) => styles.find((style) => style.getImage()?.getSrc)
const circlesOf = (styles) => styles.filter((style) => style.getImage()?.getRadius)

test('raster active + unselected: the vector is interaction-only, the WMS draws the badge', () => {
  /* Aksi hâlde aynı POI hem WMS görüntüsünde hem vektörde çizilirdi. */
  const styles = createPoiLayer(() => null, () => true, presentation, () => resolutionAt(16))
    .layer.getStyle()(poiFeature(1))

  assert.equal(iconOf(styles), undefined, 'the raster owns the badge; the vector must not repeat it')

  const circles = circlesOf(styles)
  assert.equal(circles.length, 1, 'only the hit circle remains')
  assert.ok(isTransparent(circles[0].getImage().getFill().getColor()))
  assert.ok(isTransparent(circles[0].getImage().getStroke().getColor()))
})

test('raster active + selected: a ring is added, the badge is NOT redrawn on top', () => {
  /* Raster kategoriye göre boyanmış sabit bir görüntüdür ve neyin seçili
     olduğunu bilemez; seçim geri bildirimi vektörde kalmak zorundadır. Ama
     ikinci bir rozet çizmek, hafifçe kaymış iki simgeyi üst üste bindirirdi. */
  const styles = createPoiLayer(() => 7, () => true, presentation, () => resolutionAt(16))
    .layer.getStyle()(poiFeature(7))

  assert.equal(iconOf(styles), undefined, 'the WMS badge must not be doubled')

  const ringColours = circlesOf(styles).map((style) => style.getImage().getStroke().getColor())
  assert.ok(ringColours.includes(SELECTION_COLOR), 'the selection ring must be visible')
})

test('raster inactive + unselected: the vector draws the CATEGORY badge, never a plain dot', () => {
  /* Faz 5A rasteri ölçek değişiminde çekiyor. O boşluğu eskiden sade bir mavi
     nokta dolduruyordu — kullanıcının bildirdiği sorun tam olarak buydu. */
  const styles = createPoiLayer(() => null, () => false, presentation, () => resolutionAt(16))
    .layer.getStyle()(poiFeature(1))

  const icon = iconOf(styles)
  assert.ok(icon, 'a category badge must be drawn')

  const svg = decodeURIComponent(icon.getImage().getSrc())
  assert.match(svg, /fill="#EF4444"/, "the badge carries the category's own colour")
  assert.ok(svg.includes(pillGlyph), "the badge carries the category's own glyph")

  // Seçili olmayan POI'de halka YOKTUR: halka bir DURUM anlatır, kimlik değil.
  const ringColours = circlesOf(styles).map((style) => style.getImage().getStroke().getColor())
  assert.ok(!ringColours.includes(SELECTION_COLOR))
})

test('raster inactive + selected: the category badge stays and the ring is added around it', () => {
  const styles = createPoiLayer(() => 7, () => false, presentation, () => resolutionAt(16))
    .layer.getStyle()(poiFeature(7))

  const icon = iconOf(styles)
  assert.ok(icon, 'selection must NOT replace the category identity')
  assert.ok(decodeURIComponent(icon.getImage().getSrc()).includes(pillGlyph))

  const rings = circlesOf(styles).filter(
    (style) => !isTransparent(style.getImage().getStroke().getColor()),
  )
  assert.equal(rings.length, 2, 'a soft white halo plus the accent ring')

  /* Halka rozeti ÖRTMEZ: yarıçapı rozetin yarıçapından büyüktür. */
  const size = markerSizeForResolution(resolutionAt(16))
  assert.ok(rings.every((style) => style.getImage().getRadius() > size / 2))
})

test('the legacy plain-blue POI marker is gone from every path', () => {
  /* Kaynağın kendisi kanıttır: mavi nokta sabitleri kalıcı POI stilinde artık
     HİÇ kullanılmıyor. Yalnızca kesikli geçici işaretler (bekleyen/taslak) o
     maviyi taşır ve onlar ayrı bir kavramdır. */
  const source = readFileSync(new URL('../../src/map/poi.js', import.meta.url), 'utf8')

  assert.doesNotMatch(source, /POI_STYLE|POI_SELECTED_STYLE|POI_INTERACTION_ONLY_STYLE/)
  assert.match(source, /poiMarkerStyle\(/)

  for (const state of [
    { selected: false, rasterActive: false },
    { selected: true, rasterActive: false },
    { selected: false, rasterActive: true },
    { selected: true, rasterActive: true },
  ]) {
    const styles = poiMarkerStyle({ iconKey: 'pill', colorHex: '#EF4444', size: 24, ...state })
    const opaqueDiscs = styles.filter((style) => {
      const fill = style.getImage()?.getFill?.()
      return fill && !isTransparent(fill.getColor())
    })

    assert.equal(opaqueDiscs.length, 0, 'no state fills a POI with a generic disc')
  }
})

test('an unknown icon_key falls back to MapPin and a malformed colour to the neutral grey', () => {
  const svg = decodeURIComponent(poiBadgeDataUri('kayip-anahtar', 'not-a-colour', 24))

  assert.match(svg, /fill="#64748B"/)
  // MapPin'in gövdesi; ikinci bir simge tablosu değil, kayıtlı yedeğin kendisi.
  assert.ok(svg.includes(mapPinGlyph))
})

test('a POI whose category metadata never arrives is still a badge, not a dot', () => {
  /* Liste uçuyor olabilir ya da göç öncesinden kalan bir kategori metadatasız
     olabilir. İkisinde de POI kimliksiz kalır — ama nokta OLMAZ. */
  const styles = createPoiLayer(() => null, () => false, () => null, () => resolutionAt(16))
    .layer.getStyle()(poiFeature(1))

  const icon = iconOf(styles)
  assert.ok(icon)
  assert.match(decodeURIComponent(icon.getImage().getSrc()), /fill="#64748B"/)
})

test('createPoiLayer keeps working without the optional predicates', () => {
  // Geriye dönük uyumluluk: çağıran yalnızca seçimi verebilir.
  const styles = createPoiLayer(() => null).layer.getStyle()(poiFeature(1))

  assert.ok(iconOf(styles), 'a badge is still drawn')
})

/* --- Boyut bantları ----------------------------------------------------------- */

const sizeAtZoom = (zoom) => markerSizeForResolution(resolutionAt(zoom))

test('the marker grows with zoom, in the same three bands as the SLD', () => {
  assert.equal(sizeAtZoom(6), 20)
  assert.equal(sizeAtZoom(9), 20)
  assert.equal(sizeAtZoom(10), 24)
  assert.equal(sizeAtZoom(11), 24)
  assert.equal(sizeAtZoom(12), 30)
  assert.equal(sizeAtZoom(18), 30)

  // Tek yönlü ve sınırlı: "biraz büyüsün" istendi, "devasa olsun" değil.
  assert.ok(sizeAtZoom(6) < sizeAtZoom(10))
  assert.ok(sizeAtZoom(10) < sizeAtZoom(14))
  assert.ok(sizeAtZoom(20) <= 32)
})

test('FRACTIONAL zoom picks the band the SLD would, not a rounded guess', () => {
  /* Faz 5C: bantlar artık tamsayı yakınlık eşiklerinden değil, ölçek
     paydasından türer. Yakınlaşma animasyonu, kaydırma çubuğu ve dokunmatik
     kıstırma hep kesirli yakınlıklar üretir; eski tamsayı eşikler bunların
     ikisini de yanlış bantlıyordu. */
  assert.equal(Math.round(scaleDenominatorFor(resolutionAt(9.5))), 772131)
  assert.equal(sizeAtZoom(9.5), 24, '1:772131 orta banttır, uzak değil')

  assert.equal(Math.round(scaleDenominatorFor(resolutionAt(11.9))), 146291)
  assert.equal(sizeAtZoom(11.9), 30, '1:146291 yakın banttır, orta değil')

  // Sınırın tam üstü ve tam altı da doğru tarafa düşer.
  assert.equal(markerBandForResolution(1_000_000 * 0.00028), MARKER_BANDS.veryFar)
  assert.equal(markerBandForResolution(999_999 * 0.00028), MARKER_BANDS.medium)
  assert.equal(markerBandForResolution(150_000 * 0.00028), MARKER_BANDS.medium)
  assert.equal(markerBandForResolution(149_999 * 0.00028), MARKER_BANDS.near)
})

test('an unknown resolution falls back to the smallest band', () => {
  // Bilinmeyen bir durumda haritayı devasa rozetlerle açmak daha rahatsızdır.
  assert.equal(markerBandForResolution(undefined), MARKER_BANDS.veryFar)
  assert.equal(markerBandForResolution(Number.NaN), MARKER_BANDS.veryFar)
  assert.equal(markerBandForResolution(0), MARKER_BANDS.veryFar)
})

test('the size band the frontend picks matches the size the SLD would have drawn', () => {
  /* İki taraf ayrışırsa, raster gelip gittiğinde simge bir de BOYUT
     değiştirirdi — Faz 5A'da çözülen titremenin bir başka biçimi. */
  const sld = readFileSync(new URL('../../../geoserver/styles/poi_all.sld', import.meta.url), 'utf8')
  const sizes = [...new Set([...sld.matchAll(/<Size>(\d+)<\/Size>/g)].map((match) => match[1]))]

  assert.deepEqual(sizes.map(Number).sort((a, b) => a - b), [20, 24, 30])
  assert.deepEqual(Object.values(MARKER_SIZES).sort((a, b) => a - b), [20, 24, 30])
})

/* --- Boş kare yok -------------------------------------------------------------
   Faz 5C: canlı kayıtta "WMS kayboldu → bir an boş → rozet geldi" sırası
   görüldü. Sebep stil değil ZAMANLAMAYDI — rozet ilk kez ancak raster
   çekildiği anda kuruluyordu ve OpenLayers henüz çözülmemiş bir görüntüyü
   çizemiyordu. */

test('badges are prepared BEFORE the first zoom, not at the moment the raster withdraws', () => {
  const hook = readFileSync(new URL('../../src/hooks/usePoiLayer.js', import.meta.url), 'utf8')

  // Isıtma veri gelir gelmez yapılır…
  const load = hook.slice(hook.indexOf('const load = useCallback'), hook.indexOf('} catch (error)'))
  assert.match(load, /prewarmRef\.current\(\)/)

  // …ve metadata POI listesinden SONRA gelebileceği için orada da.
  assert.match(hook, /\}, \[categoryPresentation, prewarm\]\)/)

  /* Isıtılan şey bütün taksonomi DEĞİL, haritada gerçekten bulunan
     kategorilerdir: 44 rozeti boşuna kurmak çoğu hiç görünmeyecek nesneler
     üretirdi. */
  const prewarm = hook.slice(hook.indexOf('const prewarm = useCallback'), hook.indexOf('const prewarmRef'))
  assert.match(prewarm, /source\.getFeatures\(\)/)
  assert.match(prewarm, /feature\.get\('categoryId'\)/)
})

test('prewarming is idempotent and allocates nothing the second time', () => {
  const categories = [
    { iconKey: 'pill', colorHex: '#EF4444' },
    { iconKey: 'coffee', colorHex: '#B45309' },
    { iconKey: 'utensils', colorHex: '#EA580C' },
  ]

  prewarmPoiBadges(categories)
  const after = markerCacheSizes()
  prewarmPoiBadges(categories)

  assert.deepEqual(markerCacheSizes(), after, 'a second pass must create nothing')
})

test('prewarming covers every size band, so no band is cold when the raster withdraws', () => {
  /* Bir bandı atlamak, o ölçekte ilk yakınlaşmada boş kareyi geri getirirdi. */
  prewarmPoiBadges([{ iconKey: 'church', colorHex: '#7C3AED' }])

  const before = markerCacheSizes()
  for (const size of Object.values(MARKER_SIZES)) {
    poiMarkerStyle({ iconKey: 'church', colorHex: '#7C3AED', size, selected: false, rasterActive: false })
  }

  assert.deepEqual(markerCacheSizes(), before, 'every band was already warm')
})

test('the unknown-icon fallback is warmed too', () => {
  /* Metadatası olmayan bir kategori de ilk karede hazır olmalıdır. */
  prewarmPoiBadges([])

  const before = markerCacheSizes()
  poiMarkerStyle({ iconKey: null, colorHex: null, size: 24, selected: false, rasterActive: false })

  assert.deepEqual(markerCacheSizes(), before)
})

test('prewarming performs no network work and no per-frame React rendering', () => {
  const source = readFileSync(new URL('../../src/map/poiMarkerStyle.js', import.meta.url), 'utf8')
  const fn = source.slice(source.indexOf('export function prewarmPoiBadges'))

  assert.ok(!/fetch\(|XMLHttpRequest|https?:\/\//.test(fn))
  // Lucide bir KEZ çizilir ve önbelleğe girer; ısıtma o önbelleği kullanır.
  assert.ok(!/renderToStaticMarkup/.test(fn))
})

/* --- Önbellek ----------------------------------------------------------------- */

test('styles and badges are cached, so a zoom animation cannot allocate without bound', () => {
  const before = markerCacheSizes()

  /* Aynı istek yüzlerce kez: yakınlaşma sırasında stil fonksiyonu her POI için
     her karede çağrılabilir. Tek bir yeni nesne bile üretilmemelidir. */
  let last = null
  for (let index = 0; index < 500; index += 1) {
    last = poiMarkerStyle({
      iconKey: 'pill',
      colorHex: '#EF4444',
      size: 24,
      selected: false,
      rasterActive: false,
    })
  }

  const after = markerCacheSizes()

  assert.ok(after.styles - before.styles <= 1, 'at most ONE style array per distinct state')
  assert.ok(after.badges - before.badges <= 1, 'at most ONE data URI per distinct badge')
  assert.equal(
    last,
    poiMarkerStyle({
      iconKey: 'pill',
      colorHex: '#EF4444',
      size: 24,
      selected: false,
      rasterActive: false,
    }),
    'the very same array instance comes back',
  )
})

test('the layer only redraws when the size BAND changes, not on every resolution tick', () => {
  /* `change:resolution` bir yakınlaşma boyunca onlarca kez ateşlenir. Her
     birinde kaynağı geçersizleştirmek, Faz 5A'da kazanılan akıcılığı geri
     verirdi. */
  const hook = readFileSync(new URL('../../src/hooks/usePoiLayer.js', import.meta.url), 'utf8')
  const handler = hook.slice(hook.indexOf('const onResolutionChange'), hook.indexOf("map.getView().on('change:resolution'"))

  assert.match(handler, /markerBandForResolution/)
  assert.match(handler, /if \(next === band\) return/)
  // Dinleyici kalkarken sökülür: sızdıran bir dinleyici haritayı yavaşlatırdı.
  assert.match(hook, /un\('change:resolution', onResolutionChange\)/)
})

/* --- Tarayıcı GeoServer'a doğrudan gitmez ------------------------------------- */

const sourceFiles = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) return sourceFiles(full)
    return /\.(js|jsx)$/.test(entry) ? [full] : []
  })

test('no runtime frontend module addresses GeoServer directly', () => {
  /* Sınırın kendisi: GeoServer adresi, workspace, katman ve style adı tarayıcı
     paketine HİÇ girmemelidir. Bir gerileme burada, tarayıcıda değil,
     yakalanır. */
  const offenders = []

  for (const file of sourceFiles(new URL('../../src', import.meta.url).pathname)) {
    const text = readFileSync(file, 'utf8')
    // Yorumlar açıklama metnidir; taranan şey çalışan koddur.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

    if (/:8080\b/.test(code)) offenders.push(`${file}: :8080`)
    if (/\/geoserver\b/.test(code)) offenders.push(`${file}: /geoserver`)
    if (/\bgeoworkspace\b/.test(code)) offenders.push(`${file}: geoworkspace`)
    if (/\bpoi_read\b/.test(code)) offenders.push(`${file}: poi_read`)
    if (/\bpoi_all\b/.test(code)) offenders.push(`${file}: poi_all`)
    if (/\bstaj_postgis\b/.test(code)) offenders.push(`${file}: staj_postgis`)
  }

  assert.deepEqual(offenders, [], `frontend must not reference GeoServer:\n${offenders.join('\n')}`)
})

test('the POI presentation request targets the application endpoint only', () => {
  const api = readFileSync(new URL('../../src/services/api.js', import.meta.url).pathname, 'utf8')

  assert.match(api, /const POI_PRESENTATION_PATH = '\/api\/map\/presentation\/poi'/)

  /* Katman/style seçimi istemcide YOKTUR: sunucu sabitler. Yorumlar neyin
     GÖNDERİLMEDİĞİNİ anlatır ve taramada işaretlemeden ayrılmalıdır — aksi
     hâlde açıklamanın kendisi teste takılır. */
  const code = api.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

  assert.ok(!/STYLES|LAYERS/.test(code), 'the client must never name a layer or style')
  assert.ok(!/FORMAT_OPTIONS/.test(code), 'the client must never name a render option')
})

test('the POI presentation request carries only the viewport', () => {
  const api = readFileSync(new URL('../../src/services/api.js', import.meta.url).pathname, 'utf8')
  const fn = api.slice(api.indexOf('export async function fetchPoiPresentationImage'))
  const params = fn.slice(fn.indexOf('new URLSearchParams'), fn.indexOf('const response'))

  assert.match(params, /bbox/)
  assert.match(params, /width/)
  assert.match(params, /height/)
  /* Faz 5C'nin tek eklediği şey görüntünün YOĞUNLUĞUDUR — bir sayı, bir WMS
     parametresi değil. Sunucu çizim DPI'ını ondan kendisi türetir. */
  assert.match(params, /pixelRatio: String\(pixelRatio\)/)
  // Token sorgu dizesine KONMAZ; authFetch onu Authorization başlığında taşır.
  assert.ok(!/token/i.test(params))
})

test('the POI raster hook requests through authFetch, never a raw URL', () => {
  const hook = readFileSync(
    new URL('../../src/hooks/usePoiPresentationLayer.js', import.meta.url).pathname,
    'utf8',
  )

  assert.match(hook, /fetchPoiPresentationImage/)
  assert.ok(!/http:\/\//.test(hook), 'the hook must not contain an absolute URL')
  assert.ok(!/Basic\s/.test(hook), 'no GeoServer credential may reach the browser')
})

/* --- Yaşam döngüsü ------------------------------------------------------------ */

test('the raster is not built without the poi.view permission', () => {
  const hook = readFileSync(
    new URL('../../src/hooks/usePoiPresentationLayer.js', import.meta.url).pathname,
    'utf8',
  )

  // Yetki yoksa katman kurulmaz ve uç hiç çağrılmaz.
  assert.match(hook, /if \(!map \|\| !permitted\)/)

  const page = readFileSync(new URL('../../src/pages/MapPage.jsx', import.meta.url).pathname, 'utf8')
  const call = page.slice(page.indexOf('usePoiPresentationLayer(mapInstance'))

  assert.match(call.slice(0, 400), /permitted: allowed\.canViewPoi/)
})

test('every successful POI mutation invalidates the raster', () => {
  /* Oluşturma, güncelleme, silme ve geri yükleme — dördü de. Eksik biri,
     haritanın veritabanıyla sessizce ayrışması demek olurdu. */
  const page = readFileSync(new URL('../../src/pages/MapPage.jsx', import.meta.url).pathname, 'utf8')
  const calls = page.match(/invalidatePoiPresentation\(\)/g) ?? []

  assert.equal(calls.length, 4)
})

/* --- Faz 5A: ölçek değişimi artefaktı ------------------------------------------ */

const rasterHook = readFileSync(
  new URL('../../src/hooks/usePoiPresentationLayer.js', import.meta.url).pathname,
  'utf8',
)

test('the raster is only shown at the resolution it was rendered for', () => {
  /* Kök neden: ImageStatic coğrafi bir kapsama raptedilmiştir, dolayısıyla
     ölçek değişince OpenLayers bitmap'i geometrik olarak yeniden boyutlandırır
     — 24px'lik bir POI işareti animasyon boyunca 12px gibi görünür, sonra yeni
     görüntü gelince "zıplar". Yüklem çözünürlüğü de içerdiği için raster o an
     çekilir ve artefakt hiç görünmez. */
  assert.match(rasterHook, /imageResolution/)
  assert.match(rasterHook, /entry\.imageResolution === resolution/)
})

test('the rendered resolution is captured with the request, not guessed later', () => {
  assert.match(rasterHook, /const requestedResolution = view\.getResolution\(\)/)
  assert.match(rasterHook, /entry\.imageResolution = requestedResolution/)
})

test('a resolution change re-evaluates visibility but never issues a request', () => {
  /* Aksi hâlde yakınlaşma animasyonu kare başına backend'e istek atardı. */
  /* Dinleyicinin GÖVDESİ yalnızca syncLayer çağırır — istek yok. Tek satırlık
     olması iddiayı da kesin kılar. */
  const handler = rasterHook.match(/const onResolutionChange = .*/)[0]

  assert.equal(handler, 'const onResolutionChange = () => syncLayer()')
  assert.match(rasterHook, /map\.getView\(\)\.on\('change:resolution', onResolutionChange\)/)
})

test('requests still happen only for a settled viewport', () => {
  assert.match(rasterHook, /map\.on\('moveend', scheduleLoad\)/)
  assert.match(rasterHook, /map\.on\('change:size', scheduleLoad\)/)
  assert.match(rasterHook, /window\.setTimeout\(load, PRESENTATION_REQUEST_DEBOUNCE_MS\)/)
})

test('the resolution listener is removed on teardown', () => {
  // Kaldırılmayan bir görünüm dinleyicisi, harita yeniden kurulduğunda birikirdi.
  assert.match(rasterHook, /map\.getView\(\)\.un\('change:resolution', onResolutionChange\)/)
})

test('a stale image can still never become active after a newer write', () => {
  // Sürüm yüklemi Faz 4'ten beri var ve korunmalıdır.
  assert.match(rasterHook, /entry\.imageVersion === versionRef\.current/)
  assert.match(rasterHook, /thisRequest !== entry\.requestNumber/)
})

test('the vector layer is told only when the answer actually changes', () => {
  /* Ölçek değişimi sırasında her karede source.changed() çağırmak boşuna
     yeniden çizim olurdu; bildirim yalnızca gerçek değişimde gider. */
  assert.match(rasterHook, /const changed = activeRef \? activeRef\.current !== value : true/)
  assert.match(rasterHook, /if \(changed\) onChangeRef\.current\?\.\(value\)/)
})

test('while the raster is withdrawn the vector CATEGORY badge carries the map', () => {
  /* Yedeğin kendisi Faz 4'ten beri var; Faz 5B'de değişen, ne çizdiğidir.
     Raster ölçek değişiminde çekildiğinde POI kaybolmaz VE genel bir noktaya
     dönüşmez — aynı kategori rozetini vektör çizer. İkisi aynı anda TAM
     görünür olmaz: rozet yalnızca raster kapalıyken eklenir. */
  const withRaster = createPoiLayer(() => null, () => true, presentation, () => resolutionAt(16))
    .layer.getStyle()(poiFeature(1))
  const withoutRaster = createPoiLayer(() => null, () => false, presentation, () => resolutionAt(16))
    .layer.getStyle()(poiFeature(1))

  assert.equal(iconOf(withRaster), undefined, 'the raster owns the badge')
  assert.ok(iconOf(withoutRaster), 'the vector takes it back the moment the raster withdraws')

  /* Boyut, SLD'nin o ölçekte çizeceğiyle AYNI: geçiş ne bir kimlik değişimi ne
     de bir boyut sıçraması gibi görünmeli. Rozet hedefin iki katı doğal
     boyutta üretilir (retina) ve yarım ölçekle çizilir. */
  const icon = iconOf(withoutRaster).getImage()
  const natural = Number(decodeURIComponent(icon.getSrc()).match(/width="(\d+)"/)[1])

  assert.equal(natural * icon.getScale(), markerSizeForResolution(resolutionAt(16)))
})

test('teardown removes the layer and releases its blob url', () => {
  const hook = readFileSync(
    new URL('../../src/hooks/usePoiPresentationLayer.js', import.meta.url).pathname,
    'utf8',
  )

  // Aksi hâlde harita yeniden kurulduğunda katmanlar üst üste birikirdi.
  assert.match(hook, /map\.removeLayer\(entry\.layer\)/)
  assert.match(hook, /entry\.layer\.dispose\(\)/)
  assert.match(hook, /URL\.revokeObjectURL\(entry\.blobUrl\)/)
  assert.match(hook, /map\.un\('moveend', scheduleLoad\)/)
})
