import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * Faz 6.1 — giriş ekranında YALNIZCA gerçekten çalışan eylemler kalır.
 *
 * Kaldırılan üç blokun ortak özelliği vardı: hiçbirinin arkasında bir uygulama
 * yoktu. Dil hapı hiçbir şeyi değiştirmiyordu, "Kurumsal SSO" düğmesinin bir
 * tıklama işleyicisi bile yoktu, Passkey kartı ise tıklanabilir değildi. Bir
 * denetimin var olması onu bir söz hâline getirir; tutulamayan söz arayüzde
 * durmamalıdır.
 *
 * <b>Kimlik doğrulama davranışı DEĞİŞMEZ.</b> Bu bir sunum temizliğidir:
 * istek, belirteç, iki aşamalı doğrulama dalı ve yönlendirme aynen korunur —
 * aşağıda ayrıca doğrulanır.
 *
 * Taramalar YORUMSUZ metin üzerindedir: aksi hâlde bu dosyanın kendi
 * açıklamalarındaki "SSO" ya da "Passkey" sözcükleri testi düşürürdü.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')
const stripCssComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, ' ')

const LOGIN = stripComments(read('../../src/pages/LoginPage.jsx'))
const LOGIN_CSS = stripCssComments(read('../../src/pages/LoginPage.css'))
const AUTH_SHELL = stripComments(read('../../src/pages/AuthShell.jsx'))
const TWO_FACTOR = stripComments(read('../../src/pages/TwoFactorPage.jsx'))

/** Giriş kartının içeriği: kaldırılanlar buradan çıkmalıydı. */
const loginCard = () => {
  const card = LOGIN.match(/<GlassPanel className="login-card"[\s\S]*?<\/GlassPanel>/)
  assert.ok(card, 'giriş kartı bulunmalı')
  return card[0]
}

/* --- 1-5. Çalışan giriş akışı OLDUĞU GİBİ durur ----------------------------- */

test('the username and password fields are still rendered', () => {
  const card = loginCard()
  assert.match(card, /id="login-username"[\s\S]*?autoComplete="username"/)
  assert.match(card, /id="login-password"[\s\S]*?autoComplete="current-password"/)
  assert.match(card, /label="Kullanıcı adı"/)
  assert.match(card, /label="Şifre"/)
})

test('the password visibility toggle is still rendered', () => {
  assert.match(LOGIN, /setShowPassword\(\(v\) => !v\)/)
  assert.match(LOGIN, /showPassword \? 'Şifreyi gizle' : 'Şifreyi göster'/)
  assert.match(LOGIN, /showPassword \? <EyeOffIcon size=\{18\} \/> : <EyeIcon size=\{18\} \/>/)
})

test('remember-me is still rendered and still bound to its state', () => {
  assert.match(LOGIN, /const \[rememberMe, setRememberMe\] = useState\(true\)/)
  assert.match(LOGIN, /className="login-remember-input"[\s\S]*?checked=\{rememberMe\}/)
  assert.ok(LOGIN.includes('Beni hatırla'))
})

test('forgot-password is still rendered and still points at its route', () => {
  assert.match(LOGIN, /className="login-forgot auth-link" to="\/forgot-password"/)
  assert.ok(LOGIN.includes('Şifremi unuttum?'))
})

test('the main login action and the register link are still rendered', () => {
  const card = loginCard()
  assert.match(card, /<Button type="submit" loading=\{loading\} className="login-submit">/)
  assert.ok(card.includes('Giriş Yap'))
  assert.match(card, /className="auth-link" to="\/register"/)
  assert.ok(card.includes('Kayıt Ol'))

  // Başlıklar korunur.
  assert.ok(card.includes('Hoş geldiniz'))
  assert.ok(card.includes('Hesabınıza giriş yapın'))
})

/* --- 6. Dil seçici giriş ekranından KALKTI (altyapı korunur) ---------------- */

test('the language selector is gone from the login page', () => {
  assert.equal(LOGIN.includes('LanguagePill'), false)
  assert.equal(LOGIN.includes('login-page-top-controls'), false)
})

