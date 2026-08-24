import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_ADMIN_POI_SORT,
  EMPTY_ADMIN_CATEGORY_FILTERS,
  EMPTY_ADMIN_POI_FILTERS,
  adminPoiCategoryOptions,
  adminPoiCreatorOptions,
  buildAdminCategoryView,
  buildAdminPoiView,
  hasActiveCategoryFilters,
  hasActivePoiFilters,
} from '../../src/map/adminPoiFilters.js'

/**
 * Yönetim panelindeki süzme hattı.
 *
 * <b>Kapsam burada ölçülmez.</b> Liste zaten `poi.manage` /
 * `poi.categories.manage` ile sunucudan geldi; buradaki her şey o listenin
 * üzerine kurulan sunumdur ve bir güvenlik sınırı değildir.
 */

const POIS = [
  {
    id: 1,
    name: 'Starbucks Eskişehir',
    categoryPath: 'Yeme-İçme / kafe',
    creatorUsername: 'duygu2',
    createdDate: '2026-08-20T10:00:00Z',
    isActive: true,
    isDeleted: false,
  },
  {
    id: 2,
    name: 'Şehir Lokantası',
    categoryPath: 'Yeme-İçme / restoran',
    creatorUsername: 'admin',
    createdDate: '2026-08-22T10:00:00Z',
    isActive: true,
    isDeleted: false,
  },
  {
    id: 3,
    name: 'Kapalı Otopark',
    categoryPath: 'Ulaşım / otopark',
    creatorUsername: 'duygu2',
    createdDate: '2026-08-18T10:00:00Z',
    isActive: false,
    isDeleted: false,
  },
  {
    id: 4,
    name: 'Silinmiş Kafe',
    categoryPath: 'Yeme-İçme / kafe',
    creatorUsername: 'duygu2',
    createdDate: '2026-08-24T10:00:00Z',
    isActive: false,
    isDeleted: true,
  },
]

const names = (view) => view.items.map((poi) => poi.name)

test('no filters return every record, newest first', () => {
  const view = buildAdminPoiView(POIS, EMPTY_ADMIN_POI_FILTERS)

  assert.equal(view.matchCount, 4)
  assert.equal(view.total, 4)
  // Varsayılan sıra sunucununkini korur: en yeni başta.
  assert.deepEqual(names(view), ['Silinmiş Kafe', 'Şehir Lokantası', 'Starbucks Eskişehir', 'Kapalı Otopark'])
  assert.equal(DEFAULT_ADMIN_POI_SORT, 'newest')
})

test('search matches POI names with Turkish-aware SUBSTRING folding', () => {
  assert.deepEqual(names(buildAdminPoiView(POIS, { search: 'star' })), ['Starbucks Eskişehir'])

  /* Katlama uygulamanın tek yardımcısından gelir (`foldForSearch`): Ş/ş ve İ/ı
     ayrımı aramayı takmaz. "SEHIR" büyük I yüzünden önce "sehır" olur, sonra
     "sehir"e katlanır.

     İKİ kayıt birden döner ve bu DOĞRUDUR: eşleşme alt dize üzerinden çalışır,
     "Eskişehir" de "şehir" içerir. Yalnızca birini beklemek, aramayı
     `startsWith` ya da sözcük eşleşmesine daraltmayı gerektirirdi — bu da
     Çizimlerim, POI'lerim, Çöp Kutusu ve kategori seçicisinde çoktan yerleşmiş
     davranıştan sapmak olurdu. Sıra varsayılan sıralamanındır: en yeni başta. */
  assert.deepEqual(names(buildAdminPoiView(POIS, { search: 'SEHIR' })), [
    'Şehir Lokantası',
    'Starbucks Eskişehir',
  ])

  // Daha uzun bir alt dize doğal olarak daraltır; ayrı bir kural gerekmez.
  assert.deepEqual(names(buildAdminPoiView(POIS, { search: 'eskisehir' })), ['Starbucks Eskişehir'])
  assert.deepEqual(names(buildAdminPoiView(POIS, { search: 'LOKANTA' })), ['Şehir Lokantası'])
})

