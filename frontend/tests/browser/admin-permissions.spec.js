import { expect, test } from '@playwright/test'

/**
 * Yetki kataloğu ekranı (/admin/permissions).
 *
 * Fixture'lar GERÇEK sözleşmeyi yansıtır:
 *
 *   GET /api/admin/permissions
 *       -> PermissionCatalogItem[]
 *          { id, code, name, description, category, isActive, sortOrder }
 *       MFA + `permissions.view` ister; kullanımdan kaldırılmış satırlar da
 *       döner (`isActive:false`) ve sıra sunucudan gelir:
 *       category -> sortOrder -> code.
 *
 * Ekran SALT OKUNURDUR: sunucunun katalog için create/update/delete ucu yoktur,
 * dolayısıyla bu testler bir mutasyonun çalıştığını değil, HİÇ OLMADIĞINI da
 * doğrular.
 *
 * Hiçbir şey veritabanına dokunmaz; tüm ağ trafiği burada karşılanır.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/* --- Katalog -------------------------------------------------------------------
   Sunucu sırası: önce `category` (alfabetik), sonra `sortOrder`, sonra `code`.
   Türkçe başlıklara çevrildiğinde bu sıra ALFABETİK DEĞİLDİR ve `sortOrder`
   kategoriler arasında artmaz (Permissions 900, Reporting 700, Roles 800) —
   ekran kendi sıralamasını uygularsa buradan görünür. */

const permission = (id, code, name, category, sortOrder, extra = {}) => ({
  id,
  code,
  name,
  description: `${name} yetkisinin açıklaması.`,
  category,
  isActive: true,
  sortOrder,
  ...extra,
})

const CATALOG = [
  permission(20, 'drawings.point.create', 'Nokta Ekleme', 'DrawingCreate', 200),
  permission(21, 'drawings.line.create', 'Çizgi Ekleme', 'DrawingCreate', 210),
  /* sortOrder 300 önce gelir; Türkçe alfabede "Çizim Silme" öne geçerdi. */
  permission(23, 'drawings.view', 'Çizimleri Görüntüleme', 'DrawingManagement', 300),
  permission(24, 'drawings.delete', 'Çizim Silme', 'DrawingManagement', 340),
  // Açıklama nullable'dır: bu satır boş açıklamanın nasıl çizildiğini ölçer.
  permission(25, 'inventory.analysis', 'Envanter Analizi', 'Inventory', 500, { description: null }),
  permission(26, 'inventory.view', 'Envanteri Görüntüleme', 'Inventory', 510),
  // Kullanımdan kaldırılmış yetki katalogta KALIR.
  permission(27, 'layers.legacy.print', 'Katman Baskısı', 'Layers', 600, { isActive: false }),
  permission(28, 'layers.view', 'Katmanları Görüntüleme', 'Layers', 610),
  permission(29, 'map.view', 'Haritayı Görüntüleme', 'Map', 100),
  permission(30, 'permissions.view', 'Yetkileri Görüntüleme', 'Permissions', 900),
  /* Arayüzün Türkçe karşılığını BİLMEDİĞİ bir kategori. Gizlenmemeli; ham
     sunucu değeriyle görünmeli ve süzülebilmelidir. */
  permission(31, 'reports.export', 'Rapor Dışa Aktarma', 'Reporting', 700),
  permission(32, 'roles.view', 'Rolleri Görüntüleme', 'Roles', 800),
]

const TOTAL = CATALOG.length                                   // 12
const ACTIVE = CATALOG.filter((p) => p.isActive).length        // 11
const INACTIVE = TOTAL - ACTIVE                                // 1

/* --- Kurulum ------------------------------------------------------------------ */

/**
 * Oturum açar ve katalog ucunu karşılar.
 *
 * `calls` ağa ULAŞAN her admin isteğini toplar: "açılışta tek istek",
 * "rol-yetki ucu hiç çağrılmıyor" ve "süzgeçler istek üretmiyor" iddiaları
 * buradan doğrulanır.
 */
