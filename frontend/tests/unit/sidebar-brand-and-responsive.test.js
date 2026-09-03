import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const exists = (relative) => existsSync(new URL(relative, import.meta.url))

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
const stripCssComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ')

/**
 * YALNIZCA bildirim gövdeleri.
 *
 * At-rule başlıkları (`@media (max-width: 640px)`) bir bildirim DEĞİLDİR ve
 * bu ayrım gereklidir: dosya geneline atılan `min-width:\s*\d+` gibi bir
 * desen medya sorgusunun başlığıyla eşleşir ve olmayan bir kural bulmuş gibi
 * davranırdı. Aynı sınıf hata bu projede daha önce yaşandı.
 */
const declarationRules = (css) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }))

const rulesFor = (css, selector) =>
  declarationRules(css).filter((rule) => rule.selector === selector)

const bodyOf = (css, selector) => {
  const rules = rulesFor(css, selector)
  assert.ok(rules.length > 0, `${selector} kuralı bulunmalı`)
  return rules.map((rule) => rule.body).join('\n')
}

/**
 * Seçicisi verilen parçayı İÇEREN kuralların gövdeleri.
 *
 * Çok satırlı bir seçici listesini ("a,\n  b,\n  c") birebir yazmak, yalnızca
 * girinti değiştiği için kırılırdı. Ölçülen şey yine BİLDİRİM gövdesidir;
 * gevşeyen tek şey seçicinin nasıl yazıldığıdır.
 */
const bodiesContaining = (css, fragment) => {
  const rules = declarationRules(css).filter((rule) => rule.selector.includes(fragment))
  assert.ok(rules.length > 0, `${fragment} içeren kural bulunmalı`)
  return rules.map((rule) => rule.body).join('\n')
}

const SIDEBAR = stripComments(read('../../src/components/map/Sidebar.jsx'))
const SIDEBAR_CSS = stripCssComments(read('../../src/components/map/Sidebar.css'))
const JOURNEY_CSS = stripCssComments(read('../../src/components/map/JourneyPlanner.css'))
const TOKENS = stripCssComments(read('../../src/styles/tokens.css'))
const TOPBAR = stripComments(read('../../src/components/map/Topbar.jsx'))
const DIALOG_CSS = stripCssComments(read('../../src/components/map/ConfirmDialog.css'))
const QUICK_CSS = stripCssComments(read('../../src/components/map/QuickActions.css'))
const DOCK_CSS = stripCssComments(read('../../src/components/map/DrawToolbar.css'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))

/* --- Kenar çubuğu markası --------------------------------------------------------- */

