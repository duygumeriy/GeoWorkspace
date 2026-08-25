import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { FALLBACK_COLOR, FALLBACK_ICON, accentColor, iconForKey, isKnownIconKey, knownIconKeys } from '../../src/components/map/poiIconRegistry.js'
import { displayColor } from '../../src/components/admin/poiCategoryMetadata.js'
import { PoiCategoryTaxonomy } from './helpers/taxonomy.js'

/**
 * Faz 5D — kategori kimliği HER EKRANDA aynı simgeyle konuşur.
 *
 * Yönetim panelindeki kategori ağacı, "POI'lerim" listesi, arama sonuçları ve
 * haritanın kendisi aynı kaydı gösterirken aynı glifi kullanmalıdır. Her ekran
 * kendi göstergesini uydurduğunda — biri renkli kare, biri genel raptiye, biri
 * gerçek simge — kullanıcı aynı kaydı üç ayrı şey sanır.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const badge = read('../../src/components/map/PoiCategoryBadge.jsx')
const tree = read('../../src/components/admin/PoiCategoryTree.jsx')
const treeCss = read('../../src/pages/admin/PoiPage.css')
const myPois = read('../../src/components/map/MyPoisPanel.jsx')
const search = read('../../src/components/map/PoiSearchBar.jsx')
const page = read('../../src/pages/MapPage.jsx')

/* --- Tek kayıt ----------------------------------------------------------------- */

test('there is exactly ONE icon registry and the badge is its only reader', () => {
  /* İkinci bir 44 satırlık eşleme, bir kategori düzenlendiğinde sessizce
     ayrışacak ikinci bir gerçek kaynağı olurdu. */
  assert.match(badge, /from '\.\/poiIconRegistry\.js'/)

  /* Yorumlar kaydın adını anabilir; ölçülen şey KODUN ona doğrudan bağlanıp
     bağlanmadığıdır. */
  const stripComments = (source) =>
    source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/\/\/.*/g, '')

  for (const [name, source] of [['tree', tree], ['myPois', myPois], ['search', search]]) {
    assert.ok(!/poiIconRegistry/.test(stripComments(source)), `${name} must go through the shared badge`)
    assert.match(source, /PoiCategoryBadge/, `${name} must use the shared badge`)
  }
})

test('the registry still covers the whole canonical taxonomy', () => {
  assert.equal(knownIconKeys().length, 44)
  assert.equal(PoiCategoryTaxonomy.iconKeys.length, 44)

  for (const iconKey of PoiCategoryTaxonomy.iconKeys) {
    /* Her anahtar KAYITLIDIR. `map-pin` bilinçli bir istisnadır: kendisi de
       yedeğin ta kendisidir ("Önemli Noktalar" gerçekten bir raptiyedir),
       dolayısıyla ona eşit çıkması bir eksiklik değil, doğru cevaptır. */
    assert.ok(isKnownIconKey(iconKey), `${iconKey} is missing from the registry`)

    if (iconKey !== 'map-pin') {
      assert.notEqual(iconForKey(iconKey), FALLBACK_ICON, `${iconKey} must resolve to its own icon`)
    }
  }
})

/* --- Yedekler ------------------------------------------------------------------ */

test('an unknown icon key falls back to MapPin, never to nothing', () => {
  for (const broken of [null, undefined, '', 'kayip-anahtar', 42, {}]) {
    assert.equal(iconForKey(broken), FALLBACK_ICON)
  }

  // Bileşen HER ZAMAN çizilebilir bir şey döndürür.
  assert.match(badge, /const Icon = iconForKey\(iconKey\)/)
})

test('a malformed colour falls back to the neutral grey', () => {
  assert.equal(FALLBACK_COLOR, '#64748B')

  for (const broken of [null, undefined, '', 'red', '#GGG', '#12345', 7]) {
    assert.equal(accentColor(broken), FALLBACK_COLOR)
    assert.equal(displayColor({ colorHex: broken }), FALLBACK_COLOR)
  }

  assert.equal(accentColor('#ef4444'), '#EF4444')
})

