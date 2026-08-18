import { expect, test } from '@playwright/test'

/**
 * Role management against the global inventory.
 *
 * The DTO here mirrors the backend's RoleListItem exactly: the server decides
 * classification (isLegacy / isSystem) and what may be done (canRename /
 * canDelete / canEditPermissions). These tests assert the UI FOLLOWS those
 * flags rather than re-deriving anything from role names.
 *
 * Everything is mocked at the network boundary — no real role is created or
 * destroyed. The rules themselves live in the backend suite.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/** Matches RoleListItem / RoleDetail (they are the same shape). */
const role = (id, name, flags) => ({
  id,
  name,
  userCount: 0,
  permissionCount: 0,
  isSystem: false,
  isLegacy: false,
  isAssignable: true,
  canRename: false,
  canDelete: false,
  canEditPermissions: true,
  ...flags,
})

const LEGACY_ADMIN = role(1, 'Admin', { userCount: 2, permissionCount: 27, isSystem: true, isLegacy: true, isAssignable: false, canEditPermissions: false })
const LEGACY_USER = role(2, 'User', { userCount: 6, permissionCount: 14, isSystem: true, isLegacy: true, isAssignable: false, canEditPermissions: false })
const VIEWER = role(3, 'Viewer', { userCount: 1, permissionCount: 6, isSystem: true })
const GIS_EDITOR = role(4, 'GIS Editor', { userCount: 3, permissionCount: 14, isSystem: true })
const ADMINISTRATOR = role(7, 'Administrator', { userCount: 0, permissionCount: 27, isSystem: true })
const CUSTOM = role(9, 'Saha Ekibi', { userCount: 0, permissionCount: 0, canRename: true, canDelete: true })

const ROLES = [LEGACY_ADMIN, LEGACY_USER, VIEWER, GIS_EDITOR, ADMINISTRATOR, CUSTOM]

/**
 * Signs in and stubs the role inventory.
 *
 * `onList` lets a test change what the refetch after a mutation returns, which
 * is how "the list re-reads from the server" gets proven.
 */
async function openRoles(page, { onList, onCreate, onRename, onDelete, listStatus, onPermissions } = {}) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: 1, username: 'admin', emailConfirmed: true, twoFactorEnabled: true, role: 'Admin', roles: ['Admin'] })),
  )
  /* Detay açıldığında rolün yetki matrisi okunur (Phase 5C). Bu dosyanın konusu
     rol CRUD'udur, matrisin kendisi değil; boş bir katalog yeterlidir ve hiçbir
     istek ağa çıkmaz. Matrisin davranışı admin-role-permissions.spec.js'te. */
  await page.route('**/api/admin/roles/*/permissions', (route) => {
    if (onPermissions) { onPermissions(route); return }
    const id = Number(route.request().url().match(/roles\/(\d+)\/permissions/)[1])
    route.fulfill(json({ role: ROLES.find((r) => r.id === id) ?? ROLES[0], permissions: [] }))
  })
  if (onCreate) await page.route('**/api/admin/roles', (route) => (route.request().method() === 'POST' ? onCreate(route) : route.fulfill(json(onList ? onList() : ROLES))))
  if (onRename) await page.route('**/api/admin/roles/9', (route) => (route.request().method() === 'PATCH' ? onRename(route) : route.fallback()))
  if (onDelete) await page.route('**/api/admin/roles/9', (route) => (route.request().method() === 'DELETE' ? onDelete(route) : route.fallback()))
  if (!onCreate) {
    await page.route('**/api/admin/roles', (route) =>
      route.fulfill(listStatus ? json({ message: 'Bu işlem için yetkiniz bulunmuyor.' }, listStatus) : json(onList ? onList() : ROLES)),
    )
  }

  await page.goto('/login')
  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-admin-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())
  await page.goto('/admin/roles')
}

const rows = (page) => page.getByRole('button', { name: /rolünün detayını aç/ })
const rowFor = (page, name) => page.getByRole('button', { name: `${name} rolünün detayını aç` })

/* --- Liste ------------------------------------------------------------------ */

test('the page lists the global role inventory with server-supplied counts', async ({ page }) => {
  await openRoles(page)

  await expect(page.getByRole('heading', { name: 'Roller', level: 1 })).toBeVisible()
  await expect(rows(page)).toHaveCount(6)

  // Counts are rendered from the list response; no per-role request is made.
  const editorRow = rowFor(page, 'GIS Editor')
  await expect(editorRow).toContainText('3')
  await expect(editorRow).toContainText('14')

  // The Phase 5A placeholder is gone.
  await expect(page.getByText('Bu ekran hazırlanıyor')).toHaveCount(0)
})

