import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'

/**
 * The admin panel shell: one sidebar, three destinations, and a layout that
 * survives a phone.
 *
 * Everything is mocked at the network boundary — these tests are about the
 * shell, not the rules. Authorization itself is enforced server-side and
 * covered by the backend suite; the UI must never be the thing that decides.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const ROLES = [
  { name: 'Viewer', description: 'Yalnızca görüntüleme.', requiresTwoFactor: false },
  { name: 'Administrator', description: 'Tüm yönetim yetkileri.', requiresTwoFactor: true },
]

const admin = {
  id: 1,
  username: 'admin',
  email: 'admin@example.invalid',
  role: 'Admin',
  isActive: true,
  emailConfirmed: true,
  accountStatus: 'Active',
  twoFactorEnabled: true,
  lockoutEnd: null,
  modifiedDate: '2026-08-01T10:00:00Z',
}

/**
 * Signs the browser in and stubs the admin endpoints.
 *
 * @param {string} role the role the server reports for the current user
 */
async function signIn(page, { role = 'Admin' } = {}) {
  /* Yetki ucu da yanıtlanmalı: arayüz küme gelene kadar korumalı hiçbir şeyi
     çizmez (fail-closed). Bu spec yetki KURALLARINI ölçmüyor, bu yüzden tam
     küme verilir; kuralların kendisi permission-aware-ui.spec.js'in işidir. */
  await mockPermissions(page)

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({
      userId: 1,
      username: 'admin',
      email: admin.email,
      emailConfirmed: true,
      twoFactorEnabled: true,
      role,
      roles: [role],
    })),
  )
  await page.route('**/api/admin/users/roles', (route) => route.fulfill(json(ROLES)))
  await page.route('**/api/admin/users/1', (route) => route.fulfill(json(admin)))
  await page.route('**/api/admin/users', (route) => route.fulfill(json([admin])))
  /* Roller ekranı artık gerçek envanteri okuyor; kabuk testleri onun içeriğini
     değil, yalnızca rotanın kabuğun içinde açıldığını doğrular. */
  await page.route('**/api/admin/roles', (route) => route.fulfill(json([
    { id: 1, name: 'Admin', userCount: 1, permissionCount: 27, isSystem: true, isLegacy: true, isAssignable: false, canRename: false, canDelete: false, canEditPermissions: false },
  ])))
  /* Yetkiler de Phase 5D'de gerçek bir ekran oldu ve açılışta kataloğu okuyor.
     Kabuk testleri onun davranışını ölçmez (o admin-permissions.spec.js'in
     işi); burada yalnızca rotanın kabuk içinde veriyle açılması gerekir. */
  await page.route('**/api/admin/permissions', (route) => route.fulfill(json([
    { id: 29, code: 'map.view', name: 'Haritayı Görüntüleme', description: 'Harita uygulamasını açabilir.', category: 'Map', isActive: true, sortOrder: 100 },
  ])))

  await page.goto('/login')
  /* An hour out, not a far-future date: AuthContext schedules the automatic
     logout with setTimeout, and a delay past the 32-bit limit fires straight
     away — which would sign this session out before the page even renders. */
  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-admin-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())
}

const nav = (page) => page.getByRole('navigation', { name: 'Yönetim menüsü' })

/* --- Kabuk ve gezinme ------------------------------------------------------ */

