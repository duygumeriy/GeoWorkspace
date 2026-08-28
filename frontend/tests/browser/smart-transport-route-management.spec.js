import { expect, test } from '@playwright/test'
import { boundingExtent, getCenter } from 'ol/extent.js'
import { fromLonLat, toLonLat } from 'ol/proj.js'
import { mockPermissions } from './permissions.js'
import {
  createTransportLayers,
  routeArrowPlacements,
  TRANSPORT_ROUTE_KIND,
  TRANSPORT_ROUTE_PATH_KIND,
  TRANSPORT_STOP_KIND,
  transportFeatures,
} from '../../src/map/transport.js'

const MAP_VIEW = 'map.view'
const TRANSPORT_VIEW = 'transport.view'
const STOP_CREATE = 'transport.stop.create'
const STOP_UPDATE = 'transport.stop.update'
const STOP_DELETE = 'transport.stop.delete'
const STOP_RESTORE = 'transport.stop.restore'
const ROUTE_CREATE = 'transport.route.create'
const ROUTE_UPDATE = 'transport.route.update'
const ROUTE_DELETE = 'transport.route.delete'
const ROUTE_REORDER = 'transport.route.reorder'
const POI_VIEW = 'poi.view'
const LOCATION_ANALYSIS = 'location.analysis'
const POINT_CREATE = 'drawings.point.create'
const MAP_CENTER = { longitude: 35.2433, latitude: 38.9637 }
// The management map is 966 × 302 canvas pixels in the browser trace, while
// its CSS viewport has a fractional height. A visual-centre click can therefore
// land a fraction of a pixel from the OpenLayers centre. 0.0002° latitude is
// about 22 m here: tight enough to catch swapped/wrong-CRS coordinates while
// allowing that real pointer quantization.
const CENTER_CLICK_TOLERANCE_DEGREES = 0.0002

const ROUTES = [
  { id: 7, name: 'Merkez Hattı', colorHex: '#E11D48', stopCount: 3, isActive: true },
  { id: 8, name: 'Boş Hat', colorHex: '#0284C7', stopCount: 0, isActive: true },
]

const STOPS = [
  { id: 73, routeId: 7, routeName: 'Merkez Hattı', name: 'Üniversite', longitude: 39.2433, latitude: 38.9637, sequenceOrder: 3, isActive: true },
  { id: 71, routeId: 7, routeName: 'Merkez Hattı', name: 'Cumhuriyet', ...MAP_CENTER, sequenceOrder: 1, isActive: true },
  { id: 72, routeId: 7, routeName: 'Merkez Hattı', name: 'Meydan', longitude: 37.2433, latitude: 38.9637, sequenceOrder: 2, isActive: true },
]

function focusedRouteCenter(routeId) {
  const projectedStops = STOPS
    .filter((stop) => stop.routeId === routeId)
    .map((stop) => fromLonLat([stop.longitude, stop.latitude]))
  const [longitude, latitude] = toLonLat(getCenter(boundingExtent(projectedStops)))
  return { longitude, latitude }
}

function routeFeatureState(routes, stops, paths, routeId) {
  const features = transportFeatures(routes, stops, paths)
  const belongsToRoute = (feature) => feature.get('routeId') === routeId
  const currentPaths = features.pathFeatures.filter(belongsToRoute)
  return {
    currentPaths,
    previews: features.routeFeatures.filter(belongsToRoute),
    stops: features.stopFeatures.filter(belongsToRoute),
    arrowPlacements: currentPaths.flatMap((feature) => routeArrowPlacements(feature.getGeometry())),
  }
}

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8vZVwAAAABJRU5ErkJggg==',
  'base64',
)

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) })
const clone = (value) => JSON.parse(JSON.stringify(value))

