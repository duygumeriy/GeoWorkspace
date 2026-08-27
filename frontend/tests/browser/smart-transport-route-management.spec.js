import { expect, test } from '@playwright/test'
import { toLonLat } from 'ol/proj.js'
import { mockPermissions } from './permissions.js'
import { createTransportLayers, transportFeatures } from '../../src/map/transport.js'

const MAP_VIEW = 'map.view'
const TRANSPORT_VIEW = 'transport.view'
const STOP_CREATE = 'transport.stop.create'
const ROUTE_CREATE = 'transport.route.create'
const ROUTE_UPDATE = 'transport.route.update'
const ROUTE_DELETE = 'transport.route.delete'
const ROUTE_REORDER = 'transport.route.reorder'
const POI_VIEW = 'poi.view'
const LOCATION_ANALYSIS = 'location.analysis'
const POINT_CREATE = 'drawings.point.create'
const MAP_CENTER = { longitude: 35.2433, latitude: 38.9637 }

const ROUTES = [
  { id: 7, name: 'Merkez Hattı', colorHex: '#E11D48', stopCount: 3, isActive: true },
  { id: 8, name: 'Boş Hat', colorHex: '#0284C7', stopCount: 0, isActive: true },
]

const STOPS = [
  { id: 73, routeId: 7, routeName: 'Merkez Hattı', name: 'Üniversite', longitude: 39.2433, latitude: 38.9637, sequenceOrder: 3, isActive: true },
  { id: 71, routeId: 7, routeName: 'Merkez Hattı', name: 'Cumhuriyet', ...MAP_CENTER, sequenceOrder: 1, isActive: true },
  { id: 72, routeId: 7, routeName: 'Merkez Hattı', name: 'Meydan', longitude: 37.2433, latitude: 38.9637, sequenceOrder: 2, isActive: true },
]

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8vZVwAAAABJRU5ErkJggg==',
  'base64',
)

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const clone = (value) => JSON.parse(JSON.stringify(value))

async function signIn(page, permissions, {
  role = 'Özel Ulaşım Yöneticisi',
  reorderStatus = 200,
  stopCreateStatus = 201,
} = {}) {
  await mockPermissions(page, permissions)
  const state = {
    routes: clone(ROUTES),
    stops: clone(STOPS),
    routeReads: 0,
    stopReads: 0,
    creates: [],
    updates: [],
    deletes: [],
    reorders: [],
    stopCreates: [],
    reorderStatus,
    stopCreateStatus,
    poiReads: 0,
    analysisRequests: 0,
  }

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'transport-management-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())

  await page.route('**/api/auth/me', (route) => route.fulfill(json({
    userId: 44,
    username: 'transport-manager',
    emailConfirmed: true,
    twoFactorEnabled: true,
    role,
    roles: [role],
  })))
  await page.route('**/api/auth/me/geographic-scope', (route) => route.fulfill(json({
    isRestricted: false,
    effectiveWkt: null,
    areaCount: 0,
  })))

  await page.route('**/api/transport/routes', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}')
      state.creates.push(body)
      const created = { id: 9, ...body, stopCount: 0, isActive: true }
      state.routes.push(created)
      return route.fulfill(json(created, 201))
    }
    state.routeReads += 1
    return route.fulfill(json(state.routes))
  })

  await page.route(/\/api\/transport\/routes\/\d+$/, async (route) => {
    const request = route.request()
    const id = Number(new URL(request.url()).pathname.split('/').at(-1))
    if (request.method() === 'PUT') {
      const body = JSON.parse(request.postData() ?? '{}')
      state.updates.push({ id, body })
      const index = state.routes.findIndex((item) => item.id === id)
      state.routes[index] = { ...state.routes[index], ...body }
      state.stops = state.stops.map((stop) => stop.routeId === id ? { ...stop, routeName: body.name } : stop)
      return route.fulfill(json(state.routes[index]))
    }
    if (request.method() === 'DELETE') {
      state.deletes.push(id)
      state.routes = state.routes.filter((item) => item.id !== id)
      return route.fulfill({ status: 204 })
    }
    return route.fulfill(json(state.routes.find((item) => item.id === id)))
  })

  await page.route(/\/api\/transport\/routes\/\d+\/stops$/, (route) => {
    state.stopReads += 1
    const routeId = Number(new URL(route.request().url()).pathname.split('/').at(-2))
    return route.fulfill(json(state.stops.filter((stop) => stop.routeId === routeId)))
  })

  await page.route(/\/api\/transport\/routes\/\d+\/stops\/order$/, (route) => {
    const routeId = Number(new URL(route.request().url()).pathname.split('/').at(-3))
    const body = JSON.parse(route.request().postData() ?? '{}')
    state.reorders.push({ routeId, body })
    if (state.reorderStatus !== 200) return route.fulfill(json({ message: 'Sıralama reddedildi.' }, state.reorderStatus))
    state.stops = state.stops.map((stop) => stop.routeId === routeId
      ? { ...stop, sequenceOrder: body.stopIds.indexOf(stop.id) + 1 }
      : stop)
    return route.fulfill(json(state.stops.filter((stop) => stop.routeId === routeId).sort((a, b) => a.sequenceOrder - b.sequenceOrder)))
  })

  await page.route('**/api/transport/stops', (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    state.stopCreates.push(body)
    if (state.stopCreateStatus !== 201) return route.fulfill(json({ message: 'Durak eklenemedi.' }, state.stopCreateStatus))
    const routeRecord = state.routes.find((item) => item.id === body.routeId)
    const created = {
      id: 90 + state.stopCreates.length,
      ...body,
      routeName: routeRecord.name,
      sequenceOrder: state.stops.filter((stop) => stop.routeId === body.routeId).length + 1,
      isActive: true,
    }
    state.stops.push(created)
    routeRecord.stopCount += 1
    return route.fulfill(json(created, 201))
  })

  await page.route('**/api/poi/categories', (route) => route.fulfill(json([
    { id: 1, name: 'Kafe', path: 'Kafe', iconKey: 'coffee', colorHex: '#F97316', isActive: true },
  ])))
  await page.route('**/api/poi', (route) => {
    state.poiReads += 1
    return route.fulfill(json([{ id: 501, name: 'Bağımsız POI', categoryId: 1, categoryName: 'Kafe', categoryPath: 'Kafe', longitude: 31.2, latitude: 39.1, workHours: null }]))
  })
  await page.route('**/api/map/presentation/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }))
  await page.route('**/api/analysis/location**', (route) => {
    state.analysisRequests += 1
    return route.fulfill(json({ message: 'Beklenmeyen analiz isteği.' }, 500))
  })
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: PIXEL_PNG,
  }))

  return state
}