test('the shell renders one sidebar with the four admin destinations', async ({ page }) => {
  await signIn(page)
  await page.goto('/admin/users')

  await expect(nav(page)).toBeVisible()
  await expect(nav(page).getByRole('link', { name: 'Kullanıcılar' })).toBeVisible()
  await expect(nav(page).getByRole('link', { name: 'Roller' })).toBeVisible()
  await expect(nav(page).getByRole('link', { name: 'Yetkiler' })).toBeVisible()
  await expect(nav(page).getByRole('link', { name: 'Aktivite Geçmişi' })).toBeVisible()

  // Exactly one navigation: a page growing its own copy would show two.
  await expect(page.getByRole('navigation', { name: 'Yönetim menüsü' })).toHaveCount(1)

  /* Coğrafi yetki menüde KENDİ girişi olarak durmaz ve durmamalıdır: bir
     kullanıcının ya da rolün alanı, o kaydın detayından yönetilir. Ayrı bir
     menü girişi, "hangi hedefin alanı" sorusunu cevapsız bırakan bir kapı
     olurdu. */
  // Dört bölüm + haritaya dönüş bağlantısı. Sayı, yeni bir girişin fark
  // edilmeden eklenmesine karşı bir bekçidir.
  await expect(nav(page).getByRole('link')).toHaveCount(5)
  await expect(nav(page).getByText(/coğraf/i)).toHaveCount(0)
})

test('/admin redirects to the users screen', async ({ page }) => {
  await signIn(page)
  await page.goto('/admin')

  await expect(page).toHaveURL(/\/admin\/users$/)
  await expect(page.getByRole('heading', { name: 'Kullanıcılar', level: 1 })).toBeVisible()
})

test('the active navigation item follows the current route', async ({ page }) => {
  await signIn(page)
  await page.goto('/admin/users')

  const users = nav(page).getByRole('link', { name: 'Kullanıcılar' })
  const roles = nav(page).getByRole('link', { name: 'Roller' })

  /* aria-current is the assertion that matters: it is what a screen reader
     announces, and it cannot be satisfied by a colour change alone. */
  await expect(users).toHaveAttribute('aria-current', 'page')
  await expect(roles).not.toHaveAttribute('aria-current', 'page')

  await roles.click()

  await expect(page).toHaveURL(/\/admin\/roles$/)
  await expect(roles).toHaveAttribute('aria-current', 'page')
  await expect(users).not.toHaveAttribute('aria-current', 'page')
})

test('the sidebar returns to the real map route', async ({ page }) => {
  await signIn(page)
  await page.goto('/admin/users')

  // The href is asserted rather than followed: this is about the shell
  // pointing at the app's actual map route, not about the map booting.
  await expect(nav(page).getByRole('link', { name: 'Haritaya Dön' })).toHaveAttribute('href', '/map')
})

/* --- Sayfalar -------------------------------------------------------------- */

test('the users screen keeps its existing content inside the shell', async ({ page }) => {
  await signIn(page)
  await page.goto('/admin/users')

  await expect(page.getByRole('heading', { name: 'Kullanıcılar', level: 1 })).toBeVisible()
  // The real, previously existing functionality: filters and the user list.
  await expect(page.getByRole('region', { name: 'Kullanıcı filtreleri' })).toBeVisible()
  await expect(page.getByRole('button', { name: /admin kullanıcısının detayını aç/ })).toBeVisible()

  /* The page-level "← Haritaya dön" link was shell chrome and moved into the
     sidebar; leaving it would give the screen two ways back and two headers. */
  await expect(page.getByRole('link', { name: '← Haritaya dön' })).toHaveCount(0)
})

test('all three destinations are real screens now, with no placeholder left', async ({ page }) => {
  await signIn(page)

  /* Roller Phase 5B'de gerçek oldu; yer tutucusu bilinçli olarak kaldırıldı.
     Ekranın kendi davranışı admin-roles.spec.js'te doğrulanıyor — burada
     ölçülen, rotanın kabuğun içinde açılması. */
  await page.goto('/admin/roles')
  await expect(page.getByRole('heading', { name: 'Roller', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: '+ Yeni Rol' })).toBeVisible()
  await expect(page.getByText('Bu ekran hazırlanıyor')).toHaveCount(0)

  /* Yetkiler Phase 5D'de gerçek kataloğu okumaya başladı. Yer tutucu artık
     yok ve ekran SALT OKUNURDUR: katalogda oluşturma/silme yoktur, o yüzden
     kabukta da böyle bir düğme aranmaz. */
  await page.goto('/admin/permissions')
  await expect(page.getByRole('heading', { name: 'Yetkiler', level: 1 })).toBeVisible()
  await expect(page.getByText('Haritayı Görüntüleme')).toBeVisible()
  await expect(page.getByText('Bu ekran hazırlanıyor')).toHaveCount(0)
  await expect(page.getByRole('checkbox')).toHaveCount(0)
})

