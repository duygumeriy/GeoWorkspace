import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'

/**
 * Phase 2: kategori sunum metadatası (simge + renk) ve slug'ın salt okunurluğu.
 *
 * ## Burada kanıtlanan şey
 *
 * Yöneticinin seçtiği simgenin ve rengin gerçekten TARAYICIYI TERK ETTİĞİ, ve
 * `slug`'ın hiçbir istekte gönderilmediği.
 *
 * Bu, `category-persistence.spec.js`'in var oluş nedeniyle aynı derstir: bir
 * kullanıcı çizim kategorisi seçip kaydetmiş, sonra o kategoriyi bulamamıştı;
 * hata istek gövdesinde alanın hiç olmamasıydı ve hiçbir test bunu
 * ölçmüyordu. Metadata da aynı sınıfa girer — arayüzde seçilebilir görünen ama
 * gövdeye konmayan bir alan, sessizce NULL kalırdı.
 *
 * ## Burada kanıtlanmayan şey
 *
 * <b>Doğrulamanın kendisi.</b> Simge izin listesi ve renk biçimi SUNUCUNUN
 * kararıdır ve `PoiCategoryMetadataServiceTests` ile tarayıcıdan bağımsız
 * ölçülür. Burada yalnızca arayüzün o sözleşmeyi doğru taşıdığı gösterilir.
 *
 * <b>Slug üretimi.</b> Slug'ı sunucu üretir; buradaki iddia yalnızca istemcinin
 * onu GÖNDERMEDİĞİ ve yeniden adlandırmada değişmemiş hâlini gösterdiğidir.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const CATEGORIES_MANAGE = 'poi.categories.manage'

const CATEGORIES = [
  {
    id: 1, name: 'Yeme-İçme Yerleri', parentId: null, parentName: null,
    path: 'Yeme-İçme Yerleri', depth: 0,
    slug: 'yeme-icme', iconKey: 'utensils', colorHex: '#F97316',
    createdDate: '2026-08-01T00:00:00Z', modifiedDate: '2026-08-01T00:00:00Z',
    isActive: true, isDeleted: false,
  },
  {
    id: 2, name: 'Kafe', parentId: 1, parentName: 'Yeme-İçme Yerleri',
    path: 'Yeme-İçme Yerleri / Kafe', depth: 1,
    slug: 'kafe', iconKey: 'coffee', colorHex: '#F97316',
    createdDate: '2026-08-01T00:00:00Z', modifiedDate: '2026-08-01T00:00:00Z',
    isActive: true, isDeleted: false,
  },
  {
    /* Göç öncesinden kalan, metadatasız satır: teknik yedek slug taşır ve
       simge/renk NULL'dur. Arayüz onu çizebilmeli, düzenlemesi ise metadata
       doldurmaya ZORLAMALIDIR. */
    id: 3, name: 'Elle Eklenen', parentId: null, parentName: null,
    path: 'Elle Eklenen', depth: 0,
    slug: 'category-3', iconKey: null, colorHex: null,
    createdDate: '2026-08-02T00:00:00Z', modifiedDate: '2026-08-02T00:00:00Z',
    isActive: true, isDeleted: false,
  },
]