test('the shared language pill still serves the other auth screens', () => {
  /* Bileşen PAYLAŞIMLIDIR: kayıt/şifre akışları (AuthShell) ve iki aşamalı
     doğrulama ekranı onu kullanmaya devam eder. Giriş ekranından kaldırmak,
     onu uygulamadan silmek DEĞİLDİR. */
  for (const [name, source] of [['AuthShell', AUTH_SHELL], ['TwoFactorPage', TWO_FACTOR]]) {
    assert.ok(source.includes('<LanguagePill />'), `${name} dil hapını kullanmaya devam etmeli`)
  }
  // Onların dayandığı düzen kuralı da yerinde kalır.
  assert.match(LOGIN_CSS, /\.login-page-top-controls\s*\{/)
})

/* --- 7 / 8 / 9. Sahte alternatif giriş yolları KALKTI ----------------------- */

test('the corporate SSO action is gone', () => {
  assert.equal(LOGIN.includes('login-sso'), false)
  assert.equal(LOGIN.includes('Kurumsal SSO'), false)
  assert.equal(LOGIN_CSS.includes('login-sso'), false)
})

test('the passkey / fingerprint section is gone', () => {
  assert.equal(LOGIN.includes('login-passkey'), false)
  assert.equal(LOGIN.includes('Parmak İzi'), false)
  assert.equal(LOGIN.includes('Hızlı ve güvenli giriş'), false)
  assert.equal(LOGIN_CSS.includes('login-passkey'), false)
})

test('the orphaned "veya" divider is gone with the alternatives it separated', () => {
  assert.equal(LOGIN.includes('login-divider'), false)
  assert.equal(/>veya</.test(LOGIN), false)
  assert.equal(LOGIN_CSS.includes('login-divider'), false)
})

/* --- 10. Ölü kod bırakılmadı ------------------------------------------------ */

test('no dead alternative-auth code is left behind', () => {
  // Yalnızca kaldırılan bloklarda kullanılan simgeler artık içe aktarılmaz.
  assert.equal(LOGIN.includes('FingerprintIcon'), false)
  assert.equal(LOGIN.includes('ShieldIcon'), false)

  // Kalan simgelerin hepsinin bir kullanımı vardır.
  const imported = LOGIN.match(/\{([^}]*)\} from '\.\.\/components\/ui\/icons\/index\.js'/)
  assert.ok(imported)
  for (const icon of imported[1].split(',').map((name) => name.trim()).filter(Boolean)) {
    assert.ok(
      new RegExp(`<${icon}\\b`).test(LOGIN),
      `${icon} içe aktarılıyor ama kullanılmıyor`,
    )
  }

  // Hiçbir yerde askıda kalmış bir alternatif-giriş işleyicisi yoktur.
  for (const dead of ['handleSso', 'handlePasskey', 'onSso', 'onPasskey', 'webauthn', 'WebAuthn']) {
    assert.equal(LOGIN.includes(dead), false, `${dead} kalmamalı`)
  }

  // Yorum satırına alınmış JSX bırakılmaz.
  assert.equal(/\{\s*\/\*[\s\S]*?<button/.test(read('../../src/pages/LoginPage.jsx')), false)
})

/* --- 11. Kimlik doğrulama sözleşmesi DEĞİŞMEDİ ------------------------------ */

test('the authentication contract is untouched', () => {
  assert.match(LOGIN, /import \{ login as loginRequest \} from '\.\.\/services\/api'/)
  assert.match(LOGIN, /const res = await loginRequest\(username, password\)/)
  assert.match(LOGIN, /login\(data\.token, data\.expiresAt\)/)

  // İki aşamalı doğrulama dalı ve yönlendirme aynen durur.
  assert.match(LOGIN, /data\.requiresTwoFactor \|\| data\.requiresTwoFactorSetup/)
  assert.match(LOGIN, /navigate\('\/login\/2fa'\)/)
  assert.match(LOGIN, /beginLoginToMapTransition\(\)/)
  assert.match(LOGIN, /requiresEmailConfirmation/)

  // Ekran hâlâ koyu sunuma sabitlenir; tema tercihi buradan yazılmaz.
  assert.match(LOGIN, /useFixedThemePresentation\('dark'\)/)
})

/* --- Düzen: altta boş şerit kalmaz ----------------------------------------- */

test('the card height was rebalanced for the shorter content', () => {
  const card = LOGIN_CSS.match(/\.login-card\s*\{([^}]*)\}/)
  assert.ok(card)
  const minHeight = card[1].match(/min-height:\s*(\d+)px/)
  assert.ok(minHeight, 'kart bir asgari yükseklik bildirmeli')
  assert.ok(Number(minHeight[1]) < 740, 'kart kaldırılan blokların yüksekliğini saymayı sürdürmemeli')

  // Görsel kimlik korunur: genişlik, kenarlık ve mor vurgu aynı.
  assert.match(card[1], /width:\s*min\(38vw, 640px\)/)
  assert.match(card[1], /border:\s*1px solid rgba\(145, 110, 255, 0\.5\)/)
})
