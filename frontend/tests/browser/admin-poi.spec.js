import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'
/* Koordinat eşitliğinin TEK tanımı üretimden okunur; testin kendi eşiğini
   uydurması, iki farklı "aynı yer" kuralı demek olurdu. Modül saftır (React ya
   da OpenLayers içermez), dolayısıyla tarayıcı testinden içe aktarılabilir. */
import { coordinatesEqual } from '../../src/poi/poiCoordinates.js'

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

/** Haritanın açılış merkezi: kabın orta pikseli tam bu koordinattır. */
const MAP_CENTER = { longitude: 35.2433, latitude: 38.9637 }

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
  { id: 1, name: 'Yeme-İçme', parentId: null, parentName: null, path: 'Yeme-İçme', depth: 0, slug: 'yeme-icme', iconKey: 'utensils', colorHex: '#F97316', createdDate: '2026-08-01T00:00:00Z', modifiedDate: '2026-08-01T00:00:00Z', isActive: true, isDeleted: false },
  { id: 3, name: 'Kafe', parentId: 1, parentName: 'Yeme-İçme', path: 'Yeme-İçme / Kafe', depth: 1, slug: 'kafe', iconKey: 'coffee', colorHex: '#F97316', createdDate: '2026-08-01T00:00:00Z', modifiedDate: '2026-08-01T00:00:00Z', isActive: true, isDeleted: false },
  { id: 2, name: 'Restoran', parentId: 1, parentName: 'Yeme-İçme', path: 'Yeme-İçme / Restoran', depth: 1, slug: 'restoran', iconKey: 'utensils-crossed', colorHex: '#F97316', createdDate: '2026-08-01T00:00:00Z', modifiedDate: '2026-08-01T00:00:00Z', isActive: true, isDeleted: false },
  { id: 4, name: 'Pasif Kategori', parentId: null, parentName: null, path: 'Pasif Kategori', depth: 0, slug: 'pasif-kategori', iconKey: 'map-pin', colorHex: '#64748B', createdDate: '2026-08-02T00:00:00Z', modifiedDate: '2026-08-02T00:00:00Z', isActive: false, isDeleted: false },
  { id: 5, name: 'Silinmiş Kategori', parentId: null, parentName: null, path: 'Silinmiş Kategori', depth: 0, slug: 'silinmis-kategori', iconKey: 'map-pin', colorHex: '#64748B', createdDate: '2026-08-03T00:00:00Z', modifiedDate: '2026-08-03T00:00:00Z', isActive: true, isDeleted: true },
]

/**
 * Yönetim kaydının HARİTA sözleşmesindeki karşılığı.
 *
 * Oluşturan bilgisi ve denetim alanları BİLİNÇLİ olarak düşer: harita
 * sözleşmesi onları hiç taşımaz. Yetenek bayrakları sunucunun kararıdır ve
 * burada `poi.manage` taşıyan çağıran için doludur.
 */
const mapPoi = (poi) => ({
  id: poi.id,
  name: poi.name,
  categoryId: poi.categoryId,
  categoryName: poi.categoryName,
  categoryPath: poi.categoryPath,
  workHours: poi.workHours,
  longitude: poi.longitude,
  latitude: poi.latitude,
  canUpdate: true,
  canDelete: true,
})

/**
 * Oturum açar, yetki kümesini kurar ve POI uçlarını taklit eder.
 *
 * `role` yalnızca sunucunun bildirdiği rol ADIDIR ve hiçbir görünürlük kararı
 * vermez; varsayılan olarak kanonik olmayan bir ad verilir ki bu testlerin
 * hiçbiri yanlışlıkla rol adına dayanamasın.
 */
