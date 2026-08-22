import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'

const HEATMAP_PERMISSION = 'inventory.analysis'
const BASE_PERMISSIONS = ['map.view', 'drawings.view', 'layers.view']
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8vZVwAAAABJRU5ErkJggg==',
  'base64',
)

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

async function prepareMap(page, {
  permissions = [...BASE_PERMISSIONS, HEATMAP_PERMISSION],
  role = 'Custom Density Reader',
  heatmapHandler = null,
} = {}) {
  const permissionState = await mockPermissions(page, permissions, { userId: 42 })
  const requests = []
  const authorizationHeaders = []

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'heatmap-browser-token')
    sessionStorage.setItem('expiresAt', expiresAt)
    window.__heatmapLifecycle = JSON.parse(
      sessionStorage.getItem('__heatmapLifecycle')
        ?? '{"aborts":0,"created":[],"revoked":[]}',
    )
    const persistLifecycle = () => sessionStorage.setItem(
      '__heatmapLifecycle',
      JSON.stringify(window.__heatmapLifecycle),
    )

    /* Sayaçlar ISI HARİTASINA ÖZELDİR.

       Phase 5'ten beri harita, normal çizim görünümü için de kimlik
       doğrulamalı PNG istekleri açıyor. Bu istekler de AbortController
       kullanıyor ve kendi Blob URL'lerini üretip serbest bırakıyor; sayaçlar
       küresel kalsaydı "üstü örtülen istek iptal edildi" ve "Blob URL geri
       verildi" iddiaları, ısı haritası hiç iptal edilmese bile geçerdi.
       Bu yüzden her kayıt, isteğin/yanıtın ısı haritası ucuna ait olup
       olmadığına göre süzülür. İddialar zayıflatılmaz, DARALTILIR. */
    const HEATMAP_PATH = '/api/heatmap/image'
    const heatmapSignals = new WeakSet()
    const heatmapBlobs = new WeakSet()

    const nativeFetch = window.fetch
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input?.url ?? '')
      const signal = init?.signal ?? (typeof input === 'object' ? input?.signal : null)
      if (signal && url.includes(HEATMAP_PATH)) heatmapSignals.add(signal)
      return nativeFetch.apply(this, arguments)
    }

    /* Bir Blob'un hangi uçtan geldiği yalnızca onu üreten Response'tan
       bilinebilir; createObjectURL'e yalnızca Blob ulaşır. */
    const nativeResponseBlob = Response.prototype.blob
    Response.prototype.blob = function () {
      const isHeatmap = (this.url ?? '').includes(HEATMAP_PATH)
      return nativeResponseBlob.call(this).then((blob) => {
        if (isHeatmap) heatmapBlobs.add(blob)
        return blob
      })
    }

    const nativeAbort = AbortController.prototype.abort
    AbortController.prototype.abort = function (...args) {
      if (heatmapSignals.has(this.signal)) {
        window.__heatmapLifecycle.aborts += 1
        persistLifecycle()
      }
      return nativeAbort.apply(this, args)
    }
    const nativeCreate = URL.createObjectURL.bind(URL)
    const nativeRevoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      const url = nativeCreate(blob)
      if (heatmapBlobs.has(blob)) {
        window.__heatmapLifecycle.created.push(url)
        persistLifecycle()
      }
      return url
    }
    URL.revokeObjectURL = (url) => {
      if (window.__heatmapLifecycle.created.includes(url)) {
        window.__heatmapLifecycle.revoked.push(url)
        persistLifecycle()
      }
      return nativeRevoke(url)
    }
  }, new Date(Date.now() + 3_600_000).toISOString())

  await page.route('**/api/auth/me', (route) => route.fulfill(json({
    userId: 42,
    username: 'density-user',
    role,
    roles: [role],
  })))
  await page.route('**/api/auth/me/geographic-scope', (route) => route.fulfill(json({
    isRestricted: false,
    effectiveWkt: null,
    areaCount: 0,
  })))
  /* Phase 5: harita artık kalıcı çizimlerin GENEL GÖSTERİMİ için de kimlik
     doğrulamalı PNG istekleri açıyor. Bu spec ısı haritasını ölçer, ama fixture
     hermetik kalmalıdır: taklit edilmeyen bu istekler gerçek ağa düşer,
     başarısız olur ve uygulamanın genel "Bağlantı kurulamadı." uyarısını
     doğurur — ısı haritasıyla ilgisi olmayan bir alert. Sunum uçları bu yüzden
     BAŞARILI birer PNG döndürür; ısı haritası taklidi ve onun hata/yeniden
     deneme senaryoları olduğu gibi kalır. */
  await page.route('**/api/map/presentation/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: PIXEL_PNG,
  }))
  await page.route('**/api/drawings/points', (route) => route.fulfill(json([])))
  await page.route('**/api/drawings/lines', (route) => route.fulfill(json([])))
  await page.route('**/api/drawings/polygons', (route) => route.fulfill(json([])))
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: PIXEL_PNG,
  }))
  await page.route('**/api/heatmap/image?*', async (route) => {
    const url = new URL(route.request().url())
    requests.push(url)
    authorizationHeaders.push(route.request().headers().authorization ?? '')
    if (heatmapHandler) return heatmapHandler(route, requests.length)
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })
  })

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()
  return { permissionState, requests, authorizationHeaders }
}

