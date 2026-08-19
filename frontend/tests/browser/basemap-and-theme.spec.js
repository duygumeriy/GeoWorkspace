import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'

/**
 * Browser cover for the basemap system and the theme scope.
 *
 * ## Why these exist
 *
 * Two invariants are easy to break later and expensive to notice:
 *
 *  1. Changing the basemap must be a pure background swap. The OpenLayers Map,
 *     its View (centre/zoom) and every overlay — drawings, selection,
 *     measurement, analysis — have to survive untouched. A future refactor that
 *     rebuilds the map on selection would still "work" visually while silently
 *     resetting the user's position and clearing their work.
 *  2. The UI theme and the basemap are independent. Dark chrome over satellite
 *     imagery is a valid combination, and neither setting may imply the other.
 *
 * Plus the auth-theme rule: the sign-in screens own no theme control, and the
 * map still does.
 *
 * Tiles are stubbed so the suite stays hermetic and makes no request to
 * OpenStreetMap or Esri. The recorded URLs are themselves the assertion for
 * which basemap is live.
 */

const USER_ID = 7

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/** 1x1 transparent PNG, so a "tile" resolves without touching the network. */
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)

const POLYGON = {
  id: 11,
  name: 'Ankara Alanı',
  wkt: 'POLYGON((32.6 39.8, 33.0 39.8, 33.0 40.1, 32.6 40.1, 32.6 39.8))',
  style: {
    strokeColor: '#DC2626',
    strokeWidth: 3,
    fillColor: '#DC2626',
    fillOpacity: 0.25,
    pointRadius: null,
    lineStyle: 'solid',
  },
  description: '',
  category: null,
  tags: [],
  createdDate: '2026-08-01T09:00:00Z',
  modifiedDate: '2026-08-01T09:00:00Z',
  createdBy: 'browser-user',
  createdByUserId: USER_ID,
}

/**
 * Signs in, serves one polygon, and stubs every tile provider.
 *
 * @returns {{ tiles: string[] }} every tile URL the map asked for
 */
async function openMap(page, { theme = null, basemap = null } = {}) {
  const tiles = []

  /* Yetki ucu da yanıtlanmalı: arayüz küme gelene kadar korumalı hiçbir şeyi
     çizmez (fail-closed). Bu spec yetki KURALLARINI ölçmüyor, bu yüzden tam
     küme verilir; kuralların kendisi permission-aware-ui.spec.js'in işidir. */
  await mockPermissions(page)

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: USER_ID, username: 'browser-user', role: 'User' })),
  )
  await page.route('**/api/drawings/points', (route) => route.fulfill(json([])))
  await page.route('**/api/drawings/lines', (route) => route.fulfill(json([])))
  await page.route('**/api/drawings/polygons', (route) => route.fulfill(json([POLYGON])))
  await page.route('**/api/drawings/deleted', (route) => route.fulfill(json([])))

  const serveTile = (route) => {
    tiles.push(route.request().url())
    return route.fulfill({
      status: 200,
      contentType: 'image/png',
      // The sources request tiles with crossOrigin="anonymous"; without this the
      // image would fail to decode even though the request was made.
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: PIXEL_PNG,
    })
  }

  await page.route('**/tile.openstreetmap.org/**', serveTile)
  await page.route('**/server.arcgisonline.com/**', serveTile)

  await page.addInitScript(
    ([expiresAt, themeValue, basemapValue]) => {
      sessionStorage.setItem('token', 'browser-test-token')
      sessionStorage.setItem('expiresAt', expiresAt)
      if (themeValue) localStorage.setItem('staj-map-theme', themeValue)
      else localStorage.removeItem('staj-map-theme')
      if (basemapValue) localStorage.setItem('staj-map-basemap', basemapValue)
      else localStorage.removeItem('staj-map-basemap')
    },
    [new Date(Date.now() + 3600_000).toISOString(), theme, basemap],
  )

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  return { tiles }
}