test('classification comes from the server flags, not from role names', async ({ page }) => {
  await openRoles(page)

  await expect(rowFor(page, 'Admin')).toContainText('Legacy')
  await expect(rowFor(page, 'User')).toContainText('Legacy')
  await expect(rowFor(page, 'Viewer')).toContainText('Sistem')
  await expect(rowFor(page, 'GIS Editor')).toContainText('Sistem')
  await expect(rowFor(page, 'Administrator')).toContainText('Sistem')
  await expect(rowFor(page, 'Saha Ekibi')).toContainText('Özel')

  // Legacy roles are shown as closed to new assignments.
  await expect(rowFor(page, 'Admin')).toContainText('Kapalı')
  await expect(rowFor(page, 'Viewer')).toContainText('Atanabilir')
})

test('the list does not fetch each role separately', async ({ page }) => {
  const detailCalls = []
  await page.route('**/api/admin/roles/*', (route) => { detailCalls.push(route.request().url()); route.fallback() })
  await openRoles(page)
  await expect(rows(page)).toHaveCount(6)

  /* Kart başına GET /roles/{id} açan bir uygulama burada 6 istek yapardı.
     Detay, liste satırının kendisinden okunur. */
  expect(detailCalls).toEqual([])
})

test('a loading state is shown before the roles arrive', async ({ page }) => {
  let release
  const held = new Promise((resolve) => { release = resolve })
  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: 1, username: 'admin', emailConfirmed: true, twoFactorEnabled: true, role: 'Admin', roles: ['Admin'] })),
  )
  // The inventory is held open so the skeleton is observable.
  await page.route('**/api/admin/roles', async (route) => { await held; route.fulfill(json(ROLES)) })

  await page.goto('/login')
  await page.evaluate((e) => { sessionStorage.setItem('token', 't'); sessionStorage.setItem('expiresAt', e) }, new Date(Date.now() + 3_600_000).toISOString())
  await page.goto('/admin/roles')

  await expect(page.getByLabel('Roller yükleniyor')).toBeVisible()
  release()
  await expect(rows(page)).toHaveCount(6)
})

test('a failed load explains itself and can be retried', async ({ page }) => {
  await openRoles(page, { listStatus: 403 })

  await expect(page.getByRole('alert')).toContainText('yetkiniz bulunmuyor')
  await expect(page.getByRole('button', { name: 'Tekrar dene' })).toBeVisible()
})

test('an empty inventory does not invent roles', async ({ page }) => {
  await openRoles(page, { onList: () => [] })

  await expect(page.getByText('Rol bulunamadı')).toBeVisible()
  await expect(rows(page)).toHaveCount(0)
})

/* --- Detay ------------------------------------------------------------------ */

