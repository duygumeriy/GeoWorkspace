import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'

/**
 * Phase 2C: yönetim panelindeki POI ekranı.
 *
 * ## Burada kanıtlanan şey
 *
 * Ekranın YETKİ KODLARINDAN çizildiği: iki sekme iki ayrı koda bağlıdır ve
 * biri olmadan diğeri çalışmaya devam eder. Rol adı hiçbir görünürlük kararına
 * girmez — testlerin bir kısmı bunu, adı ile yetkisini bilerek ayırarak ölçer.
 *
 * ## Burada kanıtlanmayan şey
 *
 * <b>Güvenlik.</b> Bir sekmeyi gizlemek yetkilendirme değildir. Gerçek kapı
 * backend'dedir ve <c>PoiApiAuthorizationTests</c> tarafından tarayıcıdan
 * bağımsız olarak ölçülür; buradaki testler yalnızca arayüzün o gerçeği doğru
 * yansıttığını gösterir.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const POI_MANAGE = 'poi.manage'
const CATEGORIES_MANAGE = 'poi.categories.manage'

const POIS = [
  {
    id: 1,
    name: 'Ankara Kalesi Kafe',
    categoryId: 3,
    categoryName: 'Kafe',
    categoryPath: 'Yeme-İçme / Kafe',
    workHours: {
      monday: { closed: false, open: '09:00', close: '18:00' },
      tuesday: { closed: false, open: '09:00', close: '18:00' },
      wednesday: { closed: false, open: '09:00', close: '18:00' },
      thursday: { closed: false, open: '09:00', close: '18:00' },
      friday: { closed: false, open: '09:00', close: '18:00' },
      sunday: { closed: true },
    },
    longitude: 32.8597,
    latitude: 39.9334,
    creatorUserId: 7,
    creatorUsername: 'saha-operatoru',
    createdDate: '2026-08-20T08:30:00Z',
    modifiedDate: '2026-08-20T08:30:00Z',
    isActive: true,
    isDeleted: false,
  },
  {
    id: 2,
    name: 'Pasif Restoran',
    categoryId: 2,
    categoryName: 'Restoran',
    categoryPath: 'Yeme-İçme / Restoran',
    workHours: null,
    longitude: 29.0,
    latitude: 41.0,
    creatorUserId: 8,
    creatorUsername: 'ikinci-operator',
    createdDate: '2026-08-19T10:00:00Z',
    modifiedDate: '2026-08-19T10:00:00Z',
    isActive: false,
    isDeleted: false,
  },
  {
    id: 3,
    name: 'Silinmiş Nokta',
    categoryId: 2,
    categoryName: 'Restoran',
    categoryPath: 'Yeme-İçme / Restoran',
    workHours: null,
    longitude: 27.0,
    latitude: 38.0,
    creatorUserId: 8,
    creatorUsername: 'ikinci-operator',
    createdDate: '2026-08-18T10:00:00Z',
    modifiedDate: '2026-08-18T12:00:00Z',
    isActive: false,
    isDeleted: true,
  },
]

const CATEGORIES = [
  { id: 1, name: 'Yeme-İçme', parentId: null, parentName: null, path: 'Yeme-İçme', depth: 0, createdDate: '2026-08-01T00:00:00Z', modifiedDate: '2026-08-01T00:00:00Z', isActive: true, isDeleted: false },
  { id: 3, name: 'Kafe', parentId: 1, parentName: 'Yeme-İçme', path: 'Yeme-İçme / Kafe', depth: 1, createdDate: '2026-08-01T00:00:00Z', modifiedDate: '2026-08-01T00:00:00Z', isActive: true, isDeleted: false },
  { id: 2, name: 'Restoran', parentId: 1, parentName: 'Yeme-İçme', path: 'Yeme-İçme / Restoran', depth: 1, createdDate: '2026-08-01T00:00:00Z', modifiedDate: '2026-08-01T00:00:00Z', isActive: true, isDeleted: false },
  { id: 4, name: 'Pasif Kategori', parentId: null, parentName: null, path: 'Pasif Kategori', depth: 0, createdDate: '2026-08-02T00:00:00Z', modifiedDate: '2026-08-02T00:00:00Z', isActive: false, isDeleted: false },
  { id: 5, name: 'Silinmiş Kategori', parentId: null, parentName: null, path: 'Silinmiş Kategori', depth: 0, createdDate: '2026-08-03T00:00:00Z', modifiedDate: '2026-08-03T00:00:00Z', isActive: true, isDeleted: true },
]

/**
 * Oturum açar, yetki kümesini kurar ve POI uçlarını taklit eder.
 *
 * `role` yalnızca sunucunun bildirdiği rol ADIDIR ve hiçbir görünürlük kararı
 * vermez; varsayılan olarak kanonik olmayan bir ad verilir ki bu testlerin
 * hiçbiri yanlışlıkla rol adına dayanamasın.
 */