async function signIn(page, permissions, {
  role = 'Özel Ulaşım Yöneticisi',
  routes = ROUTES,
  stops = STOPS,
  deletedStops = [],
  paths = [],
  reorderStatus = 200,
  stopCreateStatus = 201,
  stopDeleteStatus = 204,
  routeGenerateStatus = 200,
} = {}) {
  await mockPermissions(page, permissions)
  const state = {
    routes: clone(routes),
    stops: clone(stops),
    deletedStops: clone(deletedStops),
    routeReads: 0,
    stopReads: 0,
    managedStopReads: 0,
    managedDeletedStopReads: 0,
    creates: [],
    updates: [],
    deletes: [],
    reorders: [],
    stopCreates: [],
    stopUpdates: [],
    stopDeletes: [],
    stopRestores: [],
    generations: [],
    reorderStatus,
    stopCreateStatus,
    stopDeleteStatus,
    routeGenerateStatus,
    poiReads: 0,
    analysisRequests: 0,
    pathReads: 0,
    paths: clone(paths),
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

  await page.route('**/api/transport/routes/paths', (route) => {
    state.pathReads += 1
    return route.fulfill(json(state.paths))
  })

  await page.route(/\/api\/transport\/routes\/\d+\/path\/generate$/, (route) => {
    const routeId = Number(new URL(route.request().url()).pathname.split('/').at(-3))
    state.generations.push(routeId)
    if (state.routeGenerateStatus !== 200) return route.fulfill(json({ message: 'Güvenli rota hatası.' }, state.routeGenerateStatus))
    const routeStops = state.stops.filter((stop) => stop.routeId === routeId).sort((a, b) => a.sequenceOrder - b.sequenceOrder)
    const path = { routeId, geometryWkt: `LINESTRING (${routeStops.map((stop) => `${stop.longitude} ${stop.latitude}`).join(', ')})`, distanceMeters: 1200, durationSeconds: 180, generatedAt: '2026-08-28T10:00:00Z', isStale: false }
    state.paths = state.paths.filter((item) => item.routeId !== routeId).concat(path)
    return route.fulfill(json(path))
  })

  await page.route(/\/api\/transport\/routes\/\d+\/path$/, (route) => {
    state.pathReads += 1
    const routeId = Number(new URL(route.request().url()).pathname.split('/').at(-2))
    const path = state.paths.find((item) => item.routeId === routeId)
    return path ? route.fulfill(json(path)) : route.fulfill(json({ message: 'Rota henüz oluşturulmadı.' }, 404))
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

  await page.route('**/api/transport/stops/deleted', (route) => {
    state.managedDeletedStopReads += 1
    return route.fulfill(json(state.deletedStops))
  })

  await page.route('**/api/transport/stops', (route) => {
    if (route.request().method() === 'GET') {
      state.managedStopReads += 1
      return route.fulfill(json(state.stops))
    }
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

  await page.route(/\/api\/transport\/stops\/\d+$/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1))
    if (route.request().method() === 'PUT') {
      const body = JSON.parse(route.request().postData() ?? '{}')
      state.stopUpdates.push({ id, body })
      const index = state.stops.findIndex((stop) => stop.id === id)
      const previous = state.stops[index]
      const routeChanged = previous.routeId !== body.routeId
      const coordinatesChanged = previous.longitude !== body.longitude || previous.latitude !== body.latitude
      if (routeChanged) {
        state.stops.filter((stop) => stop.routeId === previous.routeId && stop.id !== id)
          .sort((left, right) => left.sequenceOrder - right.sequenceOrder)
          .forEach((stop, orderIndex) => { stop.sequenceOrder = orderIndex + 1 })
      }
      const destination = state.routes.find((routeRecord) => routeRecord.id === body.routeId)
      const sequenceOrder = routeChanged
        ? Math.max(0, ...state.stops.filter((stop) => stop.routeId === body.routeId).map((stop) => stop.sequenceOrder)) + 1
        : previous.sequenceOrder
      state.stops[index] = { ...previous, ...body, routeName: destination?.name ?? '', routeColor: destination?.colorHex ?? '', sequenceOrder }
      const affected = routeChanged ? [previous.routeId, body.routeId] : coordinatesChanged ? [body.routeId] : []
      state.paths = state.paths.map((path) => affected.includes(path.routeId) ? { ...path, isStale: true } : path)
      return route.fulfill(json(state.stops[index]))
    }
    if (route.request().method() === 'DELETE') {
      if (state.stopDeleteStatus !== 204) return route.fulfill(json({ message: 'Durak silinemedi.' }, state.stopDeleteStatus))
      state.stopDeletes.push(id)
      const stop = state.stops.find((item) => item.id === id)
      state.stops = state.stops.filter((item) => item.id !== id)
      state.deletedStops.push({ ...stop, isDeleted: true })
      const remaining = state.stops
        .filter((item) => item.routeId === stop.routeId)
        .sort((left, right) => left.sequenceOrder - right.sequenceOrder)
      remaining.forEach((item, index) => { item.sequenceOrder = index + 1 })
      state.paths = state.paths.map((path) => path.routeId === stop.routeId ? { ...path, isStale: true } : path)
      const parent = state.routes.find((item) => item.id === stop.routeId)
      if (parent) parent.stopCount -= 1
      return route.fulfill({ status: 204 })
    }
    return route.fulfill(json({ message: 'Method not allowed.' }, 405))
  })

  await page.route(/\/api\/transport\/stops\/\d+\/restore$/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-2))
    const index = state.deletedStops.findIndex((stop) => stop.id === id)
    const deleted = state.deletedStops[index]
    if (!deleted) return route.fulfill(json({ message: 'Silinmiş durak bulunamadı.' }, 404))
    state.stopRestores.push(id)
    state.deletedStops.splice(index, 1)
    const sequenceOrder = Math.max(0, ...state.stops.filter((stop) => stop.routeId === deleted.routeId).map((stop) => stop.sequenceOrder)) + 1
    const restored = { ...deleted, isDeleted: false, isActive: true, sequenceOrder }
    state.stops.push(restored)
    state.paths = state.paths.map((path) => path.routeId === restored.routeId ? { ...path, isStale: true } : path)
    return route.fulfill(json(restored))
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
const stopManagement = (page) => page.getByRole('region', { name: 'Durak Yönetimi' })
const routeSelection = (page, name) => activeRoutes(page).getByRole('button', { name: `${name} güzergahını seç`, exact: true })
const routeRow = (page, routeId) => activeRoutes(page).locator(`[data-route-id="${routeId}"]`)

async function openManagement(page) {
  await page.goto('/admin/transport')
  await expect(page.getByRole('heading', { name: 'Güzergah Yönetimi', level: 1 })).toBeVisible()
}

async function selectRoute(page, name = 'Merkez Hattı') {
  await routeSelection(page, name).click()
  await expect(routeDetail(page).getByRole('heading', { name, level: 2 })).toBeVisible()
}

async function openStopManagement(page) {
  await page.getByRole('tab', { name: 'Durak Yönetimi' }).click()
  await expect(stopManagement(page)).toBeVisible()
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

test('Durak Yönetimi lists all routes with one set read and composes name, route and status filters', async ({ page }) => {
  const sahilStop = { id: 81, routeId: 8, routeName: 'Boş Hat', routeColor: '#0284C7', name: 'İskele', longitude: 29.1, latitude: 41.1, sequenceOrder: 1, isActive: true }
  const state = await signIn(page, [TRANSPORT_VIEW, STOP_UPDATE], { stops: [...STOPS, sahilStop] })
  await openManagement(page)
  await openStopManagement(page)

  const management = stopManagement(page)
  await expect(management.getByRole('row', { name: /Cumhuriyet/ })).toBeVisible()
  await expect(management.getByRole('row', { name: /İskele/ })).toBeVisible()
  expect(state.managedStopReads).toBeGreaterThanOrEqual(1)
  expect(state.managedStopReads).toBeLessThanOrEqual(2)
  expect(state.managedStopReads).toBeLessThan(state.stops.length)
  await management.getByLabel('Durak ara').fill('UNIVERSITE')
  await expect(management.locator('tbody tr')).toHaveCount(1)
  await expect(management.getByRole('row', { name: /Üniversite/ })).toBeVisible()
  await management.getByRole('button', { name: 'Filtreleri Temizle' }).click()
  await management.getByLabel('Güzergah').selectOption('8')
  await management.getByLabel('Durum').selectOption('active')
  await expect(management.locator('tbody tr')).toHaveCount(1)
  await expect(management.getByRole('row', { name: /İskele/ })).toBeVisible()
})

test('central stop focus and edit reuse the existing Admin map detail', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, STOP_UPDATE])
  await openManagement(page)
  await openStopManagement(page)
  const row = stopManagement(page).getByRole('row', { name: /Cumhuriyet/ })

  await row.getByRole('button', { name: 'Haritada Göster' }).click()
  await expect(mapCard(page).getByRole('complementary', { name: 'Seçili durak detayı' })).toContainText('Cumhuriyet')
  await row.getByRole('button', { name: 'Düzenle', exact: true }).click()
  const detail = mapCard(page).getByRole('complementary', { name: 'Seçili durak detayı' })
  await detail.getByLabel('Durak Adı').fill('Cumhuriyet Meydanı')
  await detail.getByRole('button', { name: 'Kaydet', exact: true }).click()

  await expect.poll(() => state.stopUpdates).toHaveLength(1)
  expect(state.stopUpdates[0]).toEqual(expect.objectContaining({ id: 71, body: expect.objectContaining({ name: 'Cumhuriyet Meydanı', routeId: 7 }) }))
  await expect(stopManagement(page).getByRole('row', { name: /Cumhuriyet Meydanı/ })).toBeVisible()
})