const adminNav = (page) => page.getByRole('navigation', { name: 'Yönetim menüsü' })
const routeEntry = (page) => adminNav(page).getByRole('link', { name: 'Güzergah Yönetimi' })
const activeRoutes = (page) => page.getByRole('region', { name: 'Aktif güzergahlar' })
const routeDetail = (page) => page.getByRole('region', { name: 'Seçili güzergah detayı' })
const mapCard = (page) => page.getByRole('region', { name: 'Güzergah haritası' })

async function openManagement(page) {
  await page.goto('/admin/transport')
  await expect(page.getByRole('heading', { name: 'Güzergah Yönetimi', level: 1 })).toBeVisible()
}

async function selectRoute(page, name = 'Merkez Hattı') {
  await activeRoutes(page).getByRole('button', { name: new RegExp(name) }).click()
  await expect(routeDetail(page).getByRole('heading', { name, level: 2 })).toBeVisible()
}

async function clickManagementMap(page) {
  const viewport = page.getByTestId('transport-management-map').locator('.ol-viewport')
  await viewport.scrollIntoViewIfNeeded()
  const box = await viewport.boundingBox()
  await viewport.click({ position: { x: box.width / 2, y: box.height / 2 } })
  await page.waitForTimeout(120)
}

async function layerHasPaint(page, selector) {
  return page.evaluate((layerSelector) => {
    const root = document.querySelector(layerSelector)
    const canvas = root?.matches('canvas') ? root : root?.querySelector('canvas')
    if (!canvas) return false
    const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, canvas.width, canvas.height).data
    for (let index = 3; index < pixels.length; index += 4) if (pixels[index] !== 0) return true
    return false
  }, selector)
}

test('Güzergah Yönetimi is hidden without route-management permissions even for an Administrator role', async ({ page }) => {
  await signIn(page, [MAP_VIEW, TRANSPORT_VIEW], { role: 'Administrator' })
  await page.goto('/admin/transport')

  await expect(page.getByRole('heading', { name: 'Bu bölüme erişim yetkiniz yok' })).toBeVisible()
  await expect(routeEntry(page)).toHaveCount(0)
})

test('a custom role with one route permission sees the module in the existing admin sidebar', async ({ page }) => {
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE], { role: 'Özel Hat Sorumlusu' })
  await openManagement(page)

  await expect(routeEntry(page)).toBeVisible()
  await expect(routeEntry(page)).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('navigation', { name: 'Yönetim menüsü' })).toHaveCount(1)
})

