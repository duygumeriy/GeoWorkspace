import { expect, test } from '@playwright/test'
import { ALL_PERMISSIONS, mockPermissions } from './permissions.js'

/**
 * Yönetim panelindeki ÇOK ALANLI coğrafi yetki düzenleyicisi (Phase 9).
 *
 * Ekran bir YÖNETİM arayüzüdür, bir güvenlik sınırı değildir: buradaki her
 * kural backend'in `users.view`/`users.update`, `roles.view`/`roles.update` ve
 * `geography.view`/`geography.manage` kapılarını YANSITIR, onların yerine
 * geçmez. Testler de bunu böyle ölçer — bir düğmenin gizlenmesi yetkinin
 * kalktığını kanıtlamaz, yalnızca arayüzün yapılamayacak bir işi teklif
 * etmediğini gösterir.
 *
 * <b>Fazın çekirdek iddiası burada ölçülür: EKLEME SİLME DEĞİLDİR.</b> Yeni bir
 * alan eklerken var olanlar haritada ve listede durmaya devam eder; kaydetmek
 * yalnızca POST açar, düzenlemek yalnızca seçili alanın PUT'unu, silmek
 * yalnızca onun DELETE'ini gönderir.
 *
 * Her şey ağ sınırında taklit edilir. Gerçek `geographic_authorizations`
 * tablosuna tek bir satır bile yazılmaz.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/* --- Sabit geometriler -------------------------------------------------------
   Hepsi EPSG:4326 (boylam, enlem) ve hepsi Türkiye içinde. Metre ölçeğinde bir
   Web Mercator değeriyle karıştırılamayacak kadar küçük sayılar olması
   bilinçlidir: projeksiyon testi tam olarak bu farkı arar. */

/** Ankara çevresinde ~1°'lik bir kare. */
const ANKARA_WKT = 'POLYGON ((32.5 39.5, 33.5 39.5, 33.5 40.5, 32.5 40.5, 32.5 39.5))'

/** Kayseri çevresinde, Ankara ile KESİŞMEYEN ikinci bir kare. */
const KAYSERI_WKT = 'POLYGON ((35 38, 36 38, 36 39, 35 39, 35 38))'

/** İç Anadolu'yu kapsayan daha geniş bir alan — rolden miras kalan alan. */
const ROLE_WKT = 'POLYGON ((30 37, 38 37, 38 41, 30 41, 30 37))'

let nextAreaId = 100

/** Sunucunun döndürdüğü tek bir alan kaydı. */
const area = (name, wkt, { sourceType = 'ManualPolygon', sourceKey = null, id } = {}) => ({
  id: id ?? (nextAreaId += 1),
  name,
  wkt,
  sourceType,
  sourceKey,
  createdDate: '2026-08-19T09:00:00Z',
  modifiedDate: '2026-08-19T09:00:00Z',
})

/** Phase 9 sözleşmesinin birebir kopyası. */
const scope = (areas, { effectiveWkt, restricted } = {}) => ({
  areas,
  isRestricted: restricted ?? (effectiveWkt !== undefined ? effectiveWkt !== null : areas.length > 0),
  effectiveWkt: effectiveWkt === undefined ? (areas[0]?.wkt ?? null) : effectiveWkt,
})

const USER = {
  id: 4,
  username: 'saha-kullanicisi',
  email: 'saha@example.invalid',
  role: 'GIS Editor',
  isActive: true,
  emailConfirmed: true,
  accountStatus: 'Active',
  twoFactorEnabled: false,
  lockoutEnd: null,
  modifiedDate: '2026-08-18T10:00:00Z',
}

const ROLE = {
  id: 9,
  name: 'Saha Ekibi',
  userCount: 3,
  permissionCount: 8,
  isSystem: false,
  isLegacy: false,
  isAssignable: true,
  canRename: true,
  canDelete: true,
  canEditPermissions: true,
}

/**
 * Çoğul coğrafi uçları taklit eder ve yapılan çağrıları kaydeder.
 *
 * Sunucu DURUMLUDUR: POST/PUT/DELETE sonraki okumaların döneceği cevabı da
 * değiştirir. Phase 9 uçları zaten güncel durumu geri döndürür, ve ekranın
 * "kendi gönderdiğini başarılı saymak yerine sunucunun cevabını temel al"
 * davranışı ancak böyle ölçülebilir.
 */