test('search also matches the category path and the creator', () => {
  assert.deepEqual(names(buildAdminPoiView(POIS, { search: 'otopark' })), ['Kapalı Otopark'])
  assert.deepEqual(
    names(buildAdminPoiView(POIS, { search: 'duygu2', sort: 'name-asc' })),
    ['Kapalı Otopark', 'Silinmiş Kafe', 'Starbucks Eskişehir'],
  )
})

test('the category filter narrows to one path', () => {
  const view = buildAdminPoiView(POIS, { category: 'Ulaşım / otopark' })
  assert.deepEqual(names(view), ['Kapalı Otopark'])
})

test('status distinguishes active, passive and deleted', () => {
  assert.deepEqual(names(buildAdminPoiView(POIS, { status: 'active', sort: 'name-asc' })),
    ['Starbucks Eskişehir', 'Şehir Lokantası'])
  assert.deepEqual(names(buildAdminPoiView(POIS, { status: 'inactive' })), ['Kapalı Otopark'])
  assert.deepEqual(names(buildAdminPoiView(POIS, { status: 'deleted' })), ['Silinmiş Kafe'])

  /* Silinmişlik önceliklidir: soft-delete edilmiş satır ayrıca pasif olsa da
     "Pasif" süzgecine DÜŞMEZ — anlamlı bilgi silinmiş olmasıdır. */
  assert.equal(buildAdminPoiView(POIS, { status: 'inactive' }).items.some((p) => p.isDeleted), false)
})

test('the creator filter works on its own', () => {
  assert.deepEqual(names(buildAdminPoiView(POIS, { creator: 'admin' })), ['Şehir Lokantası'])
})

test('filters COMPOSE rather than replacing each other', () => {
  const view = buildAdminPoiView(POIS, {
    search: 'kafe',
    category: 'Yeme-İçme / kafe',
    creator: 'duygu2',
    status: 'active',
  })

  /* "Silinmiş Kafe" adıyla ve kategorisiyle eşleşir, oluşturanı da doğrudur —
     ama durumu değildir. Dört ölçüt aynı listeyi dört kez daraltır. */
  assert.deepEqual(names(view), ['Starbucks Eskişehir'])
})

test('sorting covers name and age in both directions', () => {
  assert.deepEqual(names(buildAdminPoiView(POIS, { sort: 'name-asc' })),
    ['Kapalı Otopark', 'Silinmiş Kafe', 'Starbucks Eskişehir', 'Şehir Lokantası'])
  assert.deepEqual(names(buildAdminPoiView(POIS, { sort: 'name-desc' })),
    ['Şehir Lokantası', 'Starbucks Eskişehir', 'Silinmiş Kafe', 'Kapalı Otopark'])
  assert.equal(buildAdminPoiView(POIS, { sort: 'oldest' }).items[0].name, 'Kapalı Otopark')
  assert.equal(buildAdminPoiView(POIS, { sort: 'newest' }).items[0].name, 'Silinmiş Kafe')
})

test('a zero-result state is reported without losing the total', () => {
  const view = buildAdminPoiView(POIS, { search: 'bulunmayan' })

  // İki sayı AYRI kalır: boş sonuç "hiç kayıt yok" demek değildir.
  assert.equal(view.matchCount, 0)
  assert.equal(view.total, 4)
})

test('the dropdowns are built from values the data actually contains', () => {
  assert.deepEqual(adminPoiCategoryOptions(POIS).map((o) => o.id),
    ['all', 'Ulaşım / otopark', 'Yeme-İçme / kafe', 'Yeme-İçme / restoran'])
  assert.deepEqual(adminPoiCreatorOptions(POIS).map((o) => o.id), ['all', 'admin', 'duygu2'])
})