test('central stop route transfer uses the shared two-route generation workflow', async ({ page }) => {
  const destinationStops = [
    { id: 81, routeId: 8, routeName: 'Boş Hat', routeColor: '#0284C7', name: 'İskele', longitude: 29, latitude: 41, sequenceOrder: 1, isActive: true },
    { id: 82, routeId: 8, routeName: 'Boş Hat', routeColor: '#0284C7', name: 'Liman', longitude: 29.1, latitude: 41.1, sequenceOrder: 2, isActive: true },
  ]
  const routes = ROUTES.map((route) => route.id === 8 ? { ...route, stopCount: 2 } : route)
  const state = await signIn(page, [TRANSPORT_VIEW, STOP_UPDATE, ROUTE_UPDATE], { routes, stops: [...STOPS, ...destinationStops] })
  await openManagement(page)
  await openStopManagement(page)

  await stopManagement(page).getByRole('row', { name: /Cumhuriyet/ }).getByRole('button', { name: 'Düzenle', exact: true }).click()
  const detail = mapCard(page).getByRole('complementary', { name: 'Seçili durak detayı' })
  await detail.getByLabel('Güzergah').selectOption('8')
  await detail.getByRole('button', { name: 'Kaydet', exact: true }).click()

  await expect.poll(() => state.generations).toEqual([7, 8])
  expect(state.stops.find((stop) => stop.id === 71)).toEqual(expect.objectContaining({ routeId: 8, routeName: 'Boş Hat', sequenceOrder: 3 }))
  await expect(stopManagement(page).getByRole('row', { name: /Cumhuriyet.*Boş Hat/ })).toBeVisible()
})

test('central delete refreshes the list and map, while deleted restore retains canonical order', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, STOP_DELETE, STOP_RESTORE, ROUTE_UPDATE])
  await openManagement(page)
  await openStopManagement(page)
  const management = stopManagement(page)

  await management.getByLabel('Durum').selectOption('active')
  await management.getByRole('row', { name: /Cumhuriyet/ }).getByRole('button', { name: 'Sil', exact: true }).click()
  const detail = mapCard(page).getByRole('complementary', { name: 'Seçili durak detayı' })
  await detail.getByRole('button', { name: 'Sil', exact: true }).click()
  await expect.poll(() => state.stopDeletes).toEqual([71])
  await expect(management.getByRole('row', { name: /Cumhuriyet/ })).toHaveCount(0)

  await management.getByLabel('Durum').selectOption('deleted')
  const deletedRow = management.getByRole('row', { name: /Cumhuriyet.*Silinmiş/ })
  await expect(deletedRow).toBeVisible()
  await deletedRow.getByRole('button', { name: 'Geri Yükle' }).click()
  await expect.poll(() => state.stopRestores).toEqual([71])
  expect(state.stops.find((stop) => stop.id === 71)?.sequenceOrder).toBe(3)
  await expect(deletedRow).toHaveCount(0)
  await expect(mapCard(page).getByRole('complementary', { name: 'Seçili durak detayı' })).toContainText('Cumhuriyet')
})

test('central stop actions omit delete without its effective permission', async ({ page }) => {
  await signIn(page, [TRANSPORT_VIEW, STOP_UPDATE])
  await openManagement(page)
  await openStopManagement(page)
  const row = stopManagement(page).getByRole('row', { name: /Cumhuriyet/ })
  await expect(row.getByRole('button', { name: 'Düzenle', exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Sil', exact: true })).toHaveCount(0)
})

test('accessible reorder arrows use the canonical reorder endpoint and enforce boundaries', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_REORDER])
  await openManagement(page)
  await selectRoute(page)
  const list = routeDetail(page).getByRole('list', { name: 'Merkez Hattı durak sırası' })
  await expect(list.getByRole('button', { name: 'Cumhuriyet durağını yukarı taşı' })).toBeDisabled()
  await expect(list.getByRole('button', { name: 'Üniversite durağını aşağı taşı' })).toBeDisabled()
  await list.getByRole('button', { name: 'Meydan durağını yukarı taşı' }).click()
  await expect.poll(() => state.reorders[0]?.body.stopIds).toEqual([72, 71, 73])
  await expect(list.locator('.transport-stop-order')).toHaveText(['01', '02', '03'])
})

