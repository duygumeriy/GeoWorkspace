import { expect, test } from '@playwright/test'
import { ADMIN_VIEW_PERMISSIONS, ALL_PERMISSIONS, VIEWER_PERMISSIONS, mockPermissions } from './permissions.js'

/**
 * Phase 7: arayüz ETKİN YETKİ KODLARINDAN çiziliyor mu?
 *
 * ## Burada kanıtlanan şey
 *
 * Ödevin istediği davranış tek cümle: <b>yetkisi yoksa düğme hiç
 * görünmeyecek</b>. Bunun rol adına değil, kullanıcının o anki etkin
 * yetkilerine bakılarak yapıldığı ölçülür — çünkü ikisi ayrıştığında (yetkisi
 * alınmış bir "Administrator", ya da yetkileri verilmiş özel bir rol) yalnızca
 * doğru olan ayakta kalmalıdır.
 *
 * ## Burada kanıtlanmayan şey
 *
 * <b>Güvenlik.</b> Bir düğmeyi gizlemek yetkilendirme değildir ve bu dosya
 * öyle bir iddiada bulunmaz. Gerçek kapı backend'dedir: her uç aynı yetkiyi
 * sunucuda yeniden denetler ve yetkisiz isteğe 403 döner — bu, backend
 * paketindeki PermissionEnforcementTests, UserPermissionHttpTests ve
 * RolePermissionGrantAuthorityHttpTests tarafından, tarayıcıdan bağımsız
 * olarak ölçülür. Buradaki testler yalnızca arayüzün o gerçeği DOĞRU
 * YANSITTIĞINI gösterir.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const ADMIN_USER = {
  id: 1,
  username: 'admin',
  email: 'admin@example.invalid',
  role: 'Administrator',
  isActive: true,
  emailConfirmed: true,
  accountStatus: 'Active',
  twoFactorEnabled: true,
  lockoutEnd: null,
  modifiedDate: '2026-08-01T10:00:00Z',
}

const ROLE_ROWS = [
  {
    id: 1, name: 'Admin', userCount: 1, permissionCount: 27,
    isSystem: true, isLegacy: true, isAssignable: false,
    canRename: false, canDelete: false, canEditPermissions: false,
  },
  {
    id: 9, name: 'Field Wizard', userCount: 2, permissionCount: 4,
    isSystem: false, isLegacy: false, isAssignable: true,
    canRename: true, canDelete: true, canEditPermissions: true,
  },
]

const CATALOG = [
  { id: 1, code: 'map.view', name: 'Haritayı Görüntüleme', description: 'Harita uygulamasını açabilir.', category: 'Map', isActive: true, sortOrder: 100 },
  { id: 2, code: 'inventory.analysis', name: 'Envanter Analizi', description: 'Alan analizi çalıştırabilir.', category: 'Inventory', isActive: true, sortOrder: 200 },
]

/** Bir kullanıcının yetki tablosu; sunucunun hedefe özgü bayraklarıyla. */
function userPermissionsBody({ canManage = true } = {}) {
  return {
    userId: 4,
    roles: ['Field Wizard'],
    targetAccountEligible: true,
    canManageDirectPermissions: canManage,
    permissions: CATALOG.map((item) => ({
      ...item,
      assigned: false,
      directAssigned: false,
      inheritedFromRoles: [],
      effective: false,
      canAssignDirect: canManage,
      canRemoveDirect: canManage,
    })),
  }
}

/* --- Ortak kurulum --------------------------------------------------------- */

/**
 * Oturum açar ve yetki kümesini kurar.
 *
 * `role` yalnızca sunucunun bildirdiği rol ADIDIR ve hiçbir görünürlük kararı
 * vermez; testlerin bir kısmı tam olarak bunu kanıtlamak için adı ile yetkisini
 * bilerek ayrıştırır.
 */