/* --- Rol uyumluluğu --------------------------------------------------------
   Phase 4 `Administrator`'ı gerçek bir hedef rol yaptı. Backend onu kabul
   ederken React'in onu kapıda durdurması, sunucunun izin verdiği bir yöneticiyi
   arayüzden kilitlemek olurdu. */

/* Phase 7'den önce bu karar rol ADINA bakıyordu ('Admin' | 'Administrator').
   Artık etkin yetki kodlarına bakıyor: aynı ekran, farklı ve doğru sebep.
   Rol adının kendi başına hiçbir şey açmadığı permission-aware-ui.spec.js'te
   ayrıca kanıtlanır. */
test('the panel opens on an admin view permission, whatever the role is called', async ({ page }) => {
  await signIn(page, { role: 'Administrator' })
  await page.goto('/admin/users')

  await expect(nav(page)).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Kullanıcılar', level: 1 })).toBeVisible()

  // Yönetim yetkisi taşımayan kimse geçemez.
  const permissions = await mockPermissions(page, ['map.view'], { userId: 5 })
  expect(permissions.calls).toBe(0)

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: 5, username: 'viewer', emailConfirmed: true, twoFactorEnabled: false, role: 'Viewer', roles: ['Viewer'] })),
  )
  await page.goto('/admin/users')

  /* /login'e YÖNLENDİRİLMEZ: oturum sağlamdır, eksik olan yetkidir. */
  await expect(page.getByRole('heading', { name: 'Bu bölüme erişim yetkiniz yok' })).toBeVisible()
  await expect(page).not.toHaveURL(/\/login/)
  await expect(nav(page)).toBeHidden()
})

/* --- Dar ekran ------------------------------------------------------------- */

test.describe('narrow screens', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the sidebar becomes a drawer that opens, navigates and closes', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/users')

    const menu = page.getByRole('button', { name: 'Menüyü aç' })
    await expect(menu).toBeVisible()

    // Closed: the drawer is off-canvas, so its links are not clickable.
    await expect(nav(page).getByRole('link', { name: 'Roller' })).toBeHidden()

    await menu.click()
    await expect(nav(page).getByRole('link', { name: 'Roller' })).toBeVisible()

    // Choosing a destination navigates AND closes the drawer.
    await nav(page).getByRole('link', { name: 'Roller' }).click()
    await expect(page).toHaveURL(/\/admin\/roles$/)
    await expect(nav(page).getByRole('link', { name: 'Roller' })).toBeHidden()
  })

  test('the drawer closes on Escape and on an outside click', async ({ page }) => {
    await signIn(page)
    await page.goto('/admin/users')

    await page.getByRole('button', { name: 'Menüyü aç' }).click()
    await expect(nav(page).getByRole('link', { name: 'Roller' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(nav(page).getByRole('link', { name: 'Roller' })).toBeHidden()

    await page.getByRole('button', { name: 'Menüyü aç' }).click()
    // The scrim, not the toggle: this is the outside-click path.
    await page.locator('.admin-layout-scrim').click()
    await expect(nav(page).getByRole('link', { name: 'Roller' })).toBeHidden()
  })

  test('the panel never scrolls sideways', async ({ page }) => {
    await signIn(page)

    for (const route of ['/admin/users', '/admin/roles', '/admin/permissions']) {
      await page.goto(route)
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      )
      expect(overflows, `${route} overflows horizontally`).toBe(false)
    }
  })
})
