import assert from 'node:assert/strict'
import test from 'node:test'
import { existsSync, readFileSync } from 'node:fs'

/**
 * Faz 6.2 — kimlik doğrulama ekranlarının ürün kimliği: Info&Motion.
 *
 * Ölçülen sözleşme ikilidir:
 *
 * <ul>
 *   <li><b>Marka TEK yerde durur.</b> Giriş, kayıt (ve `AuthShell`'in diğer
 *       ekranları) ile iki aşamalı doğrulama AYNI görsel yüzeyi paylaşır;
 *       marka oraya konduğu için hiçbir ekran ötekinden geride kalmaz ve
 *       hiçbir JSX kopyalanmaz.</li>
 *   <li><b>Çizim OLDUĞU GİBİ kullanılır.</b> Ad ve slogan çizimin içindedir;
 *       yeniden çizilmez, HTML metniyle taklit edilmez ve slogan ikinci kez
 *       yazılmaz.</li>
 * </ul>
 *
 * Bu, uygulamanın İÇ marka işinden (harita üst şeridi, kenar çubuğu, paylaşılan
 * araç işareti) ayrıdır ve ona dokunmaz — aşağıda ayrıca doğrulanır.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const exists = (relative) => existsSync(new URL(relative, import.meta.url))

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

const PANE = clean('../../src/pages/LoginVisualPane.jsx')
const PANE_CSS = stripCssComments(read('../../src/pages/LoginVisualPane.css'))
const LOGIN = clean('../../src/pages/LoginPage.jsx')
const REGISTER = clean('../../src/pages/RegisterPage.jsx')
const SHELL = clean('../../src/pages/AuthShell.jsx')

const LOGO_ASSET = '../../src/assets/brand/infomotion-logo.png'
const SLOGAN = 'Sahadan veriye, veriden harekete.'

/** Marka `<img>` etiketi. */
const brandImg = () => {
  const tag = PANE.match(/<img\s+className="login-visual-brand-logo"[\s\S]*?\/>/)
  assert.ok(tag, 'marka görseli bulunmalı')
  return tag[0]
}

/** Bir kaynağın çizdiği görsel yüzey bileşenleri. */
const usesVisualPane = (source) => /<LoginVisualPane \/>/.test(source)

/* --- Kaynak ön işleme kendisi ------------------------------------------------
   Bu testler kaynağı METİN olarak okur; okuma bozulursa iddialar sessizce
   anlamını yitirir. Bir kez tam olarak bu oldu, bu yüzden ön işleme artık
   kendi testine sahiptir. */

test('stripping JSX comments never swallows surrounding code', () => {
  /* Tehlikeli şekil: gövdesi blok yorumla BAŞLAYAN ve JSX'inde ayrıca bir
     yorum taşıyan bir bileşen. Sınırsız bir desen, açılış `{`'inden ta o
     JSX yorumunun `*\/}` kapanışına kadar her şeyi silerdi. */
  const sample = [
    'export default function Sample() {',
    '  /* leading block comment */',
    "  useFixedThemePresentation('dark')",
    '  return (',
    '    <div>',
    '      <Visual />',
    '      {/* jsx comment */}',
    '      <Form />',
    '    </div>',
    '  )',
    '}',
  ].join('\n')

  const stripped = stripJsxComments(sample)

  // JSX yorumu gider...
  assert.equal(stripped.includes('jsx comment'), false)
  // ...ama gövde HİÇBİR ŞEY kaybetmez.
  assert.ok(stripped.includes("useFixedThemePresentation('dark')"))
  assert.ok(stripped.includes('<Visual />'))
  assert.ok(stripped.includes('<Form />'))
  assert.ok(stripped.includes('leading block comment'))
})

test('the processed LoginPage keeps its whole function body', () => {
  /* Ön işlemenin gerçek dosyada da doğru çalıştığının kanıtı: bu üç satır,
     hatalı desenin sildiği aralığın tam ortasındaydı. */
  for (const fragment of [
    'const [username, setUsername]',
    'const handleSubmit = async (event)',
    '<LoginVisualPane />',
  ]) {
    assert.ok(LOGIN.includes(fragment), `işlenmiş kaynak ${fragment} parçasını korumalı`)
  }
})