async function mockAreas(page, { targetType, targetId, initial = [], inherited = null, getStatus, onPost }) {
  const calls = { get: 0, post: [], put: [], delete: [] }
  const state = { areas: [...initial] }

  const base = `**/api/admin/${targetType === 'user' ? 'users' : 'roles'}/${targetId}/geographic-authorizations`

  const body = () =>
    state.areas.length > 0
      ? scope(state.areas, { effectiveWkt: state.areas[0].wkt })
      : scope([], { effectiveWkt: inherited, restricted: inherited !== null })

  // Koleksiyon önce kaydedilir; Playwright son kaydedileni önce dener, bu
  // yüzden tekil rota aşağıda ve daha önceliklidir.
  await page.route(base, async (route) => {
    if (route.request().method() === 'POST') {
      const payload = JSON.parse(route.request().postData() || '{}')
      calls.post.push(payload)
      if (onPost) return onPost(route, calls)
      state.areas.push(area(payload.name || 'Adsız', payload.wkt, {
        sourceType: payload.sourceType ?? 'ManualPolygon',
        sourceKey: payload.sourceKey ?? null,
      }))
      return route.fulfill(json(body()))
    }

    calls.get += 1
    if (getStatus && getStatus !== 200) {
      return route.fulfill(json({ message: 'Coğrafi yetki alanları okunamadı.' }, getStatus))
    }
    return route.fulfill(json(body()))
  })

  await page.route(`${base}/*`, async (route) => {
    const method = route.request().method()
    const id = Number(new URL(route.request().url()).pathname.split('/').pop())

    if (method === 'PUT') {
      const payload = JSON.parse(route.request().postData() || '{}')
      calls.put.push({ id, ...payload })
      state.areas = state.areas.map((item) =>
        item.id === id ? { ...item, name: payload.name || item.name, wkt: payload.wkt } : item,
      )
      return route.fulfill(json(body()))
    }

    if (method === 'DELETE') {
      calls.delete.push(id)
      state.areas = state.areas.filter((item) => item.id !== id)
      return route.fulfill(json(body()))
    }

    return route.fulfill(json(body()))
  })

  return { calls, state }
}

/** Kip penceresinin ihtiyacı olan döşemeler; hiçbir istek ağa çıkmaz. */
const TRANSPARENT_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

async function stubTiles(page) {
  const serve = (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: TRANSPARENT_PNG,
  })
  await page.route('**/tile.openstreetmap.org/**', serve)
  await page.route('**/server.arcgisonline.com/**', serve)
}

/** Oturumu açar ve yönetim panelinin ortak uçlarını yanıtlar. */
async function signIn(page, permissions) {
  const control = await mockPermissions(page, permissions)
  await stubTiles(page)
  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: 1, username: 'admin', emailConfirmed: true, twoFactorEnabled: true, role: 'Admin', roles: ['Admin'] })),
  )
  await page.goto('/login')
  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-admin-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())
  return control
}

/** Kullanıcı detayını açar; coğrafi uçlar isteğe göre taklit edilir. */
async function openUser(page, { permissions = ALL_PERMISSIONS, geo } = {}) {
  const control = await signIn(page, permissions)
  await page.route('**/api/admin/users/roles', (route) => route.fulfill(json([])))
  await page.route(`**/api/admin/users/${USER.id}/permissions`, (route) =>
    route.fulfill(json({ userId: USER.id, userName: USER.username, roles: ['GIS Editor'], canManageDirectPermissions: true, targetAccountEligible: true, permissions: [] })),
  )
  const scopeMock = geo ? await mockAreas(page, { targetType: 'user', targetId: USER.id, ...geo }) : null
  await page.route(`**/api/admin/users/${USER.id}`, (route) => route.fulfill(json(USER)))
  await page.route('**/api/admin/users', (route) => route.fulfill(json([USER])))

  await page.goto('/admin/users')
  await page.getByRole('button', { name: `${USER.username} kullanıcısının detayını aç` }).click()
  await expect(page.getByRole('heading', { name: USER.username, level: 2 })).toBeVisible()
  return { control, scopeMock }
}