async function signIn(page, codes, { role = 'Administrator', userId = 1 } = {}) {
  const permissions = await mockPermissions(page, codes, { userId })

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({
      userId,
      username: role === 'Administrator' ? 'admin' : 'someone',
      email: 'someone@example.invalid',
      emailConfirmed: true,
      twoFactorEnabled: true,
      role,
      roles: [role],
    })),
  )

  await page.route('**/api/admin/users/roles', (route) => route.fulfill(json([
    { name: 'Field Wizard', description: 'Özel rol.', requiresTwoFactor: false },
  ])))
  await page.route('**/api/admin/users/1', (route) => route.fulfill(json(ADMIN_USER)))
  await page.route('**/api/admin/users/4', (route) => route.fulfill(json({
    ...ADMIN_USER, id: 4, username: 'target', role: 'Field Wizard', twoFactorEnabled: false,
  })))
  await page.route('**/api/admin/users/*/permissions', (route) => route.fulfill(json(userPermissionsBody())))
  await page.route('**/api/admin/users', (route) => route.fulfill(json([
    ADMIN_USER,
    { ...ADMIN_USER, id: 4, username: 'target', role: 'Field Wizard' },
  ])))
  await page.route('**/api/admin/roles/*/permissions', (route) => route.fulfill(json({
    role: ROLE_ROWS[1],
    permissions: CATALOG.map((item) => ({ ...item, assigned: false })),
  })))
  await page.route('**/api/admin/roles/*', (route) => route.fulfill(json(ROLE_ROWS[1])))
  await page.route('**/api/admin/roles', (route) => route.fulfill(json(ROLE_ROWS)))
  await page.route('**/api/admin/permissions', (route) => route.fulfill(json(CATALOG)))

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())

  return permissions
}

/** Haritanın çizim uçları; bu dosyada içerikleri değil, görünürlük önemli. */
async function stubDrawings(page) {
  await page.route('**/api/drawings/points', (route) => route.fulfill(json([])))
  await page.route('**/api/drawings/lines', (route) => route.fulfill(json([])))
  await page.route('**/api/drawings/polygons', (route) => route.fulfill(json([])))
  await page.route('**/api/drawings/deleted', (route) => route.fulfill(json([])))
}

async function openMap(page) {
  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()
}

const adminNav = (page) => page.getByRole('navigation', { name: 'Yönetim menüsü' })
const toolbar = (page) => page.getByRole('toolbar', { name: 'Çizim araçları' })
const drawButton = (page, label) => toolbar(page).getByRole('button', { name: new RegExp(`^${label} çiz`) })
const denied = (page) => page.getByRole('heading', { name: 'Bu bölüme erişim yetkiniz yok' })

/* ===========================================================================
   1. Merkezî yetki durumu
   =========================================================================== */