test('route list and selection show name, color, stop count, and ordered stops', async ({ page }) => {
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE])
  await openManagement(page)

  const item = activeRoutes(page).getByRole('button', { name: /Merkez Hattı/ })
  await expect(item).toContainText('3 aktif durak')
  await expect(item.getByLabel('Renk #E11D48')).toHaveCSS('background-color', 'rgb(225, 29, 72)')
  await item.click()

  await expect(routeDetail(page).getByRole('list', { name: 'Merkez Hattı durak sırası' }).locator('strong'))
    .toHaveText(['Cumhuriyet', 'Meydan', 'Üniversite'])
  await expect(routeDetail(page).locator('.transport-stop-order')).toHaveText(['01', '02', '03'])
})

test('independent permissions show Edit while hiding Delete, Create, Reorder, and map stop creation', async ({ page }) => {
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE])
  await openManagement(page)
  await selectRoute(page)

  await expect(routeDetail(page).getByRole('button', { name: 'Düzenle' })).toBeVisible()
  await expect(routeDetail(page).getByRole('button', { name: 'Sil' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '+ Yeni Güzergah' })).toHaveCount(0)
  await expect(routeDetail(page).locator('[draggable="true"]')).toHaveCount(0)
  await expect(mapCard(page).getByRole('button', { name: 'Haritadan Durak Ekle' })).toHaveCount(0)
})

test('create route posts canonical fields, refreshes the list, and selects the new route', async ({ page }) => {
  const state = await signIn(page, [MAP_VIEW, TRANSPORT_VIEW, STOP_CREATE, ROUTE_CREATE])
  await openManagement(page)
  const readsBefore = state.routeReads

  await page.getByRole('button', { name: '+ Yeni Güzergah' }).click()
  const dialog = page.getByRole('dialog', { name: 'Yeni Güzergah' })
  await dialog.getByLabel('Güzergah Adı').fill('Gece Hattı')
  await dialog.getByLabel('Renk hex değeri').fill('#a855f7')
  await dialog.getByRole('button', { name: 'Güzergah Oluştur' }).click()

  await expect.poll(() => state.creates.length).toBe(1)
  expect(state.creates[0]).toEqual({ name: 'Gece Hattı', colorHex: '#A855F7' })
  await expect.poll(() => state.routeReads).toBeGreaterThan(readsBefore)
  await expect(activeRoutes(page).getByRole('button', { name: /Gece Hattı/ })).toBeVisible()
  await expect(routeDetail(page).getByRole('heading', { name: 'Gece Hattı' })).toBeVisible()

  const mapReadsBefore = state.routeReads
  await adminNav(page).getByRole('link', { name: 'Haritaya Dön' }).click()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()
  await expect.poll(() => state.routeReads).toBeGreaterThan(mapReadsBefore)
  await page.getByRole('toolbar', { name: 'Çizim araçları' }).getByRole('button', { name: 'Durak Ekle aracı' }).click()
  const mapBox = await page.locator('.map-container').boundingBox()
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2)
  await expect(page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Durak Ekle' }) })
    .getByRole('option', { name: 'Gece Hattı' })).toHaveCount(1)
})

test('edit route puts new fields and refreshes the selected name and color', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE])
  await openManagement(page)
  await selectRoute(page)

  await routeDetail(page).getByRole('button', { name: 'Düzenle' }).click()
  const dialog = page.getByRole('dialog', { name: 'Güzergahı Düzenle' })
  await dialog.getByLabel('Güzergah Adı').fill('Yeni Merkez Hattı')
  await dialog.getByLabel('Renk hex değeri').fill('#16a34a')
  await dialog.getByRole('button', { name: 'Değişiklikleri Kaydet' }).click()

  await expect.poll(() => state.updates.length).toBe(1)
  expect(state.updates[0]).toEqual({ id: 7, body: { name: 'Yeni Merkez Hattı', colorHex: '#16A34A' } })
  await expect(routeDetail(page).getByRole('heading', { name: 'Yeni Merkez Hattı' })).toBeVisible()
  await expect(activeRoutes(page).getByLabel('Renk #16A34A')).toHaveCSS('background-color', 'rgb(22, 163, 74)')
})

test('delete confirms the soft-delete consequence and removes stale route selection and map data', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_DELETE])
  await openManagement(page)
  await selectRoute(page)
  const readsBefore = state.routeReads

  await routeDetail(page).getByRole('button', { name: 'Sil' }).click()
  const confirm = page.getByRole('alertdialog')
  await expect(confirm).toContainText('Durak kayıtları kalıcı olarak silinmeyecek')
  await confirm.getByRole('button', { name: 'Güzergahı Sil' }).click()

  await expect.poll(() => state.deletes).toEqual([7])
  await expect.poll(() => state.routeReads).toBeGreaterThan(readsBefore)
  await expect(activeRoutes(page).getByText('Merkez Hattı')).toHaveCount(0)
  await expect(routeDetail(page).getByText('Bir güzergah seçin')).toBeVisible()
  expect(state.stops.filter((stop) => stop.routeId === 7)).toHaveLength(3)
})

