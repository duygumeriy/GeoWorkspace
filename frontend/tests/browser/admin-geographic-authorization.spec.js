import { expect, test } from '@playwright/test'
import { ALL_PERMISSIONS, mockPermissions } from './permissions.js'

/**
 * Yönetim panelindeki coğrafi yetki düzenleyicisi (Phase 8B).
 *
 * Ekran bir YÖNETİM arayüzüdür, bir güvenlik sınırı değildir: buradaki her
 * kural backend'in `users.view`/`users.update`, `roles.view`/`roles.update` ve
 * `geography.view`/`geography.manage` kapılarını YANSITIR, onların yerine
 * geçmez. Testler de bunu böyle ölçer — bir düğmenin gizlenmesi yetkinin
 * kalktığını kanıtlamaz, yalnızca arayüzün yapılamayacak bir işi teklif
 * etmediğini gösterir.
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

/** Ankara çevresinde ~1°'lik bir kare — kullanıcıya özel alan. */
const ANKARA_WKT = 'POLYGON ((32.5 39.5, 33.5 39.5, 33.5 40.5, 32.5 40.5, 32.5 39.5))'
const ANKARA_RING = [[32.5, 39.5], [33.5, 39.5], [33.5, 40.5], [32.5, 40.5], [32.5, 39.5]]

/** İç Anadolu'yu kapsayan daha geniş bir alan — rolden miras kalan alan. */
const ROLE_WKT = 'POLYGON ((30 37, 38 37, 38 41, 30 41, 30 37))'