test('same-route duplicate name warning is visible but does not block save', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, STOP_UPDATE])
  await openManagement(page)
  await openStopManagement(page)
  await stopManagement(page).getByRole('row', { name: /Cumhuriyet/ }).getByRole('button', { name: 'Düzenle', exact: true }).click()
  const detail = mapCard(page).getByRole('complementary', { name: 'Seçili durak detayı' })
  await detail.getByLabel('Durak Adı').fill(' meydan ')
  await expect(detail.getByRole('status')).toHaveText('Bu güzergâhta aynı isimde başka bir durak bulunuyor.')
  const save = detail.getByRole('button', { name: 'Kaydet', exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  await expect.poll(() => state.stopUpdates).toHaveLength(1)
})

test('route list and selection show name, color, stop count, and ordered stops', async ({ page }) => {
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE])
  await openManagement(page)

  const item = routeSelection(page, 'Merkez Hattı')
  await expect(item).toContainText('3 aktif durak')
  await expect(item.getByLabel('Renk #E11D48')).toHaveCSS('background-color', 'rgb(225, 29, 72)')
  await item.click()

  await expect(routeDetail(page).getByRole('list', { name: 'Merkez Hattı durak sırası' }).locator('strong'))
    .toHaveText(['Cumhuriyet', 'Meydan', 'Üniversite'])
  await expect(routeDetail(page).locator('.transport-stop-order')).toHaveText(['01', '02', '03'])
})

test('desktop route management uses a sticky two-column layout and collapses cleanly on tablet', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE])
  await openManagement(page)

  const layout = page.locator('.transport-admin-layout.is-routes')
  const content = layout.locator('.transport-admin-content')
  const mapColumn = layout.locator('.transport-admin-map-column')
  await expect(layout).toHaveCSS('display', 'grid')
  await expect(mapColumn).toHaveCSS('position', 'sticky')
  const desktopContentBox = await content.boundingBox()
  const desktopMapBox = await mapColumn.boundingBox()
  expect(desktopMapBox.x).toBeGreaterThan(desktopContentBox.x + desktopContentBox.width - 2)

  await page.setViewportSize({ width: 900, height: 900 })
  await expect(mapColumn).toHaveCSS('position', 'static')
  const tabletContentBox = await content.boundingBox()
  const tabletMapBox = await mapColumn.boundingBox()
  expect(tabletMapBox.x).toBeCloseTo(tabletContentBox.x, 0)
  expect(tabletMapBox.width).toBeLessThanOrEqual(900)
  await expect(mapCard(page)).toBeVisible()
  await expect(activeRoutes(page).getByPlaceholder('Güzergah ara')).toBeVisible()
})

test('route search and current, stale and missing status filters compose without replacing selection', async ({ page }) => {
  const routes = [
    ROUTES[0],
    ROUTES[1],
    { id: 9, name: 'Şehir Ring', colorHex: '#16A34A', stopCount: 2, isActive: true },
  ]
  const stops = [
    ...STOPS,
    { id: 81, routeId: 8, routeName: 'Boş Hat', name: 'İskele', longitude: 29, latitude: 41, sequenceOrder: 1, isActive: true },
    { id: 82, routeId: 8, routeName: 'Boş Hat', name: 'Liman', longitude: 29.2, latitude: 41.1, sequenceOrder: 2, isActive: true },
    { id: 91, routeId: 9, routeName: 'Şehir Ring', name: 'Kuzey', longitude: 32, latitude: 40, sequenceOrder: 1, isActive: true },
    { id: 92, routeId: 9, routeName: 'Şehir Ring', name: 'Güney', longitude: 32.2, latitude: 39.8, sequenceOrder: 2, isActive: true },
  ]
  const paths = [
    { routeId: 7, geometryWkt: 'LINESTRING (35.2433 38.9637, 39.2433 38.9637)', distanceMeters: 4200, durationSeconds: 600, generatedAt: '2026-08-28T10:00:00Z', isStale: false },
    { routeId: 9, geometryWkt: 'LINESTRING (32 40, 32.2 39.8)', distanceMeters: 3100, durationSeconds: 480, generatedAt: '2026-08-27T10:00:00Z', isStale: true },
  ]
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE], { routes, stops, paths })
  await openManagement(page)
  await expect(routeRow(page, 7).getByText('Güncel', { exact: true })).toBeVisible()
  await expect(routeRow(page, 9).getByText('Güncel değil', { exact: true })).toBeVisible()
  await expect(routeRow(page, 8).getByText('Oluşturulmadı', { exact: true })).toBeVisible()
  await expect(routeRow(page, 7)).toContainText('4.2 km · 10 dk')

  await selectRoute(page)
  await activeRoutes(page).getByLabel('Rota durumu').selectOption('stale')
  await expect(activeRoutes(page).locator('[data-route-id]')).toHaveCount(1)
  await activeRoutes(page).getByPlaceholder('Güzergah ara').fill('SEHIR')
  await expect(routeSelection(page, 'Şehir Ring')).toBeVisible()
  await activeRoutes(page).getByPlaceholder('Güzergah ara').fill('merkez')
  await expect(activeRoutes(page).getByText('Filtrelere uygun güzergah bulunamadı.')).toBeVisible()
  await expect(routeDetail(page).getByRole('heading', { name: 'Merkez Hattı' })).toBeVisible()

  await activeRoutes(page).getByRole('button', { name: 'Filtreleri Temizle' }).click()
  await activeRoutes(page).getByLabel('Rota durumu').selectOption('current')
  await expect(activeRoutes(page).locator('[data-route-id]')).toHaveCount(1)
  await activeRoutes(page).getByLabel('Rota durumu').selectOption('missing')
  await expect(routeSelection(page, 'Boş Hat')).toBeVisible()
})

