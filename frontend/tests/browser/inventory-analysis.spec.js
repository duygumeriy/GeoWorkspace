import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'

/**
 * Inventory analysis: user scope, explainable results and map integration.
 *
 * ## What these lock down
 *
 * A user with one line and one polygon on the map was shown "2 çizgi, 3 poligon"
 * by the analysis, because the query ran over every user's drawings. The counts
 * had no counterpart on screen, and a count is itself information — it told the
 * caller how much inventory other people had in that area.
 *
 * The ownership boundary is enforced and proven in the backend
 * (`InventoryAnalysisScopeTests`, which asserts against the stored rows). What is
 * proven HERE is the half the browser owns:
 *
 *   - the analysis request carries no ownership field for a client to tamper with,
 *   - the panel renders the SERVER's counts rather than recomputing its own,
 *   - every count can be expanded into the records behind it,
 *   - a result can be located and opened on the map.
 *
 * The mock therefore behaves like the fixed API: it applies the ownership filter
 * itself and serves the other user's records to nobody. A mock that simply
 * returned the right numbers would pass even if the frontend went back to
 * counting things on its own.
 */

const USER_ID = 7
const OTHER_USER_ID = 8

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

/* The fixture from the bug report: the signed-in user owns one line and one
   polygon; another user owns one line and two polygons in the same area. */
const INVENTORY = [
  {
    id: 70,
    drawingType: 'line',
    name: 'çizgi1',
    ownerId: USER_ID,
    wkt: 'LINESTRING(32.60 39.85, 32.95 40.05)',
    category: 'Rota',
    description: 'Kuzey güzergâhı',
    tags: ['saha'],
    color: '#E11D48',
  },
  {
    id: 87,
    drawingType: 'polygon',
    name: 'poligon2',
    ownerId: USER_ID,
    wkt: 'POLYGON((32.62 39.82, 32.90 39.82, 32.90 40.02, 32.62 40.02, 32.62 39.82))',
    category: 'Envanter',
    description: '',
    tags: [],
    color: '#00A878',
  },
  // Everything below belongs to somebody else and must never surface.
  { id: 71, drawingType: 'line', name: 'BAŞKA-çizgi', ownerId: OTHER_USER_ID, wkt: 'LINESTRING(32.65 39.90, 32.85 40.00)', category: 'Rota', description: '', tags: [], color: '#2563EB' },
  { id: 88, drawingType: 'polygon', name: 'BAŞKA-alan-1', ownerId: OTHER_USER_ID, wkt: 'POLYGON((32.66 39.86, 32.80 39.86, 32.80 39.96, 32.66 39.96, 32.66 39.86))', category: 'Envanter', description: '', tags: [], color: '#7C3AED' },
  { id: 89, drawingType: 'polygon', name: 'BAŞKA-alan-2', ownerId: OTHER_USER_ID, wkt: 'POLYGON((32.70 39.88, 32.84 39.88, 32.84 39.98, 32.70 39.98, 32.70 39.88))', category: 'Envanter', description: '', tags: [], color: '#DB2777' },
]

function record(item) {
  return {
    id: item.id,
    name: item.name,
    wkt: item.wkt,
    style: { strokeColor: item.color, strokeWidth: 3 },
    description: item.description,
    category: item.category,
    tags: item.tags,
    createdDate: '2026-08-01T09:00:00Z',
    modifiedDate: '2026-08-10T12:30:00Z',
    createdBy: item.ownerId === USER_ID ? 'browser-user' : 'other-user',
    createdByUserId: item.ownerId,
  }
}

/** The analysis item shape the fixed API returns — no geometry, no ownership. */
function analysisItem(item) {
  return {
    id: item.id,
    drawingType: item.drawingType,
    name: item.name,
    description: item.description,
    category: item.category,
    tags: item.tags,
    style: { strokeColor: item.color, strokeWidth: 3 },
    createdDate: '2026-08-01T09:00:00Z',
    modifiedDate: '2026-08-10T12:30:00Z',
    intersectionType: item.drawingType === 'polygon' ? 'partial' : 'fullyInside',
  }
}

async function openMap(page) {
  const analysisRequests = []
  const mine = INVENTORY.filter((item) => item.ownerId === USER_ID)

  /* Yetki ucu da yanıtlanmalı: arayüz küme gelene kadar korumalı hiçbir şeyi
     çizmez (fail-closed). Bu spec yetki KURALLARINI ölçmüyor, bu yüzden tam
     küme verilir; kuralların kendisi permission-aware-ui.spec.js'in işidir. */
  await mockPermissions(page)

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: USER_ID, username: 'browser-user', role: 'User' })),
  )

  // The map only ever loads the caller's own drawings.
  const ofType = (type) => mine.filter((item) => item.drawingType === type).map(record)
  await page.route('**/api/drawings/points', (route) => route.fulfill(json(ofType('point'))))
  await page.route('**/api/drawings/lines', (route) => route.fulfill(json(ofType('line'))))
  await page.route('**/api/drawings/polygons', (route) => route.fulfill(json(ofType('polygon'))))

  await page.route('**/api/analysis/intersections', async (route) => {
    analysisRequests.push(JSON.parse(route.request().postData() ?? '{}'))

    /* The ownership filter lives HERE, as it does on the server. The other
       user's records are in the fixture and are simply never matched. */
    const matched = mine
    const byType = (type) => matched.filter((item) => item.drawingType === type).map(analysisItem)

    const points = byType('point')
    const lines = byType('line')
    const polygons = byType('polygon')

    await route.fulfill(
      json({
        totalCount: points.length + lines.length + polygons.length,
        pointCount: points.length,
        lineCount: lines.length,
        polygonCount: polygons.length,
        points,
        lines,
        polygons,
      }),
    )
  })

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3600_000).toISOString())

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  return { analysisRequests }
}