async function signIn(page, codes, { role = 'Operatör Amiri' } = {}) {
  const permissions = await mockPermissions(page, codes)
  const calls = { pois: 0, categories: 0, created: [], updated: [] }

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({
      userId: 1,
      username: 'poi-yonetici',
      email: 'poi@example.invalid',
      emailConfirmed: true,
      twoFactorEnabled: true,
      role,
      roles: [role],
    })),
  )

  await page.route('**/api/admin/poi/categories/*', async (route) => {
    const request = route.request()
    if (request.method() !== 'PUT') return route.fulfill(json({ message: 'Beklenmeyen istek.' }, 405))

    const body = JSON.parse(request.postData() ?? '{}')
    calls.updated.push({ url: request.url(), body })

    /* Döngü reddi sunucunun kararıdır; arayüz mesajı olduğu gibi göstermek
       zorundadır. `parentId: 3` bu taklitte alt ağaca taşımayı temsil eder. */
    if (body.parentId === 3) {
      return route.fulfill(json({
        message: 'Bir kategori kendisinin ya da kendi alt kategorilerinden birinin altına taşınamaz.',
      }, 400))
    }

    return route.fulfill(json({ ...CATEGORIES[0], name: body.name, isActive: body.isActive }))
  })

  await page.route('**/api/admin/poi/categories', async (route) => {
    const request = route.request()

    if (request.method() === 'POST') {
      calls.created.push(JSON.parse(request.postData() ?? '{}'))
      return route.fulfill(json({ id: 9, name: 'Yeni', parentId: null, path: 'Yeni', depth: 0, isActive: true, isDeleted: false }, 201))
    }

    calls.categories += 1
    return route.fulfill(json(CATEGORIES))
  })

  await page.route('**/api/admin/poi', (route) => {
    calls.pois += 1
    return route.fulfill(json(POIS))
  })

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())

  return { permissions, calls }
}

const nav = (page) => page.getByRole('navigation', { name: 'Yönetim menüsü' })
const tabs = (page) => page.getByRole('tablist', { name: 'POI yönetimi bölümleri' })
const tab = (page, name) => tabs(page).getByRole('tab', { name })
const dialog = (page) => page.getByRole('dialog')

/* ===========================================================================
   1. Gezinme
   =========================================================================== */

test('the POI section appears with the POI management permission alone', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin')

  await expect(nav(page).getByRole('link', { name: 'POI Yönetimi' })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/poi$/)
})

test('the POI section appears with the category permission alone', async ({ page }) => {
  /* Ayrı bir test olmasının sebebi tam olarak budur: bölüm tek bir koda
     bağlansaydı, yalnızca taksonomiyi yöneten kişi menüde hiçbir şey görmezdi. */
  await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin')

  await expect(nav(page).getByRole('link', { name: 'POI Yönetimi' })).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/poi$/)
})

test('the POI section is hidden without either permission', async ({ page }) => {
  await signIn(page, ['users.view'])
  await page.goto('/admin/users')

  await expect(nav(page)).toBeVisible()
  await expect(nav(page).getByRole('link', { name: 'POI Yönetimi' })).toBeHidden()
})

test('the route itself is closed without either permission', async ({ page }) => {
  await signIn(page, ['users.view'])
  await page.goto('/admin/poi')

  await expect(page.getByRole('heading', { name: 'Bu bölüme erişim yetkiniz yok' })).toBeVisible()
})

/* ===========================================================================
   2. Sekme görünürlüğü
   =========================================================================== */

