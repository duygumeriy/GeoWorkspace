import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'

/**
 * Kullanıcı detayındaki "Yetkiler" sekmesi.
 *
 * Ekranın işi üç kavramı AYRI göstermektir: rolden KALITILAN, kullanıcıya
 * DOĞRUDAN verilen ve gerçekten ETKİN olan yetkiler. Onay kutusu yalnızca
 * doğrudan atamaları temsil eder — rolden gelen bir satır işaretli ama kilitli
 * görünür, çünkü onu ikinci kez atamak hiçbir erişim eklemez ama rol
 * değiştiğinde arkada kalırdı.
 *
 * Neyin atanabileceğine SUNUCU karar verir. Testler bunu, rol adlarının hiçbir
 * şey ima etmediği bir kurguyla kanıtlar: aynı rol adı bir satırda
 * atanabilirken diğerinde atanamaz olabilir, çünkü karar `canAssignDirect`
 * alanından okunur.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const ASSIGNABLE = [
  { name: 'Viewer', description: 'Haritayı görüntüler.', requiresTwoFactor: false },
  { name: 'GIS Editor', description: 'Çizim oluşturur ve düzenler.', requiresTwoFactor: false },
  { name: 'Saha Ekibi', description: 'Yöneticinin tanımladığı özel rol.', requiresTwoFactor: false },
]

const USER = {
  id: 4,
  username: 'cizim-eden',
  email: 'cizim-eden@example.invalid',
  role: 'GIS Editor',
  isActive: true,
  emailConfirmed: true,
  accountStatus: 'Active',
  twoFactorEnabled: false,
  lockoutEnd: null,
  modifiedDate: '2026-08-17T10:00:00Z',
}

/**
 * Tek bir yetki satırı. Varsayılan: hiçbir kaynaktan gelmiyor, aktif ve
 * çağıranın atayabileceği bir yetki.
 */
const perm = (id, code, name, category, extra = {}) => ({
  id,
  code,
  name,
  description: `${name} yetkisi.`,
  category,
  isActive: true,
  sortOrder: id * 10,
  inheritedFromRoles: [],
  directAssigned: false,
  effective: false,
  canAssignDirect: true,
  canRemoveDirect: false,
  ...extra,
})

/* Her durumdan bir satır: kalıtım, doğrudan, çakışma, atanmamış, çağıranın
   veremediği, pasif ve pasif-tarihsel. */
const PERMISSIONS = [
  perm(1, 'map.view', 'Harita Görüntüleme', 'Map', {
    inheritedFromRoles: ['GIS Editor'], effective: true, canAssignDirect: false,
  }),
  perm(2, 'drawings.point.create', 'Nokta Ekleme', 'DrawingCreate', {
    inheritedFromRoles: ['GIS Editor'], effective: true, canAssignDirect: false,
  }),
  perm(3, 'drawings.line.create', 'Çizgi Ekleme', 'DrawingCreate', {
    // Tarihsel çakışma: hem rolden geliyor hem kişiye özel kaydı var.
    inheritedFromRoles: ['GIS Editor', 'Saha Ekibi'],
    directAssigned: true, effective: true, canAssignDirect: false, canRemoveDirect: true,
  }),
  perm(4, 'inventory.analysis', 'Envanter Analizi', 'Inventory', {
    directAssigned: true, effective: true, canAssignDirect: false, canRemoveDirect: true,
  }),
  perm(5, 'layers.manage', 'Katman Yönetimi', 'Layers'),
  perm(6, 'users.delete', 'Kullanıcı Silme', 'Users', {
    // Çağıranın kendisinde yok: sunucu atanamaz diyor.
    canAssignDirect: false,
  }),
  perm(7, 'legacy.export', 'Eski Dışa Aktarma', 'Tools', {
    isActive: false, canAssignDirect: false,
  }),
  perm(8, 'legacy.import', 'Eski İçe Aktarma', 'Tools', {
    // Pasif ama tarihsel bir kişiye özel kaydı var; korunmalı.
    isActive: false, directAssigned: true, canAssignDirect: false, canRemoveDirect: false,
  }),
  /* Coğrafi yetkilendirme (Phase 8-P): sıradan kanonik yetkiler. Görüntüleme
     çağıranda VAR, yönetme YOK — sunucunun satır başına verdiği
     `canAssignDirect` kararının ekranda ayrı ayrı okunduğunu gösterir. */
  perm(9, 'geography.view', 'Coğrafi Yetkileri Görüntüleme', 'Geography'),
  perm(10, 'geography.manage', 'Coğrafi Yetkileri Yönetme', 'Geography', {
    canAssignDirect: false,
  }),
]

