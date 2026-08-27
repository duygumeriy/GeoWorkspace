import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'

/**
 * Interaction-level QA for the geometry editor.
 *
 * These run against the real OpenLayers map with a mocked API, because the
 * things this phase changed are precisely the things a unit test cannot see:
 * whether clicking a numbered marker selects the matching row, whether a
 * programmatic coordinate write leaves OpenLayers' Modify handles behind at the
 * OLD position, and whether an inserted vertex lands on the segment its button
 * named.
 *
 * ## How positions are made deterministic
 *
 * Screen coordinates of a vertex are never guessed. "Haritada Göster" centres
 * the map on a vertex **without changing the zoom**, so immediately afterwards
 * that vertex is at the map's centre pixel — and that is the only pixel any test
 * here relies on.
 */

const USER_ID = 7

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/** A square-ish polygon near Ankara: 4 unique vertices, ring closed in the WKT. */
const POLYGON_WKT = 'POLYGON((32.6 39.8, 33.0 39.8, 33.0 40.1, 32.6 40.1, 32.6 39.8))'
/** A three-point line: the middle vertex makes reordering and midpoints visible. */
const LINE_WKT = 'LINESTRING(29.0 40.0, 29.4 40.2, 29.8 40.0)'
const POINT_WKT = 'POINT(32.8597 39.9334)'
const TWO_AREA_SCOPE = {
  isRestricted: true,
  effectiveWkt:
    'MULTIPOLYGON (((32 39, 33 39, 33 40, 32 40, 32 39)), ((35 38, 36 38, 36 39, 35 39, 35 38)))',
  areaCount: 2,
}
const POLYGON_EDIT_CYCLE_SCOPE = {
  isRestricted: true,
  effectiveWkt:
    'MULTIPOLYGON (((32.3 39.4, 33.05 39.4, 33.05 40.4, 32.3 40.4, 32.3 39.4)), ((33.1 39.4, 33.85 39.4, 33.85 40.4, 33.1 40.4, 33.1 39.4)))',
  areaCount: 2,
}
const HOLE_SCOPE = {
  isRestricted: true,
  effectiveWkt:
    'MULTIPOLYGON (((32.4 39.6, 34.2 39.6, 34.2 40.3, 32.4 40.3, 32.4 39.6), (32.72 39.9, 32.84 39.9, 32.78 40.0, 32.72 39.9)))',
  areaCount: 1,
}

function record(id, name, wkt) {
  return {
    id,
    name,
    wkt,
    style: null,
    description: '',
    category: '',
    tags: [],
    createdDate: '2026-08-01T09:00:00Z',
    modifiedDate: '2026-08-01T09:00:00Z',
    createdBy: 'browser-user',
    createdByUserId: USER_ID,
  }
}

/** Signs in without a network round trip and puts one drawing of each type on the map. */
async function openMap(page, geographicScope = { isRestricted: false, effectiveWkt: null, areaCount: 0 }) {
  /* Yetki ucu da yanıtlanmalı: arayüz küme gelene kadar korumalı hiçbir şeyi
     çizmez (fail-closed). Bu spec yetki KURALLARINI ölçmüyor, bu yüzden tam
     küme verilir; kuralların kendisi permission-aware-ui.spec.js'in işidir. */
  await mockPermissions(page)

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: USER_ID, username: 'browser-user', role: 'User' })),
  )
  await page.route('**/api/auth/me/geographic-scope', (route) =>
    route.fulfill(json(geographicScope)),
  )
  await page.route('**/api/drawings/points', (route) =>
    route.fulfill(json([record(1, 'Test Noktası', POINT_WKT)])),
  )
  await page.route('**/api/drawings/lines', (route) =>
    route.fulfill(json([record(2, 'Test Çizgisi', LINE_WKT)])),
  )
  await page.route('**/api/drawings/polygons', (route) =>
    route.fulfill(json([record(3, 'Test Alanı', POLYGON_WKT)])),
  )

  // A session is a token plus an expiry; the app never decodes the token itself,
  // so any opaque string works once /api/auth/me is answered.
  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3600_000).toISOString())

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()
}

/** Opens a drawing's edit session and switches to the Geometri tab. */
async function startEditing(page, name) {
  // The sidebar collapses into a drawer below 640px.
  const menu = page.getByRole('button', { name: 'Menüyü aç' })
  if (await menu.isVisible()) await menu.click()

  await page.getByRole('button', { name: 'Çizimlerim' }).click()
  await page.getByRole('button', { name: `${name} çizimini düzenle` }).click()
  await page.getByRole('tab', { name: 'Geometri' }).click()
  await expect(page.getByText('Koordinatlar WGS84 (EPSG:4326) formatındadır.')).toBeVisible()
}