async function signIn(page, codes, { role = 'Operatör Amiri' } = {}) {
  const permissions = await mockPermissions(page, codes)
  const calls = { pois: 0, categories: 0, created: [], updated: [], poiUpdates: [] }

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
      return route.fulfill(json({ id: 9, name: 'Yeni', parentId: null, path: 'Yeni', depth: 0, slug: 'yeni', iconKey: 'store', colorHex: '#8B5CF6', isActive: true, isDeleted: false }, 201))
    }

    calls.categories += 1
    return route.fulfill(json(CATEGORIES))
  })

  await page.route('**/api/admin/poi', (route) => {
    calls.pois += 1
    return route.fulfill(json(POIS))
  })

  /* --- Düzenleme diyaloğunun ve haritaya devretmenin ihtiyaç duyduğu uçlar ---
     Kayıt uçları YÖNETİME ÖZEL DEĞİLDİR: düzenleme formu haritayla aynı
     kategori listesini ve aynı `PUT /api/poi/{id}` sözleşmesini kullanır. */

  await page.route('**/api/poi/categories', (route) =>
    route.fulfill(json(CATEGORIES.filter((c) => c.isActive && !c.isDeleted))),
  )

  await page.route(/\/api\/poi\/\d+$/, (route) => {
    const request = route.request()
    if (request.method() !== 'PUT') return route.fallback()

    const body = JSON.parse(request.postData() ?? '{}')
    const id = Number(request.url().match(/\/api\/poi\/(\d+)$/)?.[1])
    calls.poiUpdates.push({ id, body })

    return route.fulfill(json({ ...mapPoi(POIS.find((p) => p.id === id) ?? POIS[0]), ...body }))
  })

  /* Harita önyüklemesi: devretme testleri gerçek `/map` sayfasını açar ve
     üretimdeki düzenleme mimarisini olduğu gibi kullanır. Çizim uçları 403
     döner — bu profilin hiçbir çizim yetkisi yoktur. */
  await page.route('**/api/auth/me/geographic-scope', (route) =>
    route.fulfill(json({ isRestricted: false, effectiveWkt: null, areaCount: 0 })),
  )

  for (const path of ['points', 'lines', 'polygons', 'deleted']) {
    await page.route(`**/api/drawings/${path}`, (route) =>
      route.fulfill(json({ message: 'Yetkiniz yok.' }, 403)),
    )
  }

  await page.route('**/api/poi', (route) =>
    route.fulfill(json(POIS.filter((p) => !p.isDeleted && p.isActive).map(mapPoi))),
  )

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

/**
 * Bir POI'nin SATIRI.
 *
 * Aynı metin artık iki yerde geçiyor: süzgeç şeridindeki açılır liste
 * seçeneklerinde ve satırın kendisinde. İddia edilen şey satırın İÇERİĞİ
 * olduğuna göre, locator da satıra sabitlenir — `.first()` ile hangi eşleşmenin
 * geleceğini tahmin etmek, bugünkü DOM sırasına güvenmek olurdu. */
const poiRow = (page, name) =>
  page.locator('.admin-poi-row').filter({ hasText: name })

test('creator attribution is rendered for every record', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin/poi')

  // Oluşturan, KAYDIN kendi satırında görünür.
  await expect(poiRow(page, 'Ankara Kalesi Kafe').getByText('saha-operatoru')).toBeVisible()
  await expect(poiRow(page, 'Pasif Restoran').getByText('ikinci-operator')).toBeVisible()
  await expect(poiRow(page, 'Silinmiş Nokta').getByText('ikinci-operator')).toBeVisible()
})