async function openCatalog(page, { catalog = CATALOG, onGet } = {}) {
  const calls = []

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: 1, username: 'admin', emailConfirmed: true, twoFactorEnabled: true, role: 'Admin', roles: ['Admin'] })),
  )
  await page.route('**/api/admin/users', (route) => route.fulfill(json([])))
  await page.route('**/api/admin/users/roles', (route) => route.fulfill(json([])))
  await page.route('**/api/admin/roles', (route) => route.fulfill(json([])))

  /* Rol bazlı yetki ucu bilinçli olarak KARŞILANIR ama katalog ekranı onu
     çağırmamalıdır; çağırırsa `calls` bunu ele verir. */
  await page.route('**/api/admin/roles/*/permissions', (route) => {
    calls.push({ method: route.request().method(), url: 'role-permissions' })
    route.fulfill(json({ role: {}, permissions: [] }))
  })

  await page.route('**/api/admin/permissions', async (route) => {
    calls.push({ method: route.request().method(), url: 'catalog' })
    if (onGet) { await onGet(route); return }
    route.fulfill(json(catalog))
  })

  await page.goto('/login')
  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-admin-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())
  await page.goto('/admin/permissions')

  return { calls }
}

const rows = (page) => page.locator('.admin-catalog-table tbody tr')
const names = (page) => page.locator('.admin-catalog-name strong')
const searchBox = (page) => page.getByRole('searchbox', { name: 'Yetki ara' })
const categoryFilter = (page) => page.getByLabel('Kategori')
const statusFilter = (page) => page.getByLabel('Durum')
const rowFor = (page, name) => rows(page).filter({ has: page.getByRole('rowheader', { name: new RegExp(`^${name}`) }) })

/* --- Yükleme ------------------------------------------------------------------ */

test('the catalog screen reads the catalog endpoint and nothing else', async ({ page }) => {
  const { calls } = await openCatalog(page)

  await expect(rows(page)).toHaveCount(TOTAL)

  /* Sayfa TEK bir ucu okur ve satır başına ikinci bir istek açmaz. Rol-yetki
     ucuna hiç dokunulmaz: o, başka bir soruyu ("bu rolde ne işaretli")
     yanıtlar ve burada bir N+1 kapısı olurdu.

     İsteğin SAYISI değil KİMLİĞİ ölçülür: React dev sunucusunda StrictMode
     bağlama etkilerini bilerek iki kez çalıştırır, dolayısıyla montaj anındaki
     sayı üretimdekiyle aynı değildir. Ölçülmesi gereken şey — hangi uçlar ve
     kaç FARKLI uç — bu ortamdan bağımsızdır. */
  expect(calls.every((call) => call.method === 'GET' && call.url === 'catalog')).toBe(true)
  expect(calls.filter((call) => call.url === 'role-permissions')).toEqual([])
  expect(calls.length).toBeGreaterThan(0)
})

test('every row carries the values the server sent', async ({ page }) => {
  await openCatalog(page)

  const row = rowFor(page, 'Nokta Ekleme')
  await expect(row).toHaveCount(1)
  await expect(row.getByText('Nokta Ekleme yetkisinin açıklaması.')).toBeVisible()
  await expect(row.getByText('drawings.point.create', { exact: true })).toBeVisible()
  await expect(row.getByText('Çizim Oluşturma', { exact: true })).toBeVisible()
  await expect(row.getByText('Aktif', { exact: true })).toBeVisible()
})

test('a null description is simply omitted, never printed', async ({ page }) => {
  await openCatalog(page)

  const row = rowFor(page, 'Envanter Analizi')
  await expect(row.getByText('inventory.analysis', { exact: true })).toBeVisible()
  // "null" / "undefined" / "-" yazmak, olmayan bilgiyi varmış gibi sunmaktır.
  await expect(row).not.toContainText('null')
  await expect(row).not.toContainText('undefined')
  await expect(row.locator('.admin-catalog-name span')).toHaveCount(0)
})