/** The row for "Köşe 3" / "Nokta 2" — the list item, not just its title button. */
function vertexRow(page, label) {
  return page.locator('.vertex-row').filter({ has: page.getByRole('button', { name: label, exact: true }) })
}

/* Selection assertions must be the auto-retrying kind. OpenLayers withholds
   `singleclick` for ~250ms after mouseup so it can tell a click from a
   double-click, so a one-shot read taken the instant `mouse.click()` returns
   always sees the state from before the click. */
const expectSelected = (page, label) => expect(vertexRow(page, label)).toHaveClass(/is-selected/)
const expectNotSelected = (page, label) =>
  expect(vertexRow(page, label)).not.toHaveClass(/is-selected/)

/** Undo/redo also exist on the draw toolbar, so history assertions stay scoped. */
function historyButton(page, name) {
  return page.locator('.selected-history').getByRole('button', { name })
}

/**
 * Centres the map on a vertex, leaving it at the map's centre pixel.
 *
 * The camera move is a 500ms `View.animate`, so the wait is not padding: without
 * it every pixel these tests compute belongs to a map that is still travelling.
 */
async function showOnMap(page, label) {
  await vertexRow(page, label).getByRole('button', { name: 'Haritada Göster' }).click()
  await page.waitForTimeout(700)
}

async function mapCentre(page) {
  const box = await page.locator('.map-container').boundingBox()
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/**
 * A point on the polygon's left edge, given that vertex 1 (its bottom-left
 * corner) has just been centred.
 *
 * Straight up from that corner runs the closing edge, Köşe 4–1. Upward matters:
 * the edit panel is docked over the right of the map, so an offset to the RIGHT
 * of centre lands on the panel rather than on the map.
 */
function onLeftEdge(centre) {
  return { x: centre.x, y: centre.y - 150 }
}

/** The longitude currently shown for a row. */
async function longitudeOf(page, label) {
  return Number(await vertexRow(page, label).locator('input').first().inputValue())
}

function polygonCoords(wkt) {
  const pairs = [...String(wkt).matchAll(/([\d.-]+)\s+([\d.-]+)/g)].map((match) => [
    Number(match[1]),
    Number(match[2]),
  ])
  return pairs.length > 1 && pairs[0][0] === pairs.at(-1)[0] && pairs[0][1] === pairs.at(-1)[1]
    ? pairs.slice(0, -1)
    : pairs
}

async function polygonPanelCoords(page) {
  return Promise.all(
    ['Köşe 1', 'Köşe 2', 'Köşe 3', 'Köşe 4'].map(async (label) => {
      const row = vertexRow(page, label)
      return [Number(await row.locator('input').first().inputValue()), Number(await row.locator('input').nth(1).inputValue())]
    }),
  )
}

async function expectPolygonPanel(page, expected) {
  const actual = await polygonPanelCoords(page)
  expect(actual).toHaveLength(expected.length)
  actual.forEach((coordinate, index) => {
    expect(coordinate[0]).toBeCloseTo(expected[index][0], 5)
    expect(coordinate[1]).toBeCloseTo(expected[index][1], 5)
  })
}

function expectInsideLongitudeRange(coords, [minimum, maximum]) {
  for (const [longitude] of coords) {
    expect(longitude).toBeGreaterThanOrEqual(minimum)
    expect(longitude).toBeLessThanOrEqual(maximum)
  }
}

async function dragFrom(page, from, dx, dy) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  // Several steps: OpenLayers only treats a pointer sequence as a drag once it
  // has moved past its own tolerance, and one jump can be swallowed.
  await page.mouse.move(from.x + dx, from.y + dy, { steps: 12 })
  await page.mouse.up()
}

/* --- Polygon ---------------------------------------------------------------- */

