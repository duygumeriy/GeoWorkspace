import { expect, test } from '@playwright/test'

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

async function waitForLogin(page) {
  await page.goto('/login')
  await expect(page.getByRole('heading', { name: 'Hesabınıza giriş yapın' })).toBeVisible()
}

async function submitPassword(page) {
  await page.getByLabel('Kullanıcı adı').fill('browser-user')
  await page.locator('#login-password').fill('Browser1Password')
  await page.getByRole('button', { name: 'Giriş Yap', exact: true }).click()
}

test('a direct 2FA URL without a pending challenge returns to login', async ({ page }) => {
  await page.goto('/login/2fa')

  await expect(page.getByRole('heading', { name: 'Hesabınıza giriş yapın' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('token'))).toBeNull()
})

test('password step stores challenge separately and shows TOTP/recovery choices', async ({ page }) => {
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.route('**/api/auth/login', (route) =>
    route.fulfill(json({ requiresTwoFactor: true, challengeToken: 'browser-test-challenge' })),
  )
  await waitForLogin(page)

  await submitPassword(page)

  await expect(page.getByRole('heading', { name: 'İki faktörlü doğrulama' })).toBeVisible()
  await expect(page.getByLabel('Doğrulama kodu')).toHaveAttribute('autocomplete', 'one-time-code')
  await expect(page.getByRole('button', { name: 'Kurtarma kodu kullan' })).toBeVisible()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('token'))).toBeNull()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('expiresAt'))).toBeNull()
  expect(consoleErrors).toEqual([])
})

test('mandatory Admin setup renders responsive QR then one-time recovery screen without starting a session', async ({ page }) => {
  const consoleErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.route('**/api/auth/login', (route) =>
    route.fulfill(json({ requiresTwoFactorSetup: true, challengeToken: 'setup-challenge-one' })),
  )
  await page.route('**/api/auth/login/2fa/setup', (route) =>
    route.fulfill(json({
      sharedKey: 'AAAA BBBB CCCC DDDD',
      authenticatorUri: 'otpauth://totp/StajProject%3Abrowser-user?secret=AAAAAAAAAAAAAAAA&issuer=StajProject',
      challengeToken: 'setup-challenge-two',
    })),
  )
  await page.route('**/api/auth/login/2fa/setup/verify', (route) =>
    route.fulfill(json({
      token: 'browser-test-access-token',
      expiresAt: '2099-01-01T00:00:00Z',
      recoveryCodes: ['code-01', 'code-02', 'code-03', 'code-04'],
    })),
  )
  await waitForLogin(page)
  await submitPassword(page)

  await expect(page.getByRole('heading', { name: 'İki faktörlü doğrulama kurulumu' })).toBeVisible()
  await expect(page.locator('.two-factor-qr svg')).toBeVisible()
  await expect(page.getByText('AAAA BBBB CCCC DDDD')).toBeHidden()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('token'))).toBeNull()

  await page.getByLabel('Doğrulama kodu').fill('123456')
  await page.getByRole('button', { name: 'Doğrula ve Etkinleştir' }).click()

  await expect(page.getByRole('heading', { name: 'Kurtarma kodlarınız' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Kopyala' })).toBeVisible()
  await expect(page.getByText('Her kod yalnızca bir kez kullanılabilir.', { exact: false })).toBeVisible()
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('token'))).toBeNull()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  expect(consoleErrors).toEqual([])
})