test('route eye controls preserve selection, survive filtering and hide only route geometry without requests', async ({ page }) => {
  const routeEightStops = [
    { id: 81, routeId: 8, routeName: 'Boş Hat', name: 'Batı', longitude: 30, latitude: 40, sequenceOrder: 1, isActive: true },
    { id: 82, routeId: 8, routeName: 'Boş Hat', name: 'Doğu', longitude: 30.2, latitude: 40, sequenceOrder: 2, isActive: true },
  ]
  const routes = ROUTES.map((route) => route.id === 8 ? { ...route, stopCount: 2 } : route)
  const paths = [
    { routeId: 7, geometryWkt: 'LINESTRING (35.2433 38.9637, 39.2433 38.9637)', distanceMeters: 4200, durationSeconds: 600, generatedAt: '2026-08-28T10:00:00Z', isStale: false },
    { routeId: 8, geometryWkt: 'LINESTRING (30 40, 30.2 40)', distanceMeters: 1700, durationSeconds: 240, generatedAt: '2026-08-28T10:00:00Z', isStale: false },
  ]
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE], { routes, stops: [...STOPS, ...routeEightStops], paths })
  await openManagement(page)
  await selectRoute(page)
  await expect(routeRow(page, 8).getByText('Güncel', { exact: true })).toBeVisible()
  const readsBefore = { route: state.routeReads, stop: state.stopReads, path: state.pathReads }

  await activeRoutes(page).getByRole('button', { name: 'Merkez Hattı güzergahını gizle' }).click()
  await expect(routeSelection(page, 'Merkez Hattı')).toHaveAttribute('aria-pressed', 'true')
  await expect(activeRoutes(page).getByRole('button', { name: 'Merkez Hattı güzergahını göster' })).toHaveAttribute('aria-pressed', 'false')
  await expect(activeRoutes(page).getByRole('button', { name: 'Boş Hat güzergahını gizle' })).toHaveAttribute('aria-pressed', 'true')
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-route-path-layer')).toBe(true)

  await activeRoutes(page).getByPlaceholder('Güzergah ara').fill('boş')
  await activeRoutes(page).getByRole('button', { name: 'Boş Hat güzergahını gizle' }).click()
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-route-path-layer')).toBe(false)
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-stop-layer')).toBe(true)
  await activeRoutes(page).getByRole('button', { name: 'Filtreleri Temizle' }).click()
  await expect(activeRoutes(page).getByRole('button', { name: 'Merkez Hattı güzergahını göster' })).toBeVisible()
  await page.waitForTimeout(100)
  expect({ route: state.routeReads, stop: state.stopReads, path: state.pathReads }).toEqual(readsBefore)
})

test('route focus prefers a current path and safely falls back to stale or ungenerated stop extents', async ({ page }) => {
  const routes = [
    { ...ROUTES[0], stopCount: 3 },
    { ...ROUTES[1], stopCount: 2 },
    { id: 9, name: 'Eski Hat', colorHex: '#16A34A', stopCount: 2, isActive: true },
  ]
  const extraStops = [
    { id: 81, routeId: 8, routeName: 'Boş Hat', name: 'Tek', longitude: 30, latitude: 40, sequenceOrder: 1, isActive: true },
    { id: 82, routeId: 8, routeName: 'Boş Hat', name: 'Çift', longitude: 30.2, latitude: 40.1, sequenceOrder: 2, isActive: true },
    { id: 91, routeId: 9, routeName: 'Eski Hat', name: 'Başlangıç', longitude: 32, latitude: 40, sequenceOrder: 1, isActive: true },
    { id: 92, routeId: 9, routeName: 'Eski Hat', name: 'Bitiş', longitude: 32.3, latitude: 39.8, sequenceOrder: 2, isActive: true },
  ]
  const paths = [
    { routeId: 7, geometryWkt: 'LINESTRING (28 41, 28.2 41)', distanceMeters: 1000, durationSeconds: 120, generatedAt: '2026-08-28T10:00:00Z', isStale: false },
    { routeId: 9, geometryWkt: 'LINESTRING (20 20, 21 21)', distanceMeters: 3000, durationSeconds: 500, generatedAt: '2026-08-27T10:00:00Z', isStale: true },
  ]
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE], { routes, stops: [...STOPS, ...extraStops], paths })
  await openManagement(page)

  await selectRoute(page)
  await mapCard(page).getByRole('button', { name: 'Güzergaha Odaklan' }).click()
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-route-path-layer')).toBe(true)
  await activeRoutes(page).getByRole('button', { name: 'Merkez Hattı güzergahını gizle' }).click()
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-route-path-layer')).toBe(false)

  await selectRoute(page, 'Eski Hat')
  await expect(mapCard(page).getByRole('button', { name: 'Güzergaha Odaklan' })).toBeEnabled()
  await mapCard(page).getByRole('button', { name: 'Güzergaha Odaklan' }).click()
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-route-layer')).toBe(true)

  await selectRoute(page, 'Boş Hat')
  await expect(mapCard(page).getByRole('button', { name: 'Güzergaha Odaklan' })).toBeEnabled()
  await mapCard(page).getByRole('button', { name: 'Güzergaha Odaklan' }).click()
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-route-layer')).toBe(true)
})

