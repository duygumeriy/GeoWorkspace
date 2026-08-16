import { expect, test } from '@playwright/test'

/**
 * Regression cover for drawing categories: create, edit, filter, group, search.
 *
 * ## Why these exist
 *
 * A user reported picking a category, saving, and then finding nothing under
 * that category in "Çizimlerim". The cause turned out to be a stale locally
 * running API — a build predating the metadata feature, whose
 * `CreateDrawingRequest` had no `category` property at all, so ASP.NET dropped
 * the field silently and the column stayed NULL.
 *
 * No frontend code was at fault, which is exactly why this file is worth
 * having: nothing in the app asserted that the category the user picked
 * actually leaves the browser. These tests pin down the half of the contract
 * the frontend owns —
 *
 *   1. the chosen category is IN the request payload (create and update), and
 *   2. the category the server answers with is what the panel filters, groups
 *      and searches on, both immediately after saving and after a reload.
 *
 * The backend half — that the column is written and returned — is covered by
 * `DrawingMetadataTests`, which asserts against the stored row.
 *
 * The mock deliberately mirrors the real API's PATCH semantics (null preserves,
 * "" clears, values are normalised to their canonical spelling). A lenient mock
 * would pass while the real thing failed.
 */

const USER_ID = 7

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

const CANONICAL = ['Genel', 'Envanter', 'Çalışma Alanı', 'Sınır', 'Rota', 'Referans Noktası', 'Diğer']

/** The backend's `DrawingCategories.TryNormalize`, in miniature. */
function normalizeCategory(value) {
  const trimmed = (value ?? '').trim()
  if (trimmed.length === 0) return null
  return CANONICAL.find((item) => item.toLocaleLowerCase('tr') === trimmed.toLocaleLowerCase('tr')) ?? null
}

const EXISTING_WKT = 'POLYGON((32.6 39.8, 33.0 39.8, 33.0 40.1, 32.6 40.1, 32.6 39.8))'

function makeRecord(id, name, wkt, category = null) {
  return {
    id,
    name,
    wkt,
    style: null,
    description: '',
    category,
    tags: [],
    createdDate: '2026-08-01T09:00:00Z',
    modifiedDate: '2026-08-01T09:00:00Z',
    createdBy: 'browser-user',
    createdByUserId: USER_ID,
  }
}

/**
 * Signs in and serves one existing uncategorised polygon from a mock that
 * stores what it is sent, the way the real API does.
 *
 * @returns {{ requests: object[], polygons: object[] }} the recorded payloads
 */
async function openMap(page) {
  const requests = []
  const polygons = [makeRecord(3, 'Mevcut Alan', EXISTING_WKT, null)]
  let nextId = 100

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: USER_ID, username: 'browser-user', role: 'User' })),
  )
  await page.route('**/api/drawings/points', (route) => route.fulfill(json([])))
  await page.route('**/api/drawings/lines', (route) => route.fulfill(json([])))
  await page.route('**/api/drawings/polygons', (route) => route.fulfill(json(polygons)))

  await page.route('**/api/drawings/polygon', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    requests.push({ method: 'POST', body })

    const record = makeRecord(nextId++, body.name, body.wkt, normalizeCategory(body.category))
    polygons.push(record)
    await route.fulfill(json(record))
  })

  await page.route('**/api/drawings/polygon/*', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    requests.push({ method: 'PUT', body })

    const id = Number(route.request().url().split('/').pop())
    const record = polygons.find((item) => item.id === id)

    if (body.name != null) record.name = body.name
    // The contract the real backend keeps: an absent field is preserved, an
    // empty string clears, anything else is normalised and stored.
    if (body.category !== undefined && body.category !== null) {
      record.category = normalizeCategory(body.category)
    }
    await route.fulfill(json(record))
  })

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3600_000).toISOString())

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  return { requests, polygons }
}

/* --- Panel controls ---------------------------------------------------------
   Each dropdown is found through its own visible label; "Kategori" alone also
   matches the group dropdown's "Kategoriye Göre" option text. */

function panelSelect(page, label) {
  return page
    .locator('.drawings-select')
    .filter({ has: page.locator('.drawings-select-label', { hasText: new RegExp(`^${label}$`) }) })
    .locator('select')
}

async function openDrawingsPanel(page) {
  await page.getByRole('button', { name: 'Çizimlerim' }).click()
  await expect(page.locator('.drawings-panel')).toBeVisible()
}

const listedTitles = (page) => page.locator('.drawings-item-title')

/** Draws a four-corner polygon on the map and opens the attribute popup. */
async function drawPolygon(page) {
  await page.getByRole('button', { name: 'Poligon' }).click()

  const box = await page.locator('.map-container').boundingBox()
  const at = (dx, dy) => ({ x: box.x + 300 + dx, y: box.y + 250 + dy })

  for (const point of [at(0, 0), at(150, 0), at(150, 120)]) {
    await page.mouse.click(point.x, point.y)
    await page.waitForTimeout(120)
  }
  // A double-click places the final vertex and closes the ring.
  await page.mouse.dblclick(at(0, 120).x, at(0, 120).y)

  await expect(page.getByRole('dialog')).toBeVisible()
}

/** Fills the create popup and saves. `category` of '' leaves it unset. */
async function saveNewDrawing(page, { name, category }) {
  await page.getByLabel('İsim').fill(name)

  if (category) {
    await page.getByRole('button', { name: 'Daha fazla seçenek' }).click()
    await page.getByLabel('Kategori').selectOption(category)
  }

  await page.getByRole('button', { name: 'Kaydet' }).click()
  await expect(page.getByRole('dialog')).toBeHidden()
}