test('both permissions show both tabs, with the POI list first', async ({ page }) => {
  await signIn(page, [POI_MANAGE, CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await expect(page.getByRole('heading', { name: 'POI Yönetimi', level: 1 })).toBeVisible()
  await expect(tab(page, "POI'ler")).toHaveAttribute('aria-selected', 'true')
  await expect(tab(page, 'Kategoriler')).toHaveAttribute('aria-selected', 'false')
})

test('the POI permission alone renders the list and no category tab', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin/poi')

  await expect(page.getByText('Ankara Kalesi Kafe')).toBeVisible()
  // Tek sekme kalınca şerit hiç çizilmez; olmayan bir tercihi sunmaz.
  await expect(tabs(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: '+ Yeni Kategori' })).toHaveCount(0)
})

test('the category permission alone renders the tree and never requests the POI list', async ({ page }) => {
  const { calls } = await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await expect(page.getByRole('list', { name: 'POI kategorileri' })).toBeVisible()
  await expect(page.getByText('Ankara Kalesi Kafe')).toHaveCount(0)

  /* Yetkisi olmayan bir uca istek açmak garanti 403 demektir; ekran o isteği
     hiç yapmaz. */
  expect(calls.pois).toBe(0)
  expect(calls.categories).toBeGreaterThan(0)
})

test('revoking a permission moves away from the tab and unmounts its data', async ({ page }) => {
  const { permissions } = await signIn(page, [POI_MANAGE, CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await expect(page.getByText('Ankara Kalesi Kafe')).toBeVisible()

  /* Yetkilendirme CANLIDIR: yetki, oturum sürerken geri alınabilir. Token
     değişmez ve yeniden giriş yapılmaz — ekranın yeni kümeyi okuması yeter. */
  permissions.set([CATEGORIES_MANAGE])
  await page.reload()

  // Korumalı veri ekranda kalmaz; sekme kendiliğinden izinli olana geçer.
  await expect(page.getByRole('list', { name: 'POI kategorileri' })).toBeVisible()
  await expect(page.getByText('Ankara Kalesi Kafe')).toHaveCount(0)
  await expect(tabs(page)).toHaveCount(0)
  expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBe('browser-test-token')
})

/* ===========================================================================
   3. POI listesi
   =========================================================================== */

test('the list reads the admin endpoint, not the map one', async ({ page }) => {
  const { calls } = await signIn(page, [POI_MANAGE])

  let mapCalls = 0
  await page.route('**/api/poi', (route) => { mapCalls += 1; return route.fulfill(json([])) })

  await page.goto('/admin/poi')
  await expect(page.getByText('Ankara Kalesi Kafe')).toBeVisible()

  expect(calls.pois).toBeGreaterThan(0)
  // Harita sözleşmesinde oluşturan bilgisi YOKTUR; yönetim ekranı onu kullanamaz.
  expect(mapCalls).toBe(0)
})

test('creator attribution is rendered for every record', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin/poi')

  await expect(page.getByText('saha-operatoru')).toBeVisible()
  await expect(page.getByText('ikinci-operator').first()).toBeVisible()
})

test('category path and compact coordinates are shown', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin/poi')

  await expect(page.getByText('Yeme-İçme / Kafe')).toBeVisible()
  await expect(page.getByText('32.85970, 39.93340')).toBeVisible()
})

test('active, inactive and deleted records are labelled distinctly', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin/poi')

  const list = page.locator('.admin-poi-list')

  await expect(list.getByText('Aktif', { exact: true })).toHaveCount(1)
  await expect(list.getByText('Pasif', { exact: true })).toHaveCount(1)
  // Silinmişlik pasifliği EZER: silinmiş satır "Pasif" değil "Silinmiş"tir.
  await expect(list.getByText('Silinmiş', { exact: true })).toHaveCount(1)
})

test('work hours are rendered as readable Turkish, never as raw JSON', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin/poi')

  await expect(page.getByText('Hafta içi 09:00 – 18:00')).toBeVisible()

  const body = await page.locator('.admin-poi-list').innerText()
  for (const token of ['{', '"closed"', 'monday', 'workHours']) {
    expect(body).not.toContain(token)
  }

  // Ayrıntı istendiğinde yedi gün, Türkçe adlarıyla açılır.
  await page.getByRole('button', { name: 'Tüm hafta' }).click()
  await expect(page.getByText('Pazartesi')).toBeVisible()
  await expect(page.getByText('Cumartesi')).toBeVisible()
  // Gönderilmeyen gün "Belirtilmemiş"tir — kapalı sayılmaz.
  await expect(page.getByText('Belirtilmemiş').first()).toBeVisible()
})