/** Sunucu cevabının dört alanı; Phase 8A sözleşmesinin birebir kopyası. */
const scope = ({ wkt = null, effectiveWkt = undefined, restricted = undefined } = {}) => ({
  hasDirectAuthorization: wkt !== null,
  wkt,
  isRestricted: restricted ?? (effectiveWkt !== undefined ? effectiveWkt !== null : wkt !== null),
  effectiveWkt: effectiveWkt === undefined ? wkt : effectiveWkt,
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
 * Coğrafi yetki uçlarını taklit eder ve yapılan çağrıları kaydeder.
 *
 * Sunucu DURUMLUDUR: PUT ve DELETE, sonraki okumaların döneceği cevabı da
 * değiştirir. Phase 8A uçları zaten güncel durumu geri döndürür, ve ekranın
 * "kendi gönderdiğini başarılı saymak yerine sunucunun cevabını temel al"
 * davranışı ancak böyle ölçülebilir.
 */
async function mockScope(page, { targetType, targetId, initial, onPut, onDelete, getStatus }) {
  const calls = { get: 0, put: [], delete: 0 }
  const state = { current: initial }
  const path = `**/api/admin/${targetType === 'user' ? 'users' : 'roles'}/${targetId}/geographic-authorization`

  await page.route(path, async (route) => {
    const method = route.request().method()

    if (method === 'PUT') {
      calls.put.push(JSON.parse(route.request().postData() || '{}'))
      if (onPut) return onPut(route, calls)
      state.current = scope({ wkt: calls.put.at(-1).wkt })
      return route.fulfill(json(state.current))
    }

    if (method === 'DELETE') {
      calls.delete += 1
      if (onDelete) return onDelete(route, calls)
      state.current = scope({ wkt: null, effectiveWkt: null })
      return route.fulfill(json(state.current))
    }

    calls.get += 1
    if (getStatus && getStatus !== 200) {
      return route.fulfill(json({ message: 'Coğrafi yetki alanı okunamadı.' }, getStatus))
    }
    return route.fulfill(json(state.current))
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
  const scopeMock = geo ? await mockScope(page, { targetType: 'user', targetId: USER.id, ...geo }) : null
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
  const scopeMock = geo ? await mockScope(page, { targetType: 'role', targetId: ROLE.id, ...geo }) : null
  await page.route('**/api/admin/roles', (route) => route.fulfill(json([ROLE])))

  await page.goto('/admin/roles')
  await page.getByRole('button', { name: `${ROLE.name} rolünün detayını aç` }).click()
  await expect(page.getByRole('heading', { name: ROLE.name, level: 2 })).toBeVisible()
  return { control, scopeMock }
}

const entryButton = (page) => page.getByRole('button', { name: 'Coğrafi Yetki', exact: true })
const editor = (page) => page.getByRole('dialog', { name: /^Coğrafi Yetki —/ })
const scopeMap = (page) => page.getByTestId('geographic-scope-map')
const saveButton = (page) => page.getByRole('button', { name: 'Coğrafi Yetkiyi Kaydet' })

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
  const box = await scopeMap(page).boundingBox()
  const at = ([fx, fy]) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })

  for (const point of points) {
    const { x, y } = at(point)
    await page.mouse.click(x, y)
  }
  const last = at([points[0][0], points[points.length - 1][1]])
  await page.mouse.dblclick(last.x, last.y)
}

/* --- Kullanıcı: giriş noktasının görünürlüğü -------------------------------- */

test('a user without geography.view is never offered the geographic action', async ({ page }) => {
  await openUser(page, { permissions: without('geography.view') })

  /* Düğme DEVRE DIŞI değil, HİÇ YOK. Ödevin kuralı budur: yetkisi olmayana
     düğmeyi göstermemek. Devre dışı bir düğme, var olmayan bir yolu
     duyurmaya devam ederdi. */
  await expect(entryButton(page)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Coğrafi Yetki', level: 3 })).toHaveCount(0)
})

test('geography.view alone is enough to reach the user geographic editor', async ({ page }) => {
  await openUser(page, {
    permissions: without('geography.manage'),
    geo: { initial: scope({ wkt: null, effectiveWkt: null }) },
  })

  await expect(entryButton(page)).toBeVisible()
  await openEditor(page)
})

/* --- Kullanıcı: salt okunur kapılar ----------------------------------------- */

test('without geography.manage the user editor opens read-only', async ({ page }) => {
  await openUser(page, {
    permissions: without('geography.manage'),
    geo: { initial: scope({ wkt: ANKARA_WKT }) },
  })
  const panel = await openEditor(page)

  await expect(panel.getByText('Coğrafi alan yalnızca görüntüleniyor.', { exact: false })).toBeVisible()
  /* Düzenleme kontrolleri devre dışı DEĞİL, hiç çizilmez. */
  for (const name of ['Poligon Çiz', 'Alanı Düzenle', 'Yeniden Çiz', 'Coğrafi Yetkiyi Kaydet', 'Coğrafi Yetkiyi Kaldır']) {
    await expect(panel.getByRole('button', { name })).toHaveCount(0)
  }
  // Ama alan GÖRÜNÜR: okuma yetkisi okumayı gerçekten açar.
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')
})

test('geography.manage without users.update still leaves the user editor read-only', async ({ page }) => {
  /* Uç İKİ yetki birden arar. Yalnızca coğrafi yönetimi olan biri kullanıcıya
     dokunamaz — aksi hâlde coğrafi yetki, kullanıcı düzenleme yetkisinin
     arka kapısı olurdu. */
  await openUser(page, {
    permissions: without('users.update'),
    geo: { initial: scope({ wkt: ANKARA_WKT }) },
  })
  const panel = await openEditor(page)

  await expect(panel.getByText('Coğrafi alan yalnızca görüntüleniyor.', { exact: false })).toBeVisible()
  await expect(saveButton(page)).toHaveCount(0)
})

test('users.update together with geography.manage makes the user editor editable', async ({ page }) => {
  await openUser(page, { geo: { initial: scope({ wkt: ANKARA_WKT }) } })
  const panel = await openEditor(page)

  await expect(panel.getByRole('button', { name: 'Alanı Düzenle' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Yeniden Çiz' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Coğrafi Yetkiyi Kaldır' })).toBeVisible()
  // Hiçbir şey değişmeden kaydetme KAPALI: boş bir PUT, olmayan bir işi yapardı.
  await expect(saveButton(page)).toBeDisabled()
})

/* --- Kullanıcı: üç coğrafi durum -------------------------------------------- */

test('a user with neither a direct nor an inherited area is shown as unrestricted', async ({ page }) => {
  await openUser(page, { geo: { initial: scope({ wkt: null, effectiveWkt: null }) } })
  const panel = await openEditor(page)

  await expect(panel.getByText('Bu kullanıcı için coğrafi kısıtlama bulunmuyor.', { exact: false })).toBeVisible()
  await expect(panel.getByText('coğrafi olarak sınırsızdır', { exact: false })).toBeVisible()
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '0')
  await expect(scopeMap(page)).toHaveAttribute('data-inherited-count', '0')
  // Alan yokken tek teklif çizmektir.
  await expect(panel.getByRole('button', { name: 'Poligon Çiz' })).toBeVisible()
})

test('an area inherited from roles is shown as reference, not as the user own area', async ({ page }) => {
  await openUser(page, {
    geo: { initial: scope({ wkt: null, effectiveWkt: ROLE_WKT, restricted: true }) },
  })
  const panel = await openEditor(page)

  await expect(panel.getByText('Etkin alan rol(ler) üzerinden geliyor.', { exact: false })).toBeVisible()

  /* Miras alınan alan DÜZENLENEBİLİR kaynağa yüklenmez. Yüklenseydi, yönetici
     onu kullanıcının kendi alanı sanır, bir köşesini oynatıp kaydeder ve
     farkında olmadan rol mirasını kalıcı bir kullanıcı alanına çevirirdi. */
  await expect(scopeMap(page)).toHaveAttribute('data-inherited-count', '1')
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '0')

  // Efsane renge değil metne dayanır.
  await expect(panel.getByText('Rol üzerinden etkin alan (salt okunur)')).toBeVisible()
  // Kaldırılacak doğrudan bir alan yok.
  await expect(panel.getByRole('button', { name: 'Coğrafi Yetkiyi Kaldır' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Kullanıcıya Özel Alan Çiz' })).toBeVisible()
})

test('a direct user area is loaded as the editable geometry', async ({ page }) => {
  await openUser(page, { geo: { initial: scope({ wkt: ANKARA_WKT }) } })
  const panel = await openEditor(page)

  await expect(panel.getByText('doğrudan bir coğrafi alan tanımlı', { exact: false })).toBeVisible()
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')
  /* Doğrudan alan varken roller HİÇ okunmaz (Phase 8A). Ekranda ikinci bir
     referans alanı göstermek, birleşim varmış izlenimi verirdi. */
  await expect(scopeMap(page)).toHaveAttribute('data-inherited-count', '0')
})

test('drawing over an inherited area warns that it replaces the role geography', async ({ page }) => {
  await openUser(page, {
    geo: { initial: scope({ wkt: null, effectiveWkt: ROLE_WKT, restricted: true }) },
  })
  const panel = await openEditor(page)

  await panel.getByRole('button', { name: 'Kullanıcıya Özel Alan Çiz' }).click()
  await drawPolygon(page)

  /* Öncelik kuralı KAYDETMEDEN ÖNCE söylenir: Phase 8A'da kullanıcıya özel
     alan rollerle birleşmez, onların yerine geçer. */
  await expect(panel.getByText('rol bazlı coğrafi alanların yerine geçer', { exact: false })).toBeVisible()
})

/* --- Projeksiyon ------------------------------------------------------------ */

test('a loaded area is saved back as longitude/latitude, not as Web Mercator metres', async ({ page }) => {
  /* Bu testin varlık sebebi tek bir hata sınıfıdır: haritanın çalıştığı
     EPSG:3857 metre değerlerini boylam/enlem sanıp göndermek. O hata sessizdir
     — istek başarıyla gider, ama alan Gine Körfezi'nin binlerce kilometre
     ötesine düşer. Bu yüzden "PUT atıldı" demek yetmez; koordinatların
     KENDİSİ sınanır. */
  const { scopeMock } = await openUser(page, { geo: { initial: scope({ wkt: ANKARA_WKT }) } })
  const panel = await openEditor(page)

  /* Alan, var olan bir poligonun üzerine yeniden çizilir. Böylece haritada
     GERÇEKTEN piksel koordinatlarından üretilmiş bir geometri gönderilir —
     sunucudan gelen dizgenin geri yankılanması değil. Dönüşüm hatası ancak
     böyle görünür hâle gelir. */
  await panel.getByRole('button', { name: 'Yeniden Çiz' }).click()
  await drawPolygon(page)
  await expect(saveButton(page)).toBeEnabled()
  await saveButton(page).click()
  await expect(panel.getByText('Coğrafi yetki alanı güncellendi.')).toBeVisible()

  expect(scopeMock.calls.put).toHaveLength(1)
  const sent = scopeMock.calls.put[0].wkt
  expect(sent).toMatch(/^POLYGON\s*\(\(/)

  const coordinates = [...sent.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)]
    .map(([, lon, lat]) => [Number(lon), Number(lat)])
  expect(coordinates.length).toBeGreaterThanOrEqual(4)

  for (const [lon, lat] of coordinates) {
    /* Derece aralığı. Web Mercator metreleri burada milyonlar mertebesinde
       olurdu ve bu sınırı anında aşardı. */
    expect(Math.abs(lon)).toBeLessThanOrEqual(180)
    expect(Math.abs(lat)).toBeLessThanOrEqual(90)
    // Ve alan gerçekten Türkiye'nin görünen penceresinde çizildi.
    expect(lon).toBeGreaterThan(20)
    expect(lon).toBeLessThan(50)
    expect(lat).toBeGreaterThan(33)
    expect(lat).toBeLessThan(45)
  }
})

test('an untouched area round-trips through the map without moving', async ({ page }) => {
  /* 4326 → 3857 → 4326 gidiş dönüşü koordinatları DEĞİŞTİRMEMELİDİR. Bir
     kayma olsaydı, alanı yalnızca açıp kaydeden bir yönetici sınırı sessizce
     oynatırdı. Kayan nokta toleransı bırakılır; eşitlik aranmaz. */
  await openUser(page, { geo: { initial: scope({ wkt: ANKARA_WKT }) } })
  await openEditor(page)

  const roundTripped = await page.evaluate(async ({ wkt }) => {
    const { wkt4326ToFeature, geometryToWkt4326 } = await import('/src/map/drawing.js')
    return geometryToWkt4326(wkt4326ToFeature(wkt).getGeometry())
  }, { wkt: ANKARA_WKT })

  const coordinates = [...roundTripped.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)]
    .map(([, lon, lat]) => [Number(lon), Number(lat)])

  expect(coordinates).toHaveLength(ANKARA_RING.length)
  coordinates.forEach(([lon, lat], index) => {
    expect(lon).toBeCloseTo(ANKARA_RING[index][0], 6)
    expect(lat).toBeCloseTo(ANKARA_RING[index][1], 6)
  })
})

/* --- Türkiye görünümü ------------------------------------------------------- */

test('an empty target opens the map focused on Turkey', async ({ page }) => {
  await openUser(page, { geo: { initial: scope({ wkt: null, effectiveWkt: null }) } })
  await openEditor(page)

  const map = scopeMap(page)
  /* Kırılgan piksel değeri değil, COĞRAFİ durum sınanır: kamera Türkiye'nin
     üzerinde ve ülkeyi görecek kadar geniş bir yakınlaştırmada olmalı. */
  await expect(map).toHaveAttribute('data-center-lon', /.+/)
  const lon = Number(await map.getAttribute('data-center-lon'))
  const lat = Number(await map.getAttribute('data-center-lat'))
  const zoom = Number(await map.getAttribute('data-zoom'))

  expect(lon).toBeGreaterThan(25)
  expect(lon).toBeLessThan(45)
  expect(lat).toBeGreaterThan(35)
  expect(lat).toBeLessThan(43)
  // Ülke ölçeği: bir şehre dalmış ya da dünyayı gösteren bir görünüm değil.
  expect(zoom).toBeGreaterThan(4)
  expect(zoom).toBeLessThan(9)
})

test('an existing area is fitted instead of falling back to the Turkey view', async ({ page }) => {
  await openUser(page, { geo: { initial: scope({ wkt: ANKARA_WKT }) } })
  await openEditor(page)

  const map = scopeMap(page)
  const lon = Number(await map.getAttribute('data-center-lon'))
  const lat = Number(await map.getAttribute('data-center-lat'))
  const zoom = Number(await map.getAttribute('data-zoom'))

  // Kamera poligonun merkezine gelir (33.0, ~40.0), ülke merkezine değil.
  expect(lon).toBeCloseTo(33, 0)
  expect(lat).toBeCloseTo(40, 0)
  // Ve var olan alana sığdırmak, ülke görünümünden daha yakındır.
  expect(zoom).toBeGreaterThan(6)
})

/* --- Tek poligon kuralı ----------------------------------------------------- */

test('redrawing replaces the working area instead of adding a second one', async ({ page }) => {
  const { scopeMock } = await openUser(page, { geo: { initial: scope({ wkt: ANKARA_WKT }) } })
  const panel = await openEditor(page)
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')

  /* "Yeniden Çiz" YEREL geometriyi boşaltır — sunucudaki alanı SİLMEZ.
     Silseydi, vazgeçilebilir bir düzenleme kalıcı bir veri kaybına dönerdi. */
  await panel.getByRole('button', { name: 'Yeniden Çiz' }).click()
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '0')
  expect(scopeMock.calls.delete).toBe(0)

  await drawPolygon(page)
  // Bir çizim bitti: kaynakta hâlâ TEK alan var, ikincisi eklenmedi.
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')

  // Ve yeniden çizmek yine tek alan bırakır.
  await panel.getByRole('button', { name: 'Yeniden Çiz' }).click()
  await drawPolygon(page, [[0.4, 0.4], [0.7, 0.4], [0.7, 0.7]])
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')

  await saveButton(page).click()
  await expect(panel.getByText('Coğrafi yetki alanı güncellendi.')).toBeVisible()
  expect(scopeMock.calls.put).toHaveLength(1)
  // Gönderilen gövde tek bir Polygon'dur; MultiPolygon değil.
  expect(scopeMock.calls.put[0].wkt).toMatch(/^POLYGON\s*\(\(/)
  expect(scopeMock.calls.put[0].wkt).not.toMatch(/MULTIPOLYGON/i)
})

/* --- Kaydetme --------------------------------------------------------------- */

test('drawing and saving sends exactly one PUT and adopts the server answer', async ({ page }) => {
  const { scopeMock } = await openUser(page, { geo: { initial: scope({ wkt: null, effectiveWkt: null }) } })
  const panel = await openEditor(page)

  await panel.getByRole('button', { name: 'Poligon Çiz' }).click()
  await drawPolygon(page)
  await expect(saveButton(page)).toBeEnabled()

  await saveButton(page).click()
  await expect(panel.getByText('Coğrafi yetki alanı güncellendi.')).toBeVisible()

  expect(scopeMock.calls.put).toHaveLength(1)
  /* Kaydetmeden sonra temel SUNUCUNUN cevabıdır: yeniden kirli görünmez ve
     pencere açık kalır. */
  await expect(saveButton(page)).toBeDisabled()
  await expect(editor(page)).toBeVisible()
  // Alan artık doğrudan tanımlıdır, dolayısıyla kaldırma da sunulur.
  await expect(panel.getByRole('button', { name: 'Coğrafi Yetkiyi Kaldır' })).toBeVisible()
})

test('a rejected save keeps the drawn area, the dirty state and the session', async ({ page }) => {
  const { scopeMock } = await openUser(page, {
    geo: {
      initial: scope({ wkt: null, effectiveWkt: null }),
      onPut: (route) => route.fulfill(json({ message: 'Bu işlem için yetkiniz bulunmuyor.' }, 403)),
    },
  })
  const panel = await openEditor(page)

  await panel.getByRole('button', { name: 'Poligon Çiz' }).click()
  await drawPolygon(page)
  await saveButton(page).click()

  await expect(panel.getByText('Bu coğrafi yetkiyi değiştirme yetkiniz bulunmuyor.')).toBeVisible()
  /* 403 bir OTURUM sorunu değildir: çizim ekranda kalır, yeniden denenebilir
     ve kullanıcı giriş ekranına atılmaz. */
  await expect(page).toHaveURL(/\/admin\/users/)
  await expect(editor(page)).toBeVisible()
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')
  await expect(saveButton(page)).toBeEnabled()
  expect(scopeMock.calls.put).toHaveLength(1)
})

test('a rejected geometry shows the server validation message', async ({ page }) => {
  await openUser(page, {
    geo: {
      initial: scope({ wkt: null, effectiveWkt: null }),
      onPut: (route) => route.fulfill(json({ message: 'Geometri kendisiyle kesişiyor.' }, 400)),
    },
  })
  const panel = await openEditor(page)

  await panel.getByRole('button', { name: 'Poligon Çiz' }).click()
  await drawPolygon(page)
  await saveButton(page).click()

  // Doğrulama bir yetki sorunu değildir ve öyle anlatılmaz.
  await expect(panel.getByText('Geometri kendisiyle kesişiyor.')).toBeVisible()
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')
})

/* --- Kaldırma --------------------------------------------------------------- */

test('removing a direct user area asks first and then falls back to the role area', async ({ page }) => {
  const { scopeMock } = await openUser(page, {
    geo: {
      initial: scope({ wkt: ANKARA_WKT }),
      /* Sunucu, silme sonrası YÜRÜRLÜKTEKİ durumu döndürür: kullanıcının
         kendi alanı gitti, ama rolünden gelen alan devreye girdi. */
      onDelete: (route, calls) => {
        calls.fellBack = true
        return route.fulfill(json(scope({ wkt: null, effectiveWkt: ROLE_WKT, restricted: true })))
      },
    },
  })
  const panel = await openEditor(page)

  await panel.getByRole('button', { name: 'Coğrafi Yetkiyi Kaldır' }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Coğrafi yetki kaldırılsın mı?' })
  await expect(confirmation).toBeVisible()

  // Vazgeçmek hiçbir istek açmaz.
  await confirmation.getByRole('button', { name: 'İptal' }).click()
  expect(scopeMock.calls.delete).toBe(0)

  await panel.getByRole('button', { name: 'Coğrafi Yetkiyi Kaldır' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Coğrafi Yetkiyi Kaldır' }).click()

  expect(scopeMock.calls.delete).toBe(1)
  /* Kaldırma sonrası ekran, kullanıcının SINIRSIZ olduğunu varsaymaz: sunucunun
     cevabı okunur ve rolden gelen alan referans olarak görünür. */
  await expect(panel.getByText('Etkin alan rol(ler) üzerinden geliyor.', { exact: false })).toBeVisible()
  await expect(scopeMap(page)).toHaveAttribute('data-inherited-count', '1')
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '0')
})

/* --- Kirli durum ve kapatma ------------------------------------------------- */

test('closing with unsaved changes is confirmed and can be cancelled', async ({ page }) => {
  const { scopeMock } = await openUser(page, { geo: { initial: scope({ wkt: null, effectiveWkt: null }) } })
  const panel = await openEditor(page)

  await panel.getByRole('button', { name: 'Poligon Çiz' }).click()
  await drawPolygon(page)

  await panel.getByRole('button', { name: 'Coğrafi yetki penceresini kapat' }).click()
  const confirmation = page.getByRole('alertdialog', { name: 'Kaydedilmemiş coğrafi alan değişiklikleri var' })
  await expect(confirmation).toBeVisible()

  await confirmation.getByRole('button', { name: 'Düzenlemeye Dön' }).click()
  await expect(editor(page)).toBeVisible()
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')

  await panel.getByRole('button', { name: 'Coğrafi yetki penceresini kapat' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Değişiklikleri Yoksay' }).click()
  await expect(editor(page)).toHaveCount(0)

  // Hiçbir şey kaydedilmedi.
  expect(scopeMock.calls.put).toHaveLength(0)
})

test('Escape does not slip past the unsaved guard or close the user drawer with it', async ({ page }) => {
  await openUser(page, { geo: { initial: scope({ wkt: null, effectiveWkt: null }) } })
  const panel = await openEditor(page)

  await panel.getByRole('button', { name: 'Poligon Çiz' }).click()
  await drawPolygon(page)

  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog', { name: 'Kaydedilmemiş coğrafi alan değişiklikleri var' })).toBeVisible()
  /* Tek bir Escape iki katmanı birden kapatamaz: arkadaki kullanıcı çekmecesi
     yerinde durur, yoksa onay penceresi kapanan bir ekranın üstünde kalırdı.
     Başlık TAM eşleşmeyle aranır: düzenleyicinin kendi başlığı da kullanıcı
     adını taşır ("Coğrafi Yetki — ..."). */
  await expect(page.getByRole('heading', { name: USER.username, level: 2, exact: true })).toBeVisible()

  // Escape onayı geri alır; düzenleyici açık kalır.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  await expect(editor(page)).toBeVisible()
})

test('closing a clean editor needs no confirmation', async ({ page }) => {
  await openUser(page, { geo: { initial: scope({ wkt: ANKARA_WKT }) } })
  const panel = await openEditor(page)

  await panel.getByRole('button', { name: 'Coğrafi yetki penceresini kapat' }).click()
  await expect(editor(page)).toHaveCount(0)
  await expect(page.getByRole('alertdialog')).toHaveCount(0)
  // Arkadaki kullanıcı detayı açık kalır.
  await expect(page.getByRole('heading', { name: USER.username, level: 2, exact: true })).toBeVisible()
})

/* --- Yükleme ve hata -------------------------------------------------------- */

test('a failed read shows an error with retry, never an unrestricted map', async ({ page }) => {
  const { scopeMock } = await openUser(page, {
    geo: { initial: scope({ wkt: ANKARA_WKT }), getStatus: 500 },
  })

  await entryButton(page).click()
  const panel = editor(page)
  await expect(panel.getByText('Coğrafi yetki alanı okunamadı.')).toBeVisible()

  /* Okunamayan bir alan "kısıt yok" DEĞİLDİR. Boş bir Türkiye haritası
     çizmek, var olan bir sınırı yokmuş gibi göstermek olurdu. */
  await expect(panel.getByText('coğrafi kısıtlama bulunmuyor', { exact: false })).toHaveCount(0)
  await expect(scopeMap(page)).toHaveCount(0)
  await expect(saveButton(page)).toHaveCount(0)

  const before = scopeMock.calls.get
  await panel.getByRole('button', { name: 'Tekrar dene' }).click()
  expect(scopeMock.calls.get).toBeGreaterThan(before)
})

/* --- Canlı yetki değişimi --------------------------------------------------- */

test('losing geography.manage live turns the open editor read-only without a re-login', async ({ page }) => {
  /* Gerçek senaryo: yönetici düzenleyiciyi açıkken bir başkası onun coğrafi
     yönetim yetkisini kaldırır. Sunucu bir sonraki yazmaya 403 döner; Phase
     7 altyapısı bunu yetkileri BİR kez tazelemek için kullanır ve arayüz
     yeniden giriş yapılmadan yetişir. */
  const { control } = await openUser(page, {
    geo: {
      initial: scope({ wkt: ANKARA_WKT }),
      onPut: (route) => route.fulfill(json({ message: 'Bu işlem için yetkiniz bulunmuyor.' }, 403)),
    },
  })
  const panel = await openEditor(page)
  await expect(panel.getByRole('button', { name: 'Yeniden Çiz' })).toBeVisible()

  // Sunucu tarafında yetki kaldırıldı; tarayıcı bunu henüz bilmiyor.
  control.set(without('geography.manage'))

  await panel.getByRole('button', { name: 'Yeniden Çiz' }).click()
  await drawPolygon(page)
  await saveButton(page).click()

  /* Reddedilen kaydetmeden sonra arayüz yetişir: düzenleme kontrolleri
     kaybolur, kaydetme sunulmaz ve durum açıkça salt okunur olur. */
  await expect(panel.getByText('Coğrafi alan yalnızca görüntüleniyor.', { exact: false })).toBeVisible()
  await expect(saveButton(page)).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Yeniden Çiz' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Coğrafi Yetkiyi Kaldır' })).toHaveCount(0)

  // Oturum KAPANMAZ: 403 bir kimlik sorunu değildir.
  await expect(page).toHaveURL(/\/admin\/users/)
  await expect(editor(page)).toBeVisible()
})

test('regaining geography.manage live restores the editing controls without a re-login', async ({ page }) => {
  /* Yetkiler JWT'den okunsaydı, geri verilen bir yetki ancak yeni bir oturumla
     işe yarardı. Phase 7 kümesi canlıdır: aynı token'la, sıradan bir yönetici
     işleminin tetiklediği tazeleme yeterlidir. */
  const { control } = await openUser(page, {
    permissions: without('geography.manage'),
    geo: { initial: scope({ wkt: ANKARA_WKT }) },
  })
  await page.route(`**/api/admin/users/${USER.id}/status`, (route) =>
    route.fulfill(json({ ...USER, isActive: false })))

  const panel = await openEditor(page)
  await expect(panel.getByText('Coğrafi alan yalnızca görüntüleniyor.', { exact: false })).toBeVisible()
  await expect(saveButton(page)).toHaveCount(0)

  // Temiz düzenleyici onay istemeden kapanır.
  await panel.getByRole('button', { name: 'Coğrafi yetki penceresini kapat' }).click()
  await expect(editor(page)).toHaveCount(0)

  // Sunucu tarafında yetki geri verildi.
  control.set(ALL_PERMISSIONS)

  /* Sıradan bir yönetici işlemi yetkileri tazeler (AdminPage her mutasyondan
     sonra `refreshPermissions()` çağırır) — token'a dokunulmaz. */
  await page.getByLabel('Hesap Durumu').selectOption('inactive')
  await page.getByRole('alertdialog').getByRole('button', { name: 'Hesabı Pasifleştir' }).click()
  await expect(page.getByText('Hesap pasifleştirildi.', { exact: false })).toBeVisible()

  await openEditor(page)
  await expect(saveButton(page)).toBeVisible()
  await expect(editor(page).getByRole('button', { name: 'Yeniden Çiz' })).toBeVisible()
})

/* --- Yaşam döngüsü ---------------------------------------------------------- */

test('opening and closing the editor repeatedly leaves exactly one map behind', async ({ page }) => {
  const { scopeMock } = await openUser(page, { geo: { initial: scope({ wkt: ANKARA_WKT }) } })
  const perRound = []

  for (let round = 0; round < 3; round += 1) {
    const before = scopeMock.calls.get
    await openEditor(page)
    await expect(scopeMap(page)).toHaveCount(1)
    await editor(page).getByRole('button', { name: 'Coğrafi yetki penceresini kapat' }).click()
    await expect(editor(page)).toHaveCount(0)
    /* Kapanan düzenleyici haritasını da GÖTÜRÜR. Bırakılan bir OpenLayers
       örneği, ikinci açılışta ikinci bir tuval ve ikinci bir dinleyici
       demekti. */
    await expect(scopeMap(page)).toHaveCount(0)
    await expect(page.locator('.ol-viewport')).toHaveCount(0)
    perRound.push(scopeMock.calls.get - before)
  }

  /* İstek sayısı açılış başına SABİTTİR — biriken bir dinleyici ya da geride
     kalan bir bileşen olsaydı her tur bir öncekinden fazla okurdu. Mutlak sayı
     kasten sınanmaz: geliştirme kipinde React.StrictMode etkileri bilerek iki
     kez çalıştırır ve bu bir sızıntı değildir. */
  expect(perRound[1]).toBe(perRound[0])
  expect(perRound[2]).toBe(perRound[0])
})

/* --- Rol hedefi ------------------------------------------------------------- */

test('a role without geography.view is never offered the geographic action', async ({ page }) => {
  await openRole(page, { permissions: without('geography.view') })
  await expect(entryButton(page)).toHaveCount(0)
})

test('a role with no area opens the Turkey view and offers a polygon', async ({ page }) => {
  await openRole(page, { geo: { initial: scope({ wkt: null, effectiveWkt: null }) } })
  const panel = await openEditor(page)

  await expect(panel.getByText('Bu rol için coğrafi yetki tanımlanmamış.')).toBeVisible()
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '0')
  await expect(panel.getByRole('button', { name: 'Poligon Çiz' })).toBeVisible()

  const lon = Number(await scopeMap(page).getAttribute('data-center-lon'))
  const lat = Number(await scopeMap(page).getAttribute('data-center-lat'))
  expect(lon).toBeGreaterThan(25)
  expect(lon).toBeLessThan(45)
  expect(lat).toBeGreaterThan(35)
  expect(lat).toBeLessThan(43)

  /* Rolde miras diye bir şey YOKTUR: bir rol başka bir yerden alan devralmaz,
     bu yüzden referans katmanı hiç kullanılmaz. */
  await expect(panel.getByText('Rol üzerinden etkin alan (salt okunur)')).toHaveCount(0)
})

test('an existing role area is loaded, fitted and editable', async ({ page }) => {
  await openRole(page, { geo: { initial: scope({ wkt: ROLE_WKT }) } })
  const panel = await openEditor(page)

  await expect(panel.getByText('Bu rol için bir coğrafi alan tanımlı.')).toBeVisible()
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')
  await expect(panel.getByText('Rol coğrafi alanı')).toBeVisible()

  // Kamera rolün alanına sığdırıldı (merkez ~34, ~39).
  expect(Number(await scopeMap(page).getAttribute('data-center-lon'))).toBeCloseTo(34, 0)
  expect(Number(await scopeMap(page).getAttribute('data-center-lat'))).toBeCloseTo(39, 0)

  await expect(panel.getByRole('button', { name: 'Alanı Düzenle' })).toBeVisible()
})

test('without geography.manage the role editor opens read-only', async ({ page }) => {
  await openRole(page, {
    permissions: without('geography.manage'),
    geo: { initial: scope({ wkt: ROLE_WKT }) },
  })
  const panel = await openEditor(page)

  await expect(panel.getByText('Coğrafi alan yalnızca görüntüleniyor.', { exact: false })).toBeVisible()
  await expect(saveButton(page)).toHaveCount(0)
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '1')
})

test('geography.manage without roles.update still leaves the role editor read-only', async ({ page }) => {
  await openRole(page, {
    permissions: without('roles.update'),
    geo: { initial: scope({ wkt: ROLE_WKT }) },
  })
  const panel = await openEditor(page)

  await expect(panel.getByText('Coğrafi alan yalnızca görüntüleniyor.', { exact: false })).toBeVisible()
  await expect(saveButton(page)).toHaveCount(0)
})

test('saving a role area sends the role endpoint exactly once', async ({ page }) => {
  const { scopeMock } = await openRole(page, { geo: { initial: scope({ wkt: null, effectiveWkt: null }) } })
  const panel = await openEditor(page)

  await panel.getByRole('button', { name: 'Poligon Çiz' }).click()
  await drawPolygon(page)
  await saveButton(page).click()

  await expect(panel.getByText('Coğrafi yetki alanı güncellendi.')).toBeVisible()
  expect(scopeMock.calls.put).toHaveLength(1)
  expect(scopeMock.calls.put[0].wkt).toMatch(/^POLYGON\s*\(\(/)
})

test('removing a role area confirms first and then refreshes from the server', async ({ page }) => {
  const { scopeMock } = await openRole(page, { geo: { initial: scope({ wkt: ROLE_WKT }) } })
  const panel = await openEditor(page)

  await panel.getByRole('button', { name: 'Coğrafi Yetkiyi Kaldır' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Coğrafi Yetkiyi Kaldır' }).click()

  expect(scopeMock.calls.delete).toBe(1)
  await expect(panel.getByText('Bu rol için coğrafi yetki tanımlanmamış.')).toBeVisible()
  await expect(scopeMap(page)).toHaveAttribute('data-area-count', '0')
  // Alan gitti: kaldırma teklifi de gitti.
  await expect(panel.getByRole('button', { name: 'Coğrafi Yetkiyi Kaldır' })).toHaveCount(0)
})

/* --- Duyarlı yerleşim ------------------------------------------------------- */

for (const [label, width, height] of [['masaüstü', 1440, 900], ['tablet', 768, 1024], ['telefon', 375, 720]]) {
  test(`the editor stays usable and free of sideways scroll at ${width}px (${label})`, async ({ page }) => {
    await page.setViewportSize({ width, height })
    await openUser(page, { geo: { initial: scope({ wkt: ANKARA_WKT }) } })
    const panel = await openEditor(page)

    // Belge yana kaymaz.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    // Harita gerçekten kullanılabilir bir alan kaplar.
    const box = await scopeMap(page).boundingBox()
    expect(box.width).toBeGreaterThan(240)
    expect(box.height).toBeGreaterThan(200)
    expect(box.width).toBeLessThanOrEqual(width)

    // Kapatma ve düzenleme kontrollerine ulaşılabilir.
    await expect(panel.getByRole('button', { name: 'Coğrafi yetki penceresini kapat' })).toBeVisible()
    await expect(saveButton(page)).toBeVisible()
    await expect(panel.getByRole('button', { name: 'Coğrafi Yetkiyi Kaldır' })).toBeVisible()

    /* "Görünür" yetmez: ana eylem GERÇEKTEN görünen alanda olmalı. DOM'da olup
       ekranın altına düşen bir kaydet düğmesi kaydırmadan bulunamaz — ve
       yalnızca `toBeVisible` arayan bir test bunu gizlerdi. */
    for (const name of ['Coğrafi Yetkiyi Kaydet', 'Coğrafi yetki penceresini kapat']) {
      const control = await panel.getByRole('button', { name }).boundingBox()
      expect(control.y).toBeGreaterThanOrEqual(0)
      expect(control.y + control.height).toBeLessThanOrEqual(height)
    }
  })
}