/** Oturum açar, kategori uçlarını taklit eder ve gönderilen gövdeleri toplar. */
async function signIn(page) {
  await mockPermissions(page, [CATEGORIES_MANAGE])

  const calls = { created: [], updated: [] }

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({
      userId: 1,
      username: 'kategori-yoneticisi',
      email: 'kategori@ornek.local',
      emailConfirmed: true,
      twoFactorEnabled: true,
      role: 'Operatör Amiri',
      roles: ['Operatör Amiri'],
    })),
  )

  await page.route('**/api/admin/poi/categories/*', async (route) => {
    const request = route.request()
    if (request.method() !== 'PUT') return route.fulfill(json({ message: 'Beklenmeyen istek.' }, 405))

    const body = JSON.parse(request.postData() ?? '{}')
    calls.updated.push({ url: request.url(), body })

    /* Sunucu slug'ı KORUR — ad değişse bile. Taklit bunu birebir yansıtır;
       hoşgörülü bir taklit, gerçek sunucu değiştirse bile geçerdi. */
    const existing = CATEGORIES.find((item) => request.url().endsWith(`/${item.id}`)) ?? CATEGORIES[0]

    return route.fulfill(json({
      ...existing,
      name: body.name,
      parentId: body.parentId,
      isActive: body.isActive,
      iconKey: body.iconKey,
      colorHex: body.colorHex,
    }))
  })

  await page.route('**/api/admin/poi/categories', async (route) => {
    const request = route.request()

    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}')
      calls.created.push(body)

      return route.fulfill(json({
        id: 9,
        name: body.name,
        parentId: body.parentId,
        parentName: null,
        path: body.name,
        depth: 0,
        // Teknik kimliği SUNUCU üretir.
        slug: 'eczane',
        iconKey: body.iconKey,
        colorHex: body.colorHex,
        createdDate: '2026-08-25T00:00:00Z',
        modifiedDate: '2026-08-25T00:00:00Z',
        isActive: true,
        isDeleted: false,
      }, 201))
    }

    return route.fulfill(json(CATEGORIES))
  })

  await page.route('**/api/admin/poi', (route) => route.fulfill(json([])))

  /* Harita sözleşmesindeki kategori ucu: POI sekmesinin düzenleme formu da
     aynı listeyi okur. Taklit edilmezse istek gerçek ağa düşerdi. */
  await page.route('**/api/poi/categories', (route) =>
    route.fulfill(json(CATEGORIES.filter((c) => c.isActive && !c.isDeleted))),
  )

  await page.route('**/api/poi', (route) => route.fulfill(json([])))

  /* OTURUM. `AuthContext` kimliği `sessionStorage`'daki token'dan okur ve
     `ProtectedRoute` token yoksa /login'e yönlendirir — yani token
     ekilmeden /admin/poi HİÇ çizilmez. Mevcut yönetim testlerinin kullandığı
     kurulumun aynısı; ikinci bir oturum sözleşmesi uydurulmaz. */
  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())

  await page.goto('/admin/poi')

  /* Sekmeye TIKLANMAZ ve tıklanmamalıdır. Bu profilin tek yetkisi
     `poi.categories.manage` olduğu için görünür tek bölüm kategorilerdir;
     PoiPage tek sekme kaldığında şeridi bilinçli olarak çizmez ("seçenek
     sunmayan bir sekme çubuğu, olmayan bir tercihi varmış gibi gösterirdi") ve
     kategori bölümü zaten etkin gelir. Mevcut `admin-poi.spec.js` kategori
     testleri de aynı şekilde doğrudan içerikle çalışır. */
  await expect(page.getByRole('list', { name: 'POI kategorileri' })).toBeVisible()

  return calls
}

/**
 * Diyalog kapsamı.
 *
 * Diyalog içindeki alanlar KAPSAMLI aranır çünkü `getByLabel` alt dizge
 * eşleştirir: süzgeç şeridindeki "Kategori adı veya yoluna göre ara" arama
 * kutusu da "Kategori adı" ile eşleşir ve kapsamsız bir arama strict-mode
 * ihlaline düşer. `admin-poi.spec.js` ile aynı yaklaşım.
 */
const dialog = (page) => page.getByRole('dialog')

/* --- Liste --------------------------------------------------------------------- */

test('the category list shows the technical identity and icon label', async ({ page }) => {
  await signIn(page)

  const row = page.getByRole('listitem').filter({ hasText: 'Yeme-İçme Yerleri' }).first()

  await expect(row.getByText('yeme-icme')).toBeVisible()
  await expect(row).toContainText('Yeme-İçme')
})

test('a category without metadata still renders', async ({ page }) => {
  // Eksik metadata bir satırın kaybolmasına yol açmamalıdır.
  await signIn(page)

  const row = page.getByRole('listitem').filter({ hasText: 'Elle Eklenen' }).first()

  await expect(row).toBeVisible()
  await expect(row.getByText('category-3')).toBeVisible()
})

/* --- Oluşturma ----------------------------------------------------------------- */

test('creating a category sends the chosen icon and color, and never a slug', async ({ page }) => {
  const calls = await signIn(page)

  await page.getByRole('button', { name: 'Yeni Kategori' }).click()

  await dialog(page).getByLabel('Kategori adı').fill('Eczane')
  await dialog(page).getByLabel('İkon').selectOption('pill')
  await dialog(page).getByLabel('Kategori rengi').fill('#ef4444')

  await dialog(page).getByRole('button', { name: 'Kategori Oluştur' }).click()

  await expect.poll(() => calls.created.length).toBe(1)

  const body = calls.created[0]

  expect(body.name).toBe('Eczane')
  expect(body.iconKey).toBe('pill')
  // Kanonik biçim: `<input type="color">` küçük harfli üretir.
  expect(body.colorHex).toBe('#EF4444')

  /* Teknik kimlik istemciden GÖNDERİLMEZ. Gönderilseydi iki istemci aynı ad
     için farklı kimlikler üretebilirdi. */
  expect(body).not.toHaveProperty('slug')
})