const openBasemapPicker = async (page) => {
  await page.getByRole('button', { name: /Harita altlığı/ }).click()
  await expect(page.getByRole('dialog', { name: 'Harita Altlığı' })).toBeVisible()
}

const chooseBasemap = async (page, name) => {
  await openBasemapPicker(page)
  await page.getByRole('radio', { name, exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Harita Altlığı' })).toBeHidden()
}

const imageryTiles = (tiles) => tiles.filter((url) => url.includes('World_Imagery'))
const labelTiles = (tiles) => tiles.filter((url) => url.includes('World_Boundaries_and_Places'))
const osmTiles = (tiles) => tiles.filter((url) => url.includes('tile.openstreetmap.org'))

/* --- Catalogue --------------------------------------------------------------- */

test('the picker offers exactly the implemented basemaps, standard selected', async ({ page }) => {
  await openMap(page)
  await openBasemapPicker(page)

  await expect(page.locator('.basemap-option-label')).toHaveText(['Standart', 'Uydu', 'Uydu + Etiket'])

  // Selection is exposed to assistive tech, not only as an accent colour.
  await expect(page.getByRole('radio', { name: 'Standart', exact: true })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: 'Uydu', exact: true })).toHaveAttribute('aria-checked', 'false')
})

test('satellite and hybrid load their real sources', async ({ page }) => {
  const { tiles } = await openMap(page)

  expect(osmTiles(tiles).length).toBeGreaterThan(0)
  expect(imageryTiles(tiles)).toEqual([])

  await chooseBasemap(page, 'Uydu')
  await expect.poll(() => imageryTiles(tiles).length).toBeGreaterThan(0)
  // Plain satellite must not pull the label layer.
  expect(labelTiles(tiles)).toEqual([])

  await chooseBasemap(page, 'Uydu + Etiket')
  // Hybrid is one logical basemap: imagery AND its reference labels.
  await expect.poll(() => labelTiles(tiles).length).toBeGreaterThan(0)
})

/* --- The invariant that matters --------------------------------------------- */

test('switching basemap keeps the map instance, the view and the overlays', async ({ page }) => {
  await openMap(page)

  // Move away from the initial camera so a reset would be obvious.
  await page.locator('.map-container').click({ position: { x: 400, y: 300 } })
  await page.locator('.ol-zoom-in').click()
  await page.locator('.ol-zoom-in').click()
  await page.waitForTimeout(700)

  // Tag the live viewport element: OpenLayers builds this once per Map, so if
  // the marker survives, the Map was never recreated.
  await page.evaluate(() => {
    document.querySelector('.map-container .ol-viewport').dataset.instanceMarker = 'original'
  })
  const scaleBefore = await page.locator('.ol-scale-line-inner').textContent()

  await chooseBasemap(page, 'Uydu')
  await page.waitForTimeout(400)

  // Same Map instance, same view.
  await expect(page.locator('.map-container .ol-viewport')).toHaveAttribute(
    'data-instance-marker',
    'original',
  )
  expect(await page.locator('.ol-scale-line-inner').textContent()).toBe(scaleBefore)

  // The drawing overlay is still there, and still carries the record.
  await expect(page.locator('.map-container .drawing-layer canvas')).toBeVisible()
  await page.getByRole('button', { name: 'Çizimlerim' }).click()
  await expect(page.locator('.drawings-item-title')).toHaveText(['#11 Ankara Alanı'])
})

/* --- Theme and basemap are independent --------------------------------------- */

test('the theme does not choose a basemap and the basemap does not choose a theme', async ({ page }) => {
  await openMap(page, { theme: 'light' })

  await chooseBasemap(page, 'Uydu')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // Flip the UI theme; the basemap must not follow.
  await page.getByRole('button', { name: /^Tema:/ }).click()
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('staj-map-basemap')))
    .toBe('satellite')

  await openBasemapPicker(page)
  await expect(page.getByRole('radio', { name: 'Uydu', exact: true })).toHaveAttribute('aria-checked', 'true')

  // Two independent preferences under two independent keys.
  const stored = await page.evaluate(() => ({
    theme: localStorage.getItem('staj-map-theme'),
    basemap: localStorage.getItem('staj-map-basemap'),
  }))
  expect(stored.basemap).toBe('satellite')
  expect(stored.theme).not.toBe('satellite')
})