test('category path and compact coordinates are shown', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin/poi')

  const row = poiRow(page, 'Ankara Kalesi Kafe')

  // Yol tam hâliyle: "Yeme-İçme / Kafe", yalnızca "Kafe"den daha çok şey söyler.
  await expect(row.getByText('Yeme-İçme / Kafe')).toBeVisible()
  await expect(row.getByText('32.85970, 39.93340')).toBeVisible()
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

test('create sends name, parent and presentation metadata — but never a slug', async ({ page }) => {
  const { calls } = await signIn(page, [CATEGORIES_MANAGE])
  await page.goto('/admin/poi')

  await page.getByRole('button', { name: '+ Yeni Kategori' }).click()
  await dialog(page).getByLabel('Kategori adı').fill('  Tatlıcı  ')
  await dialog(page).getByLabel('Üst kategori').selectOption({ label: 'Yeme-İçme' })
  await dialog(page).getByLabel('İkon').selectOption('coffee')
  await dialog(page).getByRole('button', { name: 'Kategori Oluştur' }).click()

  await expect(page.getByText('Kategori başarıyla oluşturuldu.')).toBeVisible()

  /* Gövde DÖRT alan taşır; durum ve tarihler sunucunundur. `slug` de
     sunucunundur: teknik kimliği istemci seçmez. */
  expect(calls.created).toHaveLength(1)
  expect(Object.keys(calls.created[0]).sort()).toEqual(['colorHex', 'iconKey', 'name', 'parentId'])
  expect(calls.created[0].name).toBe('Tatlıcı')
  expect(calls.created[0].parentId).toBe(1)
  expect(calls.created[0].iconKey).toBe('coffee')
  expect(calls.created[0].colorHex).toMatch(/^#[0-9A-F]{6}$/)
  expect(calls.created[0]).not.toHaveProperty('slug')
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
  // Simge ZORUNLUDUR: sunucu metadatasız kategori kabul etmez.
  await dialog(page).getByLabel('İkon').selectOption('coffee')
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
  expect(Object.keys(body).sort()).toEqual(['colorHex', 'iconKey', 'isActive', 'name', 'parentId'])
  expect(body).toEqual({
    name: 'Kahveci',
    parentId: 1,
    isActive: false,
    // Düzenleme kipinde mevcut metadata ile açılır ve olduğu gibi geri gider.
    iconKey: 'coffee',
    colorHex: '#F97316',
  })
  expect(body).not.toHaveProperty('isDeleted')
  expect(body).not.toHaveProperty('createdDate')
  // Ad değişse bile teknik kimlik gövdede YER ALMAZ.
  expect(body).not.toHaveProperty('slug')
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

/* ===========================================================================
   6. Süzgeçler
   ===========================================================================

   Süzme bir GÜVENLİK SINIRI DEĞİLDİR: liste zaten `poi.manage` ile geldi.
   Burada ölçülen şey, yöneticinin o listeyi daraltabilmesi ve daraltmanın
   bileşik olmasıdır. */

const poiRows = (page) => page.locator('.admin-poi-row .admin-user-identity strong')
const filterBar = (page) => page.getByRole('search')
const poiSearch = (page) => filterBar(page).getByRole('searchbox', { name: /POI adı/ })

test('the POI search matches name, category and creator, Turkish-aware', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin/poi')
  await expect(poiRows(page)).toHaveCount(3)

  await poiSearch(page).fill('kalesi')
  await expect(poiRows(page)).toHaveText(['Ankara Kalesi Kafe'])

  // Kategori yolu da aranır.
  await poiSearch(page).fill('restoran')
  await expect(poiRows(page)).toHaveText(['Pasif Restoran', 'Silinmiş Nokta'])

  // Oluşturan da aranır — bu alan YALNIZCA yönetim sözleşmesinde vardır.
  await poiSearch(page).fill('ikinci-operator')
  await expect(poiRows(page)).toHaveText(['Pasif Restoran', 'Silinmiş Nokta'])

  /* Türkçe katlama uygulamanın tek yardımcısından gelir: büyük I'nın 'ı'ya
     düşmesi aramayı bozmamalıdır. */
  await poiSearch(page).fill('SILINMIS')
  await expect(poiRows(page)).toHaveText(['Silinmiş Nokta'])
})

test('status, category and creator filters compose with the search', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin/poi')

  await filterBar(page).getByRole('combobox', { name: 'Duruma göre süz' }).selectOption('deleted')
  await expect(poiRows(page)).toHaveText(['Silinmiş Nokta'])

  await filterBar(page).getByRole('combobox', { name: 'Duruma göre süz' }).selectOption('active')
  await expect(poiRows(page)).toHaveText(['Ankara Kalesi Kafe'])

  await filterBar(page).getByRole('combobox', { name: 'Kategoriye göre süz' })
    .selectOption('Yeme-İçme / Restoran')
  // Bileşik: aktif VE restoran kategorisi olan kayıt yoktur.
  await expect(poiRows(page)).toHaveCount(0)
  await expect(page.getByText('Filtrelerle eşleşen POI bulunamadı.')).toBeVisible()

  /* Sıfırlama İKİ yerde sunulur: süzgeç şeridinde ve boş-sonuç durumunda.
     Kastedilen şeritteki olduğu için locator da oraya sabitlenir. */
  await filterBar(page).getByRole('button', { name: 'Filtreleri Temizle' }).click()
  await expect(poiRows(page)).toHaveCount(3)
})

test('the creator filter and the sort control work on the same narrowed list', async ({ page }) => {
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin/poi')

  await filterBar(page).getByRole('combobox', { name: 'Oluşturana göre süz' })
    .selectOption('ikinci-operator')
  await expect(poiRows(page)).toHaveText(['Pasif Restoran', 'Silinmiş Nokta'])

  await filterBar(page).getByRole('combobox', { name: 'Sıralama ölçütü' }).selectOption('name-asc')
  await expect(poiRows(page)).toHaveText(['Pasif Restoran', 'Silinmiş Nokta'])

  await filterBar(page).getByRole('combobox', { name: 'Sıralama ölçütü' }).selectOption('name-desc')
  await expect(poiRows(page)).toHaveText(['Silinmiş Nokta', 'Pasif Restoran'])
})

test('the category tab filters by search, status and kind', async ({ page }) => {
  await signIn(page, [POI_MANAGE, CATEGORIES_MANAGE])
  await page.goto('/admin/poi')
  await tab(page, 'Kategoriler').click()

  const rows = page.locator('.admin-poi-tree-identity strong')
  await expect(rows).toHaveCount(5)

  await filterBar(page).getByRole('searchbox', { name: /Kategori adı/ }).fill('kafe')
  await expect(rows).toHaveText(['Kafe'])

  await filterBar(page).getByRole('button', { name: 'Filtreleri Temizle' }).click()
  await filterBar(page).getByRole('combobox', { name: 'Türe göre süz' }).selectOption('root')
  // Tür `parentId`den okunur, girintiden DEĞİL.
  await expect(rows).toHaveText(['Yeme-İçme', 'Pasif Kategori', 'Silinmiş Kategori'])

  await filterBar(page).getByRole('combobox', { name: 'Duruma göre süz' }).selectOption('inactive')
  await expect(rows).toHaveText(['Pasif Kategori'])

  await filterBar(page).getByRole('combobox', { name: 'Türe göre süz' }).selectOption('child')
  await expect(rows).toHaveCount(0)
  await expect(page.getByText('Filtrelerle eşleşen kategori bulunamadı.')).toBeVisible()
})

/* ===========================================================================
   7. Düzenleme diyaloğu viewport'a sığar
   =========================================================================== */

test('the edit dialog fits the viewport and scrolls in its body', async ({ page }) => {
  // Dar bir viewport: form yedi mesai günü ve konum alanlarıyla uzundur.
  await page.setViewportSize({ width: 1024, height: 620 })
  await signIn(page, [POI_MANAGE])
  await page.goto('/admin/poi')

  await page.getByRole('button', { name: 'Düzenle' }).first().click()
  const form = dialog(page)
  await expect(form).toBeVisible()

  // Diyaloğun tamamı ekranın İÇİNDEDİR: alt kenarı viewport'u aşmaz.
  const box = await form.boundingBox()
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.y + box.height).toBeLessThanOrEqual(620)

  /* Kaydırma GÖVDEYE aittir: içerik kutusundan uzundur ve kutu kayar.
     Ekran görüntüsü değil, ölçülebilir DOM gerçeği. */
  const body = form.locator('.admin-dialog-body')
  const overflow = await body.evaluate((el) => el.scrollHeight - el.clientHeight)
  expect(overflow).toBeGreaterThan(0)

  // Konuma kaydırılabilir ve alttaki eylemler hâlâ erişilebilirdir.
  await form.getByRole('button', { name: 'Haritada Taşı' }).scrollIntoViewIfNeeded()
  await expect(form.getByRole('button', { name: 'Haritada Taşı' })).toBeVisible()

  /* Eylem şeridi SABİTTİR: gövde kaysa da düğmeler ekranda kalır. */
  for (const name of ['Değişiklikleri Geri Al', 'İptal', 'Kaydet']) {
    const action = form.getByRole('button', { name })
    await expect(action).toBeVisible()
    const actionBox = await action.boundingBox()
    expect(actionBox.y + actionBox.height).toBeLessThanOrEqual(620)
  }
})

/* ===========================================================================
   8. Yönetim → harita devretmesi
   ===========================================================================

   Devreden şey yalnızca VERİDİR. Hiçbir yetki iddiası taşınmaz ve hiçbir
   şey kaydedilmez: kalıcı kayıt "Güncelle"ye basılana kadar olduğu gibi
   durur. */

const mapSheet = (page, title) =>
  page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) })

