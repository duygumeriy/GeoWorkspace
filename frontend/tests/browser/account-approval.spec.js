import { expect, test } from '@playwright/test'

/**
 * The approval workflow as the two people involved actually see it: the person
 * who registered and gets stopped at the door, and the administrator who opens
 * it.
 *
 * Everything here is mocked at the network boundary — these tests are about the
 * screens, not the rules. The rules themselves are enforced server-side and
 * covered by the backend suite; the UI must never be the thing that decides.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const ROLES = [
  { name: 'Admin', description: 'Kullanıcı yönetimi ve tüm çizimler üzerinde yönetim yetkisi.', requiresTwoFactor: true },
  { name: 'User', description: 'Harita uygulamasına erişim; kendi çizimlerini oluşturur ve yönetir.', requiresTwoFactor: false },
]

const pendingUser = {
  id: 42,
  username: 'bekleyen-kullanici',
  email: 'bekleyen@example.invalid',
  role: null,
  isActive: false,
  emailConfirmed: true,
  accountStatus: 'PendingApproval',
  twoFactorEnabled: false,
  lockoutEnd: null,
  modifiedDate: '2026-08-17T10:00:00Z',
}

const activeAdmin = {
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

/** Signs the browser in as an administrator and stubs the admin endpoints. */
async function openAdminUsers(page, { onApprove, onReject } = {}) {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: 1, username: 'admin', email: activeAdmin.email, emailConfirmed: true, twoFactorEnabled: true, role: 'Admin', roles: ['Admin'] })),
  )
  await page.route('**/api/admin/users/roles', (route) => route.fulfill(json(ROLES)))
  await page.route('**/api/admin/users/42/approve', (route) => onApprove(route))
  await page.route('**/api/admin/users/42/reject', (route) => onReject(route))
  await page.route('**/api/admin/users/42', (route) => route.fulfill(json(pendingUser)))
  await page.route('**/api/admin/users', (route) => route.fulfill(json([activeAdmin, pendingUser])))

  await page.goto('/login')
  /* An hour out, not a far-future date: AuthContext schedules the automatic
     logout with setTimeout, and a delay past the 32-bit limit fires straight
     away — which would sign this session out before the page even renders. */
  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-admin-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Kullanıcı Yönetimi' })).toBeVisible()
}