test('dark chrome does not invert satellite imagery', async ({ page }) => {
  await openMap(page, { theme: 'dark', basemap: 'satellite' })

  // The OSM reskin filter must not reach photographic imagery.
  const filters = await page.evaluate(() =>
    [...document.querySelectorAll('.map-container .basemap-layer--verbatim canvas')].map(
      (canvas) => getComputedStyle(canvas).filter,
    ),
  )

  expect(filters.length).toBeGreaterThan(0)
  for (const filter of filters) expect(filter).toBe('none')
})

/* --- Persistence -------------------------------------------------------------- */

test('a remembered basemap is restored on load', async ({ page }) => {
  const { tiles } = await openMap(page, { basemap: 'hybrid' })

  await expect.poll(() => labelTiles(tiles).length).toBeGreaterThan(0)

  await openBasemapPicker(page)
  await expect(page.getByRole('radio', { name: 'Uydu + Etiket', exact: true })).toHaveAttribute(
    'aria-checked',
    'true',
  )
})

test('a stale stored basemap falls back to standard instead of a blank map', async ({ page }) => {
  // An id this build no longer offers — a renamed or withdrawn option is the
  // realistic way a browser ends up holding one.
  const { tiles } = await openMap(page, { basemap: 'no-such-basemap' })

  await expect.poll(() => osmTiles(tiles).length).toBeGreaterThan(0)

  await openBasemapPicker(page)
  await expect(page.getByRole('radio', { name: 'Standart', exact: true })).toHaveAttribute('aria-checked', 'true')
})

/* --- Dismissal and accessibility --------------------------------------------- */

test('the picker closes on Escape and on an outside click', async ({ page }) => {
  await openMap(page)

  const trigger = page.getByRole('button', { name: /Harita altlığı/ })
  const popover = page.getByRole('dialog', { name: 'Harita Altlığı' })

  await openBasemapPicker(page)
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')

  await page.keyboard.press('Escape')
  await expect(popover).toBeHidden()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')
  // Escape returns focus to the control rather than dropping it at the document.
  await expect(trigger).toBeFocused()
  // The map's own Escape handling must not have run: the drawing is untouched.
  await expect(page.locator('.map-container .drawing-layer canvas')).toBeVisible()

  await openBasemapPicker(page)
  await page.locator('.map-container').click({ position: { x: 500, y: 400 } })
  await expect(popover).toBeHidden()
})

/* --- Theme scope -------------------------------------------------------------- */

test('the sign-in screen has no theme control and the map does', async ({ page }) => {
  /* Yetki ucu da yanıtlanmalı: arayüz küme gelene kadar korumalı hiçbir şeyi
     çizmez (fail-closed). Bu spec yetki KURALLARINI ölçmüyor, bu yüzden tam
     küme verilir; kuralların kendisi permission-aware-ui.spec.js'in işidir. */
  await mockPermissions(page)

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: USER_ID, username: 'browser-user', role: 'User' })),
  )

  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Giriş Yap', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Tema:/ })).toHaveCount(0)

  await openMap(page)
  await expect(page.getByRole('button', { name: /^Tema:/ })).toBeVisible()
})

test('a dark map preference survives a visit to the sign-in screen', async ({ page }) => {
  await openMap(page, { theme: 'dark' })
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  // The login screen keeps its own fixed presentation...
  await page.goto('/login')
  await expect(page.getByRole('button', { name: 'Giriş Yap', exact: true })).toBeVisible()

  // ...without consuming the stored preference, so the map comes back dark.
  expect(await page.evaluate(() => localStorage.getItem('staj-map-theme'))).toBe('dark')

  await page.goto('/map')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})