test('a zero-stop route has a valid empty state', async ({ page }) => {
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE])
  await openManagement(page)
  await selectRoute(page, 'Boş Hat')

  await expect(routeDetail(page).getByText('Bu güzergaha henüz durak eklenmemiş.')).toBeVisible()
})

test('without reorder permission there are no functional drag handles', async ({ page }) => {
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE])
  await openManagement(page)
  await selectRoute(page)

  await expect(routeDetail(page).locator('[draggable="true"]')).toHaveCount(0)
  await expect(routeDetail(page).getByLabel(/durağını sürükle/)).toHaveCount(0)
  await expect(routeDetail(page)).toContainText('Durak sırasını değiştirme yetkiniz bulunmuyor.')
})

test('successful drag reorder sends the exact permutation, refreshes numbering, and changes derived line order', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_REORDER])
  await openManagement(page)
  await selectRoute(page)

  const list = routeDetail(page).getByRole('list', { name: 'Merkez Hattı durak sırası' })
  await list.locator('[data-stop-id="73"]').dragTo(list.locator('[data-stop-id="71"]'))

  await expect.poll(() => state.reorders.length).toBe(1)
  expect(state.reorders[0]).toEqual({ routeId: 7, body: { stopIds: [73, 71, 72] } })
  await expect(list.locator('strong')).toHaveText(['Üniversite', 'Cumhuriyet', 'Meydan'])
  await expect(list.locator('.transport-stop-order')).toHaveText(['01', '02', '03'])

  const { routeFeatures } = transportFeatures([state.routes[0]], state.stops)
  const longitudeOrder = routeFeatures[0].getGeometry().getCoordinates().map((coordinate) => toLonLat(coordinate)[0])
  expect(longitudeOrder[0]).toBeCloseTo(39.2433, 5)
  expect(longitudeOrder[1]).toBeCloseTo(35.2433, 5)
})

test('failed drag reorder rolls the visible order back to the server-confirmed baseline', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_REORDER], { reorderStatus: 400 })
  await openManagement(page)
  await selectRoute(page)
  const list = routeDetail(page).getByRole('list', { name: 'Merkez Hattı durak sırası' })

  await list.locator('[data-stop-id="72"]').dragTo(list.locator('[data-stop-id="71"]'))

  await expect.poll(() => state.reorders.length).toBe(1)
  await expect(page.getByRole('status')).toContainText('Sıralama reddedildi.')
  await expect(list.locator('strong')).toHaveText(['Cumhuriyet', 'Meydan', 'Üniversite'])
})

test('route selection applies highlight styles and clearing it restores normal transport styles', () => {
  const routes = [ROUTES[0], { ...ROUTES[1], stopCount: 2 }]
  const stops = [
    ...STOPS,
    { id: 81, routeId: 8, name: 'Batı', longitude: 30, latitude: 39, sequenceOrder: 1 },
    { id: 82, routeId: 8, name: 'Doğu', longitude: 31, latitude: 39, sequenceOrder: 2 },
  ]
  const { routeFeatures } = transportFeatures(routes, stops)
  let selectedId = 7
  const { routeLayer } = createTransportLayers(() => null, () => selectedId)
  const style = routeLayer.getStyleFunction()
  const selectedFeature = routeFeatures.find((feature) => feature.get('routeId') === 7)
  const otherFeature = routeFeatures.find((feature) => feature.get('routeId') === 8)

  expect(style(selectedFeature, 1).getStroke().getWidth()).toBe(7)
  expect(style(otherFeature, 1).getStroke().getColor()).toBe('#0284C755')

  selectedId = null
  expect(style(selectedFeature, 1).getStroke().getWidth()).toBe(4)
  expect(style(otherFeature, 1).getStroke().getColor()).toBe('#0284C7')
})