/**
 * Draws a temporary analysis area with the Envanter tool.
 *
 * @param {{ activate?: boolean }} options the tool button TOGGLES, so a second
 *   analysis in the same test must not press it again — that would switch the
 *   tool off instead of starting another area.
 */
async function drawAnalysisArea(page, { activate = true } = {}) {
  if (activate) await page.getByRole('button', { name: 'Envanter Analizi aracı' }).click()

  // Corners are a fraction of the map box, so the same helper works on a phone
  // viewport as well as on desktop.
  const box = await page.locator('.map-container').boundingBox()
  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })

  for (const point of [at(0.2, 0.25), at(0.7, 0.25), at(0.7, 0.6)]) {
    await page.mouse.click(point.x, point.y)
    await page.waitForTimeout(120)
  }
  await page.mouse.dblclick(at(0.2, 0.6).x, at(0.2, 0.6).y)
}

async function runTemporaryAnalysis(page, options) {
  await drawAnalysisArea(page, options)
  await expect(page.locator('.analysis-panel')).toBeVisible()
  await expect(page.getByText('Analiz yapılıyor...')).toBeHidden()
}

const section = (page, title) => page.locator('.analysis-section').filter({ hasText: title })
const summaryValue = (page, label) =>
  page.locator('.analysis-summary-item').filter({ hasText: label }).locator('dd')

/* --- Scope ------------------------------------------------------------------ */

test('counts only the signed-in user\'s inventory', async ({ page }) => {
  await openMap(page)
  await runTemporaryAnalysis(page)

  // The reported symptom was "2 çizgi, 3 poligon" for a user who owns one of each.
  await expect(page.getByText('Bu alan 2 envanter ile kesişiyor.')).toBeVisible()
  await expect(summaryValue(page, 'Noktalar')).toHaveText('0')
  await expect(summaryValue(page, 'Çizgiler')).toHaveText('1')
  await expect(summaryValue(page, 'Poligonlar')).toHaveText('1')

  // Nothing belonging to anyone else appears anywhere in the panel.
  await expect(page.locator('.analysis-panel')).not.toContainText('BAŞKA')
})

test('the analysis request carries no ownership field to tamper with', async ({ page }) => {
  const { analysisRequests } = await openMap(page)
  await runTemporaryAnalysis(page)

  const body = analysisRequests.at(-1)
  expect(Object.keys(body).sort()).toEqual(['excludePolygonId', 'wkt'])
  // Scope comes from the token; there is no field here that could widen it.
  expect(JSON.stringify(body)).not.toContain('userId')
})

/* --- Accordion and detail ---------------------------------------------------- */

test('each count expands into the records behind it', async ({ page }) => {
  await openMap(page)
  await runTemporaryAnalysis(page)

  const lines = section(page, 'Çizgiler (1)')
  await expect(lines.locator('.analysis-item')).toHaveCount(0)
  await lines.locator('.analysis-section-head').click()
  await expect(lines.getByText('çizgi1')).toBeVisible()

  const polygons = section(page, 'Poligonlar (1)')
  await polygons.locator('.analysis-section-head').click()
  await expect(polygons.getByText('poligon2')).toBeVisible()

  // An empty group is still shown — it is an answer — but cannot be opened.
  await expect(section(page, 'Noktalar (0)').locator('.analysis-section-head')).toBeDisabled()
})

test('a result opens into read-only detail with its metadata and metrics', async ({ page }) => {
  await openMap(page)
  await runTemporaryAnalysis(page)

  await section(page, 'Çizgiler (1)').locator('.analysis-section-head').click()
  await page.locator('.analysis-item-head').filter({ hasText: 'çizgi1' }).click()

  const detail = page.locator('.analysis-detail')
  await expect(detail).toContainText('Rota')
  await expect(detail).toContainText('Kuzey güzergâhı')
  await expect(detail).toContainText('saha')
  await expect(detail).toContainText('#E11D48')
  await expect(detail).toContainText('Tamamen İçeride')
  // Measured from the geometry on the map with the app's own helpers.
  await expect(detail).toContainText('Toplam Uzunluk')
  await expect(detail).toContainText('Nokta Sayısı')

  // Read-only: editing belongs to the drawing panel, reached via "Çizimi Aç".
  await expect(detail.locator('input, textarea, select')).toHaveCount(0)
})