test.describe('polygon geometry editor', () => {
  test('vertices are named, numbered and free of unlabelled controls', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Alanı')

    // Every vertex is addressed by name, matching the number on the map marker.
    for (const label of ['Köşe 1', 'Köşe 2', 'Köşe 3', 'Köşe 4']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    }

    // The ring is closed internally but shown open: no repeated first vertex.
    await expect(page.locator('.vertex-row')).toHaveCount(4)
    await expect(page.getByText('Köşe Sayısı')).toBeVisible()

    // Reordering is gone from the polygon UI entirely — it re-routes a boundary.
    await expect(page.getByRole('button', { name: /Sıraya Taşı/ })).toHaveCount(0)
    await expect(page.locator('.vertex-advanced')).toHaveCount(0)

    // Both map gestures explain themselves rather than relying on a tooltip.
    await expect(
      page.getByText('Tek tek köşe noktalarını sürükleyerek şekli değiştirebilirsiniz.'),
    ).toBeVisible()
    await expect(
      page.getByText('Şeklin boyutunu ve biçimini değiştirmeden tamamını taşıyabilirsiniz.'),
    ).toBeVisible()
  })

  test('insertion names the exact segment it will split, including the closing edge', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Alanı')

    await expect(vertexRow(page, 'Köşe 1').getByRole('button', { name: 'Köşe 1–2 Arasına Ekle' })).toBeVisible()
    await expect(vertexRow(page, 'Köşe 3').getByRole('button', { name: 'Köşe 3–4 Arasına Ekle' })).toBeVisible()
    // The ring wraps, so the last row offers the closing edge rather than an
    // append that would fling a vertex outside the polygon.
    await expect(vertexRow(page, 'Köşe 4').getByRole('button', { name: 'Köşe 4–1 Arasına Ekle' })).toBeVisible()

    const before = { first: await longitudeOf(page, 'Köşe 1'), second: await longitudeOf(page, 'Köşe 2') }

    await vertexRow(page, 'Köşe 1').getByRole('button', { name: 'Köşe 1–2 Arasına Ekle' }).click()

    // The new vertex is the midpoint of the named segment, is numbered 2, and is
    // the selected row — so the coordinate boxes already belong to it.
    await expect(page.locator('.vertex-row')).toHaveCount(5)
    expect(await longitudeOf(page, 'Köşe 2')).toBeCloseTo((before.first + before.second) / 2, 5)
    await expectSelected(page, 'Köşe 2')
  })

  test('panel selection lights up the map, and a map click selects the matching row', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Alanı')

    // Panel -> map: selecting a row centres the geometry's vertex 3 on screen.
    await showOnMap(page, 'Köşe 3')
    await expectSelected(page, 'Köşe 3')

    /* Move the selection away WITHOUT moving the map: an insertion selects the
       vertex it created and never pans, so the vertex under the centre pixel is
       still Köşe 3 — the new midpoint took the number 4 behind it. */
    await vertexRow(page, 'Köşe 3').getByRole('button', { name: 'Köşe 3–4 Arasına Ekle' }).click()
    await expectSelected(page, 'Köşe 4')
    await expectNotSelected(page, 'Köşe 3')

    // Map -> panel: clicking the marker at the centre selects ITS row, proving
    // both surfaces number the same vertex list the same way.
    const centre = await mapCentre(page)
    await page.mouse.click(centre.x, centre.y)

    await expectSelected(page, 'Köşe 3')
    await expectNotSelected(page, 'Köşe 4')
  })

  test('deleting stops at three vertices and says why', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Alanı')

    await vertexRow(page, 'Köşe 4').getByRole('button', { name: 'Köşeyi Sil' }).click()
    await expect(page.locator('.vertex-row')).toHaveCount(3)

    // At the minimum every delete button disables itself rather than failing at
    // save time, and the panel states the rule.
    for (const label of ['Köşe 1', 'Köşe 2', 'Köşe 3']) {
      await expect(vertexRow(page, label).getByRole('button', { name: 'Köşeyi Sil' })).toBeDisabled()
    }
    await expect(page.getByText('Polygon için en az 3 köşe gereklidir; silme şu an kapalı.')).toBeVisible()
  })

  test('dragging a native segment handle inserts and moves a polygon vertex', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Alanı')

    /* Centre vertex 1, then drag the native midpoint handle on the closing edge.
       OpenLayers must create the new vertex itself; no panel insertion action
       participates in this gesture. */
    await showOnMap(page, 'Köşe 1')
    const centre = await mapCentre(page)
    const edgePoint = onLeftEdge(centre)
    await dragFrom(page, edgePoint, -60, 0)

    await expect(page.locator('.vertex-row')).toHaveCount(5)
    await expect(page.getByRole('button', { name: 'Kaydet' })).toBeEnabled()
  })

  test('a typed coordinate moves the Modify handle with it', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Alanı')

    await showOnMap(page, 'Köşe 1')
    const centre = await mapCentre(page)

    // Programmatic write: push vertex 1 well away, diagonally, so its old spot
    // does not end up sitting on one of the polygon's new edges.
    const lon = vertexRow(page, 'Köşe 1').locator('input').first()
    const lat = vertexRow(page, 'Köşe 1').locator('input').nth(1)
    await lon.fill('31.9')
    await lat.fill('39.1')
    await lat.blur()

    const moved = await longitudeOf(page, 'Köşe 1')
    expect(moved).toBeCloseTo(31.9, 5)

    /* (a) NOTHING draggable may be left behind at the old position. A stale
           handle here is the exact Phase 2 risk this test exists for: the drag
           would grab it and the coordinate would change. */
    await dragFrom(page, centre, 70, 0)
    expect(await longitudeOf(page, 'Köşe 1')).toBeCloseTo(moved, 5)

    /* (b) A live handle must exist at the NEW position, and be draggable. */
    await showOnMap(page, 'Köşe 1')
    const newCentre = await mapCentre(page)
    await dragFrom(page, newCentre, 70, 0)

    /* `modifyend` commits through React state. The pointer gesture is complete
       here, but a busy full-suite render need not have painted the controlled
       coordinate input in the same task. Keep the semantic assertion (the live
       handle really moved east) while waiting for that commit to become visible. */
    await expect.poll(() => longitudeOf(page, 'Köşe 1')).toBeGreaterThan(moved)
  })

  test('undo, redo and reset walk the geometry back and forward', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Alanı')

    const original = await longitudeOf(page, 'Köşe 1')

    await vertexRow(page, 'Köşe 1').locator('input').first().fill('31.5')
    await vertexRow(page, 'Köşe 1').locator('input').first().blur()
    expect(await longitudeOf(page, 'Köşe 1')).toBeCloseTo(31.5, 5)

    await historyButton(page, 'Geri Al').click()
    expect(await longitudeOf(page, 'Köşe 1')).toBeCloseTo(original, 5)

    await historyButton(page, 'Yinele').click()
    expect(await longitudeOf(page, 'Köşe 1')).toBeCloseTo(31.5, 5)

    await historyButton(page, 'Orijinale Döndür').click()
    expect(await longitudeOf(page, 'Köşe 1')).toBeCloseTo(original, 5)
  })

  test('leaving with unsaved work asks first, and saving sends the edited ring', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Alanı')

    await vertexRow(page, 'Köşe 1').locator('input').first().fill('31.5')
    await vertexRow(page, 'Köşe 1').locator('input').first().blur()

    // Closing mid-edit has to be confirmed rather than silently discarding.
    await page.getByRole('button', { name: 'İptal' }).click()
    await expect(page.getByText('Kaydedilmemiş değişiklikleriniz var.')).toBeVisible()
    await page.getByRole('button', { name: 'Düzenlemeye Dön' }).click()
    expect(await longitudeOf(page, 'Köşe 1')).toBeCloseTo(31.5, 5)

    let sent = null
    await page.route('**/api/drawings/polygon/3', async (route) => {
      sent = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill(json(record(3, 'Test Alanı', POLYGON_WKT)))
    })

    await page.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Poligon güncellendi.')).toBeVisible()

    // The saved ring carries the typed coordinate and is closed, exactly once.
    expect(sent.wkt).toContain('31.5')
    expect(sent.wkt).toMatch(/^POLYGON\(\(/)
  })

  test('translate moves the whole polygon without changing its shape', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Alanı')

    /* The grab pixel is ESTABLISHED, not guessed — the rule this file opens
       with. "Haritada Göster" puts Köşe 1 (the bottom-left corner) on the map's
       centre pixel, and the offset from there walks up the left edge and then
       inwards, so the gesture starts on the polygon's fill for certain. Taking
       the bare map centre instead assumes the earlier fitExtent left the shape
       under it, which depends on the fit padding, the container box and the
       viewport size; a pointerdown that misses the fill is a map pan, and a pan
       moves the camera rather than the drawing. */
    await showOnMap(page, 'Köşe 1')
    const centre = await mapCentre(page)
    const insidePolygon = { x: centre.x + 60, y: centre.y - 150 }

    await page.getByRole('button', { name: 'Tüm Geometriyi Taşı' }).click()
    const before = await polygonPanelCoords(page)

    /* Westwards on purpose. The edit panel is docked over the RIGHT of the map
       (see `onLeftEdge`), so a leftward drag keeps both the start and the end
       pixel on the map at every viewport this suite runs at. The direction is
       part of the contract: the view is north-up EPSG:3857, so a leftward drag
       can only decrease longitude. */
    await dragFrom(page, insidePolygon, -80, 0)

    const after = await polygonPanelCoords(page)
    const dx = after[0][0] - before[0][0]
    const dy = after[0][1] - before[0][1]

    // It actually moved, and it moved the way the pointer went.
    expect(dx).toBeLessThan(0)
    expect(Math.hypot(dx, dy)).toBeGreaterThan(1e-4)

    /* Rigid: EVERY vertex moved by the same amount, so no edge was stretched
       and no corner was left behind. Comparing latitudes like this is only
       sound because the drag is purely horizontal — Mercator's y axis is not
       linear in latitude, so a diagonal drag would give each vertex a
       different Δlat even for a perfectly rigid move. */
    after.forEach(([longitude, latitude], index) => {
      expect(longitude - before[index][0]).toBeCloseTo(dx, 5)
      expect(latitude - before[index][1]).toBeCloseTo(dy, 5)
    })
  })

  test('a successful retry clears only the stale geographic authorization warning', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Alanı')

    const original = await longitudeOf(page, 'Köşe 1')
    await vertexRow(page, 'Köşe 1').locator('input').first().fill('31.5')
    await vertexRow(page, 'Köşe 1').locator('input').first().blur()

    let attempt = 0
    await page.route('**/api/drawings/polygon/3', async (route) => {
      attempt += 1
      if (attempt === 1) {
        return route.fulfill(json({ message: 'Bu alanda çizim yapma yetkiniz bulunmuyor.' }, 403))
      }

      const body = JSON.parse(route.request().postData() ?? '{}')
      return route.fulfill(json(record(3, 'Test Alanı', body.wkt)))
    })

    await page.getByRole('button', { name: 'Kaydet' }).click()

    await expect(page.getByText('Bu alanda çizim yapma yetkiniz bulunmuyor.')).toBeVisible()
    await expect.poll(() => longitudeOf(page, 'Köşe 1')).toBeCloseTo(original, 5)

    await vertexRow(page, 'Köşe 1').locator('input').first().fill('31.6')
    await vertexRow(page, 'Köşe 1').locator('input').first().blur()
    await page.getByRole('button', { name: 'Kaydet' }).click()

    await expect(page.getByText('Poligon güncellendi.')).toBeVisible()
    await expect(page.getByText('Bu alanda çizim yapma yetkiniz bulunmuyor.')).toHaveCount(0)

    await startEditing(page, 'Test Alanı')
    await expect(page.getByText('Koordinatlar WGS84 (EPSG:4326) formatındadır.')).toBeVisible()
    await expect(page.getByText('Bu alanda çizim yapma yetkiniz bulunmuyor.')).toHaveCount(0)
  })

  test('Modify and Translate preserve the latest geometry across repeated Area A and Area B sessions', async ({ page }) => {
    await openMap(page, POLYGON_EDIT_CYCLE_SCOPE)

    let persisted = polygonCoords(POLYGON_WKT)
    const requests = []

    await page.route('**/api/drawings/polygon/3', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}')
      const candidate = polygonCoords(body.wkt)
      requests.push(candidate)
      persisted = candidate
      await route.fulfill(json(record(3, 'Test Alanı', body.wkt)))
    })

    const openCurrentSession = async () => {
      await startEditing(page, 'Test Alanı')
      await expectPolygonPanel(page, persisted)
    }

    const saveCurrentSession = async (expectedArea) => {
      const before = requests.length
      const candidate = await polygonPanelCoords(page)
      expectInsideLongitudeRange(candidate, expectedArea)

      await page.getByRole('button', { name: 'Kaydet' }).click()
      await expect.poll(() => requests.length).toBe(before + 1)
      requests.at(-1).forEach((coordinate, index) => {
        expect(coordinate[0]).toBeCloseTo(candidate[index][0], 5)
        expect(coordinate[1]).toBeCloseTo(candidate[index][1], 5)
      })
      await expect(page.getByText('Poligon güncellendi.').last()).toBeVisible()
      await expect(page.getByText('Bu alanda çizim yapma yetkiniz bulunmuyor.')).toHaveCount(0)
      await expect(page.getByText('Bu geometri mevcut coğrafi yetki alanlarınızın dışında.')).toHaveCount(0)
    }

    const modifyVertex = async (label, dx, dy) => {
      await showOnMap(page, label)
      await dragFrom(page, await mapCentre(page), dx, dy)
    }

    const translateFirstVertexTo = async (targetLongitude) => {
      await page.getByRole('button', { name: 'Tüm Geometriyi Taşı' }).click()
      await expect(page.getByRole('button', { name: 'Tüm Geometriyi Taşı' })).toHaveAttribute('aria-pressed', 'true')

      // Zooming out leaves enough screen room to cross the small gap between
      // the two disjoint authorization polygons with a real Translate drag.
      await page.waitForTimeout(700)
      const centre = await mapCentre(page)
      await page.mouse.move(centre.x, centre.y)
      await page.mouse.wheel(0, 1800)
      await page.waitForTimeout(700)

      const before = (await polygonPanelCoords(page))[0][0]
      const calibrationPixels = targetLongitude > before ? 40 : -40
      await dragFrom(page, centre, calibrationPixels, 0)

      const calibrated = (await polygonPanelCoords(page))[0][0]
      const longitudePerPixel = (calibrated - before) / calibrationPixels
      const remainingPixels = (targetLongitude - calibrated) / longitudePerPixel
      await dragFrom(
        page,
        { x: centre.x + calibrationPixels, y: centre.y },
        remainingPixels,
        0,
      )
    }

    // 1. Modify inside A.
    await openCurrentSession()
    await modifyVertex('Köşe 1', 18, -12)
    await saveCurrentSession([32.3, 33.05])

    // 2. Translate A -> B.
    await openCurrentSession()
    await translateFirstVertexTo(33.2)
    await saveCurrentSession([33.1, 33.85])

    // 3. Modify inside B.
    await openCurrentSession()
    await modifyVertex('Köşe 2', -16, 10)
    await saveCurrentSession([33.1, 33.85])

    // 4. Translate B -> A.
    await openCurrentSession()
    await translateFirstVertexTo(32.45)
    await saveCurrentSession([32.3, 33.05])

    // 5. Modify inside A again.
    await openCurrentSession()
    await modifyVertex('Köşe 3', -14, 9)
    await saveCurrentSession([32.3, 33.05])

    // 6. Translate A -> B again.
    await openCurrentSession()
    await translateFirstVertexTo(33.2)
    await saveCurrentSession([33.1, 33.85])

    // 7. Modify inside B again, then prove the next session uses this response.
    await openCurrentSession()
    await modifyVertex('Köşe 4', 12, -8)
    await saveCurrentSession([33.1, 33.85])
    await openCurrentSession()
    await expectPolygonPanel(page, persisted)

    expect(requests).toHaveLength(7)
  })
})