const payload = (overrides = {}) => ({
  userId: USER.id,
  userName: USER.username,
  roles: ['GIS Editor'],
  canManageDirectPermissions: true,
  targetAccountEligible: true,
  permissions: PERMISSIONS,
  ...overrides,
})

async function openPermissions(page, {
  body = payload(),
  onSave,
  onRoleChange,
  user = USER,
  openTab = true,
} = {}) {
  const saves = []

  /* Yetki ucu da yanıtlanmalı: arayüz küme gelene kadar korumalı hiçbir şeyi
     çizmez (fail-closed). Bu spec yetki KURALLARINI ölçmüyor, bu yüzden tam
     küme verilir; kuralların kendisi permission-aware-ui.spec.js'in işidir. */
  await mockPermissions(page)

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: 1, username: 'admin', emailConfirmed: true, twoFactorEnabled: true, role: 'Admin', roles: ['Admin'] })),
  )
  await page.route('**/api/admin/users/roles', (route) => route.fulfill(json(ASSIGNABLE)))
  await page.route(`**/api/admin/users/${user.id}/permissions`, async (route) => {
    if (route.request().method() === 'PUT') {
      saves.push(JSON.parse(route.request().postData() || '{}'))
      return onSave ? onSave(route, saves) : route.fulfill(json(body))
    }
    return route.fulfill(json(body))
  })
  await page.route(`**/api/admin/users/${user.id}/role`, (route) =>
    onRoleChange ? onRoleChange(route) : route.fulfill(json(user)))
  await page.route(`**/api/admin/users/${user.id}`, (route) => route.fulfill(json(user)))
  await page.route('**/api/admin/users', (route) => route.fulfill(json([user])))

  await page.goto('/login')
  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-admin-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())
  await page.goto('/admin/users')

  await page.getByRole('button', { name: /cizim-eden kullanıcısının detayını aç/ }).click()
  await expect(page.getByRole('heading', { name: 'cizim-eden', level: 2 })).toBeVisible()

  if (openTab) {
    await page.getByRole('tab', { name: /^Yetkiler/ }).click()
    await expect(page.getByRole('heading', { name: 'Yetkiler', level: 3 })).toBeVisible()
  }

  return { saves }
}

/** Bir yetki satırının kapsayıcısı; metin sorguları buna göre daraltılır. */
const row = (page, name) => page.locator('.admin-permission-row').filter({ hasText: name })
const box = (page, name) => row(page, name).getByRole('checkbox')
const saveButton = (page) => page.getByRole('button', { name: 'Doğrudan Yetkileri Kaydet' })
const resetButton = (page) => page.getByRole('button', { name: 'Değişiklikleri Geri Al' })

/* --- Okuma ------------------------------------------------------------------ */

test('the permission tab loads the source table for the selected user', async ({ page }) => {
  await openPermissions(page)

  // Katalogdaki her satır görünür; yalnızca atanmışlar değil.
  await expect(page.locator('.admin-permission-row')).toHaveCount(PERMISSIONS.length)
  await expect(page.getByText('4 etkin yetki', { exact: false })).toBeVisible()
})