async function openHeatmapPanel(page) {
  if (await page.getByRole('button', { name: 'Menüyü aç' }).isVisible()) {
    await page.getByRole('button', { name: 'Menüyü aç' }).click()
  }
  await page.getByRole('button', { name: 'Isı Haritası Analizi' }).click()
  await expect(page.getByRole('dialog', { name: 'Isı Haritası Analizi' })).toBeVisible()
}

async function activateHeatmap(page) {
  await openHeatmapPanel(page)
  await page.getByRole('switch', { name: 'Isı haritasını göster' }).click()
  await expect(page.locator('.heatmap-layer')).toHaveCount(1)
  await expect(page.getByLabel('Isı haritası yoğunluk açıklaması')).toBeVisible()
}

test('menu visibility uses the exact permission code, independent of role name', async ({ page }) => {
  await prepareMap(page, { permissions: BASE_PERMISSIONS, role: 'Administrator' })
  await expect(page.getByRole('button', { name: 'Isı Haritası Analizi', exact: true })).toBeHidden()
})

test('a custom role or direct grant can see and activate exactly one raster layer', async ({ page }) => {
  const { requests } = await prepareMap(page)
  await expect(page.getByRole('button', { name: 'Isı Haritası Analizi' })).toBeVisible()
  await activateHeatmap(page)

  await expect.poll(() => requests.length).toBeGreaterThan(0)
  await expect(page.locator('.heatmap-layer')).toHaveCount(1)

  await page.getByRole('switch', { name: 'Isı haritasını göster' }).click()
  await expect(page.locator('.heatmap-layer')).toHaveCount(0)
  await expect(page.getByLabel('Isı haritası yoğunluk açıklaması')).toBeHidden()

  await page.getByRole('switch', { name: 'Isı haritasını göster' }).click()
  await expect(page.locator('.heatmap-layer')).toHaveCount(1)
})

test('request derives a bounded EPSG:3857 viewport and contains no client authority', async ({ page }) => {
  const seenUrls = []
  page.on('request', (request) => seenUrls.push(request.url()))
  const { requests, authorizationHeaders } = await prepareMap(page)
  await activateHeatmap(page)
  await expect.poll(() => requests.length).toBeGreaterThan(0)

  const request = requests.at(-1)
  expect([...request.searchParams.keys()].sort()).toEqual(['bbox', 'height', 'width'])
  expect(authorizationHeaders.at(-1)).toBe('Bearer heatmap-browser-token')
  const bbox = request.searchParams.get('bbox').split(',').map(Number)
  expect(bbox).toHaveLength(4)
  expect(bbox.every(Number.isFinite)).toBe(true)
  expect(Math.max(...bbox.map(Math.abs))).toBeGreaterThan(180)

  const width = Number(request.searchParams.get('width'))
  const height = Number(request.searchParams.get('height'))
  expect(width).toBeGreaterThanOrEqual(64)
  expect(height).toBeGreaterThanOrEqual(64)
  expect(width).toBeLessThanOrEqual(2048)
  expect(height).toBeLessThanOrEqual(2048)
  expect(width * height).toBeLessThanOrEqual(4_194_304)
  expect(seenUrls.some((url) => /geoserver|cql_filter|point_density_heatmap|tbl_point_heatmap/i.test(url))).toBe(false)
})

test('legend is conditional and preserves the exact normalized color scale', async ({ page }) => {
  await prepareMap(page)
  await openHeatmapPanel(page)
  // Kapalı bir ısı haritası için yoğunluk ölçeği gösterilmez.
  await expect(page.getByLabel('Isı haritası yoğunluk açıklaması')).toBeHidden()
  await page.getByRole('switch', { name: 'Isı haritasını göster' }).click()

  const legend = page.getByLabel('Isı haritası yoğunluk açıklaması')
  await expect(legend).toContainText('Göreli Nokta Yoğunluğu')
  await expect(legend.locator('.heatmap-legend-labels span')).toHaveText(['0', '0.25', '0.50', '0.75', '1'])
  const gradient = await legend.locator('.heatmap-legend-gradient').evaluate((node) => getComputedStyle(node).backgroundImage)
  for (const rgb of ['44, 123, 182', '0, 166, 202', '249, 208, 87', '215, 25, 28']) {
    expect(gradient).toContain(rgb)
  }
})