test('active and inactive permissions are both visible and labelled in words', async ({ page }) => {
  await openCatalog(page)

  const inactive = rowFor(page, 'Katman Baskısı')
  await expect(inactive).toBeVisible()
  await expect(inactive.getByText('Pasif', { exact: true })).toBeVisible()
  // Durum yalnızca renge yüklenmez; ayrıca ne anlama geldiği yazılıdır.
  await expect(inactive.getByText('Yeni atamalarda kullanılamaz.')).toBeVisible()

  await expect(rowFor(page, 'Katmanları Görüntüleme').getByText('Aktif', { exact: true })).toBeVisible()
})

test('the technical code is shown as technical text, not as an editable field', async ({ page }) => {
  await openCatalog(page)

  // Her satır kodunu taşır ve hepsi <code>'tur — hiçbiri girdi alanı değil.
  await expect(page.locator('.admin-catalog-table code')).toHaveCount(TOTAL)
  await expect(page.getByText('map.view', { exact: true })).toBeVisible()
  await expect(page.locator('.admin-catalog-table input')).toHaveCount(0)
})

test('the row count summary is derived from the response', async ({ page }) => {
  await openCatalog(page)

  await expect(page.getByRole('status')).toContainText(`${TOTAL} yetki · ${ACTIVE} aktif · ${INACTIVE} pasif`)
})

/* --- Salt okunur sınır --------------------------------------------------------- */

test('the catalog exposes no way to change a permission', async ({ page }) => {
  const { calls } = await openCatalog(page)
  await expect(rows(page)).toHaveCount(TOTAL)

  // Ne onay kutusu (aktiflik anahtarı), ne de bir CRUD düğmesi.
  await expect(page.getByRole('checkbox')).toHaveCount(0)
  await expect(page.getByRole('textbox')).toHaveCount(0)
  for (const label of [/yeni yetki/i, /sil/i, /düzenle/i, /yeniden adlandır/i, /kaydet/i, /pasifleştir/i, /aktifleştir/i]) {
    await expect(page.getByRole('button', { name: label })).toHaveCount(0)
  }

  // Satırlar tıklanabilir bile değildir: açılacak bir düzenleme ekranı yok.
  await expect(page.locator('.admin-catalog-table button')).toHaveCount(0)
  expect(calls.every((call) => call.method === 'GET')).toBe(true)
})

/* --- Sıra ---------------------------------------------------------------------- */

test('the server order survives untouched', async ({ page }) => {
  await openCatalog(page)

  /* Ne Türkçe alfabetik ne de `sortOrder`'a göre küresel bir sıra: tam olarak
     sunucunun gönderdiği dizi. */
  await expect(names(page)).toHaveText(CATALOG.map((p) => p.name))
})

test('filtering preserves the relative order of the remaining rows', async ({ page }) => {
  await openCatalog(page)

  await statusFilter(page).selectOption('Active')
  await expect(names(page)).toHaveText(CATALOG.filter((p) => p.isActive).map((p) => p.name))
})

/* --- Arama --------------------------------------------------------------------- */

test('search matches the permission name', async ({ page }) => {
  await openCatalog(page)

  await searchBox(page).fill('Nokta')
  await expect(rows(page)).toHaveCount(1)
  await expect(rowFor(page, 'Nokta Ekleme')).toBeVisible()
})

test('search matches the technical code', async ({ page }) => {
  await openCatalog(page)

  await searchBox(page).fill('layers.')
  await expect(names(page)).toHaveText(['Katman Baskısı', 'Katmanları Görüntüleme'])
})