async function openAdminEdit(page) {
  await page.goto('/admin/poi')
  await page.getByRole('button', { name: 'Düzenle' }).first().click()
  const form = dialog(page)
  await expect(form).toBeVisible()
  return form
}

test('Haritada Taşı opens the map and continues editing the same POI', async ({ page }) => {
  const { calls } = await signIn(page, [POI_MANAGE, 'map.view', 'poi.view', 'poi.update'])
  const form = await openAdminEdit(page)

  await form.getByRole('button', { name: 'Haritada Taşı' }).click()

  await expect(page).toHaveURL(/\/map$/)
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  // AYNI düzenleme bağlamı açılır; ikinci bir "yönetim düzenlemesi" yoktur.
  const sheet = mapSheet(page, 'POI Düzenle')
  await expect(sheet).toBeVisible()
  await expect(sheet.getByLabel('POI Adı')).toHaveValue('Ankara Kalesi Kafe')
  await expect(sheet.getByLabel('Boylam', { exact: true })).toHaveValue('32.8597')

  // Hiçbir şey değişmediği için kaydetme kapalıdır ve hiçbir istek gitmemiştir.
  await expect(sheet.getByRole('button', { name: 'Güncelle' })).toBeDisabled()
  expect(calls.poiUpdates).toEqual([])
})

