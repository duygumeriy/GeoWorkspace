import { expect, test } from '@playwright/test'

/**
 * Browser cover for the "Çöp Kutusu" panel: listing, filtering, searching and
 * restoring soft-deleted drawings.
 *
 * ## Why these exist
 *
 * Soft delete and restore were already implemented on the backend, but nothing
 * in the UI showed either of them — a deletion simply looked permanent. These
 * tests pin down the half of the contract the frontend owns:
 *
 *   1. deleted records are read from `/api/drawings/deleted` and shown with the
 *      type and the DELETION time (not the modification time),
 *   2. the type filter and the name search narrow that list the way the panel
 *      promises, including the two distinct empty states,
 *   3. restoring asks first, sends the existing `{ type, id }` restore contract
 *      — never a create — and afterwards the row leaves the trash while the map
 *      is reloaded so the drawing comes back without a page refresh.
 *
 * The backend half — that the query is scoped to the caller's own deleted rows
 * and that restore reopens the same id — is covered by `DrawingTrashTests`,
 * which asserts against the stored row.
 *
 * The mock mirrors the real API's shape exactly: `{ type, deletedAt, drawing }`
 * where `drawing` is the ordinary drawing body. A lenient mock would pass here
 * while the real thing failed.
 */

const USER_ID = 7

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

function makeDrawing(id, name, wkt, strokeColor = '#6D4AFF') {
  return {
    id,
    name,
    wkt,
    style: {
      strokeColor,
      strokeWidth: 3,
      fillColor: strokeColor,
      fillOpacity: 0.25,
      pointRadius: 7,
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
}

/** One trash entry, in the exact shape `DeletedDrawingResponse` serialises to. */
function makeDeleted(type, drawing, deletedAt) {
  return { type, deletedAt, drawing }
}

const ANKARA_POLYGON = makeDrawing(
  11,
  'Ankara Ofis Alanı',
  'POLYGON((32.6 39.8, 33.0 39.8, 33.0 40.1, 32.6 40.1, 32.6 39.8))',
  '#DC2626',
)
const IZMIR_POINT = makeDrawing(12, 'İzmir Deposu', 'POINT(27.1 38.4)')
const ROUTE_LINE = makeDrawing(13, 'Kuzey Rotası', 'LINESTRING(30.0 39.0, 31.0 39.5)')

/** Newest deletion first, the order the server answers in. */
const DEFAULT_TRASH = [
  makeDeleted('polygon', ANKARA_POLYGON, '2026-08-17T15:20:00Z'),
  makeDeleted('point', IZMIR_POINT, '2026-08-16T08:05:00Z'),
  makeDeleted('line', ROUTE_LINE, '2026-08-15T11:45:00Z'),
]

/**
 * Signs in and serves an empty map plus a mocked trash.
 *
 * @param {object} options
 * @param {Array} [options.trash] entries the deleted endpoint answers with
 * @param {number} [options.deletedDelayMs] holds the response, so the loading
 *   state can be observed rather than raced past
 * @returns {{ restoreRequests: object[], listLoads: number, state: object }}
 */
async function openMap(page, { trash = DEFAULT_TRASH, deletedDelayMs = 0 } = {}) {
  const restoreRequests = []
  const state = {
    // Restoring moves a record from the trash into the live list, which is what
    // the map reload then picks up.
    trash: [...trash],
    polygons: [],
    points: [],
    lines: [],
    listLoads: 0,
  }

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: USER_ID, username: 'browser-user', role: 'User' })),
  )

  await page.route('**/api/drawings/points', (route) => {
    state.listLoads += 1
    return route.fulfill(json(state.points))
  })
  await page.route('**/api/drawings/lines', (route) => route.fulfill(json(state.lines)))
  await page.route('**/api/drawings/polygons', (route) => route.fulfill(json(state.polygons)))

  await page.route('**/api/drawings/deleted', async (route) => {
    if (deletedDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, deletedDelayMs))
    await route.fulfill(json(state.trash))
  })

  await page.route('**/api/drawings/restore', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    restoreRequests.push(body)

    const items = []
    for (const target of body.items ?? []) {
      const index = state.trash.findIndex(
        (entry) => entry.type === target.type && entry.drawing.id === target.id,
      )
      if (index === -1) continue

      const [entry] = state.trash.splice(index, 1)
      // The record goes back to the live collection under the SAME id — the
      // real endpoint reopens the row, it does not create a new one.
      const bucket = { point: 'points', line: 'lines', polygon: 'polygons' }[entry.type]
      state[bucket].push(entry.drawing)
      items.push({ type: entry.type, drawing: entry.drawing })
    }

    await route.fulfill(json({ count: items.length, items }))
  })

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3600_000).toISOString())

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  return { restoreRequests, state }
}

