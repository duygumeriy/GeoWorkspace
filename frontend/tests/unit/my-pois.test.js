import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_POI_SORT,
  buildMyPoiView,
  poiCategoryOptions,
} from '../../src/map/poiFilters.js'
import { MAP_CONTEXTS, SIDEBAR_CONTEXTS } from '../../src/map/mapContexts.js'
import { POINT_ZOOM, focusZoomFor } from '../../src/map/mapView.js'

/**
 * "POI'lerim" listesinin sunum hattı.
 *
 * <b>Sahiplik burada ölçülmez ve ölçülemez.</b> Liste `GET /api/poi/mine`ten
 * gelir ve kapsamı sunucu daraltır; buradaki her şey o listenin üzerine kurulan
 * arama/süzme/sıralamadır.
 */

const POIS = [
  { id: 1, name: 'Kalesi Kafe', categoryPath: 'Yeme-İçme / kafe', workHours: null },
  { id: 2, name: 'Ankara Lokanta', categoryPath: 'Yeme-İçme / restoran', workHours: null },
  { id: 3, name: 'Şehir Oteli', categoryPath: 'Konaklama', workHours: null },
]

const names = (result) => result.items.map((item) => item.name)

test('an empty query returns everything, newest control values applied', () => {
  assert.equal(buildMyPoiView(POIS, {}).matchCount, 3)
  assert.deepEqual(names(buildMyPoiView(POIS, { sort: DEFAULT_POI_SORT })), [
    'Ankara Lokanta',
    'Kalesi Kafe',
    'Şehir Oteli',
  ])
})

test('search matches the name and the category path, Turkish-aware', () => {
  assert.deepEqual(names(buildMyPoiView(POIS, { search: 'kalesi' })), ['Kalesi Kafe'])
  // Kategori yolu da aranır: kullanıcının aklındaki ikinci alan odur.
  assert.deepEqual(names(buildMyPoiView(POIS, { search: 'restoran' })), ['Ankara Lokanta'])
  // Katlama uygulamanın tek yardımcısından gelir (foldForSearch).
  assert.deepEqual(names(buildMyPoiView(POIS, { search: 'SEHIR' })), ['Şehir Oteli'])
})

test('the category filter narrows to one path', () => {
  const options = poiCategoryOptions(POIS).map((option) => option.id)
  assert.deepEqual(options, ['all', 'Konaklama', 'Yeme-İçme / kafe', 'Yeme-İçme / restoran'])

  assert.deepEqual(names(buildMyPoiView(POIS, { category: 'Konaklama' })), ['Şehir Oteli'])
})

test('sorting flips between name orders and groups by category', () => {
  assert.deepEqual(names(buildMyPoiView(POIS, { sort: 'name-desc' })), [
    'Şehir Oteli',
    'Kalesi Kafe',
    'Ankara Lokanta',
  ])

  // Kategori sırası içinde ad sırası korunur.
  assert.deepEqual(names(buildMyPoiView(POIS, { sort: 'category' })), [
    'Şehir Oteli',
    'Kalesi Kafe',
    'Ankara Lokanta',
  ])
})

test('a filter that matches nothing reports zero without throwing', () => {
  assert.equal(buildMyPoiView(POIS, { search: 'bulunmayan' }).matchCount, 0)
  assert.equal(buildMyPoiView(undefined, {}).matchCount, 0)
})

test("POI'lerim is a primary sidebar context like Çizimlerim", () => {
  /* Tek sahiplik: panel ikinci bir bağımsız boolean değil, koordinatörün
     bildiği bir bağlamdır — açıldığında öncekini emekliye ayırır. */
  assert.equal(MAP_CONTEXTS.myPois, 'myPois')
  assert.ok(SIDEBAR_CONTEXTS.includes(MAP_CONTEXTS.myPois))
  assert.ok(SIDEBAR_CONTEXTS.includes(MAP_CONTEXTS.drawings))
})

/* --- Güncellenen kaydın satırı ----------------------------------------------
   Bir POI'nin konumu değiştikten sonra "POI'lerim" ESKİ konumu göstermeye devam
   edemez: satır, kullanıcıyı artık orada olmayan bir noktaya götürürdü. */

test('an updated record replaces the stale row, coordinates included', () => {
  const before = [
    { id: 7, name: 'Kalesi Kafe', categoryPath: 'Yeme-İçme / kafe', longitude: 32.85, latitude: 39.93 },
    { id: 8, name: 'Şehir Oteli', categoryPath: 'Konaklama', longitude: 33.1, latitude: 40.1 },
  ]

  /* Yerinde tazeleme, `useMyPois.replace`in yaptığı şeydir ve kaydın SUNUCUDAN
     dönen kanonik hâlini koyar — listeyi baştan okumadan. */
  const updated = { ...before[0], name: 'Kalesi Kafe (yeni)', longitude: 30.5, latitude: 38.2 }
  const after = before.map((item) => (item.id === updated.id ? updated : item))

  const row = buildMyPoiView(after, {}).items.find((item) => item.id === 7)

  assert.equal(row.name, 'Kalesi Kafe (yeni)')
  assert.equal(row.longitude, 30.5)
  assert.equal(row.latitude, 38.2)
  // Dokunulmayan kayıt olduğu gibi kalır.
  assert.deepEqual(buildMyPoiView(after, {}).items.find((item) => item.id === 8), before[1])
})

/* --- Satır tıklamasının yakınlık kuralı --------------------------------------
   Kural üretimde TEK bir yerde tanımlıdır (`map/mapView.js`) ve yalnızca
   sayıyla ilgilidir: React, OpenLayers ve DOM olmadan okunur ve ölçülür.
   Kamera hareketinin kendisi (`hooks/useMapView.js`) aynı fonksiyonu çağırır ve
   tarayıcı testinin konusudur — burada formülün bir kopyası YOKTUR. */

test('focusing a POI zooms in when needed and never zooms the user back out', () => {
  // Türkiye ölçeğinden tıklamak POI'yi ayırt edilebilir hâle getirir.
  assert.equal(focusZoomFor(6), POINT_ZOOM)
  // Zaten daha yakındaysa kullanıcı GERİ ÇEKİLMEZ.
  assert.equal(focusZoomFor(18), 18)
  assert.equal(focusZoomFor(POINT_ZOOM), POINT_ZOOM)
  // Görünüm henüz bir yakınlık bildirmediyse kural yine de bir sayı üretir.
  assert.equal(focusZoomFor(undefined), POINT_ZOOM)

  // "İşe yarar" bir POI yakınlığı: sokak ölçeği.
  assert.ok(POINT_ZOOM >= 14)
})