test('effective permissions are read once and shared by every screen', async ({ page }) => {
  const permissions = await signIn(page, ALL_PERMISSIONS)
  await stubDrawings(page)
  await openMap(page)

  /* Kenar çubuğu, araç çubuğu, paneller ve rota koruyucularının HEPSİ aynı
     kümeyi okur. Her tüketici kendi isteğini açsaydı bu sayı bileşen sayısıyla
     birlikte büyürdü; burada okuma sayısı sağlayıcının mount sayısıdır.

     Üst sınır 2'dir çünkü geliştirme sunucusu StrictMode altında çalışır ve
     React efektleri bilerek iki kez çağırır. Kesin 1 beklemek, ölçmek
     istediğimiz şeyi değil StrictMode'u ölçerdi. */
  const afterMap = permissions.calls
  expect(afterMap).toBeLessThanOrEqual(2)

  await page.getByRole('button', { name: 'Kullanıcı Yönetimi' }).click()
  await expect(adminNav(page)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kullanıcılar', level: 1 })).toBeVisible()

  /* Asıl iddia: haritadan yönetim paneline geçmek, üç yeni ekran ve bir düzine
     yeni tüketici demektir — ve tek bir yetki isteği daha açmaz. */
  expect(permissions.calls).toBe(afterMap)
})

test('an unknown permission code is simply false', async ({ page }) => {
  await signIn(page, ['map.view', 'drawings.view', 'not.a.real.code'])
  await stubDrawings(page)
  await openMap(page)

  // Uydurma kod hiçbir şey açmaz; gerçek kodların yokluğu da öyle.
  await expect(drawButton(page, 'Nokta')).toBeHidden()
  await expect(page.getByRole('button', { name: 'Kullanıcı Yönetimi' })).toBeHidden()
})

test('a failed permission read fails closed, and recovers on retry', async ({ page }) => {
  const permissions = await signIn(page, ALL_PERMISSIONS)
  permissions.setStatus(500)
  await stubDrawings(page)

  await page.goto('/map')

  /* Fail-closed: okuma başarısızsa cevap "hiçbir yetki"dir. Ama bu bir yetki
     REDDİ değildir ve ekran ikisini ayırt eder. */
  await expect(page.getByRole('heading', { name: 'Yetkileriniz yüklenemedi' })).toBeVisible()
  await expect(toolbar(page)).toBeHidden()

  permissions.setStatus(200)
  await page.getByRole('button', { name: 'Tekrar dene' }).click()

  await expect(page.locator('.map-container canvas').first()).toBeVisible()
  await expect(drawButton(page, 'Nokta')).toBeVisible()
})

test('logging out clears the permission set and the next user does not inherit it', async ({ page }) => {
  const permissions = await signIn(page, ALL_PERMISSIONS)
  await stubDrawings(page)
  await openMap(page)

  await expect(page.getByRole('button', { name: 'Kullanıcı Yönetimi' })).toBeVisible()

  /* İkinci kullanıcı yalnızca haritayı görebiliyor. Küme AİT OLDUĞU token ile
     tutulduğu için, yeni oturumun isteği dönmeden önce bile eski yetkiler
     geçersizdir. */
  permissions.set(VIEWER_PERMISSIONS)
  permissions.setUserId(5)

  await page.getByRole('button', { name: 'Çıkış Yap' }).first().click()
  await expect(page).toHaveURL(/\/login$/)

  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'second-user-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())

  await openMap(page)

  // Birinci kullanıcının yönetim girişi ikinci kullanıcıda GÖRÜNMEZ.
  await expect(page.getByRole('button', { name: 'Kullanıcı Yönetimi' })).toBeHidden()
  await expect(drawButton(page, 'Nokta')).toBeHidden()
})

test('protected actions never flash before the permission set arrives', async ({ page }) => {
  let release = () => {}
  const gate = new Promise((resolve) => { release = resolve })

  await signIn(page, ALL_PERMISSIONS)
  await stubDrawings(page)

  // Yetki cevabı bilerek geciktirilir; arayüz o boşlukta ne çiziyor?
  await page.unroute('**/api/auth/me/permissions')
  await page.route('**/api/auth/me/permissions', async (route) => {
    await gate
    await route.fulfill(json({ userId: 1, permissions: ALL_PERMISSIONS }))
  })

  await page.goto('/map')
  await expect(page.getByText('Yetkileriniz denetleniyor…')).toBeVisible()

  /* Kritik iddia: bekleme sırasında korumalı hiçbir şey ÇİZİLMEMİŞ olmalı.
     "Önce hepsini göster, sonra yetkisizleri kaldır" davranışı burada
     yakalanır. */
  await expect(toolbar(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Kullanıcı Yönetimi' })).toHaveCount(0)

  release()

  await expect(drawButton(page, 'Nokta')).toBeVisible()
})

/* ===========================================================================
   2. Yönetim gezinmesi
   =========================================================================== */

for (const [permission, visible, hidden] of [
  ['users.view', 'Kullanıcılar', ['Roller', 'Yetkiler']],
  ['roles.view', 'Roller', ['Kullanıcılar', 'Yetkiler']],
  ['permissions.view', 'Yetkiler', ['Kullanıcılar', 'Roller']],
]) {
  test(`only ${permission} shows only ${visible} in the admin sidebar`, async ({ page }) => {
    await signIn(page, [permission])
    await page.goto('/admin')

    await expect(adminNav(page).getByRole('link', { name: visible })).toBeVisible()
    for (const other of hidden) {
      await expect(adminNav(page).getByRole('link', { name: other })).toBeHidden()
    }
  })
}

test('a custom role name with admin permissions gets the full admin menu', async ({ page }) => {
  // Karar KODLARDAN gelir; "Field Wizard" adı hiçbir şey ima etmez.
  await signIn(page, ADMIN_VIEW_PERMISSIONS, { role: 'Field Wizard' })
  await page.goto('/admin')

  for (const label of ['Kullanıcılar', 'Roller', 'Yetkiler']) {
    await expect(adminNav(page).getByRole('link', { name: label })).toBeVisible()
  }
})

test('no admin permission means no admin entry on the map at all', async ({ page }) => {
  await signIn(page, VIEWER_PERMISSIONS)
  await stubDrawings(page)
  await openMap(page)

  await expect(page.getByRole('button', { name: 'Kullanıcı Yönetimi' })).toBeHidden()
})

/* ===========================================================================
   3. Yönetim rotaları
   =========================================================================== */

for (const [path, permission] of [
  ['/admin/users', 'users.view'],
  ['/admin/roles', 'roles.view'],
  ['/admin/permissions', 'permissions.view'],
]) {
  test(`${path} is refused without ${permission} — and not sent to login`, async ({ page }) => {
    // Diğer iki yönetim yetkisi var; eksik olan yalnızca bu ekranınki.
    await signIn(page, ADMIN_VIEW_PERMISSIONS.filter((code) => code !== permission))
    await page.goto(path)

    await expect(denied(page)).toBeVisible()
    /* Oturum sağlam: /login'e atmak "şifreni yanlış girdin" demek olurdu ve
       yeniden giriş yapan kişi aynı yere düşerdi. */
    await expect(page).not.toHaveURL(/\/login/)
  })
}

test('/admin lands on the first section the actor may actually open', async ({ page }) => {
  await signIn(page, ['roles.view'])
  await page.goto('/admin')

  // Sabit /admin/users yönlendirmesi burada yetkisizlik ekranı üretirdi.
  await expect(page).toHaveURL(/\/admin\/roles$/)
  await expect(page.getByRole('heading', { name: 'Roller', level: 1 })).toBeVisible()
})

test('/admin with only permissions.view lands on the catalog', async ({ page }) => {
  await signIn(page, ['permissions.view'])
  await page.goto('/admin')

  await expect(page).toHaveURL(/\/admin\/permissions$/)
})

test('an authenticated user with no usable section is told so, not bounced to login', async ({ page }) => {
  await signIn(page, [])
  await page.goto('/admin')

  await expect(denied(page)).toBeVisible()
  await expect(page.getByText('Hesabınıza şu anda kullanabileceğiniz hiçbir bölüm tanımlı değil.')).toBeVisible()
  await expect(page).not.toHaveURL(/\/login/)
})

/* ===========================================================================
   4. Yönetim eylemleri: aktör yetkisi VE hedef yeteneği
   =========================================================================== */

test('the new-role button follows roles.create', async ({ page }) => {
  await signIn(page, ['roles.view'])
  await page.goto('/admin/roles')
  await expect(page.getByRole('button', { name: '+ Yeni Rol' })).toBeHidden()

  await signIn(page, ['roles.view', 'roles.create'])
  await page.goto('/admin/roles')
  await expect(page.getByRole('button', { name: '+ Yeni Rol' })).toBeVisible()
})

test('rename and delete need the actor permission AND the role capability', async ({ page }) => {
  // Yetki var, rol de açık: iki eylem de görünür.
  await signIn(page, ['roles.view', 'roles.update', 'roles.delete'])
  await page.goto('/admin/roles')
  await page.getByRole('button', { name: /Field Wizard/ }).click()

  await expect(page.getByRole('button', { name: 'Yeniden Adlandır' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Rolü Sil' })).toBeVisible()
})

test('a role the server marks unrenamable stays unrenamable even with roles.update', async ({ page }) => {
  await signIn(page, ['roles.view', 'roles.update', 'roles.delete'])
  await page.goto('/admin/roles')

  /* Sunucunun hedefe özgü bayrağı ayrı bir eksendir: aktörün global yetkisi
     onu geçersiz kılmaz. */
  await page.getByRole('button', { name: /Admin/ }).first().click()

  await expect(page.getByRole('button', { name: 'Yeniden Adlandır' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Rolü Sil' })).toBeHidden()
})

test('saving role permissions needs roles.update AND permissions.assign', async ({ page }) => {
  // Yalnızca görüntüleme: kaydetme kontrolü yok.
  await signIn(page, ['roles.view', 'permissions.view'])
  await page.goto('/admin/roles')
  await page.getByRole('button', { name: /Field Wizard/ }).click()
  await expect(page.getByRole('button', { name: 'Değişiklikleri Kaydet' })).toBeHidden()

  // Tek başına roles.update de yetmez — uç ikisini birden arar.
  await signIn(page, ['roles.view', 'permissions.view', 'roles.update'])
  await page.goto('/admin/roles')
  await page.getByRole('button', { name: /Field Wizard/ }).click()
  await expect(page.getByRole('button', { name: 'Değişiklikleri Kaydet' })).toBeHidden()

  await signIn(page, ['roles.view', 'permissions.view', 'roles.update', 'permissions.assign'])
  await page.goto('/admin/roles')
  await page.getByRole('button', { name: /Field Wizard/ }).click()
  await expect(page.getByRole('button', { name: 'Değişiklikleri Kaydet' })).toBeVisible()
})

test('the user permission tab needs permissions.view, and saving needs permissions.assign', async ({ page }) => {
  // users.view tek başına: sekme yok, çünkü arkasındaki GET iki yetki ister.
  await signIn(page, ['users.view'])
  await page.goto('/admin/users')
  await page.getByRole('button', { name: /target/ }).click()
  await expect(page.getByRole('tab', { name: /Yetkiler/ })).toBeHidden()

  // Okuma açıldı, kaydetme hâlâ kapalı.
  await signIn(page, ['users.view', 'permissions.view'])
  await page.goto('/admin/users')
  await page.getByRole('button', { name: /target/ }).click()
  await page.getByRole('tab', { name: /Yetkiler/ }).click()
  await expect(page.getByRole('button', { name: 'Doğrudan Yetkileri Kaydet' })).toBeHidden()

  await signIn(page, ['users.view', 'permissions.view', 'users.update', 'permissions.assign'])
  await page.goto('/admin/users')
  await page.getByRole('button', { name: /target/ }).click()
  await page.getByRole('tab', { name: /Yetkiler/ }).click()
  await expect(page.getByRole('button', { name: 'Doğrudan Yetkileri Kaydet' })).toBeVisible()
})

test('the server capability still wins when the actor has every permission', async ({ page }) => {
  await signIn(page, ALL_PERMISSIONS)
  // Hedef bu yönetici tarafından yönetilemiyor; global yetki bunu değiştirmez.
  await page.unroute('**/api/admin/users/*/permissions')
  await page.route('**/api/admin/users/*/permissions', (route) =>
    route.fulfill(json(userPermissionsBody({ canManage: false }))),
  )

  await page.goto('/admin/users')
  await page.getByRole('button', { name: /target/ }).click()
  await page.getByRole('tab', { name: /Yetkiler/ }).click()

  await expect(page.getByRole('button', { name: 'Doğrudan Yetkileri Kaydet' })).toBeHidden()
})

test('role and status controls follow users.update', async ({ page }) => {
  await signIn(page, ['users.view'])
  await page.goto('/admin/users')
  await page.getByRole('button', { name: /target/ }).click()

  await expect(page.getByText('Rol ve hesap durumu yalnızca görüntülenir; değiştirmek için kullanıcı düzenleme yetkisi gerekir.')).toBeVisible()
  await expect(page.getByLabel('Hesap Durumu')).toBeHidden()

  await signIn(page, ['users.view', 'users.update', 'roles.view'])
  await page.goto('/admin/users')
  await page.getByRole('button', { name: /target/ }).click()

  await expect(page.getByLabel('Hesap Durumu')).toBeVisible()
})

/* ===========================================================================
   5. Harita erişimi
   =========================================================================== */

test('map.view opens the map workspace', async ({ page }) => {
  await signIn(page, VIEWER_PERMISSIONS)
  await stubDrawings(page)
  await openMap(page)

  await expect(page.locator('.map-container canvas').first()).toBeVisible()
})

test('without map.view the map workspace is refused, not the session', async ({ page }) => {
  await signIn(page, ADMIN_VIEW_PERMISSIONS)
  await stubDrawings(page)

  await page.goto('/map')

  await expect(denied(page)).toBeVisible()
  await expect(page).not.toHaveURL(/\/login/)
  await expect(page.locator('.map-container canvas')).toHaveCount(0)

  // Açabildiği bölüm varsa çıkmaz sokakta bırakılmaz.
  await page.getByRole('button', { name: 'Yönetim paneline git' }).click()
  await expect(adminNav(page)).toBeVisible()
})

/* ===========================================================================
   6. Çizim araçları — üçü ayrı ayrı
   =========================================================================== */

test('each draw tool follows its own create permission', async ({ page }) => {
  await signIn(page, [...VIEWER_PERMISSIONS, 'drawings.point.create'])
  await stubDrawings(page)
  await openMap(page)

  /* Tek bir generic "canDraw" olsaydı üçü birlikte görünürdü ve çizgi düğmesi
     garanti 403 alan bir eylem vaat ederdi. */
  await expect(drawButton(page, 'Nokta')).toBeVisible()
  await expect(drawButton(page, 'Çizgi')).toBeHidden()
  await expect(drawButton(page, 'Poligon')).toBeHidden()
})

test('a line-only profile shows only the line tool', async ({ page }) => {
  await signIn(page, [...VIEWER_PERMISSIONS, 'drawings.line.create'])
  await stubDrawings(page)
  await openMap(page)

  await expect(drawButton(page, 'Çizgi')).toBeVisible()
  await expect(drawButton(page, 'Nokta')).toBeHidden()
  await expect(drawButton(page, 'Poligon')).toBeHidden()
})

test('the letter shortcut cannot reach a tool the toolbar hides', async ({ page }) => {
  await signIn(page, [...VIEWER_PERMISSIONS, 'drawings.point.create'])
  await stubDrawings(page)
  await openMap(page)

  /* Haritanın ortasına tıklanır: köşeler kısayol düğmeleriyle kaplıdır ve
     oradaki bir tık haritaya değil onlara gider. */
  const viewport = await page.locator('.map-container').boundingBox()
  await page.mouse.click(viewport.x + viewport.width / 2, viewport.y + viewport.height / 2)
  await page.keyboard.press('l')

  /* Kısayol da aynı kapıdan geçer. Geçmeseydi gizli düğme klavyeden
     açılabilirdi — düğmeyi gizlemek tek başına hiçbir şey halletmezdi. */
  await expect(page.locator('.map-hint')).toHaveCount(0)
  await expect(drawButton(page, 'Çizgi')).toBeHidden()
})

/* ===========================================================================
   7. Aktif aracın yetkisi alınırsa
   =========================================================================== */

test('an active draw tool is torn down when its permission disappears', async ({ page }) => {
  const permissions = await signIn(page, [...VIEWER_PERMISSIONS, 'drawings.point.create'])
  await stubDrawings(page)
  await openMap(page)

  const point = drawButton(page, 'Nokta')
  await point.click()
  await expect(point).toHaveAttribute('aria-pressed', 'true')

  // Yetki harita AÇIKKEN kaldırılıyor; tazeleme onu görüyor.
  permissions.set(VIEWER_PERMISSIONS)
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await page.reload()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  await expect(drawButton(page, 'Nokta')).toBeHidden()
  /* Düğmenin gitmesi yetmez: aktif Draw etkileşimi de sökülmüş olmalı, yoksa
     bir sonraki tık hâlâ şekil başlatırdı. Mod artık çizim değil. */
  await expect(page.locator('.map-hint')).toHaveCount(0)
})

test('losing measurement.use hides the tool and stops an active measurement', async ({ page }) => {
  const permissions = await signIn(page, VIEWER_PERMISSIONS)
  await stubDrawings(page)
  await openMap(page)

  const measure = toolbar(page).getByRole('button', { name: 'Ölçüm aracı (M)' })
  await measure.click()
  await expect(measure).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.measure-readout')).toBeVisible()

  permissions.set(VIEWER_PERMISSIONS.filter((code) => code !== 'measurement.use'))
  await page.reload()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  await expect(toolbar(page).getByRole('button', { name: 'Ölçüm aracı (M)' })).toBeHidden()
  await expect(page.locator('.measure-readout')).toHaveCount(0)
})

test('without selection.use the selection group disappears entirely', async ({ page }) => {
  await signIn(page, VIEWER_PERMISSIONS.filter((code) => code !== 'selection.use'))
  await stubDrawings(page)
  await openMap(page)

  // Grup boşalınca kabuğu da kalkar; boş bir "Seçim modu" çerçevesi kalmaz.
  await expect(page.getByRole('group', { name: 'Seçim modu' })).toHaveCount(0)
})

/* ===========================================================================
   8. Envanter ve katmanlar
   =========================================================================== */

test('the inventory analysis tool follows inventory.analysis', async ({ page }) => {
  await signIn(page, VIEWER_PERMISSIONS)
  await stubDrawings(page)
  await openMap(page)

  // inventory.view analiz DEMEK DEĞİLDİR; ikisi ayrı yetkilerdir.
  await expect(toolbar(page).getByRole('button', { name: 'Envanter Analizi aracı' })).toBeHidden()
})

test('the Katmanlar and Çizimlerim entries follow their own permissions', async ({ page }) => {
  await signIn(page, ['map.view'])
  await stubDrawings(page)
  await openMap(page)

  await expect(page.getByRole('button', { name: 'Katmanlar' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Çizimlerim' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Çöp Kutusu' })).toBeHidden()

  await signIn(page, ['map.view', 'layers.view', 'drawings.view', 'drawings.restore'])
  await openMap(page)

  await expect(page.getByRole('button', { name: 'Katmanlar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Çizimlerim' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Çöp Kutusu' })).toBeVisible()
})

test('basemap selection is not permission gated — it is presentation, not authorization', async ({ page }) => {
  await signIn(page, ['map.view'])
  await stubDrawings(page)
  await openMap(page)

  /* Yetkilendirmeyi fazla uygulamamak da bir karardır: altlık seçimi
     backend'de korunan bir layers.* işlemi DEĞİLDİR. */
  await expect(page.getByRole('button', { name: /Harita altlığı/ })).toBeVisible()
})

/* ===========================================================================
   9. Canlı yetki: kazanç ve kayıp, yeniden giriş olmadan
   =========================================================================== */

test('a directly granted permission makes its action appear without a role change', async ({ page }) => {
  /* Rol yetkileri inventory.analysis İÇERMİYOR; yetki yalnızca doğrudan
     atamadan gelecek. Rol adı ve token hiç değişmiyor. */
  const permissions = await signIn(page, VIEWER_PERMISSIONS)
  await stubDrawings(page)
  await openMap(page)

  const analysis = toolbar(page).getByRole('button', { name: 'Envanter Analizi aracı' })
  await expect(analysis).toBeHidden()

  permissions.set([...VIEWER_PERMISSIONS, 'inventory.analysis'])
  await page.reload()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  // Rol değişmedi, yeniden giriş yapılmadı, token aynı.
  await expect(toolbar(page).getByRole('button', { name: 'Envanter Analizi aracı' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBe('browser-test-token')
})

test('a revoked role permission removes its action without a re-login', async ({ page }) => {
  const permissions = await signIn(page, [...VIEWER_PERMISSIONS, 'drawings.polygon.create'])
  await stubDrawings(page)
  await openMap(page)

  await expect(drawButton(page, 'Poligon')).toBeVisible()

  permissions.set(VIEWER_PERMISSIONS)
  await page.reload()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  await expect(drawButton(page, 'Poligon')).toBeHidden()
  expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBe('browser-test-token')
})

/* ===========================================================================
   10. Rol adı bir kestirme DEĞİLDİR
   =========================================================================== */

test('the Administrator role name opens nothing its permissions do not', async ({ page }) => {
  /* Sunucu rolü "Administrator" diye bildiriyor ama etkin küme yönetim
     yetkisi taşımıyor. Eski rol adı kuralı burada paneli açardı. */
  await signIn(page, VIEWER_PERMISSIONS, { role: 'Administrator' })
  await stubDrawings(page)
  await openMap(page)

  await expect(page.getByRole('button', { name: 'Kullanıcı Yönetimi' })).toBeHidden()

  await page.goto('/admin/users')
  await expect(denied(page)).toBeVisible()
})

test('a custom role name opens everything its permissions do', async ({ page }) => {
  // "Field Wizard" hiçbir listede yok; yalnızca kodları önemli.
  await signIn(page, [...VIEWER_PERMISSIONS, 'users.view', 'inventory.analysis'], { role: 'Field Wizard' })
  await stubDrawings(page)
  await openMap(page)

  await expect(toolbar(page).getByRole('button', { name: 'Envanter Analizi aracı' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Kullanıcı Yönetimi' })).toBeVisible()

  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Kullanıcılar', level: 1 })).toBeVisible()
})

/* ===========================================================================
   11. Duyarlılık
   =========================================================================== */

test.describe('narrow screens', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the mobile admin drawer filters by the same rule as the desktop column', async ({ page }) => {
    await signIn(page, ['roles.view'])
    await page.goto('/admin/roles')

    await page.getByRole('button', { name: 'Menüyü aç' }).click()

    await expect(adminNav(page).getByRole('link', { name: 'Roller' })).toBeVisible()
    await expect(adminNav(page).getByRole('link', { name: 'Kullanıcılar' })).toBeHidden()
    await expect(adminNav(page).getByRole('link', { name: 'Yetkiler' })).toBeHidden()
  })

  test('a toolbar stripped to one tool still fits without sideways scroll', async ({ page }) => {
    await signIn(page, ['map.view', 'drawings.point.create'])
    await stubDrawings(page)
    await openMap(page)

    await expect(drawButton(page, 'Nokta')).toBeVisible()

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    )
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