test('a category cannot be created without an icon', async ({ page }) => {
  const calls = await signIn(page)

  await page.getByRole('button', { name: 'Yeni Kategori' }).click()
  await dialog(page).getByLabel('Kategori adı').fill('Simgesiz')

  // Simge seçilmedi: gönderim kapalıdır ve hiçbir istek çıkmaz.
  await expect(dialog(page).getByRole('button', { name: 'Kategori Oluştur' })).toBeDisabled()
  expect(calls.created).toHaveLength(0)
})

test('the palette selector fills the color input', async ({ page }) => {
  await signIn(page)

  await page.getByRole('button', { name: 'Yeni Kategori' }).click()
  await dialog(page).getByLabel('Renk paleti').selectOption('#22C55E')

  await expect(dialog(page).getByLabel('Kategori rengi')).toHaveValue('#22c55e')
})

/* --- Düzenleme ----------------------------------------------------------------- */

test('editing a category sends updated metadata and preserves the slug', async ({ page }) => {
  const calls = await signIn(page)

  const row = page.getByRole('listitem').filter({ hasText: 'Yeme-İçme Yerleri' }).first()
  await row.getByRole('button', { name: /kategorisini düzenle/ }).click()

  // Slug SALT OKUNURDUR: gösterilir ama düzenlenebilir bir alan değildir.
  await expect(dialog(page).getByText('Teknik kimlik (slug):')).toBeVisible()
  await expect(dialog(page).getByRole('textbox', { name: /slug/i })).toHaveCount(0)

  await dialog(page).getByLabel('İkon').selectOption('utensils-crossed')
  await dialog(page).getByLabel('Kategori rengi').fill('#a855f7')
  await dialog(page).getByRole('button', { name: 'Kaydet' }).click()

  await expect.poll(() => calls.updated.length).toBe(1)

  const { body } = calls.updated[0]

  expect(body.iconKey).toBe('utensils-crossed')
  expect(body.colorHex).toBe('#A855F7')
  expect(body).not.toHaveProperty('slug')
})

test('renaming a category leaves its slug untouched', async ({ page }) => {
  /* Bu fazın merkezi kuralı: ad bir SUNUM kararıdır, teknik kimliği taşımaz.
     Yeniden adlandırma sonrası liste hâlâ ESKİ slug'ı göstermelidir. */
  const calls = await signIn(page)

  const row = page.getByRole('listitem').filter({ hasText: 'Yeme-İçme Yerleri' }).first()
  await row.getByRole('button', { name: /kategorisini düzenle/ }).click()

  await dialog(page).getByLabel('Kategori adı').fill('Restoran ve Kafeler')
  await dialog(page).getByRole('button', { name: 'Kaydet' }).click()

  await expect.poll(() => calls.updated.length).toBe(1)
  expect(calls.updated[0].body.name).toBe('Restoran ve Kafeler')
  expect(calls.updated[0].body).not.toHaveProperty('slug')

  await expect(page.getByText('yeme-icme').first()).toBeVisible()
})

test('a metadata-less category must gain metadata before it can be saved', async ({ page }) => {
  /* Yeni metadatasız kayıt üretilmemesinin karşılığı: yönetim ekranından geçen
     eski bir kayıt eksiğini tamamlar. */
  const calls = await signIn(page)

  const row = page.getByRole('listitem').filter({ hasText: 'Elle Eklenen' }).first()
  await row.getByRole('button', { name: /kategorisini düzenle/ }).click()

  await expect(dialog(page).getByRole('button', { name: 'Kaydet' })).toBeDisabled()

  await dialog(page).getByLabel('İkon').selectOption('store')
  await expect(dialog(page).getByRole('button', { name: 'Kaydet' })).toBeEnabled()

  await dialog(page).getByRole('button', { name: 'Kaydet' }).click()

  await expect.poll(() => calls.updated.length).toBe(1)
  expect(calls.updated[0].body.iconKey).toBe('store')
  expect(calls.updated[0].body.colorHex).toMatch(/^#[0-9A-F]{6}$/)
})