test('the sidebar brand is the supplied Info&Motion artwork', () => {
  assert.match(SIDEBAR, /import infomotionLogo from '\.\.\/\.\.\/assets\/brand\/infomotion-logo\.png'/)
  assert.ok(exists('../../src/assets/brand/infomotion-logo.png'))

  // Uzak bir adresten çekilmez ve yeniden çizilmez.
  assert.ok(!/https?:\/\//.test(SIDEBAR))
  assert.match(SIDEBAR, /<img className="map-sidebar-brand-logo" src=\{infomotionLogo\}/)
})

test('the artwork is not duplicated as typed text', () => {
  /* Ad ve slogan çizimin İÇİNDEDİR; HTML'e ikinci kez yazmak görenlere aynı
     şeyi iki kez okuturdu. Ekran okuyucu onu erişilebilir addan duyar. */
  assert.equal(SIDEBAR.includes('map-sidebar-brand-name'), false)
  assert.equal(SIDEBAR.includes('Staj Harita Uygulaması'), false)
  assert.match(SIDEBAR, /alt=\{BRAND_ALT\}/)
  assert.match(SIDEBAR, /const BRAND_ALT = 'Info&Motion — Sahadan veriye, veriden harekete\.'/)
})

test('the old pin-and-title brand slot is gone from the header', () => {
  const brand = SIDEBAR.slice(
    SIDEBAR.indexOf('<div className="map-sidebar-brand">'),
    SIDEBAR.indexOf('<nav className="map-sidebar-nav"'),
  )

  assert.equal(brand.includes('map-sidebar-brand-icon'), false)
  assert.equal(brand.includes('PinIcon'), false)

  // Ama menü satırları iğneyi KULLANMAYA DEVAM EDER: değişen yalnızca markadır.
  assert.match(SIDEBAR, /label: "POI'lerim", Icon: PinIcon/)
  assert.match(SIDEBAR, /label: 'Duraklarım', Icon: PinIcon/)
})

test('the artwork keeps its aspect ratio and never overflows', () => {
  const body = bodyOf(SIDEBAR_CSS, '.map-sidebar-brand-logo')

  /* Yükseklik TÜRETİLİR; iki eksen birden verilmez. */
  assert.match(body, /height:\s*auto/)
  assert.equal(/height:\s*\d/.test(body), false)
  assert.equal(/object-fit:\s*fill/.test(body), false)

  /* Sınır KAPSAYICIYA bağlıdır, sabit bir piksele değil: `100%` min()'in bir
     terimi olduğu sürece çizim levhayı aşamaz. Tek bir piksel değerini
     çivilemek, ölçüyü ayarlamayı testi bozmadan imkânsız kılardı. */
  assert.match(body, /width:\s*min\(\s*100%\s*,/)
})

test('the artwork fills the plate instead of leaving a dead strip', () => {
  /* Levha `justify-content` olmadan esnek öğeyi sola yaslıyor ve artan
     boşluğu sağda topluyordu; ayrıca çizimin tavanı levhanın içinden dardı. */
  assert.match(bodyOf(SIDEBAR_CSS, '.map-sidebar-brand'), /justify-content:\s*center/)

  const logo = bodyOf(SIDEBAR_CSS, '.map-sidebar-brand-logo')
  const ceiling = logo.match(/width:\s*min\(\s*100%\s*,\s*(\d+)px\s*\)/)

  assert.ok(ceiling, 'çizim genişliği kapsayıcıya bağlı bir min() olmalı')
  /* Tavan, kenar çubuğunun iç genişliğinden (240 − 2×16 = 208px) BÜYÜK
     olmalıdır ki gerçek sınır levha olsun ve içeride kullanılmayan bir şerit
     kalmasın. */
  assert.ok(Number(ceiling[1]) > 208, 'tavan levhayı değil, olası daha geniş bir çubuğu sınırlamalı')
})

test('the artwork gets a dark plate so its white wordmark stays readable', () => {
  /* Çizim koyu zemin için üretilmiştir: "Motion" ve slogan beyazdır. Açık
     temada soluk bir kenar çubuğu üstünde yarısı kaybolurdu. */
  const body = bodyOf(SIDEBAR_CSS, '.map-sidebar-brand')
  assert.match(body, /background:\s*var\(--sidebar-brand-plate\)/)

  /* Levha İKİ temada da koyudur: belirteç yalnızca `:root`ta tanımlanır ve
     tema başına yeniden tanımlanmaz. */
  const declarations = [...TOKENS.matchAll(/--sidebar-brand-plate:\s*([^;]+);/g)]
  assert.equal(declarations.length, 1, 'levha tema başına yeniden tanımlanmamalı')

  // Bileşende ham renk yoktur; belirteçler kullanılır.
  assert.equal(/#[0-9a-f]{3,6}/i.test(bodyOf(SIDEBAR_CSS, '.map-sidebar-brand')), false)
})

test('the collapsed rail hides the artwork instead of squashing it', () => {
  /* 3:1 bir çizim 76px'lik rayda okunmaz. Bozmak yerine çizilmez; kimlik
     erişilebilir adda yaşamaya devam eder. */
  assert.match(SIDEBAR, /collapsed \? \(/)
  assert.match(SIDEBAR, /className="map-sidebar-brand-collapsed" role="img" aria-label=\{BRAND_ALT\}/)

  const collapsed = bodyOf(SIDEBAR_CSS, '.map-sidebar-brand-collapsed')
  assert.match(collapsed, /clip-path:\s*inset\(50%\)/)

  // Tablet rayı da çizimi gizler.
  assert.match(SIDEBAR_CSS, /\.map-sidebar:not\(\.is-mobile-open\) \.map-sidebar-brand-logo/)
})

test('the topbar keeps the corporate banner and the auth screen keeps its own import', () => {
  assert.match(TOPBAR, /className="map-topbar-brand-artwork"/)
  assert.equal(TOPBAR.includes('infomotion'), false)

  // Kimlik doğrulama ekranı AYNI dosyayı kendi başına içe aktarır.
  const authPane = stripComments(read('../../src/pages/LoginVisualPane.jsx'))
  assert.match(authPane, /import infomotionLogo from '\.\.\/assets\/brand\/infomotion-logo\.png'/)
  assert.match(authPane, /className="login-visual-brand-logo"/)
})

/* --- Menü etkileşimi --------------------------------------------------------------- */

test('menu rows gain a visible hover treatment', () => {
  const hover = bodyOf(SIDEBAR_CSS, '.map-sidebar-nav-item:hover')

  assert.match(hover, /background:/)
  assert.match(hover, /box-shadow:\s*inset/)
  assert.match(hover, /transform:\s*translateX\(2px\)/)
})

test('hover never changes layout geometry', () => {
  /* Gerçek bir kenarlık satırın yüksekliğini oynatır ve fare gezdikçe menü
     titrerdi; vurgu `inset` gölgeyle verilir. `transform` düzeni etkilemez. */
  const hover = bodyOf(SIDEBAR_CSS, '.map-sidebar-nav-item:hover')

  for (const shifting of [/(^|[^-])border:/, /border-width:/, /padding:/, /margin:/, /min-height:/]) {
    assert.equal(shifting.test(hover), false, `hover ${shifting} değiştirmemeli`)
  }
})

test('keyboard focus is at least as clear as hover', () => {
  const focus = bodyOf(SIDEBAR_CSS, '.map-sidebar-nav-item:focus-visible')

  assert.match(focus, /outline:\s*2px solid/)
  assert.match(focus, /background:/)
})

test('the active row stays stronger than hover', () => {
  const active = bodyOf(SIDEBAR_CSS, '.map-sidebar-nav-item.is-active')
  const hover = bodyOf(SIDEBAR_CSS, '.map-sidebar-nav-item:hover')

  // Etkin: dolu gradyan + parıltı. Hover: yalnızca hafif tint.
  assert.match(active, /background:\s*var\(--gradient-primary\)/)
  assert.match(active, /box-shadow:\s*var\(--shadow-glow-soft\)/)
  assert.equal(/gradient-primary/.test(hover), false)

  // Ve hover etkin satırı ELE GEÇİRMEZ.
  const activeHover = bodiesContaining(SIDEBAR_CSS, '.map-sidebar-nav-item.is-active:hover')
  assert.match(activeHover, /background:\s*var\(--gradient-primary\)/)
})

test('navigation is fully visible without hover', () => {
  /* Dokunmatikte hover yoktur: satırın adı, simgesi ve etkin durumu hover
     olmadan da çizilir. */
  const base = bodyOf(SIDEBAR_CSS, '.map-sidebar-nav-item')

  assert.equal(/opacity:\s*0/.test(base), false)
  assert.equal(/visibility:\s*hidden/.test(base), false)
  assert.equal(/display:\s*none/.test(base), false)
})

/* --- Daralt/genişlet denetimi ------------------------------------------------------ */

test('the collapse control borrows the dock accent language', () => {
  const body = bodyOf(SIDEBAR_CSS, '.map-sidebar-collapse-btn')

  assert.match(body, /border-color:\s*var\(--transport-dock-border\)/)
  assert.match(body, /box-shadow:\s*var\(--transport-dock-glow\)/)

  // Yeni bir renk uydurulmadı: belirteçler kullanıldı.
  assert.equal(/#[0-9a-f]{3,6}/i.test(body), false)

  const hover = bodyOf(SIDEBAR_CSS, '.map-sidebar-collapse-btn:hover')
  assert.match(hover, /box-shadow:\s*var\(--transport-dock-glow-strong\)/)

  const focus = bodyOf(SIDEBAR_CSS, '.map-sidebar-collapse-btn:focus-visible')
  assert.match(focus, /outline:\s*2px solid/)
})

test('the collapse control keeps a comfortable target and real button semantics', () => {
  const body = bodyOf(SIDEBAR_CSS, '.map-sidebar-collapse-btn')

  assert.match(body, /min-width:\s*44px/)
  assert.match(body, /min-height:\s*44px/)

  // Davranış DEĞİŞMEDİ: aynı bileşen, aynı erişilebilir ad, aynı durum.
  assert.match(SIDEBAR, /label=\{collapsed \? 'Kenar çubuğunu genişlet' : 'Kenar çubuğunu daralt'\}/)
  assert.match(SIDEBAR, /aria-expanded=\{!collapsed\}/)
  assert.match(SIDEBAR, /onClick=\{onToggleCollapse\}/)
})

/* --- Yerleşim sınırları ------------------------------------------------------------ */

test('the journey panel is bounded by the viewport in both axes', () => {
  const body = bodyOf(JOURNEY_CSS, '.journey-panel')

  assert.match(body, /width:\s*min\(/)
  assert.match(body, /max-height:\s*calc\(100% - 2rem\)/)

  // Panele KÜRESEL bir asgari genişlik verilmez: dar ekranda taşmaya yol açardı.
  const declarations = declarationRules(JOURNEY_CSS)
  const globalMin = declarations.filter((rule) =>
    rule.selector === '.journey-panel' && /min-width:/.test(rule.body))
  assert.equal(globalMin.length, 0)
})

test('the narrow-screen sheet stays inside the viewport', () => {
  /* Dar ekranda panel alt şeride iner ve yüksekliği görüntü alanının bir
     ORANIYLA sınırlıdır: sabit bir piksel değeri kısa ekranlarda taşardı. */
  const panel = bodiesContaining(JOURNEY_CSS, '.journey-panel')

  assert.match(panel, /max-height:\s*min\(var\(--journey-sheet-height\), 55%\)/)
  // Yatay taşma da yoktur: genişlik kenar boşluklarıyla birlikte hesaplanır.
  assert.match(panel, /width:\s*min\(var\(--journey-panel-width\), calc\(100% - 5\.25rem\)\)/)
})

test('the panel body owns scrolling on narrow screens', () => {
  /* Masaüstünde iç listeler kendi pencerelerinde kayar; dar ekranda panelin
     kendisi zaten sınırlıdır ve iç pencereler onunla yarışırdı — parmak hangi
     alanı sürüklediğini bilemezdi. */
  assert.match(bodyOf(JOURNEY_CSS, '.journey-body'), /overflow-y:\s*auto/)

  const single = bodiesContaining(JOURNEY_CSS, '.journey-saved-list,')
  assert.match(single, /max-height:\s*none/)
  assert.match(single, /overflow-y:\s*visible/)
})

test('dialogs are viewport aware', () => {
  const body = bodyOf(DIALOG_CSS, '.confirm-dialog')
  assert.match(body, /width:\s*min\(400px, 100%\)/)

  // Ve dar ekranda eylemler alt alta iner.
  assert.match(bodyOf(DIALOG_CSS, '.confirm-actions'), /flex-direction:/)
})

test('map controls keep comfortable touch targets', () => {
  const quick = bodyOf(QUICK_CSS, '.quick-action')
  assert.match(quick, /width:\s*44px/)
  assert.match(quick, /height:\s*44px/)

  // Rıhtımın tutamağı kaba işaretçide büyür ve rıhtım görüntü alanını aşmaz.
  assert.match(DOCK_CSS, /@media \(pointer: coarse\)/)
  assert.match(bodyOf(DOCK_CSS, '.draw-toolbar'), /max-width:\s*calc\(100% - 1\.5rem\)/)
})

/* --- Mimari sınırlar --------------------------------------------------------------- */

test('responsive behaviour stays in CSS', () => {
  /* Sunum kesme noktası JS'e taşınmaz. `useMediaQuery` zaten vardır ve
     CSS'teki kesme noktasıyla eşleşir; `window.innerWidth` mimarisi
     kurulmaz. */
  assert.equal(MAP_PAGE.includes('window.innerWidth'), false)
  assert.equal(SIDEBAR.includes('window.innerWidth'), false)
})

test('no new storage or channel was introduced', () => {
  for (const [name, source] of [['Sidebar.jsx', SIDEBAR]]) {
    for (const forbidden of ['localStorage', 'sessionStorage', '@microsoft/signalr', 'setInterval']) {
      assert.ok(!source.includes(forbidden), `${name} ${forbidden} kullanmamalı`)
    }
  }

  // Rıhtımın MEVCUT konum kalıcılığı korunur; yerine bir şey konmaz.
  const dockHook = stripComments(read('../../src/hooks/useDockDrag.js'))
  assert.match(dockHook, /localStorage/)
})
