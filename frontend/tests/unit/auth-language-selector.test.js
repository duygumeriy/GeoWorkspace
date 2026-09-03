import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * Faz 6.1 — dil seçici yalnızca onu hâlâ çizen ekranlarda kalır.
 *
 * Dil hapı hiçbir şeyi değiştirmiyor (bkz. `LanguagePill`: `aria-hidden` bir
 * `div`, tıklama işleyicisi yok). Giriş ekranından zaten kaldırılmıştı; kayıt
 * ekranında görünmeye devam etmesinin nedeni onu KAYIT SAYFASININ değil, ortak
 * `AuthShell` çerçevesinin çiziyor olmasıydı.
 *
 * Ölçülen sözleşme: <b>görünürlük bir BİLEŞEN sözleşmesidir</b>, rotaya göre
 * bir CSS numarası değil. Kabuğun varsayılanı korunur, kayıt ekranı açıkça
 * devre dışı bırakır.
 *
 * Taramalar yorumsuz metin üzerindedir: bu dosyanın ve kaynakların kendi
 * açıklamaları testi düşürmemelidir.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
/**
 * JSX yorumlarını (`{/* ... *\/}`) siler.
 *
 * <b>İçerik bir `*\/` sınırını AŞAMAZ.</b> Bu kısıt olmadan desen, bir işlev
 * gövdesini açan `{` ile ondan sonraki ilk blok yorumunu eşleştirip, kapanışı
 * dosyanın çok ilerisindeki bir `*\/}` dizisinde bulabiliyordu — arada kalan
 * TÜM gövdeyi (durum, kancalar, istekler, çizilen bileşenler) sessizce
 * yutarak. `LoginPage` tam olarak bu şekle sahiptir: gövdesi bir blok yorumla
 * başlar ve JSX'inde bir yorum taşır.
 *
 * Sonuç kırmızı bir test değil, YANLIŞ bir testti: olumlu iddialar sebepsiz
 * düşerken, olumsuz iddialar (`includes(...) === false`) hiç kaynağı görmeden
 * "geçiyordu".
 */
const stripJsxComments = (source) =>
  source.replace(/\{\s*\/\*(?:(?!\*\/)[\s\S])*\*\/\s*\}/g, ' ')
const stripCssComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ')

const clean = (relative) => stripComments(stripJsxComments(read(relative)))

const SHELL = clean('../../src/pages/AuthShell.jsx')
const REGISTER = clean('../../src/pages/RegisterPage.jsx')
const LOGIN = clean('../../src/pages/LoginPage.jsx')
const PILL = clean('../../src/components/ui/LanguagePill.jsx')

/** `AuthShell` kullanan tüm ekranlar. */
const SHELL_CONSUMERS = [
  'ActivateAccountPage.jsx',
  'ConfirmEmailPage.jsx',
  'ForgotPasswordPage.jsx',
  'RegisterPage.jsx',
  'ResetPasswordPage.jsx',
]

/** Bir kaynaktaki her `<AuthShell ...>` açılış etiketi. */
const shellTags = (source) => source.match(/<AuthShell\b[^>]*>/g) ?? []

/* --- 1 / 2. Kayıt ekranında dil seçici YOK ---------------------------------- */

test('the register screen renders no language selector', () => {
  // Kayıt sayfası hapı zaten doğrudan çizmiyordu; kabuktan da istemiyor.
  assert.equal(REGISTER.includes('LanguagePill'), false)
  assert.equal(REGISTER.includes('login-page-top-controls'), false)

  const tags = shellTags(REGISTER)
  assert.equal(tags.length, 2, 'kayıt ekranının iki kabuk dalı vardır (form ve başarı)')
  for (const tag of tags) {
    assert.match(tag, /showLanguageSelector=\{false\}/, `devre dışı bırakılmamış dal: ${tag}`)
  }
})

test('the language control has no label or affordance left on that screen', () => {
  /* Hapın görünen metni ve simgeleri kaynağın hiçbir yerinden sızmaz. */
  assert.equal(REGISTER.includes('Türkçe'), false)
  assert.equal(REGISTER.includes('GlobeIcon'), false)
  assert.equal(REGISTER.includes('language-pill'), false)
})

/* --- 7. Kabuğun VARSAYILANI değişmedi -------------------------------------- */

test('AuthShell keeps the selector by default', () => {
  assert.match(SHELL, /function AuthShell\(\{[^}]*showLanguageSelector = true[^}]*\}\)/)

  // Çizim koşula bağlıdır ve kapalıyken sarmalayıcı hiç oluşmaz.
  assert.match(SHELL, /\{showLanguageSelector && \(\s*<div className="login-page-top-controls">/)
  assert.match(SHELL, /<LanguagePill \/>/)
})

