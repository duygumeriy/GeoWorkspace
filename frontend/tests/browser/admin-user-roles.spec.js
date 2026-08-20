import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'

/**
 * The users screen against dynamic roles.
 *
 * The role filter used to offer a fixed Admin/User pair, so a Viewer or a
 * custom role could not be filtered at all. Its options now come from the users
 * actually loaded — deliberately NOT from /api/admin/users/roles, which answers
 * a different question ("what may I assign") and is actor-specific: a role the
 * current admin cannot grant may still be worn by someone in the list.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/** Roles the server says this actor may assign. Not the filter's source. */
const ASSIGNABLE = [
  { name: 'Viewer', description: 'Haritayı görüntüler.', requiresTwoFactor: false },
  { name: 'GIS Editor', description: 'Çizim oluşturur ve düzenler.', requiresTwoFactor: false },
  { name: 'GIS Analyst', description: 'Analiz araçlarını kullanır.', requiresTwoFactor: false },
  { name: 'Administrator', description: 'Tüm yönetim yetkilerini taşır.', requiresTwoFactor: true },
  { name: 'Saha Ekibi', description: 'Yöneticinin tanımladığı özel rol.', requiresTwoFactor: false },
]

const user = (id, username, role, extra = {}) => ({
  id,
  username,
  email: `${username}@example.invalid`,
  role,
  isActive: true,
  emailConfirmed: true,
  accountStatus: 'Active',
  twoFactorEnabled: false,
  lockoutEnd: null,
  modifiedDate: '2026-08-17T10:00:00Z',
  ...extra,
})

/* Deliberately messy, the way real data is: legacy roles, target roles, a
   custom role, a duplicate and an account with no role at all. */
const USERS = [
  user(1, 'admin', 'Admin', { twoFactorEnabled: true }),
  user(2, 'eski-kullanici', 'User'),
  user(3, 'goruntuleyen', 'Viewer'),
  user(4, 'cizim-eden', 'GIS Editor'),
  user(5, 'ikinci-cizimci', 'GIS Editor'),
  user(6, 'yonetici', 'Administrator'),
  user(7, 'saha', 'Saha Ekibi'),
  user(8, 'onay-bekleyen', null, { isActive: false, accountStatus: 'PendingApproval' }),
]

async function openUsers(page, { users = USERS, onRoleChange } = {}) {
  /* Yetki ucu da yanıtlanmalı: arayüz küme gelene kadar korumalı hiçbir şeyi
     çizmez (fail-closed). Bu spec yetki KURALLARINI ölçmüyor, bu yüzden tam
     küme verilir; kuralların kendisi permission-aware-ui.spec.js'in işidir. */
  await mockPermissions(page)

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: 1, username: 'admin', emailConfirmed: true, twoFactorEnabled: true, role: 'Admin', roles: ['Admin'] })),
  )
  await page.route('**/api/admin/users/roles', (route) => route.fulfill(json(ASSIGNABLE)))
  for (const u of users) {
    await page.route(`**/api/admin/users/${u.id}/role`, (route) => onRoleChange(route, u))
    await page.route(`**/api/admin/users/${u.id}`, (route) => route.fulfill(json(u)))
  }
  await page.route('**/api/admin/users', (route) => route.fulfill(json(users)))

  await page.goto('/login')
  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-admin-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Kullanıcılar', level: 1 })).toBeVisible()
}

const roleFilter = (page) => page.getByRole('combobox', { name: 'Rol' })
const rows = (page) => page.getByRole('button', { name: /kullanıcısının detayını aç/ })

/* --- Filtre seçenekleri ----------------------------------------------------- */

test('the role filter offers every role represented in the loaded users', async ({ page }) => {
  await openUsers(page)

  /* Canonical roles keep their product order. Every remaining role is treated
     generically and sorted afterward; retired names get no special priority. */
  await expect(roleFilter(page).locator('option')).toHaveText([
    'Tümü',
    'Viewer',
    'GIS Editor',
    'Administrator',
    'Admin',
    'Saha Ekibi',
    'User',
  ])

  /* `GIS Analyst` sunucunun atanabilir listesinde VAR ama bu kullanıcı
     listesinde kimse taşımıyor — dolayısıyla filtrede yok. Filtre kataloğu
     değil, ekrandaki veriyi yansıtır. */
  await expect(roleFilter(page).locator('option', { hasText: /^GIS Analyst$/ })).toHaveCount(0)
})

test('a custom role appears without any frontend change', async ({ page }) => {
  // A role this file has never heard of, invented by an administrator.
  await openUsers(page, { users: [user(1, 'admin', 'Admin'), user(9, 'olcumcu', 'Kadastro Ölçüm')] })

  await expect(roleFilter(page).locator('option')).toHaveText(['Tümü', 'Admin', 'Kadastro Ölçüm'])
})

test('a repeated role produces exactly one option', async ({ page }) => {
  await openUsers(page)

  // Two users hold GIS Editor; the filter must not list it twice.
  await expect(roleFilter(page).locator('option', { hasText: /^GIS Editor$/ })).toHaveCount(1)
})

test('accounts without a role do not create a broken option', async ({ page }) => {
  await openUsers(page, {
    users: [user(1, 'admin', 'Admin'), user(8, 'onay-bekleyen', null), user(10, 'bos', '  ')],
  })

  /* Rolsüz hesaplar listede DURUR ama filtrede seçenek üretmez: boş etiketli,
     seçilince hiçbir şeyi filtrelemeyen bir satır olurdu. */
  await expect(roleFilter(page).locator('option')).toHaveText(['Tümü', 'Admin'])
  await expect(rows(page)).toHaveCount(3)
})

