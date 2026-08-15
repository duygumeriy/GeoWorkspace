import { createHmac } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { expect, request, test } from '@playwright/test'

const API = 'http://localhost:5154'
const sink = path.resolve('../backend/src/StajProject.Api/dev-emails')
const adminUsername = process.env.AUTH6_ADMIN_USERNAME || 'admin'
const adminPassword = process.env.AUTH6_ADMIN_PASSWORD
const adminSecret = process.env.AUTH6_ADMIN_TOTP_SECRET
const password = process.env.AUTH6_TEST_PASSWORD
const prefix = `auth61_${Date.now().toString(36)}`
const users = {
  normal: { username: `${prefix}_user`, email: `${prefix}_user@example.com` },
  mfa: { username: `${prefix}_mfa`, email: `${prefix}_mfa@example.com` },
  unconfirmed: { username: `${prefix}_unconfirmed`, email: `${prefix}_unconfirmed@example.com` },
}
let api
let normalToken
let ownedPoint

function decodeBase32(value) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  const clean = value.replace(/\s+/g, '').toUpperCase().replace(/=+$/, '')
  let bits = ''
  for (const char of clean) bits += alphabet.indexOf(char).toString(2).padStart(5, '0')
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000)
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', decodeBase32(secret)).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const binary = ((digest[offset] & 0x7f) << 24) | ((digest[offset + 1] & 0xff) << 16) | ((digest[offset + 2] & 0xff) << 8) | (digest[offset + 3] & 0xff)
  return String(binary % 1_000_000).padStart(6, '0')
}

async function register(user) {
  const response = await api.post('/api/auth/register', { data: { ...user, password, confirmPassword: password } })
  expect(response.ok(), `register ${user.username}`).toBeTruthy()
}

async function confirmationUrl(email) {
  return expect.poll(async () => {
    const files = await fs.readdir(sink)
    for (const file of files.reverse()) {
      const content = await fs.readFile(path.join(sink, file), 'utf8')
      if (!content.includes(`Kime       : ${email}`)) continue
      return content.match(/https?:\/\/[^\s]+\/confirm-email\?[^\s]+/)?.[0] || null
    }
    return null
  }, { timeout: 10_000 }).not.toBeNull().then(async () => {
    const files = await fs.readdir(sink)
    for (const file of files.reverse()) {
      const content = await fs.readFile(path.join(sink, file), 'utf8')
      if (content.includes(`Kime       : ${email}`)) return content.match(/https?:\/\/[^\s]+\/confirm-email\?[^\s]+/)[0]
    }
    throw new Error('Confirmation mail was not found')
  })
}

async function confirm(user) {
  const url = new URL(await confirmationUrl(user.email))
  const response = await api.post('/api/auth/confirm-email', { data: { userId: Number(url.searchParams.get('userId')), token: url.searchParams.get('token') } })
  expect(response.ok(), `confirm ${user.username}`).toBeTruthy()
}

async function passwordLogin(user) {
  return api.post('/api/auth/login', { data: { username: user.username, password } })
}

