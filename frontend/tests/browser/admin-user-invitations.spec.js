import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const BASE_PERMISSIONS = ['users.view', 'roles.view']
const CREATE_PERMISSIONS = [...BASE_PERMISSIONS, 'users.create']
const ROLES = [
  { name: 'Saha İnceleme', description: 'Saha kayıtlarını inceler.', requiresTwoFactor: false },
  { name: 'Özel Koordinasyon', description: 'Özel koordinasyon görevleri.', requiresTwoFactor: true },
]

const invitationUser = {
  id: 42,
  username: 'davetli',
  email: 'davetli@example.invalid',
  role: 'Saha İnceleme',
  isActive: false,
  emailConfirmed: false,
  accountStatus: 'InvitationPending',
  twoFactorEnabled: false,
  lockoutEnd: null,
  modifiedDate: '2026-08-22T10:00:00Z',
}

const activeUser = {
  ...invitationUser,
  id: 43,
  username: 'aktif-kullanici',
  email: 'aktif@example.invalid',
  isActive: true,
  emailConfirmed: true,
  accountStatus: 'Active',
}

async function openUsers(page, {
  permissions = CREATE_PERMISSIONS,
  initialUsers = [invitationUser, activeUser],
  createReply,
  resendReply,
} = {}) {
  const state = { users: [...initialUsers], createCalls: 0, resendCalls: 0, createBody: null }
  await mockPermissions(page, permissions)
  await page.route('**/api/auth/me', (route) => route.fulfill(json({
    userId: 1,
    username: 'yonetici',
    email: 'yonetici@example.invalid',
    emailConfirmed: true,
    twoFactorEnabled: true,
    role: 'Özel Koordinasyon',
    roles: ['Özel Koordinasyon'],
  })))
  await page.route('**/api/admin/users/roles', (route) => route.fulfill(json(ROLES)))
  await page.route('**/api/admin/users', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill(json(state.users))
    state.createCalls += 1
    state.createBody = route.request().postDataJSON()
    const reply = createReply?.(state.createBody) ?? {
      ...invitationUser,
      id: 44,
      username: state.createBody.username,
      email: state.createBody.email,
      role: state.createBody.role,
    }
    if (reply.status) return route.fulfill(json(reply.body, reply.status))
    state.users = [...state.users, reply]
    return route.fulfill(json(reply, 201))
  })
  await page.route('**/api/admin/users/42', (route) => route.fulfill(json(invitationUser)))
  await page.route('**/api/admin/users/43', (route) => route.fulfill(json(activeUser)))
  await page.route('**/api/admin/users/42/resend-invitation', (route) => {
    state.resendCalls += 1
    const reply = resendReply?.() ?? invitationUser
    return reply.status ? route.fulfill(json(reply.body, reply.status)) : route.fulfill(json(reply))
  })

  await page.goto('/login')
  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'frontend-invitation-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Kullanıcılar', level: 1 })).toBeVisible()
  return state
}

test('users.create permission controls the create-user button', async ({ page }) => {
  await openUsers(page, { permissions: BASE_PERMISSIONS })
  await expect(page.getByRole('button', { name: '+ Kullanıcı Ekle' })).toHaveCount(0)

  await openUsers(page, { permissions: CREATE_PERMISSIONS })
  await expect(page.getByRole('button', { name: '+ Kullanıcı Ekle' })).toBeVisible()
})

test('create dialog has only username email and dynamically loaded role fields', async ({ page }) => {
  await openUsers(page)
  await page.getByRole('button', { name: '+ Kullanıcı Ekle' }).click()

  const dialog = page.getByRole('dialog', { name: 'Kullanıcı Ekle' })
  await expect(dialog.getByLabel('Kullanıcı adı')).toBeVisible()
  await expect(dialog.getByLabel('E-posta')).toHaveAttribute('type', 'email')
  await expect(dialog.getByLabel('Rol')).toContainText('Saha İnceleme')
  await expect(dialog.getByLabel('Rol')).toContainText('Özel Koordinasyon')
  await expect(dialog.locator('input[type="password"]')).toHaveCount(0)
})

test('successful create posts the minimal contract, refreshes the list and shows invitation status', async ({ page }) => {
  const state = await openUsers(page)
  await page.getByRole('button', { name: '+ Kullanıcı Ekle' }).click()
  const dialog = page.getByRole('dialog', { name: 'Kullanıcı Ekle' })
  await dialog.getByLabel('Kullanıcı adı').fill('yeni-davetli')
  await dialog.getByLabel('E-posta').fill('yeni@example.invalid')
  await dialog.getByLabel('Rol').selectOption('Saha İnceleme')
  await page.getByRole('button', { name: 'Kullanıcı Oluştur' }).click()

  await expect(page.getByRole('dialog', { name: 'Kullanıcı Ekle' })).toHaveCount(0)
  await expect(page.getByRole('status')).toContainText('Kullanıcı oluşturuldu ve davet e-postası gönderildi.')
  await expect(page.getByRole('button', { name: /yeni-davetli/ })).toContainText('Davet Bekliyor')
  expect(state.createCalls).toBe(1)
  expect(state.createBody).toEqual({ username: 'yeni-davetli', email: 'yeni@example.invalid', role: 'Saha İnceleme' })
})