test('a role-inherited permission names its source and cannot be assigned directly', async ({ page }) => {
  await openPermissions(page)

  await expect(row(page, 'Nokta Ekleme')).toContainText('GIS Editor rolünden')

  /* Kutu HİÇ ÇİZİLMEZ. Boş bir onay kutusu, yetki gerçekten işlerken "kapalı"
     diye okunurdu: kutu doğrudan atamayı anlatır, kullanıcı ise onu "bu yetki
     var mı" diye okur. Kaydı olmayan bir satırda kapatılabilir bir kutu zaten
     yanlış bir vaattir. */
  await expect(box(page, 'Nokta Ekleme')).toHaveCount(0)
  await expect(row(page, 'Nokta Ekleme')).toHaveClass(/is-inherited/)

  // Yetkinin İŞLEDİĞİ bilgisi kaybolmaz.
  await expect(row(page, 'Nokta Ekleme')).toContainText('Etkin')

  /* Kilidin sebebi YAZILIR ve ekran okuyucuya da ulaşır: simge tek başına
     bırakılmaz. */
  await expect(row(page, 'Nokta Ekleme')).toContainText('Bu yetki rol tarafından sağlanıyor')
  await expect(row(page, 'Nokta Ekleme')).toContainText('Rolden geliyor, salt okunur.')
})

test('a permission inherited from several roles lists them all', async ({ page }) => {
  await openPermissions(page)

  /* Tek bir kaynağa indirgemek, yetkiyi kesmek isteyen yöneticiye eksik bilgi
     vermek olurdu: bir rol kaldırılsa yetki hâlâ durur. */
  await expect(row(page, 'Çizgi Ekleme')).toContainText('GIS Editor + Saha Ekibi rolünden')
})

test('a direct grant is labelled as user-specific and can be removed', async ({ page }) => {
  await openPermissions(page)

  await expect(row(page, 'Envanter Analizi')).toContainText('Kullanıcıya özel')
  await expect(box(page, 'Envanter Analizi')).toBeChecked()
  await expect(box(page, 'Envanter Analizi')).toBeEnabled()
})

test('an unassigned permission says so and can be granted', async ({ page }) => {
  await openPermissions(page)

  await expect(row(page, 'Katman Yönetimi')).toContainText('Atanmamış')
  await expect(box(page, 'Katman Yönetimi')).not.toBeChecked()
  await expect(box(page, 'Katman Yönetimi')).toBeEnabled()
})

test('effective state is shown separately from assignment', async ({ page }) => {
  await openPermissions(page)

  // Atanmış ve işleyen.
  await expect(row(page, 'Envanter Analizi')).toContainText('Etkin')
  // Atanmamış: etkin rozeti yok.
  await expect(row(page, 'Katman Yönetimi')).not.toContainText('Etkin')
})

test('an inactive permission is marked and never selectable', async ({ page }) => {
  await openPermissions(page)

  await expect(row(page, 'Eski Dışa Aktarma')).toContainText('Pasif')
  await expect(box(page, 'Eski Dışa Aktarma')).toBeDisabled()

  /* Pasif ama kişiye özel kaydı olan satır korunur ve bunu SÖYLER: sessizce
     silinseydi yetki yeniden açıldığında geri gelmezdi. */
  await expect(box(page, 'Eski İçe Aktarma')).toBeDisabled()
  await expect(page.getByText('kullanımdan kaldırılmış 1 kişiye özel yetki kaydı', { exact: false })).toBeVisible()
})