/* --- Yönetim ağacı ------------------------------------------------------------- */

test('the admin row draws the real category icon, not a plain colour square', () => {
  assert.match(tree, /<PoiCategoryBadge/)
  assert.match(tree, /iconKey=\{category\.iconKey\}/)
  assert.match(tree, /colorHex=\{displayColor\(category\)\}/)

  // Eski gösterge kaldırıldı: artık renkli bir kare çizen bir yol yok.
  const code = tree.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '')
  assert.ok(!/--poi-color/.test(code), 'the bare colour swatch must be gone')
})

test('the badge is restrained: it does not make the row taller', () => {
  const style = treeCss.slice(treeCss.indexOf('.admin-poi-tree-swatch {'))
  const block = style.slice(0, style.indexOf('}'))

  const width = Number(block.match(/width: (\d+)px/)[1])
  const height = Number(block.match(/height: (\d+)px/)[1])

  assert.equal(width, height, 'the badge is square')
  assert.ok(width >= 28 && width <= 32, `badge was ${width}px`)

  // Renk ÖLÇÜLÜ bir vurgudur: satırın tamamı boyanmaz.
  assert.match(block, /color-mix\(in srgb, var\(--poi-accent/)
})

test('the hierarchy rail and indentation survive untouched', () => {
  assert.match(tree, /admin-poi-tree-rail/)
  assert.match(tree, /'--poi-depth': indentOf\(category\)/)
  assert.match(tree, /indentOf\(category\) > 0 && </)
})

test('every category uses ITS OWN icon key, never the parent’s', () => {
  /* "Giyim Mağazaları" gömlek gösterir, üstünün çantasını değil. Satır
     `category.iconKey`'i doğrudan okur; devralma yapan hiçbir kod yoktur. */
  assert.ok(!/parent.*iconKey|iconKey.*parent/i.test(tree))

  const pairs = [
    ['shopping-bag', 'shopping-basket'],
    ['shopping-bag', 'monitor'],
    ['shopping-bag', 'shirt'],
    ['shopping-bag', 'armchair'],
    ['shopping-bag', 'shopping-cart'],
    ['hospital', 'pill'],
  ]

  for (const [parent, child] of pairs) {
    assert.notEqual(iconForKey(parent), iconForKey(child), `${parent} vs ${child}`)
    assert.notEqual(iconForKey(child), FALLBACK_ICON, `${child} must have its own glyph`)
  }
})

/* --- POI'lerim ----------------------------------------------------------------- */

test("POI'lerim shows the same badge, and needed no new request to do it", () => {
  assert.match(myPois, /<PoiCategoryBadge/)
  assert.match(myPois, /categoryPresentation\?\.get\(poi\.categoryId\)\?\.iconKey/)

  // Genel mavi nokta + raptiye kaldırıldı.
  assert.ok(!/drawings-item-dot/.test(myPois))
  assert.ok(!/PinIcon/.test(myPois))

  /* Eşleme haritanın ZATEN okuduğu listeden gelir; panel kendi isteğini
     açmaz ve sunucu sözleşmesine tek bir alan eklenmedi. */
  assert.match(page, /categoryPresentation=\{poiCategoryPresentation\}/)
  assert.ok(!/fetch|authFetch/.test(myPois))
})

test("a POI whose category metadata is missing still renders a badge", () => {
  // Eşleme henüz gelmemiş olabilir; satır kaybolmamalı, nötr rozete düşmeli.
  assert.match(myPois, /categoryPresentation = null/)
  assert.match(badge, /const color = accentColor\(colorHex\)/)
})

/* --- Ortak dil ----------------------------------------------------------------- */

test('the badge lets each screen own its size without forking the component', () => {
  assert.match(badge, /className = 'poi-category-badge'/)
  assert.match(tree, /className="admin-poi-tree-swatch"/)
  assert.match(myPois, /className="my-pois-badge"/)
  assert.match(search, /className="poi-search-option-icon"/)
})