/** Rol detayını açar. */
async function openRole(page, { permissions = ALL_PERMISSIONS, geo } = {}) {
  const control = await signIn(page, permissions)
  await page.route('**/api/admin/roles/*/permissions', (route) =>
    route.fulfill(json({ role: ROLE, permissions: [] })),
  )
  const scopeMock = geo ? await mockAreas(page, { targetType: 'role', targetId: ROLE.id, ...geo }) : null
  await page.route('**/api/admin/roles', (route) => route.fulfill(json([ROLE])))

  await page.goto('/admin/roles')
  await page.getByRole('button', { name: `${ROLE.name} rolünün detayını aç` }).click()
  await expect(page.getByRole('heading', { name: ROLE.name, level: 2 })).toBeVisible()
  return { control, scopeMock }
}

const entryButton = (page) => page.getByRole('button', { name: 'Coğrafi Yetki', exact: true })
const editor = (page) => page.getByRole('dialog', { name: /^Coğrafi Yetki —/ })
const scopeMap = (page) => page.getByTestId('geographic-scope-map')
const addButton = (page) => editor(page).getByRole('button', { name: 'Yeni Alan Ekle' }).first()
const saveButton = (page) => editor(page).getByRole('button', { name: /Alanı Kaydet$/ })
const areaCard = (page, name) => editor(page).getByRole('button', { name: new RegExp(`^${name}`) })

/** Yetki kümesinden tek tek kod çıkarır — "şu yetki olmasaydı" kurguları için. */
const without = (...codes) => ALL_PERMISSIONS.filter((code) => !codes.includes(code))

/** Düzenleyiciyi açar ve yüklenmesini bekler. */
async function openEditor(page) {
  await entryButton(page).click()
  await expect(editor(page)).toBeVisible()
  await expect(scopeMap(page)).toBeVisible()
  return editor(page)
}

/**
 * Haritaya bir poligon çizer.
 *
 * Kapsayıcının kutusuna göre oransal noktalar kullanılır: sabit piksellere
 * bağlanmak, pencere ölçüsü değiştiğinde kırılgan olurdu. Son nokta çift
 * tıklamayla verilir — OpenLayers çizimi böyle bitirir.
 */
async function drawPolygon(page, points = [[0.35, 0.35], [0.62, 0.35], [0.62, 0.62]]) {
  /* Kip penceresi kendi içinde kaydırılabilir. Taslak paneli açıldığında harita
     görünür alanın dışına kayabilir ve o koordinatlara yapılan bir tık haritaya
     değil arka plana düşerdi — pencereyi kapatarak. Önce haritayı görünür
     alana getiriyoruz. */
  await scopeMap(page).scrollIntoViewIfNeeded()
  const box = await scopeMap(page).boundingBox()
  const at = ([fx, fy]) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })

  for (const point of points) {
    const { x, y } = at(point)
    await page.mouse.click(x, y)
  }
  const last = at([points[0][0], points[points.length - 1][1]])
  await page.mouse.dblclick(last.x, last.y)
}

/* --- Giriş noktasının görünürlüğü -------------------------------------------- */