test('route summary presents canonical current, stale and ungenerated values without recomputing metrics', async ({ page }) => {
  const routes = [
    ROUTES[0],
    { ...ROUTES[1], stopCount: 2 },
    { id: 9, name: 'Eski Hat', colorHex: '#16A34A', stopCount: 2, isActive: true },
  ]
  const extraStops = [
    { id: 81, routeId: 8, routeName: 'Boş Hat', name: 'Bir', longitude: 30, latitude: 40, sequenceOrder: 1, isActive: true },
    { id: 82, routeId: 8, routeName: 'Boş Hat', name: 'İki', longitude: 30.2, latitude: 40.1, sequenceOrder: 2, isActive: true },
    { id: 91, routeId: 9, routeName: 'Eski Hat', name: 'Bir', longitude: 32, latitude: 40, sequenceOrder: 1, isActive: true },
    { id: 92, routeId: 9, routeName: 'Eski Hat', name: 'İki', longitude: 32.2, latitude: 39.9, sequenceOrder: 2, isActive: true },
  ]
  const paths = [
    { routeId: 7, geometryWkt: 'LINESTRING (35.2433 38.9637, 39.2433 38.9637)', distanceMeters: 4200, durationSeconds: 600, generatedAt: '2026-08-28T10:00:00Z', isStale: false },
    { routeId: 9, geometryWkt: 'LINESTRING (32 40, 32.2 39.9)', distanceMeters: 3100, durationSeconds: 480, generatedAt: '2026-08-27T10:00:00Z', isStale: true },
  ]
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE], { routes, stops: [...STOPS, ...extraStops], paths })
  await openManagement(page)

  await selectRoute(page)
  let summary = routeDetail(page).getByRole('group', { name: 'Merkez Hattı rota özeti' })
  await expect(summary.locator('dd')).toHaveText(['4.2 km', '10 dk', '3', /28 Ağu 2026/, 'Güncel'])

  await selectRoute(page, 'Eski Hat')
  summary = routeDetail(page).getByRole('group', { name: 'Eski Hat rota özeti' })
  await expect(summary.locator('dd')).toHaveText(['3.1 km', '8 dk', '2', /27 Ağu 2026/, 'Güncel değil'])
  await expect(routeDetail(page).getByText('Mesafe ve süre son hesaplanan, artık güncel olmayan rotaya aittir.')).toBeVisible()

  await selectRoute(page, 'Boş Hat')
  summary = routeDetail(page).getByRole('group', { name: 'Boş Hat rota özeti' })
  await expect(summary.locator('dd')).toHaveText(['—', '—', '2', '—', 'Oluşturulmadı'])
})

test('list and map route hover synchronize locally without changing selection or issuing requests', async ({ page }) => {
  const paths = [
    { routeId: 7, geometryWkt: 'LINESTRING (35.2433 38.9637, 37.2433 38.9637, 39.2433 38.9637)', distanceMeters: 4200, durationSeconds: 600, generatedAt: '2026-08-28T10:00:00Z', isStale: false },
  ]
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE], { paths })
  await openManagement(page)
  await selectRoute(page)
  await expect(routeRow(page, 7).getByText('Güncel', { exact: true })).toBeVisible()
  const readsBefore = { route: state.routeReads, stop: state.stopReads, path: state.pathReads }
  const map = page.getByTestId('transport-management-map')

  await routeRow(page, 8).hover()
  await expect(map).toHaveAttribute('data-hovered-route-id', '8')
  await expect(routeSelection(page, 'Merkez Hattı')).toHaveAttribute('aria-pressed', 'true')
  await expect(routeDetail(page).getByRole('heading', { name: 'Merkez Hattı' })).toBeVisible()
  await page.getByRole('heading', { name: 'Aktif Güzergahlar' }).hover()
  await expect(map).toHaveAttribute('data-hovered-route-id', '')

  await mapCard(page).getByRole('button', { name: 'Güzergaha Odaklan' }).click()
  await page.waitForTimeout(400)
  const viewport = map.locator('.ol-viewport')
  const box = await viewport.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(routeRow(page, 7)).toHaveAttribute('data-hovered', 'true')
  await expect(routeSelection(page, 'Merkez Hattı')).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('heading', { name: 'Aktif Güzergahlar' }).hover()
  await expect(routeRow(page, 7)).toHaveAttribute('data-hovered', 'false')
  await page.waitForTimeout(100)
  expect({ route: state.routeReads, stop: state.stopReads, path: state.pathReads }).toEqual(readsBefore)
})