async function adminLogin(page) {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Hesabınıza giriş yapın' })).toBeVisible()
  await page.getByLabel('Kullanıcı adı').fill(adminUsername)
  await page.locator('#login-password').fill(adminPassword)
  await page.getByRole('button', { name: 'Giriş Yap', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'İki faktörlü doğrulama' })).toBeVisible()
  await page.getByLabel('Doğrulama kodu').fill(totp(adminSecret))
  await page.getByRole('button', { name: 'Doğrula', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
}

test.beforeAll(async () => {
  expect(adminPassword, 'AUTH6_ADMIN_PASSWORD must be set').toBeTruthy()
  expect(adminSecret, 'AUTH6_ADMIN_TOTP_SECRET must be set').toBeTruthy()
  expect(password, 'AUTH6_TEST_PASSWORD must be set').toBeTruthy()
  api = await request.newContext({ baseURL: API })
  await register(users.normal); await register(users.mfa); await register(users.unconfirmed)
  await confirm(users.normal); await confirm(users.mfa)
  const login = await passwordLogin(users.normal)
  expect(login.ok()).toBeTruthy()
  normalToken = (await login.json()).token
  const pointResponse = await api.post('/api/drawings/point', { headers: { Authorization: `Bearer ${normalToken}` }, data: { wkt: 'POINT (29.01 41.01)', name: `${prefix} ownership fixture`, style: { strokeColor: '#6D4AFF' } } })
  expect(pointResponse.status()).toBe(201)
  ownedPoint = await pointResponse.json()
  const mfaLogin = await passwordLogin(users.mfa)
  const mfaToken = (await mfaLogin.json()).token
  const setupResponse = await api.post('/api/auth/2fa/setup', { headers: { Authorization: `Bearer ${mfaToken}` }, data: { currentPassword: password } })
  expect(setupResponse.ok()).toBeTruthy()
  const setup = await setupResponse.json()
  const enabled = await api.post('/api/auth/2fa/enable', { headers: { Authorization: `Bearer ${mfaToken}` }, data: { code: totp(setup.sharedKey) } })
  expect(enabled.ok()).toBeTruthy()
})

test.afterAll(async () => { await api?.dispose() })

test('real Admin MFA session exercises AUTH-6 management end to end', async ({ page }) => {
  const consoleErrors = []
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  await page.setViewportSize({ width: 1440, height: 900 })
  await adminLogin(page)
  await expect(page.getByRole('button', { name: 'Kullanıcı Yönetimi' })).toBeVisible()
  const listResponsePromise = page.waitForResponse((res) => res.url().endsWith('/api/admin/users') && res.request().method() === 'GET')
  await page.getByRole('button', { name: 'Kullanıcı Yönetimi' }).click()
  await expect(page).toHaveURL(/\/admin\/users$/)
  const listResponse = await listResponsePromise
  expect(listResponse.status()).toBe(200)
  const responseText = await listResponse.text()
  const initialUsers = JSON.parse(responseText)
  const adminToken = await page.evaluate(() => sessionStorage.getItem('token'))
  for (const forbidden of ['PasswordHash', 'SecurityStamp', 'AuthenticatorKey', 'RecoveryCodes', 'ConcurrencyStamp']) expect(responseText).not.toContain(forbidden)
  await expect(page.locator('.admin-user-row')).not.toHaveCount(0)
  const selfRow = page.getByRole('button', { name: `${adminUsername} kullanıcısının detayını aç`, exact: true })
  await expect(selfRow.getByText('Siz')).toBeVisible()
  await expect(selfRow).toContainText('Etkin / Zorunlu')

  const search = page.getByPlaceholder('Kullanıcı veya e-posta ara...')
  await search.fill(`  ${users.normal.username.toUpperCase()}  `)
  await expect(page.locator('.admin-user-row')).toHaveCount(1)
  await search.fill(users.normal.email.toUpperCase())
  await expect(page.locator('.admin-user-row')).toHaveCount(1)
  await search.fill('does-not-exist-auth61')
  await expect(page.getByText('Aramanızla eşleşen kullanıcı bulunamadı.')).toBeVisible()
  await search.fill('')
  const toolbar = page.locator('.admin-toolbar')
  await toolbar.getByLabel('Rol').selectOption('Admin')
  await expect(page.locator('.admin-user-row').first()).toContainText('Admin')
  await toolbar.getByLabel('Rol').selectOption('User')
  await expect(page.locator('.admin-user-row').first()).toContainText('User')
  await toolbar.getByLabel('Durum').selectOption('Inactive')
  if (await page.locator('.admin-user-row').count()) {
    for (const row of await page.locator('.admin-user-row').all()) await expect(row).toContainText('Pasif')
  } else {
    await expect(page.getByText('Seçili filtrelerle eşleşen kullanıcı bulunamadı.')).toBeVisible()
  }
  await toolbar.getByLabel('Durum').selectOption('All')

  await search.fill(users.normal.username)
  await page.locator('.admin-user-row').click()
  const panel = page.locator('.admin-detail-panel')
  await expect(panel).toContainText(users.normal.email)
  await expect(panel).toContainText('Doğrulandı')
  await expect(panel).toContainText('Kapalı')
  for (const forbidden of ['PasswordHash', 'SecurityStamp', 'AuthenticatorKey', 'RecoveryCodes', 'JWT']) await expect(panel).not.toContainText(forbidden)

  await toolbar.getByLabel('Rol').selectOption('User')
  let patchCount = 0
  page.on('request', (req) => { if (req.method() === 'PATCH' && req.url().includes(`/api/admin/users/`) && req.url().endsWith('/role')) patchCount += 1 })
  await panel.getByLabel('Rol').selectOption('Admin')
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await page.getByRole('button', { name: 'Admin Yap' }).evaluate((button) => { button.click(); button.click() })
  await expect(page.getByText('Rol Admin olarak değiştirildi.', { exact: false })).toBeVisible()
  expect(patchCount).toBe(1)
  await expect(panel.getByLabel('Rol')).toHaveValue('Admin')
  await expect(panel).toContainText('Kurulum Bekliyor')
  await expect(page.locator('.admin-user-row')).toHaveCount(0)
  const promotedLogin = await passwordLogin(users.normal)
  expect(promotedLogin.ok()).toBeTruthy()
  const promotedBody = await promotedLogin.json()
  expect(promotedBody.requiresTwoFactorSetup).toBe(true)
  expect(promotedBody.token).toBeUndefined()

  await panel.getByLabel('Rol').selectOption('User')
  await page.getByRole('button', { name: 'User Yap' }).click()
  await expect(panel.getByLabel('Rol')).toHaveValue('User')
  await expect(panel).toContainText('Kapalı')
  await toolbar.getByLabel('Durum').selectOption('Active')
  await panel.getByLabel('Hesap Durumu').selectOption('inactive')
  await page.getByRole('button', { name: 'Hesabı Pasifleştir' }).click()
  await expect(panel.getByLabel('Hesap Durumu')).toHaveValue('inactive')
  await expect(page.locator('.admin-user-row')).toHaveCount(0)
  expect((await passwordLogin(users.normal)).status()).toBe(401)
  await panel.getByLabel('Hesap Durumu').selectOption('active')
  await page.getByRole('button', { name: 'Hesabı Aktifleştir' }).click()
  await expect(panel.getByLabel('Hesap Durumu')).toHaveValue('active')
  expect((await passwordLogin(users.normal)).ok()).toBeTruthy()

  await panel.getByRole('button', { name: 'Detayı kapat' }).click()
  await search.fill(users.mfa.username)
  await page.locator('.admin-user-row').click()
  await panel.getByLabel('Rol').selectOption('Admin')
  await page.getByRole('button', { name: 'Admin Yap' }).click()
  await expect(panel.getByLabel('Rol')).toHaveValue('Admin')
  await expect(panel).toContainText('Etkin / Zorunlu')
  await panel.getByLabel('Rol').selectOption('User')
  await page.getByRole('button', { name: 'User Yap' }).click()
  await expect(panel.getByLabel('Rol')).toHaveValue('User')
  await expect(panel).toContainText('Etkin')
  const enabledMfaLogin = await passwordLogin(users.mfa)
  expect(enabledMfaLogin.ok()).toBeTruthy()
  const enabledMfaLoginBody = await enabledMfaLogin.json()
  expect(enabledMfaLoginBody.requiresTwoFactor).toBe(true)
  expect(enabledMfaLoginBody.token).toBeUndefined()
  await panel.getByRole('button', { name: 'Detayı kapat' }).click()

  await page.reload()
  await expect(page.getByPlaceholder('Kullanıcı veya e-posta ara...')).toBeVisible()
  await page.getByPlaceholder('Kullanıcı veya e-posta ara...').fill(users.normal.username)
  await expect(page.locator('.admin-user-row')).toContainText('Aktif')
  await expect(page.locator('.admin-user-row')).toContainText('User')

  await page.getByPlaceholder('Kullanıcı veya e-posta ara...').fill(users.mfa.username)
  await expect(page.locator('.admin-user-row')).toContainText('Etkin')
  await page.getByPlaceholder('Kullanıcı veya e-posta ara...').fill(users.unconfirmed.username)
  await expect(page.locator('.admin-user-row')).toContainText('Doğrulanmadı')

  const currentAdmin = initialUsers.find((user) => user.username === adminUsername)
  const otherActiveAdmins = initialUsers.filter((user) => user.id !== currentAdmin.id && user.role === 'Admin' && user.isActive)
  const temporarilyDemoted = []
  try {
    for (const other of otherActiveAdmins) {
      const response = await api.patch(`/api/admin/users/${other.id}/role`, { headers: { Authorization: `Bearer ${adminToken}` }, data: { role: 'User' } })
      expect(response.ok()).toBeTruthy()
      temporarilyDemoted.push(other.id)
    }
    await page.reload()
    await page.getByPlaceholder('Kullanıcı veya e-posta ara...').fill(adminUsername)
    await page.getByRole('button', { name: `${adminUsername} kullanıcısının detayını aç`, exact: true }).click()
    await panel.getByLabel('Rol').selectOption('User')
    await page.getByRole('button', { name: 'User Yap' }).click()
    await expect(page.getByText('Sistemde en az bir aktif Admin bulunmalıdır.', { exact: false })).toBeVisible()
    await expect(panel.getByLabel('Rol')).toHaveValue('Admin')
    await panel.getByLabel('Hesap Durumu').selectOption('inactive')
    await page.getByRole('button', { name: 'Hesabı Pasifleştir' }).click()
    await expect(page.getByText('Sistemde en az bir aktif Admin bulunmalıdır.', { exact: false })).toBeVisible()
    await expect(panel.getByLabel('Hesap Durumu')).toHaveValue('active')
    await panel.getByRole('button', { name: 'Detayı kapat' }).click()
  } finally {
    for (const id of temporarilyDemoted) {
      const response = await api.patch(`/api/admin/users/${id}/role`, { headers: { Authorization: `Bearer ${adminToken}` }, data: { role: 'Admin' } })
      expect(response.ok(), `restore Admin role for ${id}`).toBeTruthy()
    }
  }

  for (const theme of ['light', 'dark']) {
    await page.evaluate((value) => localStorage.setItem('staj-map-theme', value), theme)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
    const colors = await page.locator('.admin-users-page').evaluate((node) => { const s = getComputedStyle(node); return [s.color, s.backgroundColor] })
    expect(colors[0]).not.toBe(colors[1])
  }
  for (const viewport of [{ width: 768, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.reload()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByPlaceholder('Kullanıcı veya e-posta ara...').fill(users.normal.username)
    await page.locator('.admin-user-row').click()
    const box = await panel.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
    await panel.getByLabel('Rol').selectOption('Admin')
    const dialogBox = await page.getByRole('alertdialog').boundingBox()
    expect(dialogBox.x).toBeGreaterThanOrEqual(0); expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(viewport.width)
    expect(dialogBox.y + dialogBox.height).toBeLessThanOrEqual(viewport.height)
    await page.getByRole('button', { name: 'İptal' }).click()
    await panel.getByRole('button', { name: 'Detayı kapat' }).click()
  }
  const unexpectedConsoleErrors = consoleErrors.filter((message) => !message.includes('status of 409 (Conflict)'))
  expect(unexpectedConsoleErrors).toEqual([])
  expect(consoleErrors.filter((message) => message.includes('status of 409 (Conflict)'))).toHaveLength(2)
})

test('normal User stays authenticated after route and API 403, and map GIS controls remain available', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Hesabınıza giriş yapın' })).toBeVisible()
  await page.getByLabel('Kullanıcı adı').fill(users.normal.username)
  await page.locator('#login-password').fill(password)
  await page.getByRole('button', { name: 'Giriş Yap', exact: true }).click()
  await expect(page).toHaveURL(/\/map$/)
  await expect(page.getByRole('button', { name: 'Kullanıcı Yönetimi' })).toHaveCount(0)
  const tokenBefore = await page.evaluate(() => sessionStorage.getItem('token'))
  const status = await page.evaluate(async () => (await fetch('http://localhost:5154/api/admin/users', { headers: { Authorization: `Bearer ${sessionStorage.getItem('token')}` } })).status)
  expect(status).toBe(403)
  expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBe(tokenBefore)
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/map$/)
  await expect(page.getByRole('toolbar', { name: 'Çizim araçları' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Nokta çiz/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Çizgi çiz/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Poligon çiz/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Envanter Analizi aracı/ })).toBeVisible()
})

test('owned drawing remains present after the role/status round trip', async () => {
  const response = await api.get('/api/drawings/points', { headers: { Authorization: `Bearer ${normalToken}` } })
  expect(response.ok()).toBeTruthy()
  expect((await response.json()).some((point) => point.id === ownedPoint.id)).toBe(true)
})
