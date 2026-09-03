import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'
import { BASARSOFT_MARK_POLYGONS } from '../../src/brand/basarsoftMark.js'

/**
 * Faz 6 — düzeltme sonrası marka sözleşmesi.
 *
 * Ölçülen şey KİMLİK ile MARKANIN AYRILMASIDIR:
 *
 * <ul>
 *   <li><b>Kenar çubuğu</b> uygulamanın kimliğidir — konum iğnesi + projenin
 *       TAM adı, kırpılmadan. Kurumsal logo bu yuvada YOKTUR.</li>
 *   <li><b>Üst şerit</b> kurumsal atmosferdir — sağlanan Başarsoft afişi bir
 *       ARTALAN katmanı olarak, sağda denetimlere ayrılmış temiz bir güvenli
 *       bölge bırakarak. Proje adı burada BİR KEZ DAHA yazılmaz.</li>
 * </ul>
 *
 * Kaynak taramaları yorumsuz metin üzerinde ve BELİRTEÇ KAPSAMLIDIR; dosya
 * geneline atılan genel düzenli ifadeler bu fazda zaten bir yanlış eşleşme
 * üretmişti.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const assetExists = (name) => existsSync(new URL(`../../src/assets/brand/${name}`, import.meta.url))

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
const stripCssComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ')

const TOKENS = stripCssComments(read('../../src/styles/tokens.css'))
const TOPBAR = stripComments(read('../../src/components/map/Topbar.jsx'))
const TOPBAR_CSS = stripCssComments(read('../../src/components/map/Topbar.css'))
const SIDEBAR = stripComments(read('../../src/components/map/Sidebar.jsx'))
const SIDEBAR_CSS = stripCssComments(read('../../src/components/map/Sidebar.css'))
const THEME = stripComments(read('../../src/styles/theme.jsx'))
const BASEMAPS = stripComments(read('../../src/map/basemaps.js'))
const VEHICLE = stripComments(read('../../src/map/transportVehicle.js'))
const JOURNEY_VEHICLE = stripComments(read('../../src/map/journeyVehicle.js'))
const DOCK_HOOK = stripComments(read('../../src/hooks/useDockDrag.js'))

/** Yalnızca BİLDİRİM gövdeleri: at-rule önekleri buraya giremez. */
const declarationRules = (css) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }))

const rulesFor = (css, selector) =>
  declarationRules(css).filter((rule) => rule.selector === selector)