test('technical codes are shown and grouped by the server category', async ({ page }) => {
  await openPermissions(page)

  await expect(row(page, 'Envanter Analizi').locator('code')).toHaveText('inventory.analysis')

  // Kategori başlıkları rolePermissions.js'teki ORTAK eşlemeden gelir.
  await expect(page.getByRole('group', { name: 'Çizim Oluşturma' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Envanter' })).toBeVisible()
  await expect(page.getByRole('group', { name: 'Kullanıcı Yönetimi' })).toBeVisible()
})

test('the geographic authorization permissions are ordinary rows in their own group', async ({ page }) => {
  await openPermissions(page)

  await expect(page.getByRole('group', { name: 'Coğrafi Yetkilendirme' })).toBeVisible()
  await expect(row(page, 'Coğrafi Yetkileri Görüntüleme').locator('code')).toHaveText('geography.view')
  await expect(row(page, 'Coğrafi Yetkileri Yönetme').locator('code')).toHaveText('geography.manage')

  /* Atanabilirlik kararı SUNUCUDAN gelir, koddan çıkarılmaz: aynı kategorideki
     iki satırdan biri açık, diğeri kapalıdır. İstemci "coğrafya" diye bir
     kural bilmez. */
  await expect(box(page, 'Coğrafi Yetkileri Görüntüleme')).toBeEnabled()
  await expect(box(page, 'Coğrafi Yetkileri Yönetme')).toBeDisabled()
})

test('the historical overlap shows both sources at once', async ({ page }) => {
  await openPermissions(page)

  /* Hem rolden geliyor hem kişiye özel kaydı var. Yalnızca birini göstermek,
     fazlalık kaydı kaldırmak isteyen yöneticiden onun varlığını gizlerdi. */
  await expect(row(page, 'Çizgi Ekleme')).toContainText('GIS Editor + Saha Ekibi rolünden')
  await expect(row(page, 'Çizgi Ekleme')).toContainText('Kullanıcıya özel kayıt mevcut')
  await expect(box(page, 'Çizgi Ekleme')).toBeEnabled()
})

test('the three states are visually distinct from one another', async ({ page }) => {
  await openPermissions(page)

  /* Asıl karışıklık buradaydı: rolden gelen bir yetki "Etkin" derken yanında
     boş bir kutu duruyordu ve bu "kapalı" diye okunuyordu. Üç durum artık
     birbirine benzemiyor. */

  // Rolden gelen: kutu yok, kilit var, etkin.
  await expect(box(page, 'Nokta Ekleme')).toHaveCount(0)
  await expect(row(page, 'Nokta Ekleme').locator('.admin-permission-mark')).toBeVisible()
  await expect(row(page, 'Nokta Ekleme')).toContainText('Etkin')

  // Kişiye özel: işaretli ve düzenlenebilir kutu, kilit yok.
  await expect(box(page, 'Envanter Analizi')).toBeChecked()
  await expect(box(page, 'Envanter Analizi')).toBeEnabled()
  await expect(row(page, 'Envanter Analizi').locator('.admin-permission-mark')).toHaveCount(0)

  // Atanmamış: boş ve düzenlenebilir kutu — burada boşluk DOĞRU okumadır.
  await expect(box(page, 'Katman Yönetimi')).not.toBeChecked()
  await expect(box(page, 'Katman Yönetimi')).toBeEnabled()
  await expect(row(page, 'Katman Yönetimi')).not.toContainText('Etkin')
})

test('an inherited row is not dimmed like a retired one', async ({ page }) => {
  await openPermissions(page)

  /* Rolden gelen satır işleyen bir yetkidir; kullanımdan kaldırılmış bir
     satırla aynı tonda görünmesi, düzeltilen yanlış okumayı geri getirirdi. */
  const inherited = row(page, 'Nokta Ekleme').locator('strong').first()
  const retired = row(page, 'Eski Dışa Aktarma').locator('strong').first()

  const colourOf = (locator) => locator.evaluate((el) => getComputedStyle(el).color)
  expect(await colourOf(inherited)).not.toBe(await colourOf(retired))
})

test('an overlapping row keeps its checkbox so the direct copy can be removed', async ({ page }) => {
  await openPermissions(page)

  /* Çakışan satır kilit muamelesi ALMAZ: orada kaldırılacak gerçek bir kayıt
     vardır ve kilit onu erişilemez kılardı. */
  await expect(row(page, 'Çizgi Ekleme')).not.toHaveClass(/is-inherited/)
  await expect(box(page, 'Çizgi Ekleme')).toBeEnabled()
  await expect(row(page, 'Çizgi Ekleme')).toContainText('GIS Editor + Saha Ekibi rolünden')
  await expect(row(page, 'Çizgi Ekleme')).toContainText('Kullanıcıya özel kayıt mevcut')
})

test('an inherited permission that is inactive still says so', async ({ page }) => {
  await openPermissions(page, {
    body: payload({
      permissions: PERMISSIONS.map((p) =>
        p.code === 'map.view' ? { ...p, isActive: false, effective: false } : p),
    }),
  })

  // Kilit "etkin" demez; etkinliği yalnızca rozet söyler.
  await expect(row(page, 'Harita Görüntüleme')).toContainText('Pasif')
  await expect(row(page, 'Harita Görüntüleme')).not.toContainText('Etkin')
  await expect(box(page, 'Harita Görüntüleme')).toHaveCount(0)
})

/* --- Sunucu kaynaklı kabiliyet ---------------------------------------------- */

test('grantability comes from the server, not from role names', async ({ page }) => {
  await openPermissions(page)

  /* İki satır da atanmamış ve kullanıcının rolü aynı. Fark yalnızca sunucunun
     `canAssignDirect` alanında: rol adına bakan bir arayüz ikisini de aynı
     şekilde çizerdi. */
  await expect(box(page, 'Katman Yönetimi')).toBeEnabled()
  await expect(box(page, 'Kullanıcı Silme')).toBeDisabled()
  await expect(row(page, 'Kullanıcı Silme')).toContainText('Bu yetkiyi doğrudan atama yetkiniz yok')
})

test('a custom role fixture does not change what the screen offers', async ({ page }) => {
  /* Rol adı tamamen tanınmadık; karar yine sunucudan okunur. */
  await openPermissions(page, {
    body: payload({
      roles: ['Saha Ekibi'],
      permissions: PERMISSIONS.map((p) =>
        p.code === 'users.delete' ? { ...p, canAssignDirect: true } : p),
    }),
  })

  await expect(box(page, 'Kullanıcı Silme')).toBeEnabled()
})

test('a view-only actor gets a read-only screen', async ({ page }) => {
  await openPermissions(page, { body: payload({ canManageDirectPermissions: false }) })

  await expect(saveButton(page)).toHaveCount(0)
  await expect(page.getByText('değiştirmek için kullanıcı düzenleme', { exact: false })).toBeVisible()

  /* Hiçbir kutu yanıltıcı biçimde etkin bırakılmaz. Rolden gelen satırlarda
     kutu zaten yoktur; kalanların hepsi devre dışıdır. */
  for (const item of PERMISSIONS) {
    const inheritedOnly = item.inheritedFromRoles.length > 0 && !item.directAssigned
    if (inheritedOnly) {
      await expect(box(page, item.name)).toHaveCount(0)
      await expect(row(page, item.name)).toHaveClass(/is-inherited/)
    } else {
      await expect(box(page, item.name)).toBeDisabled()
    }
  }
})

test('an ineligible account explains why nothing is effective', async ({ page }) => {
  await openPermissions(page, {
    body: payload({
      targetAccountEligible: false,
      permissions: PERMISSIONS.map((p) => ({ ...p, effective: false })),
    }),
  })

  await expect(page.getByText('Hesap aktif olmadığı için hiçbir yetki şu anda etkin değil', { exact: false })).toBeVisible()
})

/* --- Düzenleme -------------------------------------------------------------- */

test('selecting a grantable permission marks the screen dirty', async ({ page }) => {
  await openPermissions(page)

  await expect(saveButton(page)).toBeDisabled()

  await box(page, 'Katman Yönetimi').check()
  await expect(saveButton(page)).toBeEnabled()
  await expect(page.getByText('Kaydedilmemiş değişiklik var')).toBeVisible()
})

test('toggling back to the baseline clears the dirty state', async ({ page }) => {
  await openPermissions(page)

  await box(page, 'Katman Yönetimi').check()
  await expect(saveButton(page)).toBeEnabled()

  // Kirlilik SIRAYA değil ÜYELİĞE bakar.
  await box(page, 'Katman Yönetimi').uncheck()
  await expect(saveButton(page)).toBeDisabled()
})

test('the save sends the desired ACTIVE DIRECT set and nothing else', async ({ page }) => {
  const { saves } = await openPermissions(page)

  await box(page, 'Katman Yönetimi').check()
  await saveButton(page).click()
  await expect(page.getByText('Kullanıcıya özel yetkiler güncellendi.')).toBeVisible()

  expect(saves).toHaveLength(1)
  const sent = saves[0].permissionCodes.sort()

  /* Rolden gelen kodlar GÖNDERİLMEZ (sunucu 400 verirdi) ve pasif tarihsel
     kayıt da gövdeye girmez (sunucu onu kendisi korur). */
  expect(sent).toEqual(['drawings.line.create', 'inventory.analysis', 'layers.manage'])
  expect(sent).not.toContain('drawings.point.create')
  expect(sent).not.toContain('map.view')
  expect(sent).not.toContain('legacy.import')
})

test('an inherited permission is never sent as a new direct grant', async ({ page }) => {
  const { saves } = await openPermissions(page)

  // Değiştirilecek bir kontrol yok: satırda onay kutusu hiç çizilmiyor.
  await expect(box(page, 'Nokta Ekleme')).toHaveCount(0)

  await box(page, 'Katman Yönetimi').check()
  await saveButton(page).click()
  await expect(page.getByText('Kullanıcıya özel yetkiler güncellendi.')).toBeVisible()

  expect(saves[0].permissionCodes).not.toContain('drawings.point.create')
})

test('removing a redundant direct grant keeps the role inheritance', async ({ page }) => {
  const after = payload({
    permissions: PERMISSIONS.map((p) =>
      p.code === 'drawings.line.create'
        ? { ...p, directAssigned: false, canRemoveDirect: false, effective: true }
        : p),
  })

  const { saves } = await openPermissions(page, {
    onSave: (route) => route.fulfill(json(after)),
  })

  await box(page, 'Çizgi Ekleme').uncheck()
  await saveButton(page).click()
  await expect(page.getByText('Kullanıcıya özel yetkiler güncellendi.')).toBeVisible()

  expect(saves[0].permissionCodes).not.toContain('drawings.line.create')

  // Doğrudan kayıt gitti; yetki rolden gelmeye devam ediyor.
  await expect(row(page, 'Çizgi Ekleme')).toContainText('GIS Editor + Saha Ekibi rolünden')
  await expect(row(page, 'Çizgi Ekleme')).not.toContainText('Kullanıcıya özel kayıt mevcut')
  await expect(row(page, 'Çizgi Ekleme')).toContainText('Etkin')
})

test('a successful save adopts the server response as the new baseline', async ({ page }) => {
  const after = payload({
    permissions: PERMISSIONS.map((p) =>
      p.code === 'layers.manage'
        ? { ...p, directAssigned: true, effective: true, canAssignDirect: false, canRemoveDirect: true }
        : p),
  })

  await openPermissions(page, { onSave: (route) => route.fulfill(json(after)) })

  await box(page, 'Katman Yönetimi').check()
  await saveButton(page).click()

  await expect(page.getByText('Kullanıcıya özel yetkiler güncellendi.')).toBeVisible()
  await expect(saveButton(page)).toBeDisabled()
  await expect(page.getByText('Kaydedilmemiş değişiklik var')).toHaveCount(0)
  await expect(row(page, 'Katman Yönetimi')).toContainText('Kullanıcıya özel')
})

test('reset restores the baseline without calling the API', async ({ page }) => {
  const { saves } = await openPermissions(page)

  await box(page, 'Katman Yönetimi').check()
  await box(page, 'Envanter Analizi').uncheck()
  await expect(resetButton(page)).toBeVisible()

  await resetButton(page).click()

  await expect(box(page, 'Katman Yönetimi')).not.toBeChecked()
  await expect(box(page, 'Envanter Analizi')).toBeChecked()
  await expect(saveButton(page)).toBeDisabled()
  expect(saves).toHaveLength(0)
})

/* --- Hata yolları ----------------------------------------------------------- */

test('a forbidden save explains itself and keeps the pending selection', async ({ page }) => {
  await openPermissions(page, {
    onSave: (route) => route.fulfill(json({ message: 'yoksayılır' }, 403)),
  })

  await box(page, 'Katman Yönetimi').check()
  await saveButton(page).click()

  await expect(page.getByText('Bu kullanıcıya seçilen yetkiyi atamak için gerekli yetkiye sahip değilsiniz.')).toBeVisible()

  /* Seçim KORUNUR ve ekran kirli kalır: yönetici 27 satırı yeniden
     işaretlemek zorunda kalmadan düzeltip tekrar deneyebilsin. Giriş ekranına
     da atılmaz — 403 oturum sorunu değildir. */
  await expect(box(page, 'Katman Yönetimi')).toBeChecked()
  await expect(saveButton(page)).toBeEnabled()
  await expect(page).toHaveURL(/\/admin\/users/)
})

test('a rejected duplicate shows the backend validation message', async ({ page }) => {
  await openPermissions(page, {
    onSave: (route) => route.fulfill(json({ message: 'Bu yetki kullanıcıya rol üzerinden zaten veriliyor: layers.manage.' }, 400)),
  })

  await box(page, 'Katman Yönetimi').check()
  await saveButton(page).click()

  await expect(page.getByText('Bu yetki kullanıcıya rol üzerinden zaten veriliyor: layers.manage.')).toBeVisible()
  await expect(box(page, 'Katman Yönetimi')).toBeChecked()
})

test('a failed load offers a retry inside the tab', async ({ page }) => {
  let attempts = 0
  /* Yetki ucu da yanıtlanmalı: arayüz küme gelene kadar korumalı hiçbir şeyi
     çizmez (fail-closed). Bu spec yetki KURALLARINI ölçmüyor, bu yüzden tam
     küme verilir; kuralların kendisi permission-aware-ui.spec.js'in işidir. */
  await mockPermissions(page)

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: 1, username: 'admin', emailConfirmed: true, twoFactorEnabled: true, role: 'Admin', roles: ['Admin'] })),
  )
  await page.route('**/api/admin/users/roles', (route) => route.fulfill(json(ASSIGNABLE)))
  await page.route(`**/api/admin/users/${USER.id}/permissions`, (route) => {
    attempts += 1
    return attempts === 1
      ? route.fulfill(json({ message: 'Kullanıcı yetkileri yüklenemedi.' }, 500))
      : route.fulfill(json(payload()))
  })
  await page.route(`**/api/admin/users/${USER.id}`, (route) => route.fulfill(json(USER)))
  await page.route('**/api/admin/users', (route) => route.fulfill(json([USER])))

  await page.goto('/login')
  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-admin-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())
  await page.goto('/admin/users')

  await page.getByRole('button', { name: /cizim-eden kullanıcısının detayını aç/ }).click()
  await page.getByRole('tab', { name: /^Yetkiler/ }).click()

  // Hata sekmede KALIR; panel kendiliğinden kapanmaz.
  await page.getByRole('button', { name: 'Tekrar dene' }).click()
  await expect(row(page, 'Envanter Analizi')).toBeVisible()
})