test('an empty inventory says so plainly', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.route('**/api/admin/poi', (route) => route.fulfill(json([])))
  await page.goto('/admin/poi')

  await expect(page.getByText('Henüz POI kaydı bulunmuyor.')).toBeVisible()
})

test('a failed read is surfaced and can be retried', async ({ page }) => {
  await signIn(page, [POI_MANAGE])

  let fail = true
  await page.route('**/api/admin/poi', (route) =>
    fail
      ? route.fulfill(json({ message: 'POI kayıtları yüklenemedi.' }, 500))
      : route.fulfill(json(POIS)),
  )

  await page.goto('/admin/poi')

  // Hata sessizce yutulmaz.
  await expect(page.getByRole('alert')).toContainText('yüklenemedi')

  fail = false
  await page.getByRole('button', { name: 'Tekrar dene' }).click()
  await expect(page.getByText('Ankara Kalesi Kafe')).toBeVisible()
})

/* ===========================================================================
   4. Kategori ağacı
   =========================================================================== */

test('the tree shows hierarchy, paths and every status', async ({ page }) => {
  await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  const tree = page.getByRole('list', { name: 'POI kategorileri' })

  await expect(tree.getByText('Yeme-İçme', { exact: true })).toBeVisible()
  await expect(tree.getByText('Yeme-İçme / Kafe')).toBeVisible()

  // Denetim için envanterin TAMAMI görünür.
  await expect(tree.getByText('Pasif', { exact: true })).toHaveCount(1)
  await expect(tree.getByText('Silinmiş', { exact: true })).toHaveCount(1)

  // Alt kategoriler girintilidir; derinlik veriden gelir.
  await expect(page.locator('.admin-poi-tree-item').first()).toHaveAttribute('style', /--poi-depth:\s*0/)
})