test('geographic authorization boundaries use the lightweight presentation', async ({ page }) => {
  await openMap(page)

  const style = await page.evaluate(async () => {
    const module = await import('/src/hooks/useGeographicScopeLayer.js')
    return module.SCOPE_STYLE
  })

  expect(style.strokeWidth).toBe(1.5)
  expect(style.lineDash).toEqual([8, 6])
  expect(style.fillColor).toBe('rgba(168, 85, 247, 0.04)')
})

test('an authorization hole is rendered and blocks a polygon that encloses it', async ({ page }) => {
  await openMap(page, HOLE_SCOPE)

  const diagnostic = await page.evaluate(async ({ scopeWkt, candidateWkt }) => {
    const geographic = await import('/src/map/geographicScope.js')
    const drawing = await import('/src/map/drawing.js')
    const layer = await import('/src/hooks/useGeographicScopeLayer.js')
    const scope = geographic.parseScope(scopeWkt)
    const candidate = drawing.wkt4326ToFeature(candidateWkt).getGeometry()
    const vertices = candidateWkt
      .match(/\(\((.*)\)\)/)[1]
      .split(',')
      .slice(0, -1)
      .map((pair) => pair.trim().split(/\s+/).map(Number))
    const features = layer.buildScopeFeatures(scope)

    return {
      ringCount: scope.polygons[0].length,
      verticesInside: vertices.every((vertex) => geographic.isLonLatInsideScope(scope, vertex)),
      geometryInside: geographic.isGeometryInsideScope(scope, candidate),
      excludedFeatureCount: features.filter(
        (feature) => feature.get('scopeKind') === layer.SCOPE_FEATURE_KINDS.excluded,
      ).length,
      excludedStyle: layer.EXCLUDED_SCOPE_STYLE,
    }
  }, { scopeWkt: HOLE_SCOPE.effectiveWkt, candidateWkt: POLYGON_WKT })

  expect(diagnostic.ringCount).toBe(2)
  expect(diagnostic.verticesInside).toBe(true)
  expect(diagnostic.geometryInside).toBe(false)
  expect(diagnostic.excludedFeatureCount).toBe(1)
  expect(diagnostic.excludedStyle.lineDash).toEqual([4, 4])

  let putCount = 0
  await page.route('**/api/drawings/polygon/3', async (route) => {
    putCount += 1
    const body = JSON.parse(route.request().postData() ?? '{}')
    await route.fulfill(json(record(3, 'Test Alanı', body.wkt)))
  })

  await startEditing(page, 'Test Alanı')
  await vertexRow(page, 'Köşe 1').locator('input').first().fill('32.55')
  await vertexRow(page, 'Köşe 1').locator('input').first().blur()
  await page.getByRole('button', { name: 'Kaydet' }).click()

  await expect(page.getByText('Bu geometri mevcut coğrafi yetki alanlarınızın dışında.')).toBeVisible()
  expect(putCount).toBe(0)

  // Move the restored draft beside the hole while staying inside the outer ring.
  for (const label of ['Köşe 1', 'Köşe 2', 'Köşe 3', 'Köşe 4']) {
    const input = vertexRow(page, label).locator('input').first()
    await input.fill(String(Number(await input.inputValue()) + 0.8))
    await input.blur()
  }
  await page.getByRole('button', { name: 'Kaydet' }).click()

  await expect.poll(() => putCount).toBe(1)
  await expect(page.getByText('Poligon güncellendi.').last()).toBeVisible()
})