test('the other auth screens are untouched and still get the default', () => {
  for (const name of SHELL_CONSUMERS.filter((file) => file !== 'RegisterPage.jsx')) {
    const source = clean(`../../src/pages/${name}`)
    const tags = shellTags(source)
    assert.ok(tags.length > 0, `${name} kabuğu kullanmalı`)
    for (const tag of tags) {
      assert.equal(
        /showLanguageSelector/.test(tag),
        false,
        `${name} varsayılanı taşımalı, açıkça bir değer geçmemeli`,
      )
    }
  }
})

/* --- 8. Rotaya özel CSS numarası YOK ---------------------------------------- */

test('visibility is a component contract, not a route-specific CSS hack', () => {
  const LOGIN_CSS = stripCssComments(read('../../src/pages/LoginPage.css'))
  const AUTH_CSS = stripCssComments(read('../../src/pages/AuthShell.css'))
  const PILL_CSS = stripCssComments(read('../../src/components/ui/LanguagePill.css'))

  for (const [name, css] of [['LoginPage.css', LOGIN_CSS], ['AuthShell.css', AUTH_CSS],
    ['LanguagePill.css', PILL_CSS]]) {
    // Ne hapı ne de üst denetim şeridini gizleyen bir kural eklenmedi.
    assert.equal(
      /\.(language-pill|login-page-top-controls)[^{]*\{[^}]*display:\s*none/.test(css),
      false,
      `${name} içinde gizleme numarası olmamalı`,
    )
    // Rota adına göre yazılmış bir seçici de yoktur.
    assert.equal(/\[(?:data-)?route[^\]]*\]/.test(css), false, `${name} rotaya göre biçimlendirmemeli`)
  }

  // Düzen kuralı duruyor: onu KULLANAN ekranlar için hâlâ gerekli.
  assert.match(LOGIN_CSS, /\.login-page-top-controls\s*\{/)
})

/* --- Paylaşılan bileşen silinmedi ------------------------------------------- */

test('LanguagePill survives because other screens still consume it', () => {
  assert.match(PILL, /export default function LanguagePill\(\)/)

  const consumers = ['../../src/pages/AuthShell.jsx', '../../src/pages/TwoFactorPage.jsx']
    .filter((path) => clean(path).includes('<LanguagePill />'))

  assert.ok(consumers.length >= 2, 'hap hâlâ kullanılıyor; silinmemeli')
})

/* --- 3 / 4 / 5 / 9. Kayıt işlevi OLDUĞU GİBİ ------------------------------- */

test('the registration form still renders every field', () => {
  for (const id of ['register-username', 'register-email', 'register-password', 'register-confirm']) {
    assert.ok(REGISTER.includes(`id="${id}"`), `${id} alanı korunmalı`)
  }
  assert.match(REGISTER, /showPassword \? 'text' : 'password'/)
  assert.match(REGISTER, /const \[form, setForm\] = useState\(\{/)
})

test('the register submit action remains', () => {
  assert.match(REGISTER, /<Button type="submit" loading=\{loading\} className="login-submit">/)
  assert.match(REGISTER, /<form onSubmit=\{handleSubmit\} noValidate>/)
})

test('navigation back to login remains on both branches', () => {
  // Form dalı: alt bilgideki bağlantı.
  assert.match(REGISTER, /className="auth-link" to="\/login"/)
  // Başarı dalı: "Giriş ekranına dön" düğmesi.
  assert.match(REGISTER, /navigate\('\/login'\)/)
  assert.ok(REGISTER.includes('Giriş ekranına dön'))
})

test('the registration API contract is unchanged', () => {
  assert.match(REGISTER, /import \{ register as registerRequest, readAccountError \} from '\.\.\/services\/api'/)
  assert.match(REGISTER, /const res = await registerRequest\(form\)/)
  assert.match(REGISTER, /readAccountError\(res, 'Kayıt tamamlanamadı\.'\)/)
  // İstemci tarafı denetimi yalnızca gidiş-dönüş tasarrufudur; kural değişmedi.
  assert.match(REGISTER, /form\.password !== form\.confirmPassword/)
})

/* --- 6. Giriş ekranı temiz KALDI -------------------------------------------- */

test('the login screen still has no language selector', () => {
  assert.equal(LOGIN.includes('LanguagePill'), false)
  assert.equal(LOGIN.includes('login-page-top-controls'), false)
  // Önceki temizlik de yerinde durur.
  assert.equal(LOGIN.includes('login-sso'), false)
  assert.equal(LOGIN.includes('login-passkey'), false)
})
