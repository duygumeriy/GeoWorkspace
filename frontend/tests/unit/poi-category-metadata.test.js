import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COLOR_OPTIONS,
  DEFAULT_COLOR,
  FALLBACK_COLOR,
  FALLBACK_ICON_KEY,
  ICON_OPTIONS,
  displayColor,
  iconLabel,
  isApprovedIconKey,
  normalizeColorHex,
} from '../../src/components/admin/poiCategoryMetadata.js'

/**
 * Kategori sunum metadatasının arayüz tarafındaki saf kuralları.
 *
 * <b>Bu dosya bir güvenlik sınırını sınamaz.</b> İzin listesinin sahibi
 * backend'dir ve her anahtarı yeniden doğrular; buradaki liste yalnızca
 * kullanıcıya seçenek sunar. Sınanan şey, arayüzün sunucunun REDDEDECEĞİ bir
 * değeri sessizce göndermemesidir.
 */

/* --- Renk normalleştirme ------------------------------------------------------ */

test('a lowercase color is canonicalised to uppercase', () => {
  // `<input type="color">` HER ZAMAN küçük harfli üretir; normalleştirme
  // olmadan aynı renk iki farklı metin olarak saklanırdı.
  assert.equal(normalizeColorHex('#ef4444'), '#EF4444')
  assert.equal(normalizeColorHex('#f97316'), '#F97316')
})

test('an already canonical color is unchanged', () => {
  assert.equal(normalizeColorHex('#EF4444'), '#EF4444')
})

test('normalization is idempotent', () => {
  assert.equal(normalizeColorHex(normalizeColorHex('#ef4444')), '#EF4444')
})

test('surrounding whitespace is tolerated', () => {
  assert.equal(normalizeColorHex('  #ef4444  '), '#EF4444')
})

test('shorthand #RGB is rejected rather than expanded', () => {
  // Kısa yazımı açmak, kullanıcının yazdığından FARKLI bir değeri saklamak
  // olurdu; sunucu da onu reddeder.
  assert.equal(normalizeColorHex('#FFF'), null)
  assert.equal(normalizeColorHex('#abc'), null)
})

test('an alpha channel is rejected', () => {
  assert.equal(normalizeColorHex('#EF4444FF'), null)
  assert.equal(normalizeColorHex('#EF444480'), null)
})

test('malformed colors are rejected', () => {
  for (const value of ['', 'EF4444', '#EF444', '#EF44444', '#GGGGGG', 'red', 'rgb(1,2,3)', null, undefined, 42]) {
    assert.equal(normalizeColorHex(value), null, `beklenmedik kabul: ${String(value)}`)
  }
})

/* --- Gösterim yedeği ---------------------------------------------------------- */

test('a category without a color falls back to the neutral swatch', () => {
  // Yedek yalnızca GÖSTERİM içindir; veritabanına yazılmaz.
  assert.equal(displayColor({ colorHex: null }), FALLBACK_COLOR)
  assert.equal(displayColor({}), FALLBACK_COLOR)
  assert.equal(displayColor(null), FALLBACK_COLOR)
})

test('a category with a color shows its own color, canonicalised', () => {
  assert.equal(displayColor({ colorHex: '#ef4444' }), '#EF4444')
})

test('an invalid stored color still renders something', () => {
  // Bozuk bir eski satır, satırın hiç çizilmemesine yol açmamalıdır.
  assert.equal(displayColor({ colorHex: 'garbage' }), FALLBACK_COLOR)
})

/* --- Simge kataloğu ----------------------------------------------------------- */

test('the icon catalog has no duplicate keys', () => {
  const keys = ICON_OPTIONS.map((option) => option.key)
  assert.equal(new Set(keys).size, keys.length)
})

test('every icon key is lowercase kebab-case', () => {
  for (const option of ICON_OPTIONS) {
    assert.match(option.key, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `kanonik olmayan anahtar: ${option.key}`)
  }
})

test('every icon option carries a human label', () => {
  for (const option of ICON_OPTIONS) {
    assert.equal(typeof option.label, 'string')
    assert.ok(option.label.length > 0, `etiketsiz anahtar: ${option.key}`)
  }
})

test('the catalog covers the full canonical taxonomy', () => {
  // 27 kök + 14 yeni alt + 3 mevcut alt kategori simgesi.
  assert.equal(ICON_OPTIONS.length, 44)
})

test('approved keys are recognised and anything else is not', () => {
  assert.ok(isApprovedIconKey('pill'))
  assert.ok(isApprovedIconKey('badge-dollar-sign'))

  for (const value of ['', 'Pill', 'not-an-icon', '../../etc/passwd', 'http://x/y.svg', '<svg>', null, undefined]) {
    assert.equal(isApprovedIconKey(value), false, `beklenmedik kabul: ${String(value)}`)
  }
})

test('the fallback icon key is itself in the catalog', () => {
  assert.ok(isApprovedIconKey(FALLBACK_ICON_KEY))
})

test('an icon key resolves to its Turkish label, unknown keys to themselves', () => {
  assert.equal(iconLabel('pill'), 'Eczane')
  assert.equal(iconLabel('key-round'), 'Emlak')
  assert.equal(iconLabel('bilinmeyen'), 'bilinmeyen')
  assert.equal(iconLabel(null), '')
})

test('the deliberately de-duplicated icons are present', () => {
  // landmark/house tekrarını gidermek için bilinçli eklenen anahtarlar.
  for (const key of ['badge-dollar-sign', 'key-round', 'gauge', 'armchair', 'shopping-basket', 'utensils-crossed']) {
    assert.ok(isApprovedIconKey(key), `eksik anahtar: ${key}`)
  }
})

/* --- Palet -------------------------------------------------------------------- */

test('every palette color is already canonical', () => {
  for (const option of COLOR_OPTIONS) {
    assert.equal(normalizeColorHex(option.value), option.value)
  }
})

test('the palette has ten distinct sector colors', () => {
  const values = COLOR_OPTIONS.map((option) => option.value)
  assert.equal(values.length, 10)
  assert.equal(new Set(values).size, 10)
})

test('the default color for a new category is part of the palette', () => {
  assert.ok(COLOR_OPTIONS.some((option) => option.value === DEFAULT_COLOR))
})

test('the neutral fallback is deliberately outside the palette', () => {
  // Yedek bir sektör rengiyle karıştırılmamalıdır.
  assert.ok(!COLOR_OPTIONS.some((option) => option.value === FALLBACK_COLOR))
})