test('duplicate validation is shown in the dialog without retrying automatically', async ({ page }) => {
  const state = await openUsers(page, { createReply: () => ({ status: 409, body: { message: 'Bu kullanıcı adı zaten kullanılıyor.' } }) })
  await page.getByRole('button', { name: '+ Kullanıcı Ekle' }).click()
  const dialog = page.getByRole('dialog', { name: 'Kullanıcı Ekle' })
  await dialog.getByLabel('Kullanıcı adı').fill('davetli')
  await dialog.getByLabel('E-posta').fill('duplicate@example.invalid')
  await dialog.getByLabel('Rol').selectOption('Saha İnceleme')
  await page.getByRole('button', { name: 'Kullanıcı Oluştur' }).click()

  await expect(page.getByRole('alert')).toContainText('kullanıcı adı zaten kullanılıyor')
  await expect(page.getByRole('dialog', { name: 'Kullanıcı Ekle' })).toBeVisible()
  expect(state.createCalls).toBe(1)
})

test('delivery warning still closes the dialog, refreshes the created user and never retries create', async ({ page }) => {
  const state = await openUsers(page, { createReply: (body) => ({
    ...invitationUser,
    id: 45,
    username: body.username,
    email: body.email,
    role: body.role,
    notificationWarning: 'Kullanıcı oluşturuldu ancak davet e-postası gönderilemedi.',
  }) })
  await page.getByRole('button', { name: '+ Kullanıcı Ekle' }).click()
  const dialog = page.getByRole('dialog', { name: 'Kullanıcı Ekle' })
  await dialog.getByLabel('Kullanıcı adı').fill('uyarili-davetli')
  await dialog.getByLabel('E-posta').fill('uyari@example.invalid')
  await dialog.getByLabel('Rol').selectOption('Özel Koordinasyon')
  await page.getByRole('button', { name: 'Kullanıcı Oluştur' }).click()

  await expect(page.getByRole('status')).toContainText('Kullanıcı oluşturuldu ancak davet e-postası gönderilemedi.')
  await expect(page.getByRole('status')).toHaveClass(/is-warning/)
  await expect(page.getByRole('button', { name: /uyarili-davetli/ })).toBeVisible()
  expect(state.createCalls).toBe(1)
})

test('resend action requires both users.create and InvitationPending', async ({ page }) => {
  await openUsers(page, { permissions: CREATE_PERMISSIONS })
  await page.getByRole('button', { name: /davetli/ }).click()
  await expect(page.getByRole('button', { name: 'Daveti Tekrar Gönder' })).toBeVisible()
  await page.getByRole('button', { name: 'Detayı kapat' }).click()
  await page.getByRole('button', { name: /aktif-kullanici/ }).click()
  await expect(page.getByRole('button', { name: 'Daveti Tekrar Gönder' })).toHaveCount(0)

  await openUsers(page, { permissions: BASE_PERMISSIONS, initialUsers: [invitationUser] })
  await page.getByRole('button', { name: /davetli/ }).click()
  await expect(page.getByRole('button', { name: 'Daveti Tekrar Gönder' })).toHaveCount(0)
})

test('resend sends exactly one request and shows success', async ({ page }) => {
  const state = await openUsers(page, { initialUsers: [invitationUser] })
  await page.getByRole('button', { name: /davetli/ }).click()
  await page.getByRole('button', { name: 'Daveti Tekrar Gönder' }).click()

  await expect(page.getByRole('status')).toContainText('Davet e-postası yeniden gönderildi.')
  expect(state.resendCalls).toBe(1)
})

test('resend 429 shows a friendly cooldown without another request', async ({ page }) => {
  const state = await openUsers(page, {
    initialUsers: [invitationUser],
    resendReply: () => ({ status: 429, body: { message: 'Too many requests.' } }),
  })
  await page.getByRole('button', { name: /davetli/ }).click()
  await page.getByRole('button', { name: 'Daveti Tekrar Gönder' }).click()

  await expect(page.getByRole('status')).toContainText('Yeni davet göndermeden önce kısa bir süre bekleyin.')
  expect(state.resendCalls).toBe(1)
})
