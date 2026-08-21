import { expect, test } from '@playwright/test'

const TOKEN = 'browser-only-invitation-secret-13f'
const URL = `/activate-account?userId=42&token=${encodeURIComponent(TOKEN)}`
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function fillPasswords(page, password = 'Strong1Password', confirmation = password) {
  await page.getByLabel('Yeni şifre').fill(password)
  await page.getByLabel('Şifre tekrar').fill(confirmation)
}

test('valid invitation route shows only the password form and keeps the token private', async ({ page }) => {
  let calls = 0
  await page.route('**/api/auth/activate-account', (route) => { calls += 1; return route.fulfill(json({ message: 'unused' })) })
  await page.goto(URL)

  await expect(page.getByRole('heading', { name: 'Hesabınızı etkinleştirin' })).toBeVisible()
  await expect(page.getByLabel('Yeni şifre')).toHaveAttribute('type', 'password')
  await expect(page.getByLabel('Şifre tekrar')).toHaveAttribute('type', 'password')
  await expect(page.getByRole('button', { name: 'Hesabı Etkinleştir' })).toBeVisible()
  expect(await page.locator('body').innerText()).not.toContain(TOKEN)
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }))).not.toContain(TOKEN)
  expect(calls).toBe(0)
})

for (const [name, link] of [
  ['missing userId', `/activate-account?token=${encodeURIComponent(TOKEN)}`],
  ['missing token', '/activate-account?userId=42'],
]) {
  test(`${name} shows a generic invalid-link state without POST`, async ({ page }) => {
    let calls = 0
    await page.route('**/api/auth/activate-account', (route) => { calls += 1; return route.fulfill(json({})) })
    await page.goto(link)

    await expect(page.getByRole('alert')).toContainText('Bu davet bağlantısı geçersiz veya eksik.')
    await expect(page.getByRole('link', { name: 'Giriş ekranına dön' })).toBeVisible()
    expect(calls).toBe(0)
  })
}

test('password mismatch is rejected client-side without POST', async ({ page }) => {
  let calls = 0
  await page.route('**/api/auth/activate-account', (route) => { calls += 1; return route.fulfill(json({})) })
  await page.goto(URL)
  await fillPasswords(page, 'Strong1Password', 'Different2Password')
  await page.getByRole('button', { name: 'Hesabı Etkinleştir' }).click()

  await expect(page.getByRole('alert')).toContainText('Şifreler eşleşmiyor.')
  expect(calls).toBe(0)
})

test('valid submit sends the minimal body once, cleans the URL and never creates a session', async ({ page }) => {
  let calls = 0
  let requestBody = null
  await page.route('**/api/auth/activate-account', (route) => {
    calls += 1
    requestBody = route.request().postDataJSON()
    return route.fulfill(json({ message: 'Hesabınız etkinleştirildi.' }))
  })
  await page.goto(URL)
  await fillPasswords(page)
  await page.getByRole('button', { name: 'Hesabı Etkinleştir' }).click()

  await expect(page.getByRole('status')).toContainText('Hesabınız başarıyla etkinleştirildi.')
  await expect(page.getByText('Artık kullanıcı adınız ve şifrenizle giriş yapabilirsiniz.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Giriş Yap' })).toBeVisible()
  await expect(page).toHaveURL(/\/activate-account$/)
  expect(calls).toBe(1)
  expect(requestBody).toEqual({ userId: 42, token: TOKEN, password: 'Strong1Password', confirmPassword: 'Strong1Password' })
  expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeNull()
})

test('password-policy rejection keeps the form usable and allows an explicit retry', async ({ page }) => {
  let calls = 0
  await page.route('**/api/auth/activate-account', (route) => {
    calls += 1
    return calls === 1
      ? route.fulfill(json({ message: 'Hesap etkinleştirilemedi.', errors: ['Şifre en az 8 karakter olmalıdır.'] }, 400))
      : route.fulfill(json({ message: 'Hesabınız etkinleştirildi.' }))
  })
  await page.goto(URL)
  await fillPasswords(page, 'Weak1', 'Weak1')
  await page.getByRole('button', { name: 'Hesabı Etkinleştir' }).click()

  await expect(page.getByRole('alert')).toContainText('Şifre en az 8 karakter olmalıdır.')
  await expect(page.getByLabel('Yeni şifre')).toHaveValue('Weak1')
  await fillPasswords(page)
  await page.getByRole('button', { name: 'Hesabı Etkinleştir' }).click()
  await expect(page.getByRole('status')).toContainText('başarıyla etkinleştirildi')
  expect(calls).toBe(2)
})

for (const scenario of ['expired or invalid token', 'reused token']) {
  test(`${scenario} receives the same generic invitation state`, async ({ page }) => {
    await page.route('**/api/auth/activate-account', (route) => route.fulfill(json({
      message: 'Davet bağlantısı geçersiz veya süresi dolmuş.',
      errors: ['Bağlantı geçersiz.'],
    }, 400)))
    await page.goto(URL)
    await fillPasswords(page)
    await page.getByRole('button', { name: 'Hesabı Etkinleştir' }).click()

    await expect(page.getByRole('alert')).toHaveText('Bu davet bağlantısı geçersiz veya süresi dolmuş.')
    await expect(page.getByText('sistem yöneticinizle iletişime geçin')).toBeVisible()
    expect(await page.locator('body').innerText()).not.toContain(TOKEN)
  })
}

test('two synchronous submits still produce exactly one activation request', async ({ page }) => {
  let calls = 0
  await page.route('**/api/auth/activate-account', async (route) => {
    calls += 1
    await new Promise((resolve) => setTimeout(resolve, 150))
    await route.fulfill(json({ message: 'Hesabınız etkinleştirildi.' }))
  })
  await page.goto(URL)
  await fillPasswords(page)
  await page.locator('form').evaluate((form) => { form.requestSubmit(); form.requestSubmit() })

  await expect(page.getByRole('status')).toContainText('başarıyla etkinleştirildi')
  expect(calls).toBe(1)
})

test('existing login route remains available', async ({ page }) => {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Hesabınıza giriş yapın' })).toBeVisible()
  await expect(page.getByLabel('Kullanıcı adı')).toBeVisible()
})

test('activation form does not overflow at the existing mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(URL)
  await expect(page.getByRole('heading', { name: 'Hesabınızı etkinleştirin' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
})