test('"Filtreleri Temizle" appears only when something is filtered', () => {
  assert.equal(hasActivePoiFilters(EMPTY_ADMIN_POI_FILTERS), false)
  // Sıralama bir SÜZGEÇ değildir; listeyi daraltmaz.
  assert.equal(hasActivePoiFilters({ ...EMPTY_ADMIN_POI_FILTERS, sort: 'name-asc' }), false)
  assert.equal(hasActivePoiFilters({ ...EMPTY_ADMIN_POI_FILTERS, search: 'a' }), true)
  assert.equal(hasActivePoiFilters({ ...EMPTY_ADMIN_POI_FILTERS, status: 'deleted' }), true)
})

/* --- Kategoriler ------------------------------------------------------------- */

const CATEGORIES = [
  { id: 1, name: 'Yeme-İçme', path: 'Yeme-İçme', parentId: null, isActive: true },
  { id: 2, name: 'kafe', path: 'Yeme-İçme / kafe', parentId: 1, isActive: true },
  { id: 3, name: 'restoran', path: 'Yeme-İçme / restoran', parentId: 1, isActive: false },
  { id: 4, name: 'Ulaşım', path: 'Ulaşım', parentId: null, isActive: true },
]

const paths = (view) => view.items.map((category) => category.path)

test('category search matches the name and the full path', () => {
  assert.deepEqual(paths(buildAdminCategoryView(CATEGORIES, { search: 'kafe' })), ['Yeme-İçme / kafe'])
  // "yeme" bütün dalı getirir: yaprak da kendi yolu üzerinden eşleşir.
  assert.deepEqual(paths(buildAdminCategoryView(CATEGORIES, { search: 'yeme' })),
    ['Yeme-İçme', 'Yeme-İçme / kafe', 'Yeme-İçme / restoran'])
  // Türkçe katlama burada da aynı yardımcıdan gelir.
  assert.deepEqual(paths(buildAdminCategoryView(CATEGORIES, { search: 'ULASIM' })), ['Ulaşım'])
})

test('category status separates active from passive', () => {
  assert.deepEqual(paths(buildAdminCategoryView(CATEGORIES, { status: 'inactive' })), ['Yeme-İçme / restoran'])
  assert.equal(buildAdminCategoryView(CATEGORIES, { status: 'active' }).matchCount, 3)
})

test('kind is read from parentId, never from indentation', () => {
  assert.deepEqual(paths(buildAdminCategoryView(CATEGORIES, { kind: 'root' })), ['Yeme-İçme', 'Ulaşım'])
  assert.deepEqual(paths(buildAdminCategoryView(CATEGORIES, { kind: 'child' })),
    ['Yeme-İçme / kafe', 'Yeme-İçme / restoran'])
})

test('category filters compose and keep the server ordering', () => {
  const view = buildAdminCategoryView(CATEGORIES, { search: 'yeme', kind: 'child', status: 'active' })

  assert.deepEqual(paths(view), ['Yeme-İçme / kafe'])
  assert.equal(view.total, 4)

  /* Süzme yalnızca satır DÜŞÜRÜR, yeniden sıralamaz: sunucunun yol sırası
     korunur ve her satır kendi tam yolunu taşıdığı için eşleşen bir alt
     kategori bağlamsız kalmaz. */
  const branch = buildAdminCategoryView(CATEGORIES, { search: 'yeme' })
  assert.deepEqual(paths(branch), CATEGORIES.filter((c) => c.path.startsWith('Yeme')).map((c) => c.path))
})

test('category reset control follows the same rule', () => {
  assert.equal(hasActiveCategoryFilters(EMPTY_ADMIN_CATEGORY_FILTERS), false)
  assert.equal(hasActiveCategoryFilters({ ...EMPTY_ADMIN_CATEGORY_FILTERS, kind: 'root' }), true)
})