test('an unsaved admin draft survives the handoff, and revert returns to the PERSISTED record', async ({ page }) => {
  const { calls } = await signIn(page, [POI_MANAGE, 'map.view', 'poi.view', 'poi.update'])
  const form = await openAdminEdit(page)

  await form.getByLabel('POI adı').fill('Tuz Gölü Test')
  await form.getByRole('searchbox', { name: 'Kategori', exact: true }).fill('restoran')
  await form.getByRole('option', { name: 'Yeme-İçme / Restoran', exact: true }).click()
  await form.getByRole('checkbox', { name: 'Pazartesi 24 saat açık' }).check()

  await form.getByRole('button', { name: 'Haritada Taşı' }).click()
  await expect(page).toHaveURL(/\/map$/)

  const sheet = mapSheet(page, 'POI Düzenle')
  await expect(sheet).toBeVisible()

  // Kaydedilmemiş taslağın TAMAMI taşınır.
  await expect(sheet.getByLabel('POI Adı')).toHaveValue('Tuz Gölü Test')
  await expect(sheet.getByText('Seçili: Yeme-İçme / Restoran')).toBeVisible()
  await expect(sheet.getByRole('checkbox', { name: 'Pazartesi 24 saat açık' })).toBeChecked()

  // Değişiklik zaten yapılmış olduğu için kaydetme AÇIKTIR…
  await expect(sheet.getByRole('button', { name: 'Güncelle' })).toBeEnabled()
  // …ama gezinme sırasında hiçbir şey kaydedilmemiştir.
  expect(calls.poiUpdates).toEqual([])

  /* "Değişiklikleri Geri Al"ın tek anlamı VERİTABANINDAKİ hâle dönmektir —
     devralınan ara taslağa değil. */
  await sheet.getByRole('button', { name: 'Değişiklikleri Geri Al' }).click()
  await expect(sheet.getByLabel('POI Adı')).toHaveValue('Ankara Kalesi Kafe')
  await expect(sheet.getByText('Seçili: Yeme-İçme / Kafe')).toBeVisible()
  await expect(sheet.getByRole('button', { name: 'Güncelle' })).toBeDisabled()
  expect(calls.poiUpdates).toEqual([])
})

test('a coordinate typed in admin opens as the map DRAFT, not as the persisted point', async ({ page }) => {
  const { calls } = await signIn(page, [POI_MANAGE, 'map.view', 'poi.view', 'poi.update'])
  const form = await openAdminEdit(page)

  await form.getByLabel('Boylam', { exact: true }).fill('30.5')
  await form.getByRole('button', { name: 'Haritada Taşı' }).click()

  const sheet = mapSheet(page, 'POI Düzenle')
  await expect(sheet.getByLabel('Boylam', { exact: true })).toHaveValue('30.5')
  await expect(sheet.getByRole('button', { name: 'Güncelle' })).toBeEnabled()

  /* Kalıcı kayıt KIPIRDAMADI: iptal edildiğinde bilgi paneli hâlâ eski
     koordinatı gösterir ve hiçbir PUT gitmemiştir. */
  await sheet.getByRole('button', { name: 'İptal' }).click()
  expect(calls.poiUpdates).toEqual([])
})