/** Edits the currently selected drawing's category through the Bilgiler tab. */
async function editCategory(page, category) {
  await page.locator('.selected-info-tab').getByLabel('Kategori').selectOption(category)
  await page.getByRole('button', { name: 'Kaydet' }).click()
}

/* --- Create ------------------------------------------------------------------ */

test('a category chosen at create time is sent, kept and filterable', async ({ page }) => {
  const { requests } = await openMap(page)

  await drawPolygon(page)
  await saveNewDrawing(page, { name: 'Category Create Test', category: 'Envanter' })

  // 1. The category has to actually leave the browser. This is the assertion
  //    that would have located the original report in one run.
  const created = requests.find((entry) => entry.method === 'POST')
  expect(created.body.category).toBe('Envanter')

  // 2. And the panel must find it — without a reload.
  await openDrawingsPanel(page)
  await panelSelect(page, 'Kategori').selectOption('Envanter')

  await expect(listedTitles(page)).toHaveCount(1)
  await expect(listedTitles(page)).toContainText('Category Create Test')
})

test('an edited category is sent, merged into local state and filterable at once', async ({ page }) => {
  const { requests } = await openMap(page)

  await openDrawingsPanel(page)
  await page.getByRole('button', { name: 'Mevcut Alan çizimini düzenle' }).click()
  await editCategory(page, 'Rota')
  await expect(page.getByText('Poligon güncellendi.')).toBeVisible()

  const updated = requests.find((entry) => entry.method === 'PUT')
  expect(updated.body.category).toBe('Rota')

  /* The local map feature must take the category from the SAVE RESPONSE. If it
     kept the pre-edit value, the filter below would come up empty until a
     reload — the exact shape of bug the report described. */
  await openDrawingsPanel(page)
  await panelSelect(page, 'Kategori').selectOption('Rota')

  await expect(listedTitles(page)).toHaveCount(1)
  await expect(listedTitles(page)).toContainText('Mevcut Alan')
})

/* --- Persistence across a reload --------------------------------------------- */

test('a saved category still filters after a full reload', async ({ page }) => {
  await openMap(page)

  await drawPolygon(page)
  await saveNewDrawing(page, { name: 'Reload Category Test', category: 'Sınır' })

  await page.reload()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  await openDrawingsPanel(page)
  await panelSelect(page, 'Kategori').selectOption('Sınır')

  await expect(listedTitles(page)).toHaveCount(1)
  await expect(listedTitles(page)).toContainText('Reload Category Test')
})

/* --- Grouping, search and the uncategorised bucket ---------------------------- */

test('grouping by category puts a drawing in its own bucket', async ({ page }) => {
  await openMap(page)

  await drawPolygon(page)
  await saveNewDrawing(page, { name: 'Grouped Drawing', category: 'Envanter' })

  await openDrawingsPanel(page)
  await panelSelect(page, 'Grupla').selectOption('category')

  // The named group holds the categorised drawing; the seeded one falls into
  // the explicit "no category" bucket rather than disappearing.
  const inventory = page.locator('.drawings-group').filter({ hasText: 'Envanter' })
  await expect(inventory.locator('.drawings-item-title')).toContainText('Grouped Drawing')

  const uncategorised = page.locator('.drawings-group').filter({ hasText: 'Kategori Yok' })
  await expect(uncategorised.locator('.drawings-item-title')).toContainText('Mevcut Alan')
})

test('clearing a category returns the drawing to "Kategori Yok"', async ({ page }) => {
  const { requests } = await openMap(page)

  const puts = () => requests.filter((entry) => entry.method === 'PUT')

  await openDrawingsPanel(page)
  await page.getByRole('button', { name: 'Mevcut Alan çizimini düzenle' }).click()
  await editCategory(page, 'Rota')
  await expect.poll(() => puts().length).toBe(1)

  // Now clear it again through the "Kategori yok" option. The save is awaited on
  // the recorded request, not on a toast — two identical toasts stack.
  await openDrawingsPanel(page)
  await page.getByRole('button', { name: 'Mevcut Alan çizimini düzenle' }).click()
  await editCategory(page, '')
  await expect.poll(() => puts().length).toBe(2)

  // An empty string, not null: the backend reads "" as "clear this field",
  // while a missing field would preserve the category it just replaced.
  expect(puts().at(-1).body.category).toBe('')

  await openDrawingsPanel(page)
  await panelSelect(page, 'Grupla').selectOption('category')

  const uncategorised = page.locator('.drawings-group').filter({ hasText: 'Kategori Yok' })
  await expect(uncategorised.locator('.drawings-item-title')).toContainText('Mevcut Alan')
  await expect(page.locator('.drawings-group').filter({ hasText: 'Rota' })).toHaveCount(0)
})

test('search matches a drawing by its category name', async ({ page }) => {
  await openMap(page)

  await drawPolygon(page)
  await saveNewDrawing(page, { name: 'Searchable Drawing', category: 'Envanter' })

  await openDrawingsPanel(page)
  await page.getByRole('searchbox', { name: 'Çizim ara' }).fill('Envanter')

  await expect(listedTitles(page)).toHaveCount(1)
  await expect(listedTitles(page)).toContainText('Searchable Drawing')
})