test('the filter offers only what is present, not the whole catalogue', async ({ page }) => {
  await openUsers(page, { users: [user(3, 'goruntuleyen', 'Viewer')] })

  /* Kimsenin taşımadığı bir rol sunulmaz — seçilse yalnızca boş liste verirdi.
     Sunucunun atanabilir rol listesi (GIS Editor, Administrator, …) burada
     bilinçli olarak KAYNAK DEĞİL. */
  await expect(roleFilter(page).locator('option')).toHaveText(['Tümü', 'Viewer'])
})

/* --- Filtreleme davranışı ---------------------------------------------------- */

test('choosing a dynamic role narrows the list to that role', async ({ page }) => {
  await openUsers(page)
  await expect(rows(page)).toHaveCount(8)

  await roleFilter(page).selectOption('GIS Editor')
  await expect(rows(page)).toHaveCount(2)
  await expect(page.getByRole('button', { name: /^cizim-eden/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^goruntuleyen/ })).toHaveCount(0)

  await roleFilter(page).selectOption('Saha Ekibi')
  await expect(rows(page)).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^saha/ })).toBeVisible()

  // The legacy roles keep working for the accounts that still hold them.
  await roleFilter(page).selectOption('Admin')
  await expect(rows(page)).toHaveCount(1)
  await expect(page.getByRole('button', { name: /^admin/ })).toBeVisible()

  await roleFilter(page).selectOption('Tümü')
  await expect(rows(page)).toHaveCount(8)
})

/* --- Rol değiştirme mesajı ---------------------------------------------------- */

test('the role-change confirmation and result name the role that was chosen', async ({ page }) => {
  await openUsers(page, {
    onRoleChange: async (route, target) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      route.fulfill(json({ ...target, role: body.role }))
    },
  })

  await page.getByRole('button', { name: /^goruntuleyen/ }).click()
  await expect(page.getByRole('dialog', { name: 'goruntuleyen' })).toBeVisible()

  // The change control offers the server's assignable roles, not Admin/User.
  const roleSelect = page.getByRole('dialog').getByRole('combobox', { name: 'Rol' })
  await expect(roleSelect.locator('option')).toHaveText([
    'Viewer', 'GIS Editor', 'GIS Analyst', 'Administrator', 'Saha Ekibi',
  ])

  await roleSelect.selectOption('GIS Editor')

  // The confirmation describes the chosen role from the server's own wording.
  await expect(page.getByRole('alertdialog')).toContainText('rolü GIS Editor olsun mu?')
  await expect(page.getByRole('alertdialog')).toContainText('Çizim oluşturur ve düzenler.')
  await page.getByRole('button', { name: 'Rolü Değiştir' }).click()

  /* Eski hâl burada "Rol User olarak değiştirildi." derdi — seçilen rol GIS
     Editor olmasına rağmen. */
  await expect(page.getByRole('status')).toContainText('Kullanıcının rolü GIS Editor olarak güncellendi.')
  await expect(page.getByRole('status')).not.toContainText('User olarak')
})

test('a custom role is reported by its own name', async ({ page }) => {
  await openUsers(page, {
    onRoleChange: async (route, target) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      route.fulfill(json({ ...target, role: body.role }))
    },
  })

  await page.getByRole('button', { name: /^goruntuleyen/ }).click()
  await page.getByRole('dialog').getByRole('combobox', { name: 'Rol' }).selectOption('Saha Ekibi')
  await page.getByRole('button', { name: 'Rolü Değiştir' }).click()

  await expect(page.getByRole('status')).toContainText('Kullanıcının rolü Saha Ekibi olarak güncellendi.')
})

test('a role that requires a second factor still says so', async ({ page }) => {
  await openUsers(page, {
    onRoleChange: async (route, target) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      route.fulfill(json({ ...target, role: body.role }))
    },
  })

  await page.getByRole('button', { name: /^goruntuleyen/ }).click()
  await page.getByRole('dialog').getByRole('combobox', { name: 'Rol' }).selectOption('Administrator')
  await page.getByRole('button', { name: 'Rolü Değiştir' }).click()

  /* Uyarı rol ADINDAN değil, sunucunun requiresTwoFactor alanından gelir; hedef
     kullanıcının 2FA'sı kapalı olduğu için gösterilir. */
  await expect(page.getByRole('status')).toContainText('Kullanıcının rolü Administrator olarak güncellendi.')
  await expect(page.getByRole('status')).toContainText('zorunlu 2FA kurulumuna yönlendirilecektir')
})

test('a legacy role the actor cannot assign is still shown as the current role', async ({ page }) => {
  await openUsers(page)

  await page.getByRole('button', { name: /^eski-kullanici/ }).click()

  /* `User` atanabilir listede yok (legacy), ama kullanıcının GERÇEK rolü o.
     Seçenek olarak eklenmezse açılır liste yanlış bir rol gösterirdi. */
  const roleSelect = page.getByRole('dialog').getByRole('combobox', { name: 'Rol' })
  await expect(roleSelect).toHaveValue('User')
  await expect(roleSelect.locator('option[disabled]')).toHaveText(['User'])
})