/* --- 1 / 7. Varlık YEREL ---------------------------------------------------- */

test('the supplied Info&Motion artwork is a local asset', () => {
  assert.ok(exists(LOGO_ASSET), 'Info&Motion çizim varlığı eklenmeli')

  /* Biçim de sözleşmenin parçasıdır: ilk sürümde uzantı `.svg` olmasına
     rağmen dosya geçerli bir SVG değildi ve tarayıcı yalnızca `alt` metnini
     gösteriyordu. Varlığın gerçekten bir PNG olduğu imzasından doğrulanır. */
  const header = readFileSync(new URL(LOGO_ASSET, import.meta.url)).subarray(0, 8)
  assert.deepEqual(
    [...header],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'çizim geçerli bir PNG olmalı',
  )
})

test('the branding introduces no external or CDN dependency', () => {
  assert.match(PANE, /import infomotionLogo from '\.\.\/assets\/brand\/infomotion-logo\.png'/)
  assert.match(brandImg(), /src=\{infomotionLogo\}/)
  // Uzak adres yok.
  assert.equal(/https?:\/\//.test(PANE), false)
  assert.equal(/url\(['"]?https?:/.test(PANE_CSS), false)
})

/* --- 2 / 3. Giriş VE kayıt aynı ürün kimliğini gösterir --------------------- */

test('the login screen shows the Info&Motion identity', () => {
  /* İki bağımsız halka, tek zincir: giriş sayfası ortak görsel yüzeyi
     ÇİZER, o yüzey de kurumsal çizimi gösterir. Halkaları ayrı ayrı
     doğrulamak, birinin kopması hâlinde hangisinin koptuğunu söyler. */
  assert.match(LOGIN, /import LoginVisualPane from '\.\/LoginVisualPane\.jsx'/)
  assert.ok(usesVisualPane(LOGIN), 'giriş ekranı ortak görsel yüzeyi çizmeli')

  assert.match(PANE, /className="login-visual-brand-logo"/)
  assert.match(brandImg(), /src=\{infomotionLogo\}/)
})

test('the register screen shows the same identity through the same shell', () => {
  /* Kayıt sayfası markayı KENDİ çizmez: `AuthShell` görsel yüzeyi çizer ve
     kayıt onun içindedir. Böylece kayıt ekranının hem form hem de BAŞARI dalı
     markalı kalır — ikisi de aynı kabuğu kullanır. */
  assert.ok(usesVisualPane(SHELL), 'kabuk ortak görsel yüzeyi çizmeli')

  const tags = REGISTER.match(/<AuthShell\b[^>]*>/g) ?? []
  assert.equal(tags.length, 2, 'kayıt ekranının form ve başarı dalları vardır')

  // Marka JSX'i kopyalanmadı.
  assert.equal(REGISTER.includes('login-visual-brand'), false)
  assert.equal(REGISTER.includes('infomotion'), false)
})

/* --- 4 / 5. Çizim yeniden üretilmedi, slogan iki kez yazılmadı -------------- */

test('the wordmark is the artwork, not typed-out JSX', () => {
  // Ürün adı bileşende metin olarak YAZILMAZ; çizimin içindedir.
  assert.equal(/>\s*Info&(?:amp;)?Motion\s*</.test(PANE), false)

  // Eski elle kurulmuş marka bloğu (iğne + ad + slogan) tamamen kalktı.
  for (const gone of ['PinIcon', 'login-visual-brand-name', 'login-visual-brand-accent',
    'login-visual-brand-tagline', 'Akıllı haritalar']) {
    assert.equal(PANE.includes(gone), false, `${gone} kalmamalı`)
    assert.equal(PANE_CSS.includes(gone), false, `${gone} stili kalmamalı`)
  }
})

test('the slogan is never rendered a second time', () => {
  /* Slogan çizimin İÇİNDEDİR. Tek geçtiği yer görselin `alt` metnidir; bir
     de HTML paragrafı olarak yazmak onu ekranda iki kez göstermek olurdu. */
  const occurrences = (PANE.match(new RegExp(SLOGAN.replace(/\./g, '\\.'), 'g')) ?? []).length
  assert.equal(occurrences, 1)
  assert.match(brandImg(), /alt="Info&Motion — Sahadan veriye, veriden harekete\."/)

  for (const [name, source] of [['LoginPage', LOGIN], ['RegisterPage', REGISTER], ['AuthShell', SHELL]]) {
    assert.equal(source.includes(SLOGAN), false, `${name} sloganı tekrar etmemeli`)
  }
})

/* --- 6. Duyarlı ölçü, bozulmayan en/boy oranı ------------------------------- */

test('the artwork scales responsively and keeps its aspect ratio', () => {
  const rules = [...PANE_CSS.matchAll(/\.login-visual-brand-logo\s*\{([^}]*)\}/g)].map((m) => m[1])
  assert.equal(rules.length, 3, 'masaüstü + tablet + telefon ölçüleri')

  // Yükseklik ASLA sabitlenmez: oran korunur.
  for (const body of rules) {
    assert.equal(/height:\s*\d/.test(body), false, 'sabit yükseklik oranı bozardı')
  }
  assert.match(rules[0], /height:\s*auto/)

  // Genişlik oransaldır; sabit bir piksel dayatması yoktur.
  assert.match(rules[0], /width:\s*clamp\(/)
  assert.match(rules[1], /width:\s*clamp\(/)
  assert.match(rules[2], /width:\s*min\(/)

  // Marka renkleri korunur: yalnızca siluetin DIŞINA çalışan gölge/parıltı.
  const filter = rules[0].match(/filter:\s*([^;]*)/)
  assert.ok(filter)
  for (const recolour of ['hue-rotate', 'saturate', 'grayscale', 'invert', 'sepia', 'brightness']) {
    assert.equal(filter[1].includes(recolour), false, `${recolour} marka renklerini bozardı`)
  }
  assert.match(filter[1], /drop-shadow/)

  // Sürekli animasyon eklenmedi.
  assert.equal(/animation:[^;]*infinite/.test(PANE_CSS), false)
})

/* --- Kabul edilmiş sahne korunur -------------------------------------------- */

test('the existing Earth visual and security badge are preserved', () => {
  assert.match(PANE, /import earthImage from '\.\.\/assets\/earth-login\.jpg'/)
  assert.match(PANE, /className="login-visual-earth" src=\{earthImage\}/)
  assert.equal((PANE.match(/login-visual-earth"/g) ?? []).length, 1, 'ikinci bir dünya katmanı yok')

  assert.ok(PANE.includes('Güvenli, hızlı ve modern'))
  assert.ok(PANE.includes('Verileriniz en üst düzeyde korunur.'))
  // Logonun arkasına kart/kutu konmadı.
  assert.equal(/\.login-visual-brand-logo\s*\{[^}]*background/.test(PANE_CSS), false)
})

/* --- 8 / 9 / 10 / 11. Önceki temizlikler yerinde ---------------------------- */

test('the login cleanup still holds', () => {
  for (const gone of ['login-sso', 'Kurumsal SSO', 'login-passkey', 'Parmak İzi',
    'login-divider', 'LanguagePill', 'login-page-top-controls']) {
    assert.equal(LOGIN.includes(gone), false, `${gone} geri gelmemeli`)
  }
})

test('the register language-selector cleanup still holds', () => {
  assert.equal(REGISTER.includes('LanguagePill'), false)
  for (const tag of REGISTER.match(/<AuthShell\b[^>]*>/g) ?? []) {
    assert.match(tag, /showLanguageSelector=\{false\}/)
  }
  // Kabuğun varsayılanı değişmedi.
  assert.match(SHELL, /showLanguageSelector = true/)
})

/* --- 12 / 13. Kimlik doğrulama sözleşmeleri değişmedi ----------------------- */

test('the login authentication contract is unchanged', () => {
  // İstek AYNI modülden gelir.
  assert.match(LOGIN, /import \{ login as loginRequest \} from '\.\.\/services\/api'/)

  /* Çağrı AYNI iki argümanı taşır. Biçimlendirmeye değil YAPIYA bakılır:
     boşluk ya da satır sonu değişse de sözleşme aynıdır. */
  assert.match(LOGIN, /await\s+loginRequest\(\s*username\s*,\s*password\s*\)/)

  // Çağrı, gönderim işleyicisinin İÇİNDEDİR — ölü bir satır değil.
  const submit = LOGIN.match(/const handleSubmit = async \(event\) => \{[\s\S]*?\n  \}/)
  assert.ok(submit, 'handleSubmit bulunmalı')
  assert.match(submit[0], /loginRequest\(/)

  // Kabul edilmiş çağrı sonrası davranış: 2FA dalı ve belirteç saklama.
  assert.match(submit[0], /data\.requiresTwoFactor \|\| data\.requiresTwoFactorSetup/)
  assert.match(submit[0], /navigate\('\/login\/2fa'\)/)
  assert.match(submit[0], /login\(data\.token, data\.expiresAt\)/)
  assert.match(submit[0], /beginLoginToMapTransition\(\)/)
})

test('the registration contract is unchanged', () => {
  assert.match(REGISTER, /import \{ register as registerRequest, readAccountError \} from '\.\.\/services\/api'/)
  assert.match(REGISTER, /const res = await registerRequest\(form\)/)
  assert.match(REGISTER, /form\.password !== form\.confirmPassword/)
  for (const id of ['register-username', 'register-email', 'register-password', 'register-confirm']) {
    assert.ok(REGISTER.includes(`id="${id}"`))
  }
})

/* --- O / 15. Tema otoritesi ve sunum saflığı -------------------------------- */

test('the auth screens keep their pinned dark presentation', () => {
  for (const [name, source] of [['LoginPage', LOGIN], ['AuthShell', SHELL]]) {
    // İçe aktarma ve ÇAĞRI ayrı ayrı: biri olmadan öteki bir şey ifade etmez.
    assert.match(
      source,
      /import \{ useFixedThemePresentation \} from '\.\.\/styles\/theme\.jsx'/,
      `${name} tema kancasını içe aktarmalı`,
    )
    assert.match(source, /useFixedThemePresentation\('dark'\)/, `${name} koyu sunuma sabitlemeli`)
    // Kanca bileşenin İÇİNDE çağrılır, koşulsuz.
    assert.match(source, /\n  useFixedThemePresentation\('dark'\)/, `${name} kancayı gövdede çağırmalı`)
  }

  // Görsel yüzey ikinci bir tema otoritesi KURMAZ.
  assert.equal(/useFixedThemePresentation|useTheme|data-theme/.test(PANE), false)
})

test('the visual pane stays presentation-only', () => {
  for (const forbidden of ['useState', 'useEffect', 'useAuth', 'navigate', 'fetch',
    'services/api', 'login(', 'register(']) {
    assert.equal(PANE.includes(forbidden), false, `${forbidden} sunum yüzeyinde olmamalı`)
  }
})

/* --- 14. Uygulamanın İÇ markası bu fazdan etkilenmedi ----------------------- */

test('the in-app map branding is untouched', () => {
  const TOPBAR = clean('../../src/components/map/Topbar.jsx')
  const SIDEBAR = clean('../../src/components/map/Sidebar.jsx')
  const VEHICLE = stripComments(read('../../src/map/transportVehicle.js'))

  // Üst şerit hâlâ kurumsal afişi taşır, ürün logosunu değil.
  assert.match(TOPBAR, /className="map-topbar-brand-artwork"/)
  assert.equal(TOPBAR.includes('infomotion'), false)

  // Kenar çubuğu kimliği ve paylaşılan araç işareti yerinde.
  assert.ok(SIDEBAR.includes('Staj Harita Uygulaması'))
  assert.equal(SIDEBAR.includes('infomotion'), false)
  assert.ok(VEHICLE.includes('basarsoftMarkPolygonMarkup'))
  assert.ok(exists('../../src/assets/brand/basarsoft-symbol.svg'))
})