test('a user without geography.view is never offered the geographic action', async ({ page }) => {
  await openUser(page, { permissions: without('geography.view') })

  /* Düğme DEVRE DIŞI değil, HİÇ YOK. Kural budur: yetkisi olmayana düğmeyi
     göstermemek. Devre dışı bir düğme, var olmayan bir yolu duyurmaya devam
     ederdi. */
  await expect(entryButton(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Coğrafi Yetki', level: 3 })).toHaveCount(0)
})

test('geography.view alone is enough to reach the user geographic editor', async ({ page }) => {
  await openUser(page, {
    permissions: without('geography.manage'),
    geo: { initial: [] },
  })

  await expect(entryButton(page)).toBeVisible()
  await openEditor(page)
})

test('without geography.manage the editor opens read-only', async ({ page }) => {
  await openUser(page, {
    permissions: without('geography.manage'),
    geo: { initial: [area('Ankara', ANKARA_WKT, { id: 1 })] },
  })
  const panel = await openEditor(page)

  await expect(panel.getByText('Coğrafi alanlar yalnızca görüntüleniyor.', { exact: false })).toBeVisible()
  // Kayıtlı alan GÖRÜNÜR ama hiçbir düzenleme kontrolü çizilmez.
  await expect(areaCard(page, 'Ankara')).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Yeni Alan Ekle' })).toHaveCount(0)
  await expect(saveButton(page)).toHaveCount(0)
})

/* --- Var olan alanların listelenmesi ----------------------------------------- */

test('every saved area is listed and drawn, not just the first', async ({ page }) => {
  await openUser(page, {
    geo: { initial: [area('Ankara', ANKARA_WKT, { id: 1 }), area('Kayseri', KAYSERI_WKT, { id: 2 })] },
  })
  await openEditor(page)

  await expect(areaCard(page, 'Ankara')).toBeVisible()
  await expect(areaCard(page, 'Kayseri')).toBeVisible()

  /* Haritadaki poligon sayısı tuvale çizilir ve DOM'dan okunamaz; bileşen onu
     veri niteliği olarak yayımlar. İki alandan yalnızca birini çizen bir
     uygulama burada düşer. */
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '2')
  await expect(editor(page).getByText('2 coğrafi alan tanımlı', { exact: false })).toBeVisible()
})

test('clicking an area card selects it and the map reports the selection', async ({ page }) => {
  await openUser(page, {
    geo: { initial: [area('Ankara', ANKARA_WKT, { id: 1 }), area('Kayseri', KAYSERI_WKT, { id: 2 })] },
  })
  await openEditor(page)

  await areaCard(page, 'Kayseri').click()

  await expect(areaCard(page, 'Kayseri')).toHaveAttribute('aria-pressed', 'true')
  await expect(scopeMap(page)).toHaveAttribute('data-selected-id', '2')
  // Seçim, alan bazlı eylemleri açar.
  await expect(editor(page).getByRole('button', { name: 'Alanı Düzenle' })).toBeVisible()
  await expect(editor(page).getByRole('button', { name: 'Alanı Sil' })).toBeVisible()
})

/* --- EKLEME SİLME DEĞİLDİR --------------------------------------------------- */

test('starting a new area keeps the existing ones on the map', async ({ page }) => {
  await openUser(page, {
    geo: { initial: [area('Ankara', ANKARA_WKT, { id: 1 })] },
  })
  await openEditor(page)

  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')

  await addButton(page).click()

  /* Fazın çekirdek iddiası: taslak açmak var olan alanı EKRANDAN SİLMEZ.
     Eski davranışta yeni çizim tek kaynağı temizlerdi ve yönetici ikinci
     bölgeyi birincisini göremeden çizmek zorunda kalırdı. */
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')
  await expect(areaCard(page, 'Ankara')).toBeVisible()
  await expect(editor(page).getByRole('heading', { name: 'Yeni alan' })).toBeVisible()
})

test('saving a second area POSTs once and never PUTs or DELETEs the first', async ({ page }) => {
  const { scopeMock } = await openUser(page, {
    geo: { initial: [area('Ankara', ANKARA_WKT, { id: 1 })] },
  })
  await openEditor(page)

  await addButton(page).click()
  await drawPolygon(page)
  await expect(scopeMap(page)).toHaveAttribute('data-draft-count', '1')

  await editor(page).getByLabel('Alan adı').fill('Kayseri')
  await saveButton(page).click()

  await expect(editor(page).getByText('Coğrafi alan eklendi.')).toBeVisible()

  // TEK POST, hiç PUT, hiç DELETE.
  expect(scopeMock.calls.post).toHaveLength(1)
  expect(scopeMock.calls.put).toHaveLength(0)
  expect(scopeMock.calls.delete).toHaveLength(0)
  expect(scopeMock.calls.post[0].name).toBe('Kayseri')

  // Gönderilen WKT gerçekten 4326'dır: metre ölçeğinde bir sayı içermez.
  expect(scopeMock.calls.post[0].wkt).toMatch(/^POLYGON/)
  for (const value of scopeMock.calls.post[0].wkt.match(/-?\d+(\.\d+)?/g)) {
    expect(Math.abs(Number(value))).toBeLessThanOrEqual(180)
  }

  // Sunucunun cevabı temel alınır: artık İKİ alan var.
  await expect(areaCard(page, 'Ankara')).toBeVisible()
  await expect(areaCard(page, 'Kayseri')).toBeVisible()
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '2')
})