test('a visibility-hidden route cannot become map-hover highlighted', async ({ page }) => {
  const paths = [
    { routeId: 7, geometryWkt: 'LINESTRING (35.2433 38.9637, 37.2433 38.9637, 39.2433 38.9637)', distanceMeters: 4200, durationSeconds: 600, generatedAt: '2026-08-28T10:00:00Z', isStale: false },
  ]
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE], { paths })
  await openManagement(page)
  await selectRoute(page)
  await mapCard(page).getByRole('button', { name: 'Güzergaha Odaklan' }).click()
  await page.waitForTimeout(400)
  await activeRoutes(page).getByRole('button', { name: 'Merkez Hattı güzergahını gizle' }).click()

  const map = page.getByTestId('transport-management-map')
  await routeRow(page, 7).hover()
  await expect(map).toHaveAttribute('data-hovered-route-id', '')
  await expect(routeRow(page, 7)).toHaveAttribute('data-hovered', 'false')
  const viewport = map.locator('.ol-viewport')
  const box = await viewport.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await expect(map).toHaveAttribute('data-hovered-route-id', '')
  await expect(routeRow(page, 7)).toHaveAttribute('data-hovered', 'false')
  await expect(routeSelection(page, 'Merkez Hattı')).toHaveAttribute('aria-pressed', 'true')
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
  await expect(routeSelection(page, 'Gece Hattı')).toBeVisible()
  await expect(routeDetail(page).getByRole('heading', { name: 'Gece Hattı' })).toBeVisible()

  const mapReadsBefore = state.routeReads
  await adminNav(page).getByRole('link', { name: 'Haritaya Dön' }).click()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()
  await expect.poll(() => state.routeReads).toBeGreaterThan(mapReadsBefore)
  await page.getByRole('toolbar', { name: 'Çizim araçları' }).getByRole('button', { name: 'Durak Ekle aracı' }).click()
  const mapBox = await page.locator('.map-container').boundingBox()
  await page.mouse.click(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2)
  await expect(page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: 'Durak Ekle' }) })
    .getByRole('radio', { name: /Gece Hattı/ })).toHaveCount(1)
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
  await expect(page.getByRole('alert')).toContainText('Sıralama reddedildi.')
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

  // Route selection intentionally fits the map. Explicitly finish that
  // OpenLayers animation so the viewport-centre click has a deterministic
  // geographic coordinate derived from the selected route extent.
  await mapCard(page).getByRole('button', { name: 'Güzergaha Odaklan' }).click()
  await page.waitForTimeout(400)
  await mapCard(page).getByRole('button', { name: 'Haritadan Durak Ekle' }).click()
  await expect(mapCard(page).getByText('Durak konumunu seçmek için haritaya tıklayın.')).toBeVisible()
  await clickManagementMap(page)
  const dialog = page.getByRole('dialog', { name: 'Haritadan Durak Ekle' })
  await expect(dialog).toContainText('Merkez Hattı')
  await expect(dialog.getByLabel('Güzergah')).toHaveCount(0)
  const coordinateText = await dialog.locator('.transport-stop-coordinate').textContent()
  const displayedCoordinate = coordinateText.match(/(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
  expect(displayedCoordinate).not.toBeNull()
  await dialog.getByLabel('Durak Adı').fill('Yeni Son Durak')
  await dialog.getByRole('button', { name: 'Durağı Kaydet' }).click()

  await expect.poll(() => state.stopCreates.length).toBe(1)
  expect(state.stopCreates[0].routeId).toBe(7)
  const expectedCoordinate = focusedRouteCenter(7)
  expect(Math.abs(state.stopCreates[0].longitude - expectedCoordinate.longitude)).toBeLessThan(CENTER_CLICK_TOLERANCE_DEGREES)
  expect(Math.abs(state.stopCreates[0].latitude - expectedCoordinate.latitude)).toBeLessThan(CENTER_CLICK_TOLERANCE_DEGREES)
  expect(state.stopCreates[0].longitude).toBeCloseTo(Number(displayedCoordinate[1]), 4)
  expect(state.stopCreates[0].latitude).toBeCloseTo(Number(displayedCoordinate[2]), 4)
  await expect.poll(() => state.stopReads).toBeGreaterThan(stopReadsBefore)
  await expect(routeDetail(page).getByRole('list').locator('li').last()).toContainText('Yeni Son Durak')
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-stop-pending-layer')).toBe(false)
})

test('admin fast add generates the backend path and paints it without leaving the page', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE, STOP_CREATE])
  await openManagement(page)
  await selectRoute(page)
  await mapCard(page).getByRole('button', { name: 'Haritadan Durak Ekle' }).click()
  await clickManagementMap(page)
  const dialog = page.getByRole('dialog', { name: 'Haritadan Durak Ekle' })
  await dialog.getByLabel('Durak Adı').fill('Hızlı Yönetim Durağı')
  await dialog.getByLabel('Durağı ekle ve rotayı hesapla').check()
  await dialog.getByRole('button', { name: 'Durağı Kaydet' }).click()

  await expect.poll(() => state.generations).toEqual([7])
  await expect(page.getByRole('status')).toContainText('rota hesaplandı ve harita güncellendi')
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-route-path-layer')).toBe(true)
})

test('route list selection focuses the map and stop list selection opens synchronized details', async ({ page }) => {
  await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE, STOP_UPDATE, STOP_DELETE])
  await openManagement(page)
  await selectRoute(page)
  await expect(mapCard(page).getByRole('button', { name: 'Güzergaha Odaklan' })).toBeVisible()

  await routeDetail(page).locator('[data-stop-id="72"] .transport-stop-select').click()
  const detail = mapCard(page).getByRole('complementary', { name: 'Seçili durak detayı' })
  await expect(detail).toContainText('Meydan')
  await expect(detail).toContainText('Merkez Hattı')
  await expect(detail).toContainText('37.243300')
  await expect(detail.getByRole('button', { name: 'Düzenle', exact: true })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Konuma Git' })).toBeVisible()
  await expect(detail.getByRole('button', { name: 'Sil' })).toBeVisible()
})

test('stop name edit saves, while explicit location edit supports ESC cancel and stale-path semantics', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE, STOP_UPDATE])
  state.paths.push({ routeId: 7, geometryWkt: 'LINESTRING (35.2433 38.9637, 37.2433 38.9637, 39.2433 38.9637)', distanceMeters: 1200, durationSeconds: 180, generatedAt: '2026-08-28T10:00:00Z', isStale: false })
  await openManagement(page)
  await selectRoute(page)
  await routeDetail(page).locator('[data-stop-id="72"] .transport-stop-select').click()
  const detail = mapCard(page).getByRole('complementary', { name: 'Seçili durak detayı' })

  await detail.getByRole('button', { name: 'Düzenle', exact: true }).click()
  await detail.getByLabel('Durak Adı').fill('Yeni Meydan')
  await detail.getByRole('button', { name: 'Kaydet', exact: true }).click()
  await expect.poll(() => state.stopUpdates.length).toBe(1)
  expect(state.stopUpdates[0].body.name).toBe('Yeni Meydan')

  await detail.getByRole('button', { name: 'Konumu Düzenle' }).click()
  await expect(detail).toContainText('Konum düzenleme etkin')
  await page.keyboard.press('Escape')
  await expect(detail.getByText('Konum düzenleme etkin')).toHaveCount(0)
  expect(state.stopUpdates).toHaveLength(1)

  await detail.getByRole('button', { name: 'Konumu Düzenle' }).click()
  await clickManagementMap(page)
  await detail.getByRole('button', { name: 'Konumu Kaydet' }).click()
  await expect.poll(() => state.stopUpdates.length).toBe(2)
  await expect(routeDetail(page)).toContainText('eski yol geometrisi haritada gösterilmiyor')
})