test('after the handoff the map drag saves the admin draft together with the new coordinate', async ({ page }) => {
  const { calls } = await signIn(page, [POI_MANAGE, 'map.view', 'poi.view', 'poi.update'])

  /* Taslak işaret KAYDIN koordinatındadır, haritanın ortasında değil. Sürükleme
     kabın orta pikselinden başladığı için hedef kayıt bu testte açılış
     merkezine yerleştirilir — aksi hâlde tık boş haritaya düşer, DragPan
     görünümü kaydırır ve işaret hiç kıpırdamaz. `my-pois.spec.js`teki çalışan
     sürükleme de tam olarak bu önkoşula dayanır. */
  const centred = { ...POIS[0], ...MAP_CENTER }
  await page.route('**/api/admin/poi', (route) => route.fulfill(json([centred, POIS[1], POIS[2]])))
  await page.route('**/api/poi', (route) => route.fulfill(json([mapPoi(centred)])))

  const form = await openAdminEdit(page)

  await form.getByLabel('POI adı').fill('Sürüklenecek Kayıt')
  await form.getByRole('button', { name: 'Haritada Taşı' }).click()

  const sheet = mapSheet(page, 'POI Düzenle')
  await expect(sheet).toBeVisible()

  const longitude = sheet.getByLabel('Boylam', { exact: true })
  const latitude = sheet.getByLabel('Enlem', { exact: true })
  const before = {
    longitude: Number(await longitude.inputValue()),
    latitude: Number(await latitude.inputValue()),
  }
  expect(coordinatesEqual(before, MAP_CENTER)).toBe(true)

  // Haritada taşıma: AYNI taslak işaret ve aynı Translate etkileşimi.
  await sheet.getByRole('button', { name: 'Haritada Taşı' }).click()
  await expect(sheet.getByRole('button', { name: 'Taşımayı Bitir' })).toHaveAttribute('aria-pressed', 'true')

  const box = await page.locator('.map-container').boundingBox()
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width * 0.5 + 120, box.y + box.height * 0.5 + 60, { steps: 12 })
  await page.mouse.up()

  /* TASLAK, KAYDETMEDEN ÖNCE değişmiş olmalıdır. Bu satır olmadan, yönetimde
     yazılan ad formu zaten kirlettiği için başarısız bir sürükleme fark
     edilmeden geçerdi — bu testin ilk hâli tam olarak buna düştü. */
  await expect
    .poll(async () => coordinatesEqual(before, {
      longitude: Number(await longitude.inputValue()),
      latitude: Number(await latitude.inputValue()),
    }))
    .toBe(false)

  const dragged = {
    longitude: Number(await longitude.inputValue()),
    latitude: Number(await latitude.inputValue()),
  }

  /* Kalıcı kayıt HENÜZ kıpırdamadı: taşınan yalnızca taslaktır. */
  expect(calls.poiUpdates).toEqual([])

  await sheet.getByRole('button', { name: 'Güncelle' }).click()
  await expect.poll(() => calls.poiUpdates.length).toBe(1)

  const body = calls.poiUpdates[0].body

  // Gövde yönetimde yazılan adı DA taşır, sürüklenen koordinatı da.
  expect(body.name).toBe('Sürüklenecek Kayıt')

  /* Sözleşme "boylam değişsin" DEĞİL, "kaydedilen nokta kalıcı noktadan
     FARKLI olsun"dur: dikey bir sürüklemede boylam yerinde kalabilir ve bu
     doğru davranıştır. Kıyas üretimin kendi eşiğiyle yapılır. */
  expect(coordinatesEqual({ longitude: body.longitude, latitude: body.latitude }, before)).toBe(false)
  expect(coordinatesEqual({ longitude: body.longitude, latitude: body.latitude }, dragged)).toBe(true)

  // Değerler EPSG:4326 sınırları içinde kalır.
  expect(Math.abs(body.longitude)).toBeLessThanOrEqual(180)
  expect(Math.abs(body.latitude)).toBeLessThanOrEqual(90)
})

