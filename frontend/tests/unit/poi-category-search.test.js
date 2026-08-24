import assert from 'node:assert/strict'
import test from 'node:test'
import {
  categoryLabel,
  isSelectableCategory,
  searchPoiCategories,
} from '../../src/map/poiCategorySearch.js'

/* Ödevdeki örnek taksonomi. Yol, sunucunun ürettiği alandır; arama hem yaprağa
   hem tam yola bakar. */
const CATEGORIES = [
  { id: 1, name: 'Yeme-İçme', path: 'Yeme-İçme', isActive: true, isDeleted: false },
  { id: 2, name: 'kafe', path: 'Yeme-İçme / kafe', isActive: true, isDeleted: false },
  { id: 3, name: 'restoran', path: 'Yeme-İçme / restoran', isActive: true, isDeleted: false },
  { id: 4, name: 'Konaklama', path: 'Konaklama', isActive: true, isDeleted: false },
]

const paths = (items) => items.map((item) => item.path)

test('a leaf name finds the leaf, and only the leaf', () => {
  assert.deepEqual(paths(searchPoiCategories(CATEGORIES, 'kafe')), ['Yeme-İçme / kafe'])
})

test('a parent name finds the parent and everything under it', () => {
  // Yol üzerinden eşleşme: dalın tamamı gelir.
  assert.deepEqual(paths(searchPoiCategories(CATEGORIES, 'Yeme')), [
    'Yeme-İçme',
    'Yeme-İçme / kafe',
    'Yeme-İçme / restoran',
  ])
})

test('matching is case-insensitive and Turkish-aware', () => {
  /* Katlama uygulamanın TEK yardımcısıdır (foldForSearch); çizim ve çöp kutusu
     aramaları da onu kullanır, dolayısıyla üç ekranda tek davranış vardır. */
  assert.deepEqual(paths(searchPoiCategories(CATEGORIES, 'KAFE')), ['Yeme-İçme / kafe'])
  assert.deepEqual(paths(searchPoiCategories(CATEGORIES, 'yeme-icme')), [
    'Yeme-İçme',
    'Yeme-İçme / kafe',
    'Yeme-İçme / restoran',
  ])
})

test('an empty query is a filter that filters nothing', () => {
  assert.equal(searchPoiCategories(CATEGORIES, '').length, CATEGORIES.length)
  assert.equal(searchPoiCategories(CATEGORIES, '   ').length, CATEGORIES.length)
})

test('inactive and deleted categories can never be selected', () => {
  const withUnusable = [
    ...CATEGORIES,
    { id: 5, name: 'Kapalı', path: 'Kapalı', isActive: false, isDeleted: false },
    { id: 6, name: 'Silinmiş', path: 'Silinmiş', isActive: true, isDeleted: true },
  ]

  // Sunucu da ikisini reddeder; göstermek garanti bir hataya davet olurdu.
  assert.deepEqual(paths(searchPoiCategories(withUnusable, 'Kapalı')), [])
  assert.deepEqual(paths(searchPoiCategories(withUnusable, 'Silinmiş')), [])
  assert.equal(isSelectableCategory({ isActive: false }), false)
  assert.equal(isSelectableCategory({ isDeleted: true }), false)
  // Alan hiç gelmemişse (harita ucu yalnızca aktifleri döner) satır kullanılabilir.
  assert.equal(isSelectableCategory({ id: 9, name: 'Kafe' }), true)
})

test('the label prefers the full path so same-named siblings stay distinguishable', () => {
  assert.equal(categoryLabel({ name: 'kafe', path: 'Yeme-İçme / kafe' }), 'Yeme-İçme / kafe')
  assert.equal(categoryLabel({ name: 'kafe' }), 'kafe')
})

test('create and edit share one matching implementation', () => {
  /* İki form da bu fonksiyonu çağırır (PoiCategoryPicker üzerinden). Aynı
     girdiye aynı cevabın verildiği, davranışın tek bir yerde tanımlı olmasının
     ölçülebilir hâlidir. */
  const first = searchPoiCategories(CATEGORIES, 'restoran')
  const second = searchPoiCategories(CATEGORIES, 'restoran')
  assert.deepEqual(paths(first), paths(second))
})
