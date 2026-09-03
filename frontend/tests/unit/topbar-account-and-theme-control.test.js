import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * Faz 12 — üst şerit tema anahtarı ve hesap yüzeylerinin SUNUM sözleşmesi.
 *
 * Ölçülen şey davranış değil, SUNUMUN bağlı olduğu kaynaklardır: renkler tema
 * belirteçlerinden mi geliyor, yoksa bileşen kendi paletini mi yazıyor. Piksel
 * değerleri bilinçli olarak ölçülmez — boşluk ve yarıçap ayarlanabilir kalır.
 *
 * Oturum sayacı, çıkış isteği, tema kalıcılığı ve daraltma davranışı bu fazda
 * DEĞİŞMEDİ; burada yalnızca hâlâ yerinde olduklarını doğrulayan dar iddialar
 * vardır.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const stripCssComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ')

const declarationRules = (css) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }))

const bodyOf = (css, selector) => {
  const rules = declarationRules(css).filter((rule) => rule.selector === selector)
  assert.ok(rules.length > 0, `${selector} kuralı bulunmalı`)
  return rules.map((rule) => rule.body).join('\n')
}

const TOKENS = read('../../src/styles/tokens.css')
const TOGGLE = read('../../src/components/ui/ThemeToggle.jsx')
const TOGGLE_CSS = stripCssComments(read('../../src/components/ui/ThemeToggle.css'))
const TOPBAR = read('../../src/components/map/Topbar.jsx')
const TOPBAR_CSS = stripCssComments(read('../../src/components/map/Topbar.css'))
const SIDEBAR = read('../../src/components/map/Sidebar.jsx')
const SIDEBAR_CSS = stripCssComments(read('../../src/components/map/Sidebar.css'))

/* --- Tema anahtarı: açık temada koyu bir hap DEĞİL ----------------------------- */