test('a handoff the caller cannot edit is consumed safely without opening the editor', async ({ page }) => {
  await signIn(page, [POI_MANAGE, 'map.view', 'poi.view', 'poi.update'])

  // Harita listesi kaydı düzenlenemez bildirir; karar SUNUCUNUNDUR.
  await page.route('**/api/poi', (route) =>
    route.fulfill(json([{ ...POIS[0], canUpdate: false, canDelete: false }])),
  )

  const form = await openAdminEdit(page)
  await form.getByRole('button', { name: 'Haritada Taşı' }).click()

  await expect(page).toHaveURL(/\/map$/)
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  // Düzenleme HİÇ açılmaz; harita normal kullanılabilir durumda kalır.
  await expect(mapSheet(page, 'POI Düzenle')).toHaveCount(0)
  await expect(page.getByRole('alert')).toContainText('düzenlenemiyor')

  /* Devralma TEK SEFERLİKTİR: yenilemek eskimiş taslağı yeniden uygulamaz. */
  await page.reload()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()
  await expect(mapSheet(page, 'POI Düzenle')).toHaveCount(0)
})

test('opening the map directly still opens no editor', async ({ page }) => {
  await signIn(page, [POI_MANAGE, 'map.view', 'poi.view', 'poi.update'])
  await page.goto('/map')

  await expect(page.locator('.map-container canvas').first()).toBeVisible()
  await expect(mapSheet(page, 'POI Düzenle')).toHaveCount(0)
})

/* ===========================================================================
   9. Devretme, VERİ GELMEDEN reddedilmez
   ===========================================================================

   Bu bölüm tek bir ayrımı korur: <b>"henüz okumadım" ile "okudum, kayıt yok"
   AYNI ŞEY DEĞİLDİR.</b> Harita katmanı `loading: false` ile doğar ve okumayı
   bir effect başlatır; ikisini karıştıran bir karar, veri daha yola çıkmadan
   "kayıt bulunamadı" der — ve reddetme tek seferlik olduğu için veri sonradan
   gelse de düzenleme bir daha açılmaz. */

test('a handoff waits for the first POI load instead of refusing early', async ({ page }) => {
  await signIn(page, [POI_MANAGE, 'map.view', 'poi.view', 'poi.update'])

  /* Yanıt TESTİN denetiminde serbest bırakılır: sabit bir uyku değil,
     belirlenmiş bir sıra. */
  let releasePois
  const poisArrived = new Promise((resolve) => { releasePois = resolve })

  await page.route('**/api/poi', async (route) => {
    await poisArrived
    return route.fulfill(json([mapPoi(POIS[0])]))
  })

  const form = await openAdminEdit(page)
  await form.getByRole('button', { name: 'Haritada Taşı' }).click()

  await expect(page).toHaveURL(/\/map$/)
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  // Veri henüz gelmedi: devralma REDDEDİLMEMİŞ olmalıdır.
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(mapSheet(page, 'POI Düzenle')).toHaveCount(0)

  releasePois()

  // Kayıt geldiğinde düzenleme açılır — karar ancak şimdi verilebilirdi.
  await expect(mapSheet(page, 'POI Düzenle')).toBeVisible()
  await expect(mapSheet(page, 'POI Düzenle').getByLabel('POI Adı')).toHaveValue('Ankara Kalesi Kafe')
})

test('a handoff to a record the loaded list does not contain is refused safely', async ({ page }) => {
  await signIn(page, [POI_MANAGE, 'map.view', 'poi.view', 'poi.update'])

  // Okuma TAMAMLANIR ama hedef kayıt listede yoktur (silinmiş ya da görünmez).
  await page.route('**/api/poi', (route) => route.fulfill(json([])))

  const form = await openAdminEdit(page)
  await form.getByRole('button', { name: 'Haritada Taşı' }).click()

  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  // "Okundu ve yok" durumunda güvenli ret: mesaj sahiplik ayrıntısı açıklamaz.
  await expect(page.getByRole('alert')).toContainText('düzenlenemiyor')
  await expect(mapSheet(page, 'POI Düzenle')).toHaveCount(0)
})