test('the legend is a section of the analysis panel, not a floating map overlay', async ({ page }) => {
  await prepareMap(page)
  await activateHeatmap(page)

  const panel = page.getByRole('dialog', { name: 'Isı Haritası Analizi' })
  const legend = page.getByLabel('Isı haritası yoğunluk açıklaması')

  /* Anlamsal kanıt: ölçek panelin İÇİNDEDİR. Harita üzerinde konumlanmış bir
     katman olmadığı için hiçbir görünüm genişliğinde harita kontrollerinin
     üstüne binemez. */
  await expect(panel.getByLabel('Isı haritası yoğunluk açıklaması')).toBeVisible()
  await expect(page.locator('.map-container .heatmap-legend')).toHaveCount(0)
  await expect(legend).toHaveCSS('position', 'static')

  // Ölçek, onu üreten kontrollerin ALTINDA durur.
  const [switchBox, legendBox] = await Promise.all([
    panel.getByRole('switch').boundingBox(),
    legend.boundingBox(),
  ])
  expect(legendBox.y).toBeGreaterThan(switchBox.y)

  // Panel kapatıldığında ölçek de gider; ısı haritası KAPANMAZ.
  await panel.getByRole('button', { name: /panelini kapat/ }).click()
  await expect(legend).toBeHidden()
  await expect(page.locator('.heatmap-layer')).toHaveCount(1)

  // Panel yeniden açıldığında ölçek geri gelir.
  await page.getByRole('button', { name: 'Isı Haritası Analizi' }).click()
  await expect(legend).toBeVisible()
})

test('stable move and resize refresh; opacity is presentation-only', async ({ page }) => {
  const { requests } = await prepareMap(page)
  await activateHeatmap(page)
  await expect.poll(() => requests.length).toBeGreaterThan(0)
  const initial = requests.length

  await page.getByLabel('Isı haritası saydamlığı').fill('55')
  await expect(page.getByText('55%')).toBeVisible()
  await page.waitForTimeout(300)
  expect(requests.length).toBe(initial)

  await page.locator('.ol-zoom-in').click()
  await expect.poll(() => requests.length).toBeGreaterThan(initial)
  const afterMove = requests.length

  await page.setViewportSize({ width: 1280, height: 760 })
  await expect.poll(() => requests.length).toBeGreaterThan(afterMove)
})

test('superseded requests abort silently and replacing/unmounting revokes Blob URLs', async ({ page }) => {
  const releases = []
  await prepareMap(page, {
    heatmapHandler: async (route) => {
      await new Promise((resolve) => releases.push(resolve))
      await route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }).catch(() => {})
    },
  })
  await openHeatmapPanel(page)
  await page.getByRole('switch', { name: 'Isı haritasını göster' }).click()
  await page.waitForTimeout(250)
  await page.setViewportSize({ width: 1200, height: 760 })
  await page.waitForTimeout(250)

  const aborts = await page.evaluate(() => window.__heatmapLifecycle.aborts)
  expect(aborts).toBeGreaterThan(0)
  await expect(page.getByRole('alert')).toHaveCount(0)

  for (const release of releases) release()
  await expect(page.locator('.heatmap-layer')).toHaveCount(1)
  await page.locator('.ol-zoom-in').click()
  await page.waitForTimeout(250)
  for (const release of releases) release()
  await page.waitForTimeout(250)

  await page.getByRole('button', { name: 'Çıkış Yap', exact: true }).last().click()
  await expect(page).toHaveURL(/\/login$/)
  const lifecycle = await page.evaluate(() => window.__heatmapLifecycle)
  expect(lifecycle.created.length).toBeGreaterThan(0)
  expect(lifecycle.revoked.length).toBeGreaterThan(0)
})