/* --- Tek alanı düzenleme ve silme -------------------------------------------- */

test('editing a selected area PUTs only that area', async ({ page }) => {
  const { scopeMock } = await openUser(page, {
    geo: { initial: [area('Ankara', ANKARA_WKT, { id: 1 }), area('Kayseri', KAYSERI_WKT, { id: 2 })] },
  })
  await openEditor(page)

  await areaCard(page, 'Ankara').click()
  await editor(page).getByRole('button', { name: 'Alanı Düzenle' }).click()

  /* Düzenlenen alan kayıtlı katmandan çıkar ve taslağa geçer: aynı poligon iki
     kez çizilmez. */
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')
  await expect(scopeMap(page)).toHaveAttribute('data-draft-count', '1')

  await editor(page).getByRole('button', { name: 'Yeniden Çiz' }).click()
  await drawPolygon(page)
  await saveButton(page).click()

  await expect(editor(page).getByText('Coğrafi alan güncellendi.')).toBeVisible()

  expect(scopeMock.calls.put).toHaveLength(1)
  expect(scopeMock.calls.put[0].id).toBe(1)
  expect(scopeMock.calls.post).toHaveLength(0)
  expect(scopeMock.calls.delete).toHaveLength(0)

  // İkinci alan dokunulmamış olarak durur.
  await expect(areaCard(page, 'Kayseri')).toBeVisible()
})