test('search matches the description', async ({ page }) => {
  await openCatalog(page)

  await searchBox(page).fill('Rapor Dışa Aktarma yetkisinin')
  await expect(rows(page)).toHaveCount(1)
  await expect(rowFor(page, 'Rapor Dışa Aktarma')).toBeVisible()
})

test('search is case-insensitive with Turkish letters', async ({ page }) => {
  await openCatalog(page)

  /* Türkçe yerel ayar olmadan "İ" küçültülünce "izin"e eşleşmez ve "ÇİZGİ"
     araması hiçbir şey bulmazdı. */
  await searchBox(page).fill('ÇİZGİ')
  await expect(names(page)).toHaveText(['Çizgi Ekleme'])

  await searchBox(page).fill('envanter')
  await expect(names(page)).toHaveText(['Envanter Analizi', 'Envanteri Görüntüleme'])
})

test('a search with no match keeps the catalog loaded', async ({ page }) => {
  const { calls } = await openCatalog(page)
  await expect(rows(page)).toHaveCount(TOTAL)
  const loaded = calls.length

  await searchBox(page).fill('böyle bir yetki yok')
  await expect(rows(page)).toHaveCount(0)
  await expect(page.getByText(/Bu filtrelerle eşleşen yetki bulunamadı\./)).toBeVisible()
  await expect(page.getByRole('status')).toContainText(`0 / ${TOTAL} yetki gösteriliyor`)

  /* Temizleme tek bir yerdedir (özet satırı); aynı işi yapan ikinci bir düğme
     yoktur. Temizlenince veri hâlâ ORADADIR — ikinci bir istek açılmadı. */
  await page.getByRole('button', { name: 'Filtreleri Temizle' }).click()
  await expect(rows(page)).toHaveCount(TOTAL)
  expect(calls).toHaveLength(loaded)
})

/* --- Kategori süzgeci ----------------------------------------------------------- */

test('the category options come from the loaded data, deduplicated and in server order', async ({ page }) => {
  await openCatalog(page)

  /* `toHaveText` bekler; `allTextContents()` beklemez ve katalog daha inmeden
     yalnızca "Tüm kategoriler"i görürdü. */
  await expect(categoryFilter(page).locator('option')).toHaveText([
    'Tüm kategoriler',
    'Çizim Oluşturma',   // DrawingCreate — iki satır, tek seçenek
    'Çizim Yönetimi',
    'Envanter',
    'Katmanlar',
    'Harita',
    'Yetki Yönetimi',
    // Arayüzün tanımadığı kategori HAM hâliyle listelenir, gizlenmez.
    'Reporting',
    'Rol Yönetimi',
  ])
})

test('choosing a category shows only that category', async ({ page }) => {
  await openCatalog(page)

  await categoryFilter(page).selectOption('DrawingManagement')
  await expect(names(page)).toHaveText(['Çizimleri Görüntüleme', 'Çizim Silme'])
})

test('an unknown category is selectable and filters correctly', async ({ page }) => {
  await openCatalog(page)

  await categoryFilter(page).selectOption('Reporting')
  await expect(names(page)).toHaveText(['Rapor Dışa Aktarma'])
  await expect(rowFor(page, 'Rapor Dışa Aktarma').getByText('Reporting', { exact: true })).toBeVisible()
})

/* --- Durum süzgeci --------------------------------------------------------------- */

test('the status filter separates active from inactive without hiding either', async ({ page }) => {
  await openCatalog(page)

  await statusFilter(page).selectOption('Active')
  await expect(rows(page)).toHaveCount(ACTIVE)
  await expect(rowFor(page, 'Katman Baskısı')).toHaveCount(0)

  /* Kullanımdan kaldırılmış yetkiler KEŞFEDİLEBİLİR kalır: yönetici mevcut
     durumu eksiksiz görebilmelidir. */
  await statusFilter(page).selectOption('Inactive')
  await expect(rows(page)).toHaveCount(INACTIVE)
  await expect(rowFor(page, 'Katman Baskısı')).toBeVisible()

  await statusFilter(page).selectOption('All')
  await expect(rows(page)).toHaveCount(TOTAL)
})