/* --- Line ------------------------------------------------------------------- */

test.describe('line geometry editor', () => {
  test('points are numbered, add-before/after name their segment, reorder is advanced', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Çizgisi')

    for (const label of ['Nokta 1', 'Nokta 2', 'Nokta 3']) {
      await expect(page.getByRole('button', { name: label, exact: true })).toBeVisible()
    }

    // The terminal rows extend the line; the interior row splits a named segment.
    await expect(vertexRow(page, 'Nokta 1').getByRole('button', { name: 'Başa Nokta Ekle' })).toBeVisible()
    await expect(vertexRow(page, 'Nokta 2').getByRole('button', { name: 'Nokta 1–2 Arasına Ekle' })).toBeVisible()
    await expect(vertexRow(page, 'Nokta 2').getByRole('button', { name: 'Nokta 2–3 Arasına Ekle' })).toBeVisible()
    await expect(vertexRow(page, 'Nokta 3').getByRole('button', { name: 'Sona Nokta Ekle' })).toBeVisible()

    // Explicit start/end actions as well, for extending without hunting for a row.
    await expect(page.getByRole('button', { name: '+ Başlangıca Nokta Ekle' })).toBeVisible()
    await expect(page.getByRole('button', { name: '+ Sona Nokta Ekle' })).toBeVisible()

    // Reordering exists for a line (order is direction of travel) but is tucked
    // under a disclosure rather than sitting next to the everyday actions.
    const advanced = vertexRow(page, 'Nokta 2').locator('.vertex-advanced')
    await expect(advanced.getByRole('button', { name: 'Bir Önceki Sıraya Taşı' })).toBeHidden()
    await advanced.getByText('Gelişmiş').click()
    await expect(advanced.getByRole('button', { name: 'Bir Önceki Sıraya Taşı' })).toBeVisible()
  })

  test('adding before a point splits the segment that ends at it', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Çizgisi')

    const before = { first: await longitudeOf(page, 'Nokta 1'), second: await longitudeOf(page, 'Nokta 2') }

    await vertexRow(page, 'Nokta 2').getByRole('button', { name: 'Nokta 1–2 Arasına Ekle' }).click()

    await expect(page.locator('.vertex-row')).toHaveCount(4)
    expect(await longitudeOf(page, 'Nokta 2')).toBeCloseTo((before.first + before.second) / 2, 5)
    await expectSelected(page, 'Nokta 2')
  })

  test('reordering swaps two points and carries the selection with the point', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Çizgisi')

    const second = await longitudeOf(page, 'Nokta 2')
    const third = await longitudeOf(page, 'Nokta 3')

    const advanced = vertexRow(page, 'Nokta 2').locator('.vertex-advanced')
    await advanced.getByText('Gelişmiş').click()
    await advanced.getByRole('button', { name: 'Bir Sonraki Sıraya Taşı' }).click()

    expect(await longitudeOf(page, 'Nokta 2')).toBeCloseTo(third, 5)
    expect(await longitudeOf(page, 'Nokta 3')).toBeCloseTo(second, 5)
    // The point the user moved is still the selected one, now in row 3.
    await expectSelected(page, 'Nokta 3')
  })

  test('length tools live in their own section and edit the session, not the database', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Çizgisi')

    // The coordinate list and the geodesic tools no longer stack on one screen.
    await expect(page.getByRole('tab', { name: 'Noktalar' })).toBeVisible()
    await page.getByRole('tab', { name: 'Uzunluk Araçları' }).click()
    await expect(page.locator('.vertex-row')).toHaveCount(0)

    // The live length metric stays above the sub-tabs; the tools do not repeat it.
    await expect(page.locator('.geometry-metric', { hasText: 'Toplam Uzunluk' })).toHaveCount(1)

    const readLength = async () =>
      Number(
        (await page.locator('.geometry-metric', { hasText: 'Toplam Uzunluk' }).locator('dd').innerText())
          .replace(/[^\d,]/g, '')
          .replace(',', '.'),
      )

    const start = await readLength()

    await page.getByLabel('Mesafe').fill('5')
    await page.locator('.line-tool-field').filter({ hasText: 'Birim' }).first().locator('select').selectOption('km')
    await page.getByRole('button', { name: 'Uzat' }).click()
    expect(await readLength()).toBeGreaterThan(start)

    await page.getByRole('button', { name: 'Kısalt' }).click()
    expect(await readLength()).toBeCloseTo(start, 1)

    // Target length holds one end still and moves the other to hit the number.
    await page.getByLabel('Hedef uzunluk').fill('100')
    await page.getByRole('button', { name: 'Uzunluğu Uygula' }).click()
    expect(await readLength()).toBeCloseTo(100, 1)
  })

  test('a typed coordinate moves the line Modify handle with it', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Çizgisi')

    await showOnMap(page, 'Nokta 1')
    const centre = await mapCentre(page)

    const row = vertexRow(page, 'Nokta 1')
    await row.locator('input').first().fill('28.2')
    await row.locator('input').nth(1).fill('39.4')
    await row.locator('input').nth(1).blur()

    const moved = await longitudeOf(page, 'Nokta 1')

    await dragFrom(page, centre, 70, 0)
    expect(await longitudeOf(page, 'Nokta 1')).toBeCloseTo(moved, 5)

    await showOnMap(page, 'Nokta 1')
    const newCentre = await mapCentre(page)
    await dragFrom(page, newCentre, 70, 0)
    expect(await longitudeOf(page, 'Nokta 1')).toBeGreaterThan(moved)
  })
})