test('deleting one area leaves the others in place', async ({ page }) => {
  const { scopeMock } = await openUser(page, {
    geo: { initial: [area('Ankara', ANKARA_WKT, { id: 1 }), area('Kayseri', KAYSERI_WKT, { id: 2 })] },
  })
  await openEditor(page)

  await areaCard(page, 'Ankara').click()
  await editor(page).getByRole('button', { name: 'Alanı Sil' }).click()

  // Silme ONAY ister ve diyalog diğer alanların kalacağını SÖYLER.
  const dialog = page.getByRole('alertdialog', { name: 'Bu alan kaldırılsın mı?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('diğer 1 alanı olduğu gibi kalır', { exact: false })).toBeVisible()
  await dialog.getByRole('button', { name: 'Alanı Sil' }).click()

  await expect(editor(page).getByText('Coğrafi alan kaldırıldı.')).toBeVisible()

  expect(scopeMock.calls.delete).toEqual([1])
  await expect(areaCard(page, 'Kayseri')).toBeVisible()
  await expect(areaCard(page, 'Ankara')).toHaveCount(0)
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')
})

test('deleting the final direct area falls back to the role scope', async ({ page }) => {
  await openUser(page, {
    geo: { initial: [area('Ankara', ANKARA_WKT, { id: 1 })], inherited: ROLE_WKT },
  })
  await openEditor(page)

  await areaCard(page, 'Ankara').click()
  await editor(page).getByRole('button', { name: 'Alanı Sil' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByText('rollerinden gelen coğrafi alanlara düşer', { exact: false })).toBeVisible()
  await dialog.getByRole('button', { name: 'Alanı Sil' }).click()

  /* Kısıtsızlığa DEĞİL, rolün alanına düşülür ve o alan haritada kesikli
     referans olarak belirir. */
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '0')
  await expect(scopeMap(page)).toHaveAttribute('data-inherited-count', '1')
  await expect(editor(page).getByText('Etkin alan rol(ler) üzerinden geliyor', { exact: false })).toBeVisible()
})

/* --- İl / bölge seçimi -------------------------------------------------------- */

test('choosing a province previews its real boundary before saving', async ({ page }) => {
  const { scopeMock } = await openUser(page, { geo: { initial: [] } })
  await openEditor(page)

  await addButton(page).click()
  await editor(page).getByRole('button', { name: 'İl / Bölge Seç' }).click()
  await editor(page).getByLabel('İl seç').selectOption({ label: 'Ankara' })

  // Önizleme KAYDETMEDEN ÖNCE haritadadır.
  await expect(scopeMap(page)).toHaveAttribute('data-draft-count', '1')
  expect(scopeMock.calls.post).toHaveLength(0)

  await saveButton(page).click()

  expect(scopeMock.calls.post).toHaveLength(1)
  expect(scopeMock.calls.post[0].sourceType).toBe('Province')
  expect(scopeMock.calls.post[0].sourceKey).toBe('TR-06')

  /* Sınır UYDURULMAMIŞTIR: gerçek il verisinden gelir, dolayısıyla dört köşeli
     bir kutu değildir ve Ankara'nın gerçek koordinat aralığındadır. */
  const wkt = scopeMock.calls.post[0].wkt
  expect(wkt.split(',').length).toBeGreaterThan(20)
  const numbers = wkt.match(/-?\d+(\.\d+)?/g).map(Number)
  const lons = numbers.filter((_, index) => index % 2 === 0)
  const lats = numbers.filter((_, index) => index % 2 === 1)
  expect(Math.min(...lons)).toBeGreaterThan(30)
  expect(Math.max(...lons)).toBeLessThan(35)
  expect(Math.min(...lats)).toBeGreaterThan(38)
  expect(Math.max(...lats)).toBeLessThan(41.5)
})

test('the province search narrows the list', async ({ page }) => {
  await openUser(page, { geo: { initial: [] } })
  await openEditor(page)

  await addButton(page).click()
  await editor(page).getByRole('button', { name: 'İl / Bölge Seç' }).click()

  const select = editor(page).getByLabel('İl seç')
  // 81 il + "İl seçin…" seçeneği.
  await expect(select.locator('option')).toHaveCount(82)

  await editor(page).getByLabel('İl ara').fill('kayse')
  await expect(select.locator('option')).toHaveCount(2)
  await expect(select.locator('option').nth(1)).toHaveText('Kayseri')
})

test('a multi-part province is saved as several areas and no part is dropped', async ({ page }) => {
  const { scopeMock } = await openUser(page, { geo: { initial: [] } })
  await openEditor(page)

  await addButton(page).click()
  await editor(page).getByRole('button', { name: 'İl / Bölge Seç' }).click()
  // İstanbul boğazla ayrılmış ve adaları olan bir ildir.
  await editor(page).getByLabel('İl seç').selectOption({ label: 'İstanbul' })

  const parts = await scopeMap(page).getAttribute('data-draft-count')
  expect(Number(parts)).toBeGreaterThan(1)
  await expect(editor(page).getByText('ayrı parçadan oluşuyor', { exact: false })).toBeVisible()

  await saveButton(page).click()

  /* Her parça KENDİ alanı olur. Yalnızca en büyüğünü almak, o ilin adalarını
     sessizce kapsam dışında bırakmak olurdu. */
  await expect
    .poll(() => scopeMock.calls.post.length)
    .toBe(Number(parts))
  for (const call of scopeMock.calls.post) {
    expect(call.sourceType).toBe('Province')
    expect(call.sourceKey).toBe('TR-34')
  }
})

test('the region picker says out loud that its boundary is an approximation', async ({ page }) => {
  const { scopeMock } = await openUser(page, { geo: { initial: [] } })
  await openEditor(page)

  await addButton(page).click()
  await editor(page).getByRole('button', { name: 'İl / Bölge Seç' }).click()
  await editor(page).getByRole('button', { name: 'Coğrafi Bölge' }).click()

  /* Yaklaşıklık seçim yapılmadan ÖNCE söylenir. Resmî coğrafi bölge sınırları
     il sınırlarını birebir takip etmez; bunu gizlemek, yöneticinin yanlış
     sandığı bir kapsamla yetki vermesi olurdu. */
  await expect(editor(page).getByText('yaklaşık bölge kapsamı', { exact: false })).toBeVisible()

  await editor(page).getByLabel('Bölge seç').selectOption({ label: 'İç Anadolu' })
  await expect(scopeMap(page)).toHaveAttribute('data-draft-count', '1')

  await saveButton(page).click()
  expect(scopeMock.calls.post[0].sourceType).toBe('Region')
  expect(scopeMock.calls.post[0].sourceKey).toBe('IC_ANADOLU')
})

/* --- Koordinat girişi --------------------------------------------------------- */

test('typed coordinates preview and save as a closed polygon', async ({ page }) => {
  const { scopeMock } = await openUser(page, { geo: { initial: [] } })
  await openEditor(page)

  await addButton(page).click()
  await editor(page).getByRole('button', { name: 'Koordinat Gir' }).click()
  await editor(page).getByLabel('Köşe koordinatları').fill('32.85, 39.92\n33.20, 39.50\n32.40, 38.90')

  await expect(scopeMap(page)).toHaveAttribute('data-draft-count', '1')

  await editor(page).getByLabel('Alan adı').fill('Elle Girilen')
  await saveButton(page).click()

  expect(scopeMock.calls.post).toHaveLength(1)
  expect(scopeMock.calls.post[0].sourceType).toBe('Coordinates')
  // Halka OTOMATİK kapanır: ilk köşe sonda tekrar eder.
  expect(scopeMock.calls.post[0].wkt).toBe(
    'POLYGON ((32.85 39.92, 33.2 39.5, 32.4 38.9, 32.85 39.92))',
  )
})

test('too few vertices are refused before any request is made', async ({ page }) => {
  const { scopeMock } = await openUser(page, { geo: { initial: [] } })
  await openEditor(page)

  await addButton(page).click()
  await editor(page).getByRole('button', { name: 'Koordinat Gir' }).click()
  await editor(page).getByLabel('Köşe koordinatları').fill('32.85, 39.92\n33.20, 39.50')

  await expect(editor(page).getByRole('alert')).toContainText('en az 3 farklı köşe gerekir')
  await expect(saveButton(page)).toBeDisabled()
  expect(scopeMock.calls.post).toHaveLength(0)
})

test('metric coordinates are refused rather than silently treated as lon/lat', async ({ page }) => {
  const { scopeMock } = await openUser(page, { geo: { initial: [] } })
  await openEditor(page)

  await addButton(page).click()
  await editor(page).getByRole('button', { name: 'Koordinat Gir' }).click()
  // EPSG:3857 metre değerleri.
  await editor(page).getByLabel('Köşe koordinatları').fill('3561000, 4720000\n3672000, 4720000\n3672000, 4860000')

  /* Yardım metni de aralıkları anlatır; ölçülen şey HATA'dır, bu yüzden
     `alert` rolüyle aranır. */
  await expect(editor(page).getByRole('alert')).toContainText('aralığında olmalı')
  await expect(saveButton(page)).toBeDisabled()
  expect(scopeMock.calls.post).toHaveLength(0)
})

/* --- Rol hedefi ---------------------------------------------------------------- */

test('a role can hold several areas too', async ({ page }) => {
  const { scopeMock } = await openRole(page, {
    geo: { initial: [area('Ankara', ANKARA_WKT, { id: 1 }), area('Kayseri', KAYSERI_WKT, { id: 2 })] },
  })
  await openEditor(page)

  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '2')
  // Rol hedefinde miras KAVRAMI YOKTUR: kesikli referans katmanı boş kalır.
  await expect(scopeMap(page)).toHaveAttribute('data-inherited-count', '0')

  await addButton(page).click()
  await drawPolygon(page)
  await saveButton(page).click()

  expect(scopeMock.calls.post).toHaveLength(1)
  expect(scopeMock.calls.delete).toHaveLength(0)
})

/* --- Yükleme hatası ------------------------------------------------------------ */

test('a failed load is not shown as "no restriction"', async ({ page }) => {
  await openUser(page, { geo: { initial: [], getStatus: 500 } })
  await entryButton(page).click()

  /* Yüklenemeyen alanlar için boş bir harita çizmek, var olan bir sınırı
     yokmuş gibi göstermek olurdu. */
  await expect(editor(page).getByText('Coğrafi yetki alanları okunamadı.')).toBeVisible()
  await expect(editor(page).getByRole('button', { name: 'Tekrar dene' })).toBeVisible()
  await expect(scopeMap(page)).toHaveCount(0)
})

/* --- Kaydedilmemiş taslak -------------------------------------------------------- */

test('closing with an unsaved draft asks first', async ({ page }) => {
  const { scopeMock } = await openUser(page, {
    geo: { initial: [area('Ankara', ANKARA_WKT, { id: 1 })] },
  })
  await openEditor(page)

  await addButton(page).click()
  await drawPolygon(page)

  await editor(page).getByRole('button', { name: 'Coğrafi yetki penceresini kapat' }).click()

  const dialog = page.getByRole('alertdialog', { name: 'Kaydedilmemiş coğrafi alan değişiklikleri var' })
  await expect(dialog).toBeVisible()
  // Kayıtlı alanların etkilenmediği AÇIKÇA söylenir.
  await expect(dialog.getByText('kayıtlı alanlara dokunulmaz', { exact: false })).toBeVisible()

  await dialog.getByRole('button', { name: 'Düzenlemeye Dön' }).click()
  await expect(editor(page)).toBeVisible()
  expect(scopeMock.calls.post).toHaveLength(0)
})

test('cancelling a draft restores the saved areas untouched', async ({ page }) => {
  const { scopeMock } = await openUser(page, {
    geo: { initial: [area('Ankara', ANKARA_WKT, { id: 1 })] },
  })
  await openEditor(page)

  await addButton(page).click()
  await drawPolygon(page)
  await expect(scopeMap(page)).toHaveAttribute('data-draft-count', '1')

  await editor(page).getByRole('button', { name: 'Taslağı İptal Et' }).click()

  await expect(scopeMap(page)).toHaveAttribute('data-draft-count', '0')
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')
  expect(scopeMock.calls.post).toHaveLength(0)
  expect(scopeMock.calls.delete).toHaveLength(0)
})

/* --- Canlı yetki ---------------------------------------------------------------- */

test('losing geography.manage live turns the open editor read-only without a re-login', async ({ page }) => {
  /* Gerçek senaryo: yönetici düzenleyiciyi açıkken bir başkası onun coğrafi
     yönetim yetkisini kaldırır. Sunucu bir sonraki yazmaya 403 döner; Phase 7
     altyapısı bunu yetkileri BİR kez tazelemek için kullanır ve arayüz yeniden
     giriş yapılmadan yetişir. Yetki kümesini sunucuda değiştirmek TEK BAŞINA
     yetmez ve yetmemelidir: tarayıcı her tuş vuruşunda yetki sorgulamaz. */
  const { control } = await openUser(page, {
    geo: {
      initial: [area('Ankara', ANKARA_WKT, { id: 1 })],
      onPost: (route) => route.fulfill(json({ message: 'Bu işlem için yetkiniz bulunmuyor.' }, 403)),
    },
  })
  const panel = await openEditor(page)
  await expect(addButton(page)).toBeVisible()

  // Sunucu tarafında yetki kaldırıldı; tarayıcı bunu henüz bilmiyor.
  control.set(without('geography.manage'))

  await addButton(page).click()
  await drawPolygon(page)
  await saveButton(page).click()

  /* Reddedilen kaydetmeden sonra arayüz yetişir: düzenleme kontrolleri
     kaybolur ve durum açıkça salt okunur olur. */
  await expect(panel.getByText('Coğrafi alanlar yalnızca görüntüleniyor.', { exact: false })).toBeVisible()
  await expect(saveButton(page)).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Yeni Alan Ekle' })).toHaveCount(0)

  // Kayıtlı alan hâlâ GÖRÜNÜR: okuma yetkisi duruyor.
  await expect(areaCard(page, 'Ankara')).toBeVisible()

  // Oturum KAPANMAZ: 403 bir kimlik sorunu değildir.
  await expect(page).toHaveURL(/\/admin\/users/)
  await expect(editor(page)).toBeVisible()
})

test('losing geography.view live hides the areas without a re-login', async ({ page }) => {
  const { control } = await openUser(page, {
    geo: {
      initial: [area('Ankara', ANKARA_WKT, { id: 1 })],
      onPost: (route) => route.fulfill(json({ message: 'Bu işlem için yetkiniz bulunmuyor.' }, 403)),
    },
  })
  await openEditor(page)

  control.set(without('geography.view', 'geography.manage'))

  await addButton(page).click()
  await drawPolygon(page)
  await saveButton(page).click()

  /* Artık okunmasına izin verilmeyen bir veriyi ekranda tutmak olmaz: harita
     da alan listesi de düşer. */
  await expect(scopeMap(page)).toHaveCount(0)
  await expect(editor(page).getByText('Coğrafi yetkileri görüntüleme yetkiniz kaldırıldı.')).toBeVisible()
})