test('Haritadan Durak Ekle uses the selected route and EPSG:4326, then appends and refreshes the map', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE, STOP_CREATE])
  await openManagement(page)
  await selectRoute(page)
  const stopReadsBefore = state.stopReads

  await mapCard(page).getByRole('button', { name: 'Haritadan Durak Ekle' }).click()
  await expect(mapCard(page).getByText('Durak konumunu seçmek için haritaya tıklayın.')).toBeVisible()
  await clickManagementMap(page)
  const dialog = page.getByRole('dialog', { name: 'Haritadan Durak Ekle' })
  await expect(dialog).toContainText('Merkez Hattı')
  await expect(dialog.getByLabel('Güzergah')).toHaveCount(0)
  await dialog.getByLabel('Durak Adı').fill('Yeni Son Durak')
  await dialog.getByRole('button', { name: 'Durağı Kaydet' }).click()

  await expect.poll(() => state.stopCreates.length).toBe(1)
  expect(state.stopCreates[0].routeId).toBe(7)
  expect(state.stopCreates[0].longitude).toBeCloseTo(MAP_CENTER.longitude, 5)
  expect(Math.abs(state.stopCreates[0].latitude - MAP_CENTER.latitude)).toBeLessThan(0.00001)
  await expect.poll(() => state.stopReads).toBeGreaterThan(stopReadsBefore)
  await expect(routeDetail(page).getByRole('list').locator('li').last()).toContainText('Yeni Son Durak')
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-stop-pending-layer')).toBe(false)
})

test('stop placement cancel and failed save leave no orphaned or permanent feature', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE, STOP_CREATE])
  await openManagement(page)
  await selectRoute(page)

  const add = mapCard(page).getByRole('button', { name: 'Haritadan Durak Ekle' })
  await add.click()
  await clickManagementMap(page)
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-stop-pending-layer')).toBe(true)
  await page.getByRole('dialog', { name: 'Haritadan Durak Ekle' }).getByRole('button', { name: 'İptal' }).click()
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-stop-pending-layer')).toBe(false)

  state.stopCreateStatus = 400
  const countBefore = state.stops.length
  await add.click()
  await clickManagementMap(page)
  const dialog = page.getByRole('dialog', { name: 'Haritadan Durak Ekle' })
  await dialog.getByLabel('Durak Adı').fill('Hatalı Durak')
  await dialog.getByRole('button', { name: 'Durağı Kaydet' }).click()
  await expect(dialog.getByRole('alert')).toContainText('Durak eklenemedi.')
  expect(state.stops).toHaveLength(countBefore)
  await dialog.getByRole('button', { name: 'İptal' }).click()
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-stop-pending-layer')).toBe(false)
})

test('changing route selection exits placement safely without duplicate interaction state', async ({ page }) => {
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE, STOP_CREATE])
  await openManagement(page)
  await selectRoute(page)

  await mapCard(page).getByRole('button', { name: 'Haritadan Durak Ekle' }).click()
  await activeRoutes(page).getByRole('button', { name: /Boş Hat/ }).click()

  await expect(mapCard(page).getByRole('button', { name: 'Haritadan Durak Ekle' })).toHaveAttribute('aria-pressed', 'false')
  await expect(mapCard(page).getByText('Durak konumunu seçmek için haritaya tıklayın.')).toHaveCount(0)
})

test('switching to another main-map tool clears temporary transport placement state', async ({ page }) => {
  const state = await signIn(page, [MAP_VIEW, TRANSPORT_VIEW, STOP_CREATE, ROUTE_UPDATE, POINT_CREATE])
  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()
  await expect.poll(() => state.routeReads).toBeGreaterThan(0)
  const toolbar = page.getByRole('toolbar', { name: 'Çizim araçları' })
  const stopTool = toolbar.getByRole('button', { name: 'Durak Ekle aracı' })

  await stopTool.click()
  const box = await page.locator('.map-container').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(page.getByRole('heading', { name: 'Durak Ekle' })).toBeVisible()
  await toolbar.getByRole('button', { name: /^Nokta çiz/ }).click()

  await expect(page.getByRole('heading', { name: 'Durak Ekle' })).toHaveCount(0)
  await expect(stopTool).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => layerHasPaint(page, '.map-container .transport-stop-pending-layer')).toBe(false)
})

test('normal POI and Location Analysis remain isolated from route management', async ({ page }) => {
  const state = await signIn(page, [
    MAP_VIEW,
    TRANSPORT_VIEW,
    ROUTE_UPDATE,
    POI_VIEW,
    LOCATION_ANALYSIS,
  ])
  await openManagement(page)
  expect(state.poiReads).toBe(0)
  expect(state.analysisRequests).toBe(0)

  await adminNav(page).getByRole('link', { name: 'Haritaya Dön' }).click()
  await expect(page.locator('.poi-layer')).toHaveCount(1)
  await expect(page.locator('.transport-stop-layer')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Konum Analizi', exact: true })).toBeVisible()
  await expect.poll(() => state.poiReads).toBeGreaterThan(0)
  expect(state.analysisRequests).toBe(0)
})