test('a deleted category offers no edit control', async ({ page }) => {
  /* Backend silinmiş satır için NotFound döner; düğmeyi sunmak garanti
     başarısız bir işlem vaat etmek olurdu. */
  await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await expect(page.getByRole('button', { name: 'Yeme-İçme kategorisini düzenle' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Silinmiş Kategori kategorisini düzenle' })).toHaveCount(0)
})

test('there is no category delete action anywhere on the screen', async ({ page }) => {
  await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await expect(page.getByRole('button', { name: /sil/i })).toHaveCount(0)
})

/* ===========================================================================
   5. Kategori oluşturma
   =========================================================================== */

test('create sends only a name and a parent', async ({ page }) => {
  const { calls } = await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await page.getByRole('button', { name: '+ Yeni Kategori' }).click()
  await dialog(page).getByLabel('Kategori adı').fill('  Tatlıcı  ')
  await dialog(page).getByLabel('Üst kategori').selectOption({ label: 'Yeme-İçme' })
  await dialog(page).getByRole('button', { name: 'Kategori Oluştur' }).click()

  await expect(page.getByText('Kategori başarıyla oluşturuldu.')).toBeVisible()

  // Gövde SADECE iki alan taşır; durum ve tarihler sunucunundur.
  expect(calls.created).toHaveLength(1)
  expect(calls.created[0]).toEqual({ name: 'Tatlıcı', parentId: 1 })
})

test('inactive and deleted categories are not offered as parents', async ({ page }) => {
  await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await page.getByRole('button', { name: '+ Yeni Kategori' }).click()

  const options = await dialog(page).getByLabel('Üst kategori').locator('option').allInnerTexts()

  expect(options).toContain('Ana kategori (üst kategori yok)')
  expect(options).toContain('Yeme-İçme')
  // Yol etiketi kardeşleri ayırt eder.
  expect(options).toContain('Yeme-İçme / Kafe')
  expect(options).not.toContain('Pasif Kategori')
  expect(options).not.toContain('Silinmiş Kategori')
})

test('a successful create refreshes the list from the server', async ({ page }) => {
  const { calls } = await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')
  await expect(page.getByRole('list', { name: 'POI kategorileri' })).toBeVisible()

  const before = calls.categories

  await page.getByRole('button', { name: '+ Yeni Kategori' }).click()
  await dialog(page).getByLabel('Kategori adı').fill('Tatlıcı')
  await dialog(page).getByRole('button', { name: 'Kategori Oluştur' }).click()

  await expect(dialog(page)).toHaveCount(0)
  /* Liste yerel olarak yamalanmaz: bir yeniden konumlandırma tüm alt ağacın
     yollarını değiştirir ve o hesabın sahibi sunucudur. */
  await expect.poll(() => calls.categories).toBeGreaterThan(before)
})

/* ===========================================================================
   6. Kategori düzenleme
   =========================================================================== */

test('edit sends name, parent and status — and never a deleted flag', async ({ page }) => {
  const { calls } = await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await page.getByRole('button', { name: 'Kafe kategorisini düzenle' }).click()
  await dialog(page).getByLabel('Kategori adı').fill('Kahveci')
  await dialog(page).getByLabel('Durum').selectOption('inactive')
  await dialog(page).getByRole('button', { name: 'Kaydet' }).click()

  await expect.poll(() => calls.updated.length).toBe(1)

  const body = calls.updated[0].body
  expect(Object.keys(body).sort()).toEqual(['isActive', 'name', 'parentId'])
  expect(body).toEqual({ name: 'Kahveci', parentId: 1, isActive: false })
  expect(body).not.toHaveProperty('isDeleted')
  expect(body).not.toHaveProperty('createdDate')
})

test('the edit form never offers the category itself as its own parent', async ({ page }) => {
  await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await page.getByRole('button', { name: 'Yeme-İçme kategorisini düzenle' }).click()

  const options = await dialog(page).getByLabel('Üst kategori').locator('option').allInnerTexts()

  expect(options).not.toContain('Yeme-İçme')
  // Alt ağaç da elenir — yol verisi buna elverdiği sürece.
  expect(options).not.toContain('Yeme-İçme / Kafe')
  expect(options).toContain('Ana kategori (üst kategori yok)')
})

test('a backend cycle rejection is shown verbatim and the form keeps its values', async ({ page }) => {
  await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await page.getByRole('button', { name: 'Restoran kategorisini düzenle' }).click()
  await dialog(page).getByLabel('Kategori adı').fill('Restoran Düzenlendi')
  // Taklit sunucu bu üstü döngü sayar.
  await dialog(page).getByLabel('Üst kategori').selectOption('3')
  await dialog(page).getByRole('button', { name: 'Kaydet' }).click()

  /* Sunucunun mesajı olduğu gibi gösterilir: kullanıcıya ne yapması
     gerektiğini söyleyen tek metin odur. */
  await expect(dialog(page).getByRole('alert')).toContainText('alt kategorilerinden birinin altına taşınamaz')

  // Diyalog KAPANMAZ ve girilenler korunur — kullanıcı düzeltebilmelidir.
  await expect(dialog(page).getByLabel('Kategori adı')).toHaveValue('Restoran Düzenlendi')
})

test('a successful update refreshes the list and closes the form', async ({ page }) => {
  const { calls } = await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')
  await expect(page.getByRole('list', { name: 'POI kategorileri' })).toBeVisible()

  const before = calls.categories

  await page.getByRole('button', { name: 'Kafe kategorisini düzenle' }).click()
  await dialog(page).getByLabel('Kategori adı').fill('Kahveci')
  await dialog(page).getByRole('button', { name: 'Kaydet' }).click()

  await expect(dialog(page)).toHaveCount(0)
  await expect(page.getByText('kategorisi güncellendi.')).toBeVisible()
  await expect.poll(() => calls.categories).toBeGreaterThan(before)
})

test('cancelling discards the edit and does not leak into the next create form', async ({ page }) => {
  await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await page.getByRole('button', { name: 'Kafe kategorisini düzenle' }).click()
  await dialog(page).getByLabel('Kategori adı').fill('Yarım kalan düzenleme')
  await dialog(page).getByRole('button', { name: 'İptal' }).click()

  await page.getByRole('button', { name: '+ Yeni Kategori' }).click()

  // Yeni form BOŞ açılır; önceki düzenlemenin durumu sızmaz.
  await expect(dialog(page).getByLabel('Kategori adı')).toHaveValue('')
  await expect(dialog(page).getByLabel('Durum')).toHaveCount(0)
})

test('an empty name cannot be submitted', async ({ page }) => {
  await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await page.getByRole('button', { name: '+ Yeni Kategori' }).click()

  await expect(dialog(page).getByRole('button', { name: 'Kategori Oluştur' })).toBeDisabled()
  await dialog(page).getByLabel('Kategori adı').fill('   ')
  await expect(dialog(page).getByRole('button', { name: 'Kategori Oluştur' })).toBeDisabled()
})