/* --- Point ------------------------------------------------------------------ */

test.describe('point geometry editor', () => {
  test('offers one coordinate pair and two plain actions, and nothing else', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Noktası')

    await expect(page.getByLabel('Boylam (X)')).toHaveValue('32.859700')
    await expect(page.getByLabel('Enlem (Y)')).toHaveValue('39.933400')

    await expect(page.getByRole('button', { name: 'Haritada Göster' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Koordinatı Kopyala' })).toBeVisible()
    await expect(
      page.getByText('Harita üzerinde taşımak için noktayı sürükleyebilirsiniz', { exact: false }),
    ).toBeVisible()

    // None of the list machinery applies to a single coordinate.
    await expect(page.locator('.vertex-row')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Tüm Koordinatları Kopyala' })).toHaveCount(0)
    // A point cannot be reshaped, so the two map gestures would be one gesture.
    await expect(page.getByRole('button', { name: 'Tüm Geometriyi Taşı' })).toHaveCount(0)
  })

  test('a typed coordinate previews on the map and only persists on Kaydet', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Noktası')

    let sent = null
    await page.route('**/api/drawings/point/1', async (route) => {
      sent = JSON.parse(route.request().postData() ?? '{}')
      await route.fulfill(json(record(1, 'Test Noktası', 'POINT(33.5 39.9334)')))
    })

    await page.getByLabel('Boylam (X)').fill('33.5')
    await page.getByLabel('Boylam (X)').blur()

    // Still nothing sent: the map is previewing the session, not the database.
    expect(sent).toBeNull()

    await page.getByRole('button', { name: 'Kaydet' }).click()
    await expect(page.getByText('Nokta güncellendi.')).toBeVisible()
    expect(sent.wkt).toContain('33.5')
  })

  test('an out-of-range coordinate blocks saving instead of breaking the map', async ({ page }) => {
    await openMap(page)
    await startEditing(page, 'Test Noktası')

    await page.getByLabel('Boylam (X)').fill('999')

    await expect(page.getByText('-180 ile 180 arasında olmalı')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Kaydet' })).toBeDisabled()
  })

})

/* --- Visual record ----------------------------------------------------------
   Not an assertion suite: these write the screenshots used to check that the
   numbered markers, the selected-vertex highlight and the edge highlight
   actually render, which no DOM query can confirm about a canvas. */

test('captures the edit surfaces for visual review', async ({ page }, testInfo) => {
  await openMap(page)

  await startEditing(page, 'Test Alanı')
  await showOnMap(page, 'Köşe 2')
  await page.screenshot({ path: testInfo.outputPath('polygon-vertex-selected.png') })
  await testInfo.attach('polygon-vertex-selected', { path: testInfo.outputPath('polygon-vertex-selected.png'), contentType: 'image/png' })

  // Drag the polygon's native closing-edge handle and record the inserted vertex.
  await showOnMap(page, 'Köşe 1')
  const edgePoint = onLeftEdge(await mapCentre(page))
  await dragFrom(page, edgePoint, -60, 0)
  await expect(page.locator('.vertex-row')).toHaveCount(5)
  await page.screenshot({ path: testInfo.outputPath('polygon-native-vertex-inserted.png') })
  await testInfo.attach('polygon-native-vertex-inserted', { path: testInfo.outputPath('polygon-native-vertex-inserted.png'), contentType: 'image/png' })

  await page.getByRole('button', { name: 'İptal' }).click()
  await page.getByRole('button', { name: 'Değişiklikleri At' }).click()
  await expect(page.locator('.confirm-scrim')).toBeHidden()
  await startEditing(page, 'Test Çizgisi')
  await showOnMap(page, 'Nokta 2')
  await page.screenshot({ path: testInfo.outputPath('line-vertex-selected.png') })
  await testInfo.attach('line-vertex-selected', { path: testInfo.outputPath('line-vertex-selected.png'), contentType: 'image/png' })
})

/* --- Responsive ------------------------------------------------------------- */

test('the coordinate editor fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openMap(page)
  await startEditing(page, 'Test Alanı')

  await expect(page.getByRole('button', { name: 'Köşe 1', exact: true })).toBeVisible()

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  // Actions stack one per line rather than becoming a strip of tiny targets.
  const button = await page
    .locator('.vertex-row.is-selected, .vertex-row')
    .first()
    .getByRole('button', { name: /Arasına Ekle/ })
    .boundingBox()
  expect(button.height).toBeGreaterThanOrEqual(28)
})