/* --- Birleşik süzgeçler ----------------------------------------------------------- */

test('search, category and status combine with AND semantics', async ({ page }) => {
  await openCatalog(page)

  await searchBox(page).fill('görüntüleme')
  await expect(names(page)).toHaveText([
    'Çizimleri Görüntüleme',
    'Envanteri Görüntüleme',
    'Katmanları Görüntüleme',
    'Haritayı Görüntüleme',
    'Yetkileri Görüntüleme',
    'Rolleri Görüntüleme',
  ])

  // Kategori aramanın sonucunu DARALTIR, ona eklemez.
  await categoryFilter(page).selectOption('Layers')
  await expect(names(page)).toHaveText(['Katmanları Görüntüleme'])
  await expect(page.getByRole('status')).toContainText(`1 / ${TOTAL} yetki gösteriliyor`)

  /* Üçüncü koşul da AND'lenir: Katmanlar'da pasif bir satır VAR ve
     "görüntüleme" eşleşen aktif bir satır VAR — OR anlamı olsaydı liste
     boşalmaz, ikisini birden gösterirdi. */
  await statusFilter(page).selectOption('Inactive')
  await expect(rows(page)).toHaveCount(0)
})

test('clearing the filters restores the full catalog and the plain summary', async ({ page }) => {
  await openCatalog(page)

  await categoryFilter(page).selectOption('Layers')
  await statusFilter(page).selectOption('Inactive')
  await expect(names(page)).toHaveText(['Katman Baskısı'])

  await page.getByRole('button', { name: 'Filtreleri Temizle' }).click()
  await expect(rows(page)).toHaveCount(TOTAL)
  await expect(page.getByRole('status')).toContainText(`${TOTAL} yetki · ${ACTIVE} aktif`)
  await expect(searchBox(page)).toHaveValue('')
})

/* --- Boş durumlar ----------------------------------------------------------------- */

test('an empty catalog and an empty filter result say different things', async ({ page }) => {
  await openCatalog(page, { catalog: [] })

  await expect(page.getByText('Sistemde tanımlı yetki yok.')).toBeVisible()
  // Uydurma satır yok, ve süzgeç mesajı da GÖSTERİLMEZ: süzülen bir şey yoktu.
  await expect(page.getByText('Bu filtrelerle eşleşen yetki bulunamadı.')).toHaveCount(0)
  await expect(rows(page)).toHaveCount(0)
})

/* --- Hata --------------------------------------------------------------------------- */