test('a verified account is told it is waiting for approval, not that it can sign in', async ({ page }) => {
  await page.route('**/api/auth/confirm-email', (route) =>
    route.fulfill(json({ message: 'E-posta adresiniz doğrulandı. Hesabınız yönetici onayı bekliyor.' })),
  )

  await page.goto('/confirm-email?userId=42&token=browser-test-token')

  await expect(page.getByText('Hesabınız yönetici onayı bekliyor.')).toBeVisible()
  // The old "Giriş Yap" call to action would promise something that is not yet true.
  await expect(page.getByRole('button', { name: 'Giriş ekranına dön' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Giriş Yap', exact: true })).toHaveCount(0)
})

test('a pending account is refused at login without a session being stored', async ({ page }) => {
  await page.route('**/api/auth/login', (route) =>
    route.fulfill(json({
      message: 'Hesabınız yönetici onayı bekliyor. Onaylandıktan sonra uygulamaya giriş yapabilirsiniz.',
      requiresEmailConfirmation: false,
      reason: 'PendingApproval',
    }, 401)),
  )

  await page.goto('/login')
  await page.getByLabel('Kullanıcı adı').fill('bekleyen-kullanici')
  await page.locator('#login-password').fill('Browser1Password')
  await page.getByRole('button', { name: 'Giriş Yap', exact: true }).click()

  await expect(page.getByRole('alert')).toContainText('yönetici onayı bekliyor')
  // Waiting for approval must not offer the verification resend link.
  await expect(page.getByRole('link', { name: 'Doğrulama e-postasını yeniden gönder' })).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('token'))).toBeNull()
})

test('the admin list surfaces pending accounts and the banner filters to them', async ({ page }) => {
  await openAdminUsers(page)

  await expect(page.getByText('1 hesap onay bekliyor.')).toBeVisible()
  await expect(page.getByRole('button', { name: /bekleyen-kullanici/ })).toContainText('Onay Bekliyor')
  // The enum name must never reach the screen.
  await expect(page.getByText('PendingApproval')).toHaveCount(0)

  await page.getByRole('button', { name: /hesap onay bekliyor/ }).click()

  await expect(page.getByRole('button', { name: /bekleyen-kullanici/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /^admin/ })).toHaveCount(0)
})

test('approve stays disabled until a role is chosen, then sends only the role', async ({ page }) => {
  let approvalBody = null
  await openAdminUsers(page, {
    onApprove: (route) => {
      approvalBody = route.request().postDataJSON()
      return route.fulfill(json({ ...pendingUser, accountStatus: 'Active', isActive: true, role: 'User', approvedAt: '2026-08-17T11:00:00Z', approvedByUsername: 'admin' }))
    },
  })

  await page.getByRole('button', { name: /bekleyen-kullanici/ }).click()

  const approve = page.getByRole('button', { name: 'Onayla ve Aktifleştir' })
  await expect(approve).toBeDisabled()

  // Scoped to the panel: the toolbar's role filter carries the same label.
  await page.locator('.admin-approval').getByLabel('Rol').selectOption('User')
  await expect(page.getByText('Rol ile gelecek erişim')).toBeVisible()
  await expect(approve).toBeEnabled()

  await approve.click()
  await page.getByRole('button', { name: 'Onayla ve Aktifleştir' }).last().click()

  await expect(page.getByRole('status')).toContainText('onaylandı ve User rolüyle aktifleştirildi')
  // The client sends the role and nothing else: activation and the approver are
  // the server's to decide.
  expect(approvalBody).toEqual({ role: 'User' })
})

test('a failed approval e-mail is reported as a warning, not as a failed approval', async ({ page }) => {
  await openAdminUsers(page, {
    onApprove: (route) =>
      route.fulfill(json({
        ...pendingUser,
        accountStatus: 'Active',
        isActive: true,
        role: 'User',
        notificationWarning: 'İşlem kaydedildi ancak bilgilendirme e-postası gönderilemedi.',
      })),
  })

  await page.getByRole('button', { name: /bekleyen-kullanici/ }).click()
  await page.locator('.admin-approval').getByLabel('Rol').selectOption('User')
  await page.getByRole('button', { name: 'Onayla ve Aktifleştir' }).click()
  await page.getByRole('button', { name: 'Onayla ve Aktifleştir' }).last().click()

  const notice = page.getByRole('status')
  await expect(notice).toContainText('aktifleştirildi')
  await expect(notice).toContainText('e-postası gönderilemedi')
  await expect(notice).toHaveClass(/is-warning/)
})

test('rejection collects an optional internal note', async ({ page }) => {
  let rejectionBody = null
  await openAdminUsers(page, {
    onReject: (route) => {
      rejectionBody = route.request().postDataJSON()
      return route.fulfill(json({ ...pendingUser, accountStatus: 'Rejected', rejectionReason: 'Kurum dışı başvuru', rejectedByUsername: 'admin' }))
    },
  })

  await page.getByRole('button', { name: /bekleyen-kullanici/ }).click()
  await page.getByRole('button', { name: 'Reddet' }).click()

  const reason = page.getByLabel('Gerekçe (isteğe bağlı)')
  await expect(reason).toBeVisible()
  await expect(reason).toHaveAttribute('placeholder', /kullanıcıya gönderilmez/)
  await reason.fill('Kurum dışı başvuru')
  await page.getByRole('button', { name: 'Başvuruyu Reddet' }).click()

  await expect(page.getByRole('status')).toContainText('başvurusu reddedildi')
  expect(rejectionBody).toEqual({ reason: 'Kurum dışı başvuru' })
})

test('the approval panel is usable on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openAdminUsers(page)

  await page.getByRole('button', { name: /bekleyen-kullanici/ }).click()
  await expect(page.getByRole('heading', { name: 'Hesap Onayı' })).toBeVisible()

  // The drawer takes the full width instead of becoming an unusable sliver, and
  // nothing pushes the page sideways.
  const panel = page.locator('.admin-detail-panel')
  expect((await panel.boundingBox()).width).toBeGreaterThan(340)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