test('the theme control paints itself from theme tokens, not a fixed dark surface', () => {
  const body = bodyOf(TOGGLE_CSS, '.theme-toggle')

  /* Kök sorun buydu: zemin ve kenarlık ham renklerdi, dolayısıyla hiçbir tema
     onları yeniden tanımlayamıyor ve denetim açık temada da koyu kalıyordu. */
  assert.match(body, /background:\s*var\(--brand-control-surface\)/)
  assert.match(body, /border:\s*1px solid var\(--brand-control-border\)/)
  assert.match(body, /box-shadow:\s*var\(--brand-control-glow\)/)

  // Denetimin HİÇBİR parçası artık kendi paletini yazmaz.
  assert.equal(
    /background:\s*(#|rgba?\()/.test(TOGGLE_CSS),
    false,
    'tema anahtarı hâlâ ham bir zemin rengi taşıyor',
  )

  // Kapalı ray ve güneş simgesi de temaya aittir.
  assert.match(bodyOf(TOGGLE_CSS, '.theme-toggle-track'), /background:\s*var\(--control-track-off\)/)
  assert.match(bodyOf(TOGGLE_CSS, '.theme-toggle-icon-sun'), /color:\s*var\(--control-sun\)/)
})

test('every control token is defined in all four theme scopes', () => {
  /* Projenin tema düzeni dört bloktur: varsayılan (koyu) :root, sistem
     tercihi açık, açık seçim, koyu seçim. Bir belirteç yalnızca birinde
     tanımlanırsa, diğer temalarda sessizce boş kalır — ve tam olarak bu,
     denetimin açık temada koyu kalmasına yol açan hatanın biçimiydi. */
  for (const token of ['--brand-control-glow', '--control-sun', '--control-track-off']) {
    assert.equal(
      (TOKENS.match(new RegExp(`${token}:`, 'g')) ?? []).length,
      4,
      `${token} dört tema kapsamının hepsinde tanımlı olmalı`,
    )
  }
})

test('the theme control keeps its switch mechanics and semantics', () => {
  // Sıra, kalıcı durum ve erişilebilir ad DEĞİŞMEDİ.
  assert.match(TOGGLE, /const ORDER = \['system', 'dark', 'light'\]/)
  assert.match(TOGGLE, /setTheme\(next\)/)
  assert.match(TOGGLE, /type="button"/)
  assert.match(TOGGLE, /aria-label=\{`Tema: \$\{LABELS\[theme\]\}/)
  assert.match(TOGGLE, /resolvedTheme === 'dark' \? 'is-dark' : 'is-light'/)

  // Klavye kullanıcısı denetimi görür.
  assert.match(bodyOf(TOGGLE_CSS, '.theme-toggle:focus-visible'), /outline:\s*2px solid/)
})

/* --- Üst şerit hesap kapsülü --------------------------------------------------- */

test('the topbar account capsule keeps username, session and logout as one unit', () => {
  assert.match(TOPBAR, /className="map-topbar-profile"/)
  assert.match(TOPBAR, /className="map-topbar-username"/)
  assert.match(TOPBAR, /className="map-topbar-timer" aria-label=\{`Oturum süresi: \$\{remaining\}`\}/)

  // Çıkış GERÇEK bir düğmedir ve aynı geri çağırmayı çağırır.
  assert.match(TOPBAR, /<button type="button" className="map-topbar-logout" onClick=\{onLogout\}>/)
  assert.match(TOPBAR, /<span>Çıkış Yap<\/span>/)

  const capsule = bodyOf(TOPBAR_CSS, '.map-topbar-profile')
  assert.match(capsule, /background:\s*var\(--brand-control-surface\)/)
  assert.match(capsule, /border:\s*1px solid var\(--brand-control-border\)/)
  // Ham renk yok: kapsül de tema belirteçlerinden boyanır.
  assert.equal(/#[0-9a-f]{3,6}/i.test(capsule), false)
})

test('the topbar logout is calm by default and speaks danger only on intent', () => {
  const base = bodyOf(TOPBAR_CSS, '.map-topbar-logout')
  const hover = bodyOf(TOPBAR_CSS, '.map-topbar-logout:hover')
  const focus = bodyOf(TOPBAR_CSS, '.map-topbar-logout:focus-visible')

  assert.match(base, /color:\s*var\(--text-secondary\)/)
  assert.match(hover, /color:\s*var\(--danger\)/)

  // Anlam yalnızca RENKLE taşınmaz: odak da görünür bir halka çizer…
  assert.match(focus, /outline:\s*2px solid/)
  // …ve etiket metni her ölçüde kaldırılmaz, yalnızca dar ekranda gizlenir.
  assert.match(TOPBAR_CSS, /@media \(max-width: 640px\)[\s\S]*?\.map-topbar-logout span \{[^}]*display:\s*none/)
})

test('the topbar account area cannot force horizontal overflow', () => {
  const capsule = bodyOf(TOPBAR_CSS, '.map-topbar-profile')
  const name = bodyOf(TOPBAR_CSS, '.map-topbar-username')

  // Kapsül küçülebilir, ad kısalabilir — şerit taşmaz.
  assert.match(capsule, /min-width:\s*0/)
  assert.match(name, /text-overflow:\s*ellipsis/)
  assert.match(name, /white-space:\s*nowrap/)

  // Kısaltma bilgiyi GİZLEMEZ: tam ad `title` ile erişilebilir kalır.
  assert.match(TOPBAR, /className="map-topbar-username" title=\{username\}/)
})

/* --- Kenar çubuğu hesap kartı -------------------------------------------------- */

test('the sidebar account card belongs to the same visual family', () => {
  const card = bodyOf(SIDEBAR_CSS, '.map-sidebar-user')

  assert.match(card, /background:\s*var\(--brand-control-surface\)/)
  assert.match(card, /border:\s*1px solid var\(--brand-control-border\)/)
  assert.match(card, /box-shadow:\s*var\(--brand-control-glow\)/)
  assert.equal(/#[0-9a-f]{3,6}/i.test(card), false)
})

test('the sidebar account card keeps username, session text and a real logout button', () => {
  assert.match(SIDEBAR, /className="map-sidebar-username"/)
  assert.match(SIDEBAR, /className="map-sidebar-session"/)
  // Süre METİNDİR; simge tek başına anlatmaz.
  assert.match(SIDEBAR, /Oturum: \{remaining\}/)

  assert.match(SIDEBAR, /type="button"/)
  assert.match(SIDEBAR, /className="map-sidebar-logout"/)
  assert.match(SIDEBAR, /onClick=\{onLogout\}/)
  assert.match(SIDEBAR, /aria-label="Çıkış Yap"/)

  const base = bodyOf(SIDEBAR_CSS, '.map-sidebar-logout')
  const hover = bodyOf(SIDEBAR_CSS, '.map-sidebar-logout:hover')

  assert.match(base, /color:\s*var\(--text-secondary\)/)
  assert.match(hover, /color:\s*var\(--danger\)/)
  assert.match(bodyOf(SIDEBAR_CSS, '.map-sidebar-logout:focus-visible'), /outline:\s*2px solid/)
})

test('the collapsed rail never renders a squeezed account card', () => {
  /* Daraltılmış kenar çubuğunda kart YOKTUR: 44px'lik çıkış hedefini koruyan
     çıplak bir düğme kalır. Parıltı da kartla birlikte kalkar; aksi hâlde
     rayda görünür bir kaynağı olmayan bir gölge asılı kalırdı. */
  for (const selector of [
    '.map-sidebar.is-collapsed .map-sidebar-user',
    '.map-sidebar:not(.is-mobile-open) .map-sidebar-user',
  ]) {
    const body = bodyOf(SIDEBAR_CSS, selector)
    assert.match(body, /background:\s*none/)
    assert.match(body, /border:\s*none/)
    assert.match(body, /box-shadow:\s*none/)
  }

  // Çıkış düğmesi rayda da tam dokunma hedefini korur.
  assert.match(bodyOf(SIDEBAR_CSS, '.map-sidebar-logout'), /min-height:\s*44px/)
  assert.match(bodyOf(SIDEBAR_CSS, '.map-sidebar-logout'), /min-width:\s*44px/)
})

/* --- İkinci bir hesap mantığı YOKTUR ------------------------------------------- */

test('neither surface computes session state or performs the logout itself', () => {
  /* Sayaç `MapPage`'te `expiresAt`'ten türetilir ve iki yüzeye de PROP olarak
     geçer; çıkış da aynı geri çağırmadır. Bu fazda hiçbir şey kopyalanmadı —
     kopyalansaydı iki yerde birbirinden sapan iki oturum gerçeği doğardı. */
  for (const [name, source] of [['Topbar.jsx', TOPBAR], ['Sidebar.jsx', SIDEBAR]]) {
    for (const forbidden of ['expiresAt', 'useAuth', 'setInterval', 'logoutRequest', 'fetch(']) {
      assert.equal(
        source.includes(forbidden),
        false,
        `${name} kendi oturum/çıkış mantığını kuruyor: ${forbidden}`,
      )
    }
  }
})