test('a server error is contained and retryable', async ({ page }) => {
  /* Sunucunun durumu bir bayrakla tutulur, kaçıncı istek olduğuyla DEĞİL:
     StrictMode montajda etkiyi iki kez çalıştırdığı için "ilk istek patlasın"
     kuralı, hata ekranını görünmeden geçirirdi. */
  let failing = true

  const { calls } = await openCatalog(page, {
    onGet: (route) => route.fulfill(failing
      ? json({ message: 'Yetkiler okunamadı.' }, 500)
      : json(CATALOG)),
  })

  await expect(page.getByRole('alert')).toContainText('Yetkiler okunamadı.')
  await expect(rows(page)).toHaveCount(0)
  // Kabuk ayakta kalır: kenar çubuğu ve başlık kaybolmaz.
  await expect(page.getByRole('navigation', { name: 'Yönetim menüsü' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Yetkiler', level: 1 })).toBeVisible()

  const beforeRetry = calls.length
  failing = false
  await page.getByRole('button', { name: 'Tekrar dene' }).click()

  await expect(rows(page)).toHaveCount(TOTAL)
  await expect(page.getByRole('alert')).toHaveCount(0)
  // Tekrar deneme GERÇEKTEN sunucuya gider; ekran önbelleğe düşmez.
  expect(calls.length).toBeGreaterThan(beforeRetry)
})

test('a 403 explains the missing permission and never signs the admin out', async ({ page }) => {
  await openCatalog(page, {
    onGet: (route) => route.fulfill(json({ message: 'Forbidden' }, 403)),
  })

  await expect(page.getByRole('alert')).toContainText('Yetki kataloğunu görüntülemek için gerekli izne sahip değilsiniz.')
  /* 403 bir oturum sorunu DEĞİLDİR. Giriş ekranına atmak, geçerli bir
     oturumu yetki eksikliği yüzünden sonlandırmak olurdu. */
  await expect(page).toHaveURL(/\/admin\/permissions$/)
  expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBe('browser-test-admin-token')
})

/* --- İstek disiplini ---------------------------------------------------------------- */

test('searching and filtering never touch the network', async ({ page }) => {
  const { calls } = await openCatalog(page)
  await expect(rows(page)).toHaveCount(TOTAL)
  const loaded = calls.length

  await searchBox(page).fill('çiz')
  await categoryFilter(page).selectOption('DrawingCreate')
  await statusFilter(page).selectOption('Active')
  await searchBox(page).fill('')
  await expect(names(page)).toHaveText(['Nokta Ekleme', 'Çizgi Ekleme'])

  // Katalog zaten indirilmişti; süzmek onu ikinci kez indirmek değildir.
  expect(calls).toHaveLength(loaded)
})

/* --- Kabuk ------------------------------------------------------------------------- */

test('the permissions entry is the active sidebar item', async ({ page }) => {
  await openCatalog(page)

  const nav = page.getByRole('navigation', { name: 'Yönetim menüsü' })
  await expect(nav.getByRole('link', { name: 'Yetkiler' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Roller' })).not.toHaveAttribute('aria-current', 'page')
})

test('the filters are reachable and usable from the keyboard alone', async ({ page }) => {
  await openCatalog(page)

  await searchBox(page).focus()
  await page.keyboard.type('katman')
  await expect(names(page)).toHaveText(['Katman Baskısı', 'Katmanları Görüntüleme'])

  await page.keyboard.press('Tab')
  await expect(categoryFilter(page)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(statusFilter(page)).toBeFocused()
})

/* --- Dar ekranlar ------------------------------------------------------------------- */

const overflows = (page) => page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
)

test('the catalog uses the desktop width without spilling sideways', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await openCatalog(page)

  await expect(rows(page)).toHaveCount(TOTAL)
  expect(await overflows(page)).toBe(false)
})

test.describe('tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('the catalog stays readable at 768px', async ({ page }) => {
    await openCatalog(page)

    expect(await overflows(page)).toBe(false)
    await expect(searchBox(page)).toBeVisible()
    await expect(categoryFilter(page)).toBeVisible()
    await expect(rowFor(page, 'Haritayı Görüntüleme').getByText('map.view', { exact: true })).toBeVisible()
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('each phone row still carries name, code, category and status', async ({ page }) => {
    await openCatalog(page)

    expect(await overflows(page)).toBe(false)

    const row = rowFor(page, 'Çizimleri Görüntüleme')
    await row.scrollIntoViewIfNeeded()
    await expect(row.getByText('drawings.view', { exact: true })).toBeVisible()
    await expect(row.getByText('Çizim Yönetimi', { exact: true })).toBeVisible()
    await expect(row.getByText('Aktif', { exact: true })).toBeVisible()

    // Süzgeçler telefonda da kullanılabilir ve taşma üretmez.
    await statusFilter(page).selectOption('Inactive')
    await expect(rows(page)).toHaveCount(INACTIVE)
    expect(await overflows(page)).toBe(false)

    /* Uzun kod satırın içinde kırılır; tabloyu telefonun dışına taşırmaz. */
    const fits = await page.locator('.admin-catalog').evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    expect(fits).toBe(true)
  })
})