/* --- Rol değişikliği ve kaydedilmemiş değişiklik ---------------------------- */

test('a role change refreshes the inherited sources', async ({ page }) => {
  let reads = 0
  const viewerBody = payload({
    roles: ['Viewer'],
    permissions: PERMISSIONS.map((p) =>
      p.code === 'drawings.point.create'
        ? { ...p, inheritedFromRoles: [], effective: false, canAssignDirect: true }
        : p),
  })

  /* Yetki ucu da yanıtlanmalı: arayüz küme gelene kadar korumalı hiçbir şeyi
     çizmez (fail-closed). Bu spec yetki KURALLARINI ölçmüyor, bu yüzden tam
     küme verilir; kuralların kendisi permission-aware-ui.spec.js'in işidir. */
  await mockPermissions(page)

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: 1, username: 'admin', emailConfirmed: true, twoFactorEnabled: true, role: 'Admin', roles: ['Admin'] })),
  )
  await page.route('**/api/admin/users/roles', (route) => route.fulfill(json(ASSIGNABLE)))
  await page.route(`**/api/admin/users/${USER.id}/permissions`, (route) => {
    reads += 1
    return route.fulfill(json(reads === 1 ? payload() : viewerBody))
  })
  await page.route(`**/api/admin/users/${USER.id}/role`, (route) =>
    route.fulfill(json({ ...USER, role: 'Viewer' })))
  await page.route(`**/api/admin/users/${USER.id}`, (route) => route.fulfill(json(USER)))
  await page.route('**/api/admin/users', (route) => route.fulfill(json([USER])))

  await page.goto('/login')
  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-admin-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())
  await page.goto('/admin/users')

  await page.getByRole('button', { name: /cizim-eden kullanıcısının detayını aç/ }).click()
  await page.getByRole('tab', { name: /^Yetkiler/ }).click()
  await expect(row(page, 'Nokta Ekleme')).toContainText('GIS Editor rolünden')

  await page.getByRole('tab', { name: 'Genel' }).click()
  await page.getByRole('dialog').getByRole('combobox', { name: 'Rol' }).selectOption('Viewer')
  await page.getByRole('button', { name: 'Rolü Değiştir' }).click()

  await page.getByRole('tab', { name: /^Yetkiler/ }).click()

  /* Bayat bir "GIS Editor rolünden" etiketi bırakmak, yöneticiye artık doğru
     olmayan bir kaynak göstermek olurdu. */
  await expect(row(page, 'Nokta Ekleme')).not.toContainText('GIS Editor rolünden')
  await expect(row(page, 'Nokta Ekleme')).toContainText('Atanmamış')
})