test('admin stop delete compacts order, regenerates a routable route, and paints the fresh persisted path', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE, STOP_DELETE])
  state.paths.push({ routeId: 7, geometryWkt: 'LINESTRING (35.2433 38.9637, 37.2433 38.9637, 39.2433 38.9637)', distanceMeters: 1200, durationSeconds: 180, generatedAt: '2026-08-27T10:00:00Z', isStale: false })
  await openManagement(page)
  await selectRoute(page)
  await routeDetail(page).locator('[data-stop-id="72"] .transport-stop-select').click()
  const detail = mapCard(page).getByRole('complementary', { name: 'Seçili durak detayı' })
  await detail.getByRole('button', { name: 'Sil', exact: true }).click()
  await detail.getByRole('button', { name: 'Sil', exact: true }).click()

  await expect.poll(() => state.stopDeletes).toEqual([72])
  await expect.poll(() => state.generations).toEqual([7])
  const remainingStops = state.stops.filter((stop) => stop.routeId === 7)
  expect(Object.fromEntries(remainingStops.map((stop) => [stop.id, stop.sequenceOrder]))).toEqual({
    71: 1,
    73: 2,
  })
  expect(remainingStops.map((stop) => stop.sequenceOrder).sort((left, right) => left - right)).toEqual([1, 2])
  expect(state.paths.find((path) => path.routeId === 7)?.isStale).toBe(false)
  await expect(page.getByRole('status').getByText('Durak silindi, rota yeniden hesaplandı ve harita güncellendi.', { exact: true })).toBeVisible()
  await expect.poll(() => layerHasPaint(page, '.transport-management-map .transport-route-path-layer')).toBe(true)
})

test('admin route-generation failure keeps the stop deleted and suppresses the stale old path', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE, STOP_DELETE], { routeGenerateStatus: 503 })
  state.paths.push({ routeId: 7, geometryWkt: 'LINESTRING (35.2433 38.9637, 37.2433 38.9637, 39.2433 38.9637)', distanceMeters: 1200, durationSeconds: 180, generatedAt: '2026-08-27T10:00:00Z', isStale: false })
  await openManagement(page)
  await selectRoute(page)
  await routeDetail(page).locator('[data-stop-id="72"] .transport-stop-select').click()
  const detail = mapCard(page).getByRole('complementary', { name: 'Seçili durak detayı' })
  await detail.getByRole('button', { name: 'Sil', exact: true }).click()
  await detail.getByRole('button', { name: 'Sil', exact: true }).click()

  await expect.poll(() => state.stopDeletes).toEqual([72])
  await expect.poll(() => state.generations).toEqual([7])
  expect(state.stops.some((stop) => stop.id === 72)).toBe(false)
  expect(state.paths.find((path) => path.routeId === 7)?.isStale).toBe(true)
  await expect(page.getByRole('alert').getByText('Durak silindi ancak rota yeniden hesaplanamadı. Güvenli rota hatası.', { exact: true })).toBeVisible()

  const featureState = routeFeatureState(state.routes, state.stops, state.paths, 7)
  expect(featureState.currentPaths).toHaveLength(0)
  expect(featureState.arrowPlacements).toHaveLength(0)
  expect(featureState.stops.map((feature) => [feature.get('featureKind'), feature.get('stopId')])).toEqual([
    [TRANSPORT_STOP_KIND, 71],
    [TRANSPORT_STOP_KIND, 73],
  ])
  expect(featureState.previews).toHaveLength(1)
  const [preview] = featureState.previews
  expect(preview.get('featureKind')).toBe(TRANSPORT_ROUTE_KIND)
  expect(preview.get('featureKind')).not.toBe(TRANSPORT_ROUTE_PATH_KIND)
  expect(preview.get('isPreview')).toBe(true)
  expect(preview.get('previewReason')).toBe('stale')
  expect(preview.getGeometry().getCoordinates()).toEqual(state.stops
    .filter((stop) => stop.routeId === 7)
    .sort((left, right) => left.sequenceOrder - right.sequenceOrder)
    .map((stop) => fromLonLat([stop.longitude, stop.latitude])))
  expect(preview.getGeometry().getCoordinates()).not.toContainEqual(fromLonLat([37.2433, 38.9637]))
})

test('a stop hit wins over a current route path and route-line click selects its route', async ({ page }) => {
  const state = await signIn(page, [TRANSPORT_VIEW, ROUTE_UPDATE])
  state.paths.push({ routeId: 7, geometryWkt: 'LINESTRING (35.2433 38.9637, 37.2433 38.9637, 39.2433 38.9637)', distanceMeters: 1200, durationSeconds: 180, generatedAt: '2026-08-28T10:00:00Z', isStale: false })
  await openManagement(page)
  await selectRoute(page)
  await page.waitForTimeout(400)
  await clickManagementMap(page)
  await expect(mapCard(page).getByRole('complementary', { name: 'Seçili durak detayı' })).toContainText('Meydan')

  await routeSelection(page, 'Boş Hat').click()
  const viewport = page.getByTestId('transport-management-map').locator('.ol-viewport')
  const box = await viewport.boundingBox()
  await viewport.click({ position: { x: box.width * 0.38, y: box.height / 2 } })
  await expect(routeSelection(page, 'Merkez Hattı')).toHaveAttribute('aria-pressed', 'true')
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
  await routeSelection(page, 'Boş Hat').click()

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