test('a custom role offers rename and delete', async ({ page }) => {
  await openRoles(page)
  await rowFor(page, 'Saha Ekibi').click()

  const detail = page.getByRole('dialog', { name: 'Saha Ekibi' })
  await expect(detail).toBeVisible()
  await expect(detail).toContainText('Özel')
  await expect(detail.getByRole('button', { name: 'Yeniden Adlandır' })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Rolü Sil' })).toBeVisible()
})

test('a system role offers neither rename nor delete', async ({ page }) => {
  await openRoles(page)
  await rowFor(page, 'GIS Editor').click()

  const detail = page.getByRole('dialog', { name: 'GIS Editor' })
  await expect(detail).toContainText('Sistem rolüdür')
  await expect(detail.getByRole('button', { name: 'Yeniden Adlandır' })).toHaveCount(0)
  await expect(detail.getByRole('button', { name: 'Rolü Sil' })).toHaveCount(0)
})

test('a legacy role explains that it is preserved, not broken', async ({ page }) => {
  await openRoles(page)
  await rowFor(page, 'Admin').click()

  const detail = page.getByRole('dialog', { name: 'Admin' })
  await expect(detail).toContainText('Geçiş dönemi rolüdür')
  await expect(detail).toContainText('yeni atamalarda kullanılamaz')
  await expect(detail.getByRole('button', { name: 'Yeniden Adlandır' })).toHaveCount(0)
  await expect(detail.getByRole('button', { name: 'Rolü Sil' })).toHaveCount(0)
})

/* --- Yetki matrisiyle sınır ---------------------------------------------------- */

test('the detail hosts the permission editor', async ({ page }) => {
  await openRoles(page)
  await rowFor(page, 'GIS Editor').click()

  const detail = page.getByRole('dialog', { name: 'GIS Editor' })
  await expect(detail.getByRole('heading', { name: 'Yetkiler' })).toBeVisible()
})

test('the permission matrix is read once, only when a detail opens', async ({ page }) => {
  const permissionCalls = []
  await openRoles(page, {
    onPermissions: (route) => {
      permissionCalls.push(route.request().method())
      route.fulfill(json({ role: GIS_EDITOR, permissions: [] }))
    },
  })

  // Liste tek başına hiçbir matris okumaz — rol başına istek bir N+1 olurdu.
  await expect(rows(page)).toHaveCount(6)
  expect(permissionCalls).toEqual([])

  await rowFor(page, 'GIS Editor').click()
  await expect(page.getByRole('dialog', { name: 'GIS Editor' })).toBeVisible()
  expect(permissionCalls).toEqual(['GET'])
})

/* --- Oluşturma --------------------------------------------------------------- */

test('creating a role sends the name and refetches the list', async ({ page }) => {
  let created = null
  let listing = ROLES
  await openRoles(page, {
    onList: () => listing,
    onCreate: (route) => {
      created = JSON.parse(route.request().postData() ?? '{}')
      listing = [...ROLES, role(11, 'Kadastro Ölçüm', { canRename: true, canDelete: true })]
      // The backend answers 201 Created for a new role, not 200.
      route.fulfill(json(role(11, 'Kadastro Ölçüm', { canRename: true, canDelete: true }), 201))
    },
  })

  await page.getByRole('button', { name: '+ Yeni Rol' }).click()
  const dialog = page.getByRole('dialog', { name: 'Yeni rol oluştur' })
  await expect(dialog).toBeVisible()

  // An empty name cannot be submitted.
  await expect(dialog.getByRole('button', { name: 'Rol Oluştur' })).toBeDisabled()

  await dialog.getByLabel('Rol adı').fill('  Kadastro Ölçüm  ')
  await dialog.getByRole('button', { name: 'Rol Oluştur' }).click()

  // Whitespace is trimmed before it reaches the server.
  expect(created).toEqual({ name: 'Kadastro Ölçüm' })
  await expect(page.getByRole('status')).toContainText("'Kadastro Ölçüm' rolü oluşturuldu")
  await expect(dialog).toHaveCount(0)
  await expect(rowFor(page, 'Kadastro Ölçüm')).toContainText('Özel')
})

test('a rejected creation keeps the dialog open and shows the server message', async ({ page }) => {
  await openRoles(page, {
    onCreate: (route) => route.fulfill(json({ message: "'Saha Ekibi' adında bir rol zaten var." }, 409)),
  })

  await page.getByRole('button', { name: '+ Yeni Rol' }).click()
  const dialog = page.getByRole('dialog', { name: 'Yeni rol oluştur' })
  await dialog.getByLabel('Rol adı').fill('Saha Ekibi')
  await dialog.getByRole('button', { name: 'Rol Oluştur' }).click()

  /* Sunucunun kendi cümlesi gösterilir; genel bir "hata oluştu" kullanıcıya ne
     yapacağını söylemezdi. Diyalog açık kalır ki ad düzeltilebilsin. */
  await expect(dialog.getByRole('alert')).toContainText('adında bir rol zaten var')
  await expect(dialog).toBeVisible()

  await dialog.getByRole('button', { name: 'İptal' }).click()
  await expect(dialog).toHaveCount(0)
})

/* --- Yeniden adlandırma ------------------------------------------------------- */

test('renaming a custom role updates the list and the open detail', async ({ page }) => {
  let listing = ROLES
  let patched = null
  await page.route('**/api/admin/roles/9', (route) => {
    patched = JSON.parse(route.request().postData() ?? '{}')
    listing = ROLES.map((r) => (r.id === 9 ? { ...r, name: 'Saha Ekibi A' } : r))
    route.fulfill(json({ ...CUSTOM, name: 'Saha Ekibi A' }))
  })
  await openRoles(page, { onList: () => listing })

  await rowFor(page, 'Saha Ekibi').click()
  await page.getByRole('button', { name: 'Yeniden Adlandır' }).click()

  const dialog = page.getByRole('dialog', { name: /yeniden adlandır/i })
  await expect(dialog.getByLabel('Rol adı')).toHaveValue('Saha Ekibi')
  await dialog.getByLabel('Rol adı').fill('Saha Ekibi A')
  await dialog.getByRole('button', { name: 'Kaydet' }).click()

  expect(patched).toEqual({ name: 'Saha Ekibi A' })
  await expect(page.getByRole('status')).toContainText("adı 'Saha Ekibi A' olarak güncellendi")
  await expect(rowFor(page, 'Saha Ekibi A')).toBeVisible()
  // The drawer stayed open on the same role and follows the new name.
  await expect(page.getByRole('dialog', { name: 'Saha Ekibi A' })).toBeVisible()
})

test('a rejected rename leaves the role untouched', async ({ page }) => {
  await page.route('**/api/admin/roles/9', (route) =>
    route.fulfill(json({ message: "'Viewer' sistem tarafından ayrılmış bir rol adıdır." }, 409)),
  )
  await openRoles(page)

  await rowFor(page, 'Saha Ekibi').click()
  await page.getByRole('button', { name: 'Yeniden Adlandır' }).click()
  const dialog = page.getByRole('dialog', { name: /yeniden adlandır/i })
  await dialog.getByLabel('Rol adı').fill('Viewer')
  await dialog.getByRole('button', { name: 'Kaydet' }).click()

  await expect(dialog.getByRole('alert')).toContainText('ayrılmış bir rol adıdır')
  await expect(rowFor(page, 'Saha Ekibi')).toBeVisible()
})

/* --- Silme -------------------------------------------------------------------- */

test('deleting a custom role asks first, then removes it', async ({ page }) => {
  let listing = ROLES
  let deleted = false
  await page.route('**/api/admin/roles/9', (route) => {
    deleted = true
    listing = ROLES.filter((r) => r.id !== 9)
    // The backend answers 204 No Content, with no body.
    route.fulfill({ status: 204, body: '' })
  })
  await openRoles(page, { onList: () => listing })

  await rowFor(page, 'Saha Ekibi').click()
  await page.getByRole('button', { name: 'Rolü Sil' }).click()

  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText("'Saha Ekibi' rolünü silmek istediğinize emin misiniz?")

  // Cancelling really cancels.
  await confirm.getByRole('button', { name: 'İptal' }).click()
  expect(deleted).toBe(false)
  await expect(rowFor(page, 'Saha Ekibi')).toBeVisible()

  await page.getByRole('button', { name: 'Rolü Sil' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Rolü Sil' }).click()

  await expect(page.getByRole('status')).toContainText("'Saha Ekibi' rolü silindi.")
  await expect(rowFor(page, 'Saha Ekibi')).toHaveCount(0)
  // The detail of a deleted role must not linger.
  await expect(page.getByRole('dialog', { name: 'Saha Ekibi' })).toHaveCount(0)
})

test('a refused delete keeps the role visible and says why', async ({ page }) => {
  await page.route('**/api/admin/roles/9', (route) =>
    route.fulfill(json({ message: "'Saha Ekibi' rolü 3 kullanıcıya atanmış durumda. Önce bu kullanıcıları başka bir role taşıyın." }, 409)),
  )
  await openRoles(page)

  await rowFor(page, 'Saha Ekibi').click()
  await page.getByRole('button', { name: 'Rolü Sil' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Rolü Sil' }).click()

  /* Sunucu reddettiyse rol DURUR. İyimser bir kaldırma, olmamış bir silmeyi
     olmuş gibi gösterirdi. */
  await expect(page.getByRole('status')).toContainText('kullanıcıya atanmış durumda')
  await expect(rowFor(page, 'Saha Ekibi')).toBeVisible()
})

/* --- Kabuk ------------------------------------------------------------------- */

test('the roles entry stays the active sidebar item', async ({ page }) => {
  await openRoles(page)

  const nav = page.getByRole('navigation', { name: 'Yönetim menüsü' })
  await expect(nav.getByRole('link', { name: 'Roller' })).toHaveAttribute('aria-current', 'page')
  await expect(nav.getByRole('link', { name: 'Kullanıcılar' })).not.toHaveAttribute('aria-current', 'page')
})

test.describe('narrow screens', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the roles screen and its dialogs fit a phone', async ({ page }) => {
    await openRoles(page)
    await expect(rows(page)).toHaveCount(6)

    const overflows = () => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1)
    expect(await overflows()).toBe(false)

    await rowFor(page, 'Saha Ekibi').click()
    await expect(page.getByRole('dialog', { name: 'Saha Ekibi' })).toBeVisible()
    expect(await overflows()).toBe(false)

    await page.getByRole('button', { name: 'Yeniden Adlandır' }).click()
    const dialog = page.getByRole('dialog', { name: /yeniden adlandır/i })
    await expect(dialog.getByRole('button', { name: 'Kaydet' })).toBeInViewport()
    expect(await overflows()).toBe(false)
  })
})