test('polygon detail shows area, perimeter and corner count', async ({ page }) => {
  await openMap(page)
  await runTemporaryAnalysis(page)

  await section(page, 'Poligonlar (1)').locator('.analysis-section-head').click()
  await page.locator('.analysis-item-head').filter({ hasText: 'poligon2' }).click()

  const detail = page.locator('.analysis-detail')
  await expect(detail).toContainText('Alan')
  await expect(detail).toContainText('Çevre')
  await expect(detail).toContainText('Köşe Sayısı')
  await expect(detail).toContainText('Kısmi Kesişim')
})

/* --- Map integration --------------------------------------------------------- */

test('"Haritada Göster" highlights the record and keeps the analysis on screen', async ({ page }) => {
  await openMap(page)
  await runTemporaryAnalysis(page)

  await section(page, 'Poligonlar (1)').locator('.analysis-section-head').click()
  await page.locator('.analysis-item-head').filter({ hasText: 'poligon2' }).click()

  // Selecting a result puts its geometry on the dedicated highlight layer.
  await expect(page.locator('.map-container .analysis-highlight-layer')).toBeAttached()

  await page.getByRole('button', { name: 'Haritada Göster' }).click()
  await page.waitForTimeout(700)

  // The analysis area, its result and the selection all survive the camera move.
  await expect(page.locator('.analysis-panel')).toBeVisible()
  await expect(page.getByText('Bu alan 2 envanter ile kesişiyor.')).toBeVisible()
  await expect(page.locator('.analysis-item.is-selected')).toHaveCount(1)
})

test('"Çizimi Aç" hands over to the ordinary drawing panel', async ({ page }) => {
  await openMap(page)
  await runTemporaryAnalysis(page)

  await section(page, 'Çizgiler (1)').locator('.analysis-section-head').click()

  /* Eylem, "çizgi1" sonucunun KENDİ satırından tetiklenir: sayfa genelinde
     tek bir "Çizimi Aç" düğmesi aramak, açık olan başka bir sonucun
     düğmesini de yakalayabilirdi. */
  const result = page.locator('.analysis-item').filter({ hasText: 'çizgi1' })
  await result.locator('.analysis-item-head').click()
  await result.getByRole('button', { name: 'Çizimi Aç' }).click()

  // The existing selected-drawing panel, not a second editor grown inside the
  // analysis results.
  const panel = page.locator('.selected-panel')
  await expect(panel).toBeVisible()
  await expect(panel).toContainText('çizgi1')
  await expect(panel.getByRole('button', { name: 'Düzenle' })).toBeVisible()

  /* Devir GERÇEKTEN olmuştur: aynı anda tek bir birincil bağlam vardır, yani
     analiz sonucu paneli artık ekranda değildir. Yalnızca yeni panelin
     görünmesini ölçmek, iki panelin üst üste bindiği eski davranışı da
     geçirirdi. */
  await expect(page.locator('.analysis-panel')).toHaveCount(0)
})

/* --- Clearing ----------------------------------------------------------------- */

test('clearing removes the area, the result and the highlight together', async ({ page }) => {
  await openMap(page)
  await runTemporaryAnalysis(page)

  await section(page, 'Poligonlar (1)').locator('.analysis-section-head').click()
  await page.locator('.analysis-item-head').filter({ hasText: 'poligon2' }).click()
  await expect(page.locator('.analysis-item.is-selected')).toHaveCount(1)

  await page.getByRole('button', { name: 'Analiz alanını temizle' }).click()

  await expect(page.locator('.analysis-panel')).toBeHidden()
  await expect(page.locator('.analysis-item.is-selected')).toHaveCount(0)
})

test('a second analysis replaces the first rather than adding to it', async ({ page }) => {
  const { analysisRequests } = await openMap(page)
  await runTemporaryAnalysis(page)
  await expect(page.locator('.analysis-panel')).toBeVisible()

  await runTemporaryAnalysis(page, { activate: false })

  // Two requests, one readout: a stale result can never sit next to a new area.
  expect(analysisRequests.length).toBe(2)
  await expect(page.locator('.analysis-panel')).toHaveCount(1)
  await expect(page.getByText('Bu alan 2 envanter ile kesişiyor.')).toBeVisible()
})

/* --- Failure ------------------------------------------------------------------ */

test('a failed analysis explains itself and keeps the area for a retry', async ({ page }) => {
  await openMap(page)

  await page.route('**/api/analysis/intersections', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Sunucu hatası' }) }),
  )

  await drawAnalysisArea(page)

  await expect(page.getByText('Analiz tamamlanamadı.')).toBeVisible()
  await expect(page.getByText('Analiz alanı duruyor; tekrar deneyebilirsiniz.')).toBeVisible()
})

/* --- Responsive ---------------------------------------------------------------- */

test('the analysis panel fits a phone without covering the whole map', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openMap(page)
  await runTemporaryAnalysis(page)

  const panel = await page.locator('.analysis-panel').boundingBox()
  expect(panel.width).toBeLessThanOrEqual(390)
  // Never more than half the height, so the map above it stays usable.
  expect(panel.height).toBeLessThanOrEqual(844 / 2 + 1)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)
})