/** `--brand-header-artwork` bildirimlerinin işaret ettiği yollar. */
const artworkDeclarations = () =>
  [...TOKENS.matchAll(/--brand-header-artwork:\s*url\('([^']+)'\)/g)].map((match) => match[1])

const APP_TITLE = 'Staj Harita Uygulaması'

/* ========================================================================== *
 * KENAR ÇUBUĞU — uygulama kimliği
 * ========================================================================== */

/* --- 1 / 4. Ürün kimliği ÇİZİMDİR (Faz 10) ---------------------------------
   Faz 6'daki "konum iğnesi + yazılmış proje adı" düzeni BİLİNÇLİ olarak
   değiştirildi: kenar çubuğunun marka yuvası artık sağlanan Info&Motion
   çizimini taşır. Kurumsal marka (Başarsoft) hâlâ bu yuvada DEĞİL, üst
   şerittedir — sorumluluk ayrımı korunur. */

test('the sidebar brand slot carries the Info&Motion artwork', () => {
  const brandSlot = SIDEBAR.slice(
    SIDEBAR.indexOf('<div className="map-sidebar-brand">'),
    SIDEBAR.indexOf('<nav className="map-sidebar-nav"'),
  )

  assert.match(brandSlot, /className="map-sidebar-brand-logo"/)
  assert.match(brandSlot, /src=\{infomotionLogo\}/)

  // Çizim YEREL varlıktır; uzak bir adresten çekilmez.
  assert.match(SIDEBAR, /import infomotionLogo from '\.\.\/\.\.\/assets\/brand\/infomotion-logo\.png'/)
  assert.ok(existsSync(new URL('../../src/assets/brand/infomotion-logo.png', import.meta.url)))

  // Eski yuva artık yok: iğne ve yazılmış ad marka alanından kalktı.
  assert.equal(brandSlot.includes('map-sidebar-brand-icon'), false)
  assert.equal(brandSlot.includes(APP_TITLE), false)

  // Kurumsal işaret bileşeni bu ekranda HİÇ kullanılmaz.
  assert.equal(SIDEBAR.includes('BrandMark'), false)
  assert.equal(existsSync(new URL('../../src/components/ui/BrandMark.jsx', import.meta.url)), false)
})

/* --- 2 / 3. Ad ve slogan ÇİZİMİN İÇİNDEDİR --------------------------------- */

test('the sidebar does not retype what the artwork already says', () => {
  /* Çizim ürün adını ve sloganı kendi içinde taşır; HTML'e ikinci kez yazmak
     görenlere aynı şeyi iki kez okuturdu. Ekran okuyucu ise onu erişilebilir
     addan duyar. */
  assert.equal(SIDEBAR.includes('map-sidebar-brand-name'), false)
  assert.match(SIDEBAR, /const BRAND_ALT = 'Info&Motion — Sahadan veriye, veriden harekete\.'/)
  assert.match(SIDEBAR, /alt=\{BRAND_ALT\}/)
})

test('the sidebar artwork keeps its aspect ratio', () => {
  const rules = rulesFor(SIDEBAR_CSS, '.map-sidebar-brand-logo')
  assert.equal(rules.length, 1)
  const body = rules[0].body

  /* Oran KORUNUR: YALNIZCA genişlik verilir, yükseklik türetilir. Sabit bir
     yükseklik 3:1 çizimi ezerdi. */
  assert.match(body, /height:\s*auto/)
  assert.equal(/height:\s*\d/.test(body), false)
  assert.equal(/object-fit:\s*fill/.test(body), false)

  /* Değişmez olan şey ÖLÇÜ DEĞİL, SINIRIN NEREDEN GELDİĞİDİR: genişlik
     kapsayıcıya bağlı olmalıdır, böylece çizim levhayı hiçbir genişlikte
     aşamaz.

     Belirli bir özelliğe (`max-width`) ya da belirli bir piksele çivilemek
     yanlış olurdu: marka ölçüsü meşru biçimde ayarlanabilir ve nitekim
     ayarlandı — `width: 100%` + `max-width: 176px` ikilisi tek bir
     `width: min(100%, …)` ifadesine indi. İkisi de aynı güvenceyi verir;
     `width: 176px` gibi kapsayıcıdan kopuk bir ölçü ise vermez ve buradan
     geçemez. */
  const width = body.match(/(?:^|[\s;])width:\s*([^;]+);/)
  assert.ok(width, 'çizimin bir genişlik bildirimi olmalı')
  assert.ok(
    width[1].includes('100%'),
    `genişlik kapsayıcıya bağlı olmalı, bulunan: ${width[1].trim()}`,
  )

  /* Kenar çubuğu bunun için genişletilmedi. Ölçüm BİLDİRİM gövdelerinden
     okunur; dosya geneline atılan bir desen medya sorgusu başlığına
     çarpabilirdi. */
  const sidebar = rulesFor(SIDEBAR_CSS, '.map-sidebar').map((rule) => rule.body).join('\n')
  assert.match(sidebar, /width:\s*240px/)
})

/* --- 5. Harita ikonografisi değişmedi --------------------------------------- */

test('geographic POI and stop icons are untouched', () => {
  assert.ok(SIDEBAR.includes("label: \"POI'lerim\", Icon: PinIcon"))
  assert.ok(SIDEBAR.includes("label: 'Duraklarım', Icon: PinIcon"))
  // Menü satırları kendi kırpma politikalarını KORUR: düzeltme başlığa özeldir.
  assert.match(SIDEBAR_CSS, /\.map-sidebar-nav-item span\s*\{[^}]*text-overflow:\s*ellipsis/)
})

/* ========================================================================== *
 * ÜST ŞERİT — kurumsal marka
 * ========================================================================== */

/* --- 6. Proje adı üst şeritte YOK ------------------------------------------- */

test('the topbar renders no project title', () => {
  assert.equal(TOPBAR.includes(APP_TITLE), false)
  assert.equal(TOPBAR.includes('map-topbar-title'), false)
  assert.equal(/<h1/.test(TOPBAR), false)
  // Ölü stil de bırakılmaz.
  assert.equal(TOPBAR_CSS.includes('map-topbar-title'), false)
})

/* --- 7 / 8 / 9. Afiş PNG'leri, sözcük işareti SVG'leri değil ----------------- */

test('each theme scope points at its own local banner PNG', () => {
  const declarations = artworkDeclarations()

  /* Dört bildirim: varsayılan (koyu) :root, sistem tercihi açık, açık seçim,
     koyu seçim — projenin zaten kullandığı üç bloklu tema düzeni. */
  assert.equal(declarations.length, 4)
  assert.equal(declarations.filter((url) => url.endsWith('basarsoft-banner-dark.png')).length, 2)
  assert.equal(declarations.filter((url) => url.endsWith('basarsoft-banner-light.png')).length, 2)

  for (const url of declarations) {
    assert.ok(url.startsWith('../assets/brand/'), `${url} yerel bir varlık olmalı`)
  }
})

test('the supplied banner files are present as local assets', () => {
  /* Sağlanan PNG'ler depoda DURMALIDIR: CSS `url()` çözülemezse derleme
     kırılır. Bu test, varlıkların eklenip eklenmediğini söyleyen tek yerdir. */
  assert.ok(assetExists('basarsoft-banner-light.png'), 'açık tema afişi eklenmeli')
  assert.ok(assetExists('basarsoft-banner-dark.png'), 'koyu tema afişi eklenmeli')
})

test('the old topbar wordmark SVG treatment is gone', () => {
  assert.equal(/wordmark/.test(TOKENS), false)
  assert.equal(/wordmark/.test(TOPBAR_CSS), false)
  assert.equal(assetExists('basarsoft-wordmark-light.svg'), false)
  assert.equal(assetExists('basarsoft-wordmark-dark.svg'), false)
})

/* --- 16. Ağ/CDN yok --------------------------------------------------------- */

test('no brand asset is loaded from a network origin', () => {
  for (const url of artworkDeclarations()) assert.equal(/^https?:/.test(url), false)
  assert.equal(/url\(['"]?https?:/.test(TOPBAR_CSS), false)
  assert.equal(/url\(['"]?https?:/.test(TOKENS), false)
})

/* --- 10 / 11. Afiş DEKORATİFTİR, denetimler onun ÜSTÜNDEDİR ------------------ */

test('the banner layer is decorative and non-interactive', () => {
  assert.match(TOPBAR, /<span className="map-topbar-brand-artwork" aria-hidden="true" \/>/)

  const layer = rulesFor(TOPBAR_CSS, '.map-topbar-brand-artwork')
  assert.ok(layer.length >= 1)
  assert.match(layer[0].body, /position:\s*absolute/)
  assert.match(layer[0].body, /pointer-events:\s*none/)

  // Afiş bir ön plan `img` değildir.
  assert.equal(/<img/.test(TOPBAR), false)
})

test('the functional controls sit above the banner layer', () => {
  const stacked = rulesFor(TOPBAR_CSS, '.map-topbar-left,\n.map-topbar-right')
  assert.equal(stacked.length, 1, 'denetimler tek bir yığınlama kuralı paylaşmalı')
  assert.match(stacked[0].body, /position:\s*relative/)
  assert.match(stacked[0].body, /z-index:\s*1/)

  // Afiş katmanı kendine bir z-index almaz: akıştaki denetimlerin altında kalır.
  assert.equal(/z-index/.test(rulesFor(TOPBAR_CSS, '.map-topbar-brand-artwork')[0].body), false)
})

/* --- 12. Sağ güvenli bölge -------------------------------------------------- */

test('a right-side safe zone keeps the banner off the controls', () => {
  const layer = rulesFor(TOPBAR_CSS, '.map-topbar-brand-artwork')[0].body

  /* Afiş şeridin TAMAMINI kaplamaz: genişliği güvenli bölge kadar kısalır ve
     sağ kenara varmadan maskeyle söner. Önceki sürüm `left`/`right` ile tüm
     şeride yayılıyordu ve marka metni kullanıcı adının altına giriyordu. */
  assert.match(layer, /width:\s*min\(/)
  assert.match(layer, /--brand-header-safe-zone/)
  assert.match(layer, /mask-image:\s*linear-gradient\(90deg/)
  assert.equal(/(^|[\s;])right:\s*0/.test(layer), false)

  // Güvenli bölge ve denetim yüzeyi her tema kapsamında tanımlıdır.
  for (const token of ['--brand-header-safe-zone', '--brand-banner-width',
    '--brand-control-surface', '--brand-control-border']) {
    assert.equal((TOKENS.match(new RegExp(`${token}:`, 'g')) ?? []).length, 4, `${token} eksik`)
  }

  // Denetim yüzeyi afişten ayrışır ama neon değildir.
  const profile = rulesFor(TOPBAR_CSS, '.map-topbar-profile')[0].body
  assert.match(profile, /background:\s*var\(--brand-control-surface\)/)
  assert.match(profile, /border:\s*1px solid var\(--brand-control-border\)/)
  assert.equal(/box-shadow/.test(profile), false)
})

/* --- Duyarlı davranış: ÖNCE işlev ------------------------------------------- */

test('the banner yields to the controls as the viewport narrows', () => {
  const widths = rulesFor(TOPBAR_CSS, '.map-topbar-brand-artwork')
    .map((rule) => rule.body.match(/width:\s*min\((\d+)px/))
    .filter(Boolean)
    .map((match) => Number(match[1]))

  // Kırılma noktaları afişi DARALTIR, genişletmez.
  assert.deepEqual(widths, [...widths].sort((left, right) => right - left))
  assert.match(TOPBAR_CSS, /@media \(max-width: 560px\)\s*\{[\s\S]*?\.map-topbar-brand-artwork\s*\{[^}]*display:\s*none/)
})

test('the banner belongs to the topbar surface alone', () => {
  for (const [name, css] of [
    ['Sidebar.css', SIDEBAR_CSS],
    ['MapPage.css', stripCssComments(read('../../src/pages/MapPage.css'))],
    ['DrawToolbar.css', stripCssComments(read('../../src/components/map/DrawToolbar.css'))],
  ]) {
    assert.equal(/brand-header-artwork|basarsoft-banner/.test(css), false, `${name} afişi kullanmamalı`)
  }
})

/* --- 13 / 14. Tema otoritesi TEK ve değişmemiş ------------------------------- */

test('there is exactly one theme authority and it still paints data-theme', () => {
  assert.equal((THEME.match(/setAttribute\('data-theme'/g) ?? []).length, 1)
  assert.ok(THEME.includes("const STORAGE_KEY = 'staj-map-theme'"))
  assert.ok(THEME.includes('useFixedThemePresentation'))

  // Markalama ikinci bir tema durumu KURMAZ: tema yalnızca CSS kapsamından okunur.
  for (const source of [TOPBAR, SIDEBAR]) {
    assert.equal(/useTheme\(\)|resolvedTheme|data-theme/.test(source), false)
  }
})

test('the topbar controls keep their function and their place', () => {
  assert.equal((TOPBAR.match(/<ThemeToggle/g) ?? []).length, 1)
  assert.ok(TOPBAR.includes('{username}'))
  assert.ok(TOPBAR.includes('onClick={onLogout}'))
  assert.ok(TOPBAR.includes('Çıkış Yap'))
  assert.ok(TOPBAR.includes('Oturum süresi'))
  assert.ok(TOPBAR.includes('onOpenMobileMenu'))
})

/* --- 15. Harita sağlayıcısı eklenmedi --------------------------------------- */

test('no map provider is introduced', () => {
  const hosts = [...BASEMAPS.matchAll(/https?:\/\/([^/'"]+)/g)].map((match) => match[1])
  assert.deepEqual([...new Set(hosts)].sort(), ['server.arcgisonline.com', 'www.esri.com'])
})

/* ========================================================================== *
 * 17 / 18 / 19 — Faz 6 sınırları bu düzeltmeden ETKİLENMEDİ
 * ========================================================================== */

test('the Shared vehicle still uses the Başarsoft mark', () => {
  assert.ok(VEHICLE.includes('basarsoftMarkPolygonMarkup'))
  assert.ok(VEHICLE.includes('transportVehicleMarkDataUri'))
  assert.equal(BASARSOFT_MARK_POLYGONS.length, 2)
  assert.ok(Object.isFrozen(BASARSOFT_MARK_POLYGONS))
  // İşaretin kaynağı silinmedi.
  assert.ok(assetExists('basarsoft-symbol.svg'))
})

test('the personal journey marker remains untouched', () => {
  assert.equal(JOURNEY_VEHICLE.includes('basarsoftMark'), false)
  assert.ok(JOURNEY_VEHICLE.includes('journeyProfileIcon'))
})

test('the draggable Araçlar dock is intact', () => {
  assert.ok(DOCK_HOOK.includes('setPointerCapture'))
  assert.ok(DOCK_HOOK.includes('ResizeObserver'))
  assert.ok(DOCK_HOOK.includes('readDockPosition'))
  assert.ok(DOCK_HOOK.includes('writeDockPosition'))
})