async function openTrashPanel(page) {
  await page.getByRole('button', { name: 'Çöp Kutusu' }).click()
  await expect(page.locator('.trash-panel')).toBeVisible()
}

const listedTitles = (page) => page.locator('.trash-item-title')

/* --- Listing ---------------------------------------------------------------- */

test('trash lists the deleted drawings with their type and deletion time', async ({ page }) => {
  await openMap(page)
  await openTrashPanel(page)

  await expect(listedTitles(page)).toHaveText([
    '#11 Ankara Ofis Alanı',
    '#12 İzmir Deposu',
    '#13 Kuzey Rotası',
  ])

  // The header counts everything in the trash, regardless of the filters.
  await expect(page.locator('.map-sheet-title')).toHaveText('Çöp Kutusu (3)')

  const firstRow = page.locator('.trash-row').first()
  await expect(firstRow).toContainText('Tür: Poligon')
  // The DELETION time, formatted by the app's shared formatter. The record's
  // modifiedDate is a different day on purpose, so a mix-up would show here.
  await expect(firstRow).toContainText('Silinme: 17.08.2026')
  await expect(firstRow).not.toContainText('01.08.2026')
})

test('trash shows a loading state while the list is in flight', async ({ page }) => {
  await openMap(page, { deletedDelayMs: 1200 })

  await page.getByRole('button', { name: 'Çöp Kutusu' }).click()

  await expect(page.getByText('Silinen çizimler yükleniyor...')).toBeVisible()
  await expect(listedTitles(page).first()).toBeVisible()
  await expect(page.getByText('Silinen çizimler yükleniyor...')).toBeHidden()
})

test('an empty trash explains itself instead of showing a blank panel', async ({ page }) => {
  await openMap(page, { trash: [] })
  await openTrashPanel(page)

  await expect(page.getByText('Çöp kutusunda çizim yok.')).toBeVisible()
  await expect(page.getByText('Silinen çizimler burada görünecek.')).toBeVisible()
  // With nothing to filter, the controls stay out of the way.
  await expect(page.locator('.trash-chips')).toHaveCount(0)
})

/* --- Filtering and search ---------------------------------------------------- */

test('the type filter narrows the trash to one geometry type', async ({ page }) => {
  await openMap(page)
  await openTrashPanel(page)

  await page.getByRole('button', { name: 'Nokta', exact: true }).click()
  await expect(listedTitles(page)).toHaveText(['#12 İzmir Deposu'])

  await page.getByRole('button', { name: 'Poligon', exact: true }).click()
  await expect(listedTitles(page)).toHaveText(['#11 Ankara Ofis Alanı'])

  // "Tümü" puts every type back — one trash, not three.
  await page.getByRole('button', { name: 'Tümü', exact: true }).click()
  await expect(listedTitles(page)).toHaveCount(3)
})

test('searching by name is case- and diacritic-insensitive', async ({ page }) => {
  await openMap(page)
  await openTrashPanel(page)

  const search = page.getByLabel('Silinen çizimlerde adına göre ara')

  await search.fill('ankara')
  await expect(listedTitles(page)).toHaveText(['#11 Ankara Ofis Alanı'])

  // Typed without the dotted İ, the way a user actually types it.
  await search.fill('izmir')
  await expect(listedTitles(page)).toHaveText(['#12 İzmir Deposu'])
})