test('closing the panel with unsaved changes asks first', async ({ page }) => {
  await openPermissions(page)

  await box(page, 'Katman Yönetimi').check()
  await page.getByRole('button', { name: 'Detayı kapat' }).click()

  await expect(page.getByRole('alertdialog')).toContainText('Kaydedilmemiş yetki değişiklikleri var')

  // Vazgeçmek paneli açık ve seçimi yerinde bırakır.
  await page.getByRole('button', { name: 'İptal' }).click()
  await expect(box(page, 'Katman Yönetimi')).toBeChecked()

  await page.getByRole('button', { name: 'Detayı kapat' }).click()
  await page.getByRole('button', { name: 'Değişiklikleri Yoksay' }).click()
  await expect(page.getByRole('heading', { name: 'cizim-eden', level: 2 })).toHaveCount(0)
})

test('changing the role with unsaved permission changes asks first', async ({ page }) => {
  await openPermissions(page)

  await box(page, 'Katman Yönetimi').check()
  await page.getByRole('tab', { name: 'Genel' }).click()
  await page.getByRole('dialog').getByRole('combobox', { name: 'Rol' }).selectOption('Viewer')

  /* Rol değişikliği KALITIMI değiştirir: kaydedilmemiş seçim, artık geçerli
     olmayan bir kaynak tablosunun üzerine yazılırdı. */
  await expect(page.getByRole('alertdialog')).toContainText('Kaydedilmemiş yetki değişiklikleri var')
})

/* --- Responsive ------------------------------------------------------------- */

for (const [label, viewport] of [
  ['desktop', { width: 1440, height: 900 }],
  ['tablet', { width: 768, height: 1024 }],
  ['phone', { width: 375, height: 812 }],
]) {
  test(`${label}: the permission tab stays usable and does not overflow`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await openPermissions(page)

    await expect(row(page, 'Envanter Analizi')).toBeVisible()
    await expect(saveButton(page)).toBeVisible()

    // Uzun teknik kodlar satırı yatay kaydırmaya zorlamamalı.
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    await box(page, 'Katman Yönetimi').check()
    await expect(saveButton(page)).toBeEnabled()
    await expect(resetButton(page)).toBeVisible()
  })
}