test('a failed image has a usable retry state and cancellation is not an error', async ({ page }) => {
  let fail = true
  await prepareMap(page, {
    heatmapHandler: (route) => fail
      ? route.fulfill(json({ message: 'internal details' }, 500))
      : route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
  })
  await openHeatmapPanel(page)
  await page.getByRole('switch', { name: 'Isı haritasını göster' }).click()
  await expect(page.getByRole('alert')).toContainText('Isı haritası şu anda yüklenemedi')
  await expect(page.getByRole('alert')).not.toContainText('internal')

  fail = false
  await page.getByRole('button', { name: 'Yeniden dene' }).click()
  await expect(page.locator('.heatmap-layer')).toHaveCount(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('live permission loss closes the panel, cancels work and removes the layer', async ({ page }) => {
  let status = 200
  const { permissionState } = await prepareMap(page, {
    heatmapHandler: (route) => route.fulfill(
      status === 200
        ? { status: 200, contentType: 'image/png', body: PIXEL_PNG }
        : json({ message: 'forbidden' }, 403),
    ),
  })
  await activateHeatmap(page)

  permissionState.set(BASE_PERMISSIONS)
  status = 403
  await page.locator('.ol-zoom-in').click()

  await expect(page.getByRole('button', { name: 'Isı Haritası Analizi', exact: true })).toBeHidden()
  await expect(page.locator('.heatmap-layer')).toHaveCount(0)
  await expect(page.getByRole('dialog', { name: 'Isı Haritası Analizi' })).toBeHidden()
})

for (const viewport of [
  { width: 1440, height: 900, name: 'desktop' },
  { width: 1280, height: 800, name: 'laptop' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 390, height: 844, name: 'mobile' },
  { width: 320, height: 700, name: 'narrow mobile' },
]) {
  test(`${viewport.name} layout remains usable without overflow or control collisions`, async ({ page }) => {
    await page.setViewportSize(viewport)
    await page.addInitScript((theme) => localStorage.setItem('staj-map-theme', theme),
      viewport.name === 'laptop' || viewport.name === 'mobile' ? 'light' : 'dark')
    await prepareMap(page)
    await activateHeatmap(page)

    const layout = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }))
    expect(layout.scroll).toBeLessThanOrEqual(layout.viewport)

    const panel = page.getByRole('dialog', { name: 'Isı Haritası Analizi' })
    const legend = page.getByLabel('Isı haritası yoğunluk açıklaması')
    await expect(panel.getByRole('button', { name: /panelini kapat/ })).toBeVisible()
    await expect(panel.getByRole('switch')).toBeVisible()
    await expect(legend).toBeVisible()

    /* Ölçek artık panelin bir bölümüdür, harita üzerinde yüzen bir katman
       değil. Beklenti bu yüzden TERSİNE dönmüştür: eskiden panelle çakışmaması
       aranırdı, şimdi panelin İÇİNDE kalması aranır. */
    const [panelBox, legendBox] = await Promise.all([panel.boundingBox(), legend.boundingBox()])
    expect(legendBox.x).toBeGreaterThanOrEqual(panelBox.x - 1)
    expect(legendBox.y).toBeGreaterThanOrEqual(panelBox.y - 1)
    expect(legendBox.x + legendBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width + 1)
    expect(legendBox.y + legendBox.height).toBeLessThanOrEqual(panelBox.y + panelBox.height + 1)

    // Etiketler her genişlikte okunabilir kalır.
    await expect(legend.locator('.heatmap-legend-labels span')).toHaveText(['0', '0.25', '0.50', '0.75', '1'])

    // Haritanın üzerinde KONUMLANMIŞ bir ölçek hiçbir genişlikte kalmamalı.
    await expect(page.locator('.map-container .heatmap-legend')).toHaveCount(0)

    /* Harita kontrolleri ölçek tarafından örtülmez.
       Bu iddia yalnızca panelin SAĞA yerleştiği genişliklerde anlamlıdır: orada
       `.has-docked-panel` kuralı zoom kontrolünü zaten kenara çeker, dolayısıyla
       panel de içindeki ölçek de kontrollerden uzaktır. Telefonda panel bir alt
       sayfadır ve uygulamadaki HER panel gibi haritanın alt kısmını kaplar —
       orada "ölçek zoom'u örtmemeli" demek, hiçbir panelin sağlamadığı bir şeyi
       istemek olurdu. Telefonda geçerli kanıt, ölçeğin sayfanın içinde kalması
       ve haritada konumlanmamasıdır; ikisi de yukarıda doğrulandı. */
    if (viewport.width >= 641) {
      const overlapsLegend = (box) => !(
        legendBox.x + legendBox.width <= box.x
        || box.x + box.width <= legendBox.x
        || legendBox.y + legendBox.height <= box.y
        || box.y + box.height <= legendBox.y
      )

      for (const selector of ['.quick-actions', '.draw-toolbar', '.ol-zoom', '.ol-attribution']) {
        const box = await page.locator(selector).boundingBox()
        if (box) expect(overlapsLegend(box), `${selector} must remain clear of the legend`).toBe(false)
      }
    }

    if (process.env.HEATMAP_VISUAL_REVIEW === '1') {
      await page.screenshot({ path: `/tmp/staj-phase4-${viewport.name.replace(' ', '-')}.png`, fullPage: true })
    }
  })
}