test('a filter that matches nothing says so, separately from an empty trash', async ({ page }) => {
  await openMap(page)
  await openTrashPanel(page)

  await page.getByLabel('Silinen çizimlerde adına göre ara').fill('bulunmayan-çizim')

  await expect(page.getByText('Bu filtreyle eşleşen çizim bulunamadı.')).toBeVisible()
  // The other empty state must NOT appear: the trash is not empty, a filter is
  // hiding its contents, and saying otherwise would send the user looking for a
  // drawing they still have.
  await expect(page.getByText('Çöp kutusunda çizim yok.')).toHaveCount(0)

  await page.getByRole('button', { name: 'Filtreleri Temizle' }).click()
  await expect(listedTitles(page)).toHaveCount(3)
})

test('sorting flips the list between newest and oldest deletion', async ({ page }) => {
  await openMap(page)
  await openTrashPanel(page)

  await page.locator('.trash-select select').selectOption('oldest')
  await expect(listedTitles(page)).toHaveText([
    '#13 Kuzey Rotası',
    '#12 İzmir Deposu',
    '#11 Ankara Ofis Alanı',
  ])

  await page.locator('.trash-select select').selectOption('newest')
  await expect(listedTitles(page).first()).toHaveText('#11 Ankara Ofis Alanı')
})

/* --- Restore ----------------------------------------------------------------- */

test('restoring asks for confirmation and can be cancelled', async ({ page }) => {
  const { restoreRequests } = await openMap(page)
  await openTrashPanel(page)

  await page.getByRole('button', { name: 'Ankara Ofis Alanı çizimini geri yükle' }).click()

  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  // Naming the drawing is what makes the dialog catch a mis-tap.
  await expect(dialog).toContainText('Ankara Ofis Alanı')

  await dialog.getByRole('button', { name: 'Vazgeç' }).click()

  await expect(dialog).toBeHidden()
  // Nothing was sent and nothing left the list.
  expect(restoreRequests).toEqual([])
  await expect(listedTitles(page)).toHaveCount(3)
})

test('restoring sends the existing restore contract and returns the drawing to the map', async ({ page }) => {
  const { restoreRequests, state } = await openMap(page)
  await openTrashPanel(page)

  const loadsBeforeRestore = state.listLoads

  await page.getByRole('button', { name: 'Ankara Ofis Alanı çizimini geri yükle' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Geri Yükle' }).click()

  await expect(page.locator('.map-toast.is-success')).toContainText('Çizim geri yüklendi.')

  // Identity only: no geometry, no name, no owner. Restoring must not be able
  // to turn into a create that claims ownership of the record.
  expect(restoreRequests).toEqual([{ items: [{ type: 'polygon', id: 11 }] }])

  // The row is gone from the trash immediately — it is no longer deleted.
  await expect(listedTitles(page)).toHaveText(['#12 İzmir Deposu', '#13 Kuzey Rotası'])
  await expect(page.locator('.map-sheet-title')).toHaveText('Çöp Kutusu (2)')

  // The map was reloaded, so the drawing is back without a page refresh.
  expect(state.listLoads).toBeGreaterThan(loadsBeforeRestore)
  await expect(page.getByRole('button', { name: 'Çizimlerim' })).toBeVisible()
  await page.getByRole('button', { name: 'Çizimlerim' }).click()
  await expect(page.locator('.drawings-item-title')).toHaveText(['#11 Ankara Ofis Alanı'])
})

test('a failed restore leaves the record in the trash', async ({ page }) => {
  await openMap(page)

  await page.route('**/api/drawings/restore', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Bu çizim üzerinde işlem yapma yetkiniz yok.' }),
    }),
  )

  await openTrashPanel(page)

  await page.getByRole('button', { name: 'İzmir Deposu çizimini geri yükle' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Geri Yükle' }).click()

  await expect(page.locator('.map-toast.is-error')).toContainText('yetkiniz yok')
  // The panel keeps showing the truth: the record is still deleted.
  await expect(listedTitles(page)).toHaveCount(3)
})
