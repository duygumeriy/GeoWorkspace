import { expect, test } from '@playwright/test'
import { fromLonLat, toLonLat } from 'ol/proj.js'
import { mockPermissions } from './permissions.js'
import {
  TRANSPORT_ROUTE_KIND,
  TRANSPORT_STOP_KIND,
  createTransportLayers,
  routeArrowPlacements,
  transportFeatures,
} from '../../src/map/transport.js'
import { TURKEY_CENTER_LON_LAT, TURKEY_ZOOM } from '../../src/map/turkey.js'

const MAP_VIEW = 'map.view'
const TRANSPORT_VIEW = 'transport.view'
const TRANSPORT_STOP_CREATE = 'transport.stop.create'
const TRANSPORT_STOP_DELETE = 'transport.stop.delete'
const TRANSPORT_STOP_RESTORE = 'transport.stop.restore'
const TRANSPORT_STOP_UPDATE = 'transport.stop.update'
const TRANSPORT_ROUTE_UPDATE = 'transport.route.update'
const POI_VIEW = 'poi.view'
const LOCATION_ANALYSIS = 'location.analysis'
const POINT_CREATE = 'drawings.point.create'

const MAP_CENTER = {
  longitude: TURKEY_CENTER_LON_LAT[0],
  latitude: TURKEY_CENTER_LON_LAT[1],
}

const ROUTES = [
  { id: 7, name: 'Merkez Hattı', colorHex: '#E11D48', isActive: true },
  { id: 8, name: 'Sahil Hattı', colorHex: '#0284C7', isActive: true },
]

const CENTER_STOP = {
  id: 71,
  routeId: 7,
  routeName: 'Merkez Hattı',
  name: 'Merkez Durak',
  sequenceOrder: 1,
  colorHex: '#E11D48',
  ...MAP_CENTER,
}

const EAST_STOP = {
  id: 72,
  routeId: 7,
  routeName: 'Merkez Hattı',
  name: 'Doğu Durak',
  sequenceOrder: 2,
  colorHex: '#E11D48',
  longitude: MAP_CENTER.longitude + 4,
  latitude: MAP_CENTER.latitude,
}

const transferFixture = () => {
  const routes = [
    { ...ROUTES[0], name: 'Kaynak Hat', stopCount: 3 },
    { ...ROUTES[1], name: 'Hedef Hat', stopCount: 2 },
  ]
  const stops = [
    { ...CENTER_STOP, routeName: 'Kaynak Hat' },
    { ...EAST_STOP, routeName: 'Kaynak Hat' },
    { ...EAST_STOP, id: 73, name: 'Kaynak Son', routeName: 'Kaynak Hat', longitude: MAP_CENTER.longitude + 8, sequenceOrder: 3 },
    { ...EAST_STOP, id: 81, routeId: 8, name: 'Hedef İlk', routeName: 'Hedef Hat', colorHex: '#0284C7', longitude: MAP_CENTER.longitude - 8, sequenceOrder: 1 },
    { ...EAST_STOP, id: 82, routeId: 8, name: 'Hedef Son', routeName: 'Hedef Hat', colorHex: '#0284C7', longitude: MAP_CENTER.longitude - 4, sequenceOrder: 2 },
  ]
  const paths = routes.map((route) => {
    const routeStops = stops.filter((stop) => stop.routeId === route.id)
    return {
      routeId: route.id,
      geometryWkt: `LINESTRING (${routeStops.map((stop) => `${stop.longitude} ${stop.latitude}`).join(', ')})`,
      distanceMeters: 1800,
      durationSeconds: 200,
      generatedAt: '2026-08-27T10:00:00Z',
      isStale: false,
    }
  })
  return { routes, stops, paths }
}

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8vZVwAAAABJRU5ErkJggg==',
  'base64',
)

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

const clone = (value) => JSON.parse(JSON.stringify(value))

async function openMap(page, permissions, {
  role = 'Özel Ulaşım Ekibi',
  routes = ROUTES,
  stops = [CENTER_STOP, EAST_STOP],
  paths = [],
  createStatus = 201,
  updateStatus = 200,
  deleteStatus = 204,
  restoreStatus = 200,
  generateStatus = 200,
  generateStatuses = {},
  deletedStops = [],
  pois = [],
} = {}) {
  await mockPermissions(page, permissions)

  const state = {
    routes: clone(routes),
    stops: clone(stops),
    routeReads: 0,
    stopReads: 0,
    poiReads: 0,
    analysisRequests: 0,
    created: [],
    updates: [],
    deleted: [],
    restores: [],
    generations: [],
    paths: clone(paths),
    deletedStops: clone(deletedStops),
  }

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'smart-transport-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())

  await page.route('**/api/auth/me', (route) => route.fulfill(json({
    userId: 1,
    username: 'transport-user',
    role,
    roles: [role],
  })))
  await page.route('**/api/auth/me/geographic-scope', (route) => route.fulfill(json({
    isRestricted: false,
    effectiveWkt: null,
    areaCount: 0,
  })))

  await page.route('**/api/transport/routes', (route) => {
    state.routeReads += 1
    return route.fulfill(json(state.routes))
  })
  await page.route('**/api/transport/routes/paths', (route) => route.fulfill(json(state.paths)))
  await page.route('**/api/transport/routes/*/path/generate', (route) => {
    const routeId = Number(new URL(route.request().url()).pathname.split('/').at(-3))
    state.generations.push(routeId)
    const status = generateStatuses[routeId] ?? generateStatus
    if (status !== 200) return route.fulfill(json({ message: 'Güvenli rota hatası.' }, status))
    const routeStops = state.stops
      .filter((stop) => stop.routeId === routeId)
      .sort((left, right) => left.sequenceOrder - right.sequenceOrder)
    const path = {
      routeId,
      geometryWkt: `LINESTRING (${routeStops.map((stop) => `${stop.longitude} ${stop.latitude}`).join(', ')})`,
      distanceMeters: 1000,
      durationSeconds: 120,
      generatedAt: '2026-08-28T10:00:00Z',
      isStale: false,
    }
    state.paths = state.paths.filter((item) => item.routeId !== routeId).concat(path)
    return route.fulfill(json(path))
  })
  await page.route('**/api/transport/routes/*/stops', (route) => {
    state.stopReads += 1
    const routeId = Number(new URL(route.request().url()).pathname.split('/').at(-2))
    return route.fulfill(json(state.stops.filter((stop) => stop.routeId === routeId)))
  })
  await page.route('**/api/transport/stops/mine', (route) => route.fulfill(json(state.stops)))
  await page.route('**/api/transport/stops/trash', (route) => route.fulfill(json(state.deletedStops)))
  await page.route('**/api/transport/stops', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill(json({ message: 'Method not allowed.' }, 405))

    const body = JSON.parse(route.request().postData() ?? '{}')
    state.created.push(body)
    if (createStatus !== 201) {
      return route.fulfill(json({ message: 'Durak kaydedilemedi.' }, createStatus))
    }

    const parent = state.routes.find((item) => item.id === body.routeId)
    const created = {
      id: 900 + state.created.length,
      ...body,
      routeName: parent?.name ?? '',
      colorHex: parent?.colorHex ?? '#2563EB',
      sequenceOrder: state.stops.filter((stop) => stop.routeId === body.routeId).length + 1,
    }
    state.stops.push(created)
    state.paths = state.paths.map((path) => path.routeId === body.routeId ? { ...path, isStale: true } : path)
    return route.fulfill(json(created, 201))
  })
  await page.route(/\/api\/transport\/stops\/\d+$/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-1))
    if (route.request().method() === 'PUT') {
      const body = JSON.parse(route.request().postData() ?? '{}')
      state.updates.push({ id, body })
      if (updateStatus !== 200) return route.fulfill(json({ message: 'Durak güncellenemedi.' }, updateStatus))
      const index = state.stops.findIndex((stop) => stop.id === id)
      const previous = state.stops[index]
      const routeChanged = previous.routeId !== body.routeId
      const coordinateChanged = previous.longitude !== body.longitude || previous.latitude !== body.latitude
      if (routeChanged) {
        state.stops
          .filter((stop) => stop.routeId === previous.routeId && stop.id !== id)
          .sort((left, right) => left.sequenceOrder - right.sequenceOrder)
          .forEach((stop, orderIndex) => { stop.sequenceOrder = orderIndex + 1 })
      }
      const destinationSequence = routeChanged
        ? Math.max(0, ...state.stops.filter((stop) => stop.routeId === body.routeId).map((stop) => stop.sequenceOrder)) + 1
        : previous.sequenceOrder
      const destination = state.routes.find((item) => item.id === body.routeId)
      const updated = { ...previous, ...body, routeName: destination?.name ?? '', colorHex: destination?.colorHex, sequenceOrder: destinationSequence }
      state.stops[index] = updated
      const affectedRouteIds = routeChanged ? [previous.routeId, body.routeId] : coordinateChanged ? [body.routeId] : []
      state.paths = state.paths.map((path) => affectedRouteIds.includes(path.routeId) ? { ...path, isStale: true } : path)
      return route.fulfill(json(updated))
    }
    if (route.request().method() !== 'DELETE') return route.fulfill(json({ message: 'Method not allowed.' }, 405))
    if (deleteStatus !== 204) return route.fulfill(json({ message: 'Durak silinemedi.' }, deleteStatus))
    const deleted = state.stops.find((stop) => stop.id === id)
    state.deleted.push(id)
    state.stops = state.stops.filter((stop) => stop.id !== id)
    state.stops
      .filter((stop) => stop.routeId === deleted.routeId)
      .sort((left, right) => left.sequenceOrder - right.sequenceOrder)
      .forEach((stop, index) => { stop.sequenceOrder = index + 1 })
    state.paths = state.paths.map((path) => path.routeId === deleted.routeId ? { ...path, isStale: true } : path)
    return route.fulfill({ status: 204 })
  })
  await page.route(/\/api\/transport\/stops\/\d+\/restore$/, (route) => {
    const id = Number(new URL(route.request().url()).pathname.split('/').at(-2))
    if (restoreStatus !== 200) return route.fulfill(json({ message: 'Durak geri yüklenemedi.' }, restoreStatus))
    const index = state.deletedStops.findIndex((stop) => stop.id === id)
    const deleted = state.deletedStops[index]
    if (!deleted) return route.fulfill(json({ message: 'Silinen durak bulunamadı.' }, 404))
    state.restores.push(id)
    state.deletedStops.splice(index, 1)
    const sequenceOrder = Math.max(0, ...state.stops
      .filter((stop) => stop.routeId === deleted.routeId)
      .map((stop) => stop.sequenceOrder)) + 1
    const restored = { ...deleted, sequenceOrder, isActive: true, isDeleted: false }
    state.stops.push(restored)
    state.paths = state.paths.map((path) => path.routeId === restored.routeId ? { ...path, isStale: true } : path)
    return route.fulfill(json(restored))
  })

  await page.route('**/api/poi/categories', (route) => route.fulfill(json([])))
  await page.route('**/api/poi', (route) => {
    state.poiReads += 1
    return route.fulfill(json(pois))
  })
  await page.route('**/api/map/presentation/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    body: PIXEL_PNG,
  }))
  await page.route('**/api/analysis/location**', (route) => {
    state.analysisRequests += 1
    return route.fulfill(json({ message: 'Unexpected analysis request.' }, 500))
  })
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: PIXEL_PNG,
  }))

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  return state
}

const toolbar = (page) => page.getByRole('toolbar', { name: 'Çizim araçları' })
const stopTool = (page) => toolbar(page).getByRole('button', { name: 'Durak Ekle aracı' })
const stopForm = (page) => page.getByRole('dialog').filter({
  has: page.getByRole('heading', { name: 'Durak Ekle', exact: true }),
})

async function clickMap(page, fx = 0.5, fy = 0.5) {
  const box = await page.locator('.map-container').boundingBox()
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await page.waitForTimeout(120)
}

async function clickCoordinate(page, longitude, latitude, popupOrigin = null) {
  const box = await page.locator('.map-container').boundingBox()
  let origin = fromLonLat(TURKEY_CENTER_LON_LAT)
  let originPixel = { x: box.x + box.width / 2, y: box.y + box.height / 2 }

  /* An actionable stop popup can be tall enough for Overlay auto-pan to move
     the view. In that state the geographic centre is no longer the viewport
     centre. The popup remains anchored to the selected stop, so use its live
     anchor instead of clicking where the stop was before the pan. */
  if (popupOrigin) {
    const popup = page.getByRole('dialog', { name: 'Durak bilgisi' })
    const popupBox = await popup.boundingBox()
    origin = fromLonLat([popupOrigin.longitude, popupOrigin.latitude])
    originPixel = {
      x: popupBox.x + popupBox.width / 2,
      // TransportStopPopup uses bottom-center positioning with offset [0, -14].
      y: popupBox.y + popupBox.height + 14,
    }
  }

  const coordinate = fromLonLat([longitude, latitude])
  const resolution = 156543.03392804097 / (2 ** TURKEY_ZOOM)
  await page.mouse.click(
    originPixel.x + (coordinate[0] - origin[0]) / resolution,
    originPixel.y - (coordinate[1] - origin[1]) / resolution,
  )
  await page.waitForTimeout(120)
}

async function layerHasPaint(page, selector) {
  return page.evaluate((layerSelector) => {
    const root = document.querySelector(layerSelector)
    const canvas = root?.matches('canvas') ? root : root?.querySelector('canvas')
    if (!canvas) return false
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] !== 0) return true
    }
    return false
  }, selector)
}

test('transport.view loads and renders transport independently of the role name', async ({ page }) => {
  const state = await openMap(page, [MAP_VIEW, TRANSPORT_VIEW], { role: 'Bilinmeyen Özel Rol' })

  await expect.poll(() => state.routeReads).toBeGreaterThan(0)
  await expect.poll(() => state.stopReads).toBeGreaterThanOrEqual(ROUTES.length)
  await expect(page.locator('.transport-route-layer')).toHaveCount(1)
  await expect(page.locator('.transport-stop-layer')).toHaveCount(1)

  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Durak bilgisi' })).toContainText('Merkez Durak')
})

test('Durak Ekle stays hidden when the permission code is absent even for an Administrator role', async ({ page }) => {
  await openMap(page, [MAP_VIEW, TRANSPORT_VIEW], { role: 'Administrator' })
  await expect(stopTool(page)).toHaveCount(0)
})

test('Durak Ekle is visible with transport.stop.create for a custom role', async ({ page }) => {
  await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_CREATE])
  await expect(stopTool(page)).toBeVisible()
})

test('zero stops create no route LineString', () => {
  const { routeFeatures, stopFeatures } = transportFeatures([ROUTES[0]], [])

  expect(routeFeatures).toHaveLength(0)
  expect(stopFeatures).toHaveLength(0)
})

test('one stop creates a projected marker but no route LineString', () => {
  const { routeFeatures, stopFeatures } = transportFeatures([ROUTES[0]], [CENTER_STOP])

  expect(routeFeatures).toHaveLength(0)
  expect(stopFeatures).toHaveLength(1)
  expect(stopFeatures[0].get('featureKind')).toBe(TRANSPORT_STOP_KIND)
  const coordinate = toLonLat(stopFeatures[0].getGeometry().getCoordinates())
  expect(coordinate[0]).toBeCloseTo(MAP_CENTER.longitude, 6)
  expect(coordinate[1]).toBeCloseTo(MAP_CENTER.latitude, 6)
})

test('two or more stops create an ordered LineString with the route color style', () => {
  const unordered = [
    { ...EAST_STOP, sequenceOrder: 2 },
    { ...CENTER_STOP, sequenceOrder: 1 },
  ]
  const { routeFeatures } = transportFeatures([ROUTES[0]], unordered)

  expect(routeFeatures).toHaveLength(1)
  expect(routeFeatures[0].get('featureKind')).toBe(TRANSPORT_ROUTE_KIND)
  expect(routeFeatures[0].getGeometry().getType()).toBe('LineString')
  const coordinates = routeFeatures[0].getGeometry().getCoordinates().map((coordinate) => toLonLat(coordinate))
  expect(coordinates[0][0]).toBeCloseTo(CENTER_STOP.longitude, 6)
  expect(coordinates[1][0]).toBeCloseTo(EAST_STOP.longitude, 6)

  const { routeLayer } = createTransportLayers(() => null)
  const style = routeLayer.getStyleFunction()(routeFeatures[0], 1)
  expect(style.getStroke().getColor()).toBe(ROUTES[0].colorHex)
})

test('Durak Ekle posts EPSG:4326, refreshes transport, adds the stop, and redraws the route', async ({ page }) => {
  const firstStop = { ...EAST_STOP, id: 80, sequenceOrder: 1 }
  const state = await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_CREATE], {
    routes: [ROUTES[0], { ...ROUTES[1], isActive: false }],
    stops: [firstStop],
  })

  await expect.poll(() => state.stopReads).toBeGreaterThan(0)
  const initialRouteReads = state.routeReads
  const initialStopReads = state.stopReads
  expect(await layerHasPaint(page, '.transport-route-layer')).toBe(false)

  await stopTool(page).click()
  await expect(stopTool(page)).toHaveAttribute('aria-pressed', 'true')
  await clickMap(page)

  const form = stopForm(page)
  await expect(form).toBeVisible()
  await expect(form.getByLabel('Durak Adı')).toBeVisible()
  const routeChoice = form.getByRole('radio', { name: /Merkez Hattı.*1 durak/ })
  await expect(routeChoice).toBeChecked()
  await expect(form.getByLabel('Renk #E11D48')).toHaveCSS('background-color', 'rgb(225, 29, 72)')
  await expect(form.getByRole('radio', { name: /Sahil Hattı/ })).toHaveCount(0)
  await expect(form.getByLabel('Durağı ekle ve rotayı hesapla')).toHaveCount(0)
  await form.getByLabel('Durak Adı').fill('Yeni Durak')
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click()

  await expect.poll(() => state.created.length).toBe(1)
  expect(state.created[0].routeId).toBe(ROUTES[0].id)
  expect(state.created[0].longitude).toBeCloseTo(MAP_CENTER.longitude, 5)
  expect(state.created[0].latitude).toBeCloseTo(MAP_CENTER.latitude, 5)
  await expect.poll(() => state.routeReads).toBeGreaterThan(initialRouteReads)
  await expect.poll(() => state.stopReads).toBeGreaterThan(initialStopReads)
  await expect.poll(() => layerHasPaint(page, '.transport-route-layer')).toBe(true)

  /* Save is not complete merely because the refreshed feature has painted:
     the flow also refreshes Duraklarım before retiring placement mode. Wait
     for that semantic boundary so this click is a selection, not a second
     placement click. */
  await expect(stopForm(page)).toHaveCount(0)
  await expect(stopTool(page)).toHaveAttribute('aria-pressed', 'false')
  // The freshly painted direct preview ends at the same coordinate. The stop
  // layer's typed hit filter must still win and open the stop information UI.
  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Durak bilgisi' })).toContainText('Yeni Durak')
})

test('fast stop workflow generates through the backend and refreshes the persisted path immediately', async ({ page }) => {
  const state = await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_CREATE, TRANSPORT_ROUTE_UPDATE], {
    routes: [ROUTES[0]],
    stops: [{ ...CENTER_STOP, sequenceOrder: 1 }],
  })
  await stopTool(page).click()
  await clickMap(page, 0.55, 0.5)
  const form = stopForm(page)
  await form.getByLabel('Durak Adı').fill('Hızlı Durak')
  await form.getByLabel('Durağı ekle ve rotayı hesapla').check()
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click()

  await expect.poll(() => state.created.length).toBe(1)
  expect(state.stops.some((stop) => stop.name === 'Hızlı Durak')).toBe(true)
  await expect.poll(() => state.generations).toEqual([7])
  await expect(page.getByRole('status').filter({ hasText: /^Durak eklendi, rota hesaplandı ve harita güncellendi\.$/ })).toBeVisible()
  expect(state.paths.find((path) => path.routeId === 7)?.isStale).toBe(false)
  await expect.poll(() => layerHasPaint(page, '.transport-route-path-layer')).toBe(true)
})

test('routing failure keeps the created stop and reports the safe reason without a current path', async ({ page }) => {
  const state = await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_CREATE, TRANSPORT_ROUTE_UPDATE], {
    routes: [ROUTES[0]],
    stops: [{ ...CENTER_STOP, sequenceOrder: 1 }],
    paths: [{
      routeId: 7,
      geometryWkt: `LINESTRING (${CENTER_STOP.longitude} ${CENTER_STOP.latitude}, ${EAST_STOP.longitude} ${EAST_STOP.latitude})`,
      distanceMeters: 900,
      durationSeconds: 100,
      generatedAt: '2026-08-27T10:00:00Z',
      isStale: false,
    }],
    generateStatus: 503,
  })
  await stopTool(page).click()
  await clickMap(page, 0.55, 0.5)
  const form = stopForm(page)
  await form.getByLabel('Durak Adı').fill('Kalıcı Durak')
  await form.getByLabel('Durağı ekle ve rotayı hesapla').check()
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click()

  await expect.poll(() => state.created.length).toBe(1)
  await expect.poll(() => state.generations).toEqual([7])
  expect(state.stops.some((stop) => stop.name === 'Kalıcı Durak')).toBe(true)
  expect(state.paths.find((path) => path.routeId === 7)?.isStale).toBe(true)
  await expect(page.getByRole('alert').filter({ hasText: /^Durak eklendi ancak rota yeniden hesaplanamadı\. Güvenli rota hatası\.$/ })).toBeVisible()
  expect(await layerHasPaint(page, '.transport-route-path-layer')).toBe(false)
})

test('main-map stop delete regenerates a still-routable route and renders its fresh path', async ({ page }) => {
  const thirdStop = { ...EAST_STOP, id: 73, name: 'Uzak Durak', longitude: MAP_CENTER.longitude + 8, sequenceOrder: 3 }
  const state = await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_DELETE, TRANSPORT_ROUTE_UPDATE], {
    routes: [ROUTES[0]],
    stops: [CENTER_STOP, EAST_STOP, thirdStop],
    paths: [{
      routeId: 7,
      geometryWkt: `LINESTRING (${CENTER_STOP.longitude} ${CENTER_STOP.latitude}, ${EAST_STOP.longitude} ${EAST_STOP.latitude}, ${thirdStop.longitude} ${thirdStop.latitude})`,
      distanceMeters: 1800,
      durationSeconds: 200,
      generatedAt: '2026-08-27T10:00:00Z',
      isStale: false,
    }],
  })
  await clickMap(page)
  const popup = page.getByRole('dialog', { name: 'Durak bilgisi' })
  await expect(popup).toContainText('Merkez Durak')
  await popup.getByRole('button', { name: 'Sil', exact: true }).click()
  await page.getByRole('alertdialog', { name: 'Durağı sil' }).getByRole('button', { name: 'Sil', exact: true }).click()

  await expect.poll(() => state.deleted).toEqual([71])
  await expect.poll(() => state.generations).toEqual([7])
  expect(state.stops.map((stop) => stop.sequenceOrder)).toEqual([1, 2])
  expect(state.paths.find((path) => path.routeId === 7)?.isStale).toBe(false)
  await expect(page.getByRole('status').filter({ hasText: /^Durak silindi, rota yeniden hesaplandı ve harita güncellendi\.$/ })).toBeVisible()
  await expect.poll(() => layerHasPaint(page, '.transport-route-path-layer')).toBe(true)
})

test('restoring a stop regenerates its routable route with the backend-assigned order and paints the fresh path', async ({ page }) => {
  const deletedStop = { ...EAST_STOP, sequenceOrder: 99, isActive: false, isDeleted: true, modifiedDate: '2026-08-28T10:00:00Z' }
  const state = await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_RESTORE, TRANSPORT_ROUTE_UPDATE], {
    routes: [ROUTES[0]],
    stops: [CENTER_STOP],
    deletedStops: [deletedStop],
    paths: [{
      routeId: 7,
      geometryWkt: `LINESTRING (${CENTER_STOP.longitude} ${CENTER_STOP.latitude}, ${EAST_STOP.longitude} ${EAST_STOP.latitude})`,
      distanceMeters: 900,
      durationSeconds: 100,
      generatedAt: '2026-08-27T10:00:00Z',
      isStale: true,
    }],
  })

  await page.getByRole('button', { name: 'Çöp Kutusu' }).click()
  await page.getByRole('button', { name: 'Doğu Durak kaydını geri yükle' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Geri Yükle' }).click()

  await expect.poll(() => state.restores).toEqual([72])
  await expect.poll(() => state.generations).toEqual([7])
  const restored = state.stops.find((stop) => stop.id === 72)
  expect(restored?.sequenceOrder).toBe(2)
  expect(restored?.isActive).toBe(true)
  expect(state.paths.find((path) => path.routeId === 7)?.isStale).toBe(false)
  await expect(page.getByRole('status').filter({ hasText: /^Durak geri yüklendi, rota yeniden hesaplandı ve harita güncellendi\.$/ })).toBeVisible()
  await expect.poll(() => layerHasPaint(page, '.transport-route-path-layer')).toBe(true)
})

test('restore generation failure keeps the stop restored and exposes only the stale preview', async ({ page }) => {
  const deletedStop = { ...EAST_STOP, sequenceOrder: 99, isActive: false, isDeleted: true, modifiedDate: '2026-08-28T10:00:00Z' }
  const state = await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_RESTORE, TRANSPORT_ROUTE_UPDATE], {
    routes: [ROUTES[0]],
    stops: [CENTER_STOP],
    deletedStops: [deletedStop],
    paths: [{
      routeId: 7,
      geometryWkt: `LINESTRING (${CENTER_STOP.longitude} ${CENTER_STOP.latitude}, ${EAST_STOP.longitude} ${EAST_STOP.latitude})`,
      distanceMeters: 900,
      durationSeconds: 100,
      generatedAt: '2026-08-27T10:00:00Z',
      isStale: true,
    }],
    generateStatus: 503,
  })

  await page.getByRole('button', { name: 'Çöp Kutusu' }).click()
  await page.getByRole('button', { name: 'Doğu Durak kaydını geri yükle' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Geri Yükle' }).click()

  await expect.poll(() => state.restores).toEqual([72])
  await expect.poll(() => state.generations).toEqual([7])
  expect(state.stops.some((stop) => stop.id === 72)).toBe(true)
  expect(state.paths.find((path) => path.routeId === 7)?.isStale).toBe(true)
  const features = transportFeatures(state.routes, state.stops, state.paths)
  expect(features.pathFeatures.filter((feature) => feature.get('routeId') === 7)).toHaveLength(0)
  const previews = features.routeFeatures.filter((feature) => feature.get('routeId') === 7)
  expect(previews).toHaveLength(1)
  expect(previews[0].get('featureKind')).toBe(TRANSPORT_ROUTE_KIND)
  expect(previews[0].get('previewReason')).toBe('stale')
  await expect(page.getByRole('alert').filter({ hasText: /^Durak geri yüklendi ancak rota yeniden hesaplanamadı\. Güvenli rota hatası\.$/ })).toBeVisible()
})

test('transferring a stop regenerates both eligible routes and refreshes canonical marker order and paths', async ({ page }) => {
  const fixture = transferFixture()
  const state = await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_UPDATE, TRANSPORT_ROUTE_UPDATE], fixture)

  await clickMap(page)
  const popup = page.getByRole('dialog', { name: 'Durak bilgisi' })
  await expect(popup).toContainText('Merkez Durak')
  const initialRouteReads = state.routeReads
  await popup.getByRole('button', { name: 'Düzenle', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Durağı Düzenle' })
  await form.getByLabel('Güzergah').selectOption('8')
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click()

  await expect.poll(() => state.updates).toHaveLength(1)
  await expect.poll(() => state.generations).toEqual([7, 8])
  await expect.poll(() => state.routeReads).toBe(initialRouteReads + 2)
  expect(state.updates[0]).toEqual(expect.objectContaining({ id: 71, body: expect.objectContaining({ routeId: 8 }) }))
  const moved = state.stops.find((stop) => stop.id === 71)
  expect(moved).toEqual(expect.objectContaining({ routeId: 8, routeName: 'Hedef Hat', sequenceOrder: 3 }))
  expect(Object.fromEntries(state.stops.filter((stop) => stop.routeId === 7).map((stop) => [stop.id, stop.sequenceOrder]))).toEqual({ 72: 1, 73: 2 })
  expect(Object.fromEntries(state.stops.filter((stop) => stop.routeId === 8).map((stop) => [stop.id, stop.sequenceOrder]))).toEqual({ 71: 3, 81: 1, 82: 2 })
  expect(state.paths.filter((path) => [7, 8].includes(path.routeId)).every((path) => path.isStale === false)).toBe(true)

  const features = transportFeatures(state.routes, state.stops, state.paths)
  const currentPaths = features.pathFeatures.filter((feature) => [7, 8].includes(feature.get('routeId')))
  const markerOrder = Object.fromEntries(features.stopFeatures.map((feature) => [feature.get('stopId'), feature.get('sequenceOrder')]))
  expect(markerOrder).toEqual({ 71: 3, 72: 1, 73: 2, 81: 1, 82: 2 })
  expect(currentPaths.map((feature) => feature.get('routeId')).sort()).toEqual([7, 8])
  expect(features.routeFeatures.filter((feature) => [7, 8].includes(feature.get('routeId')))).toHaveLength(0)
  expect(currentPaths.every((feature) => routeArrowPlacements(feature.getGeometry(), 1).length > 0)).toBe(true)
  await expect(page.getByRole('dialog', { name: 'Durak bilgisi' })).toContainText('Hedef Hat')
  await expect(page.getByRole('status').filter({ hasText: /^Durak taşındı, etkilenen güzergâh rotaları yeniden hesaplandı\.$/ })).toBeVisible()
})

test('one transfer route generation failure preserves the transfer and successful route while suppressing the failed current path', async ({ page }) => {
  const fixture = transferFixture()
  const state = await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_UPDATE, TRANSPORT_ROUTE_UPDATE], {
    ...fixture,
    generateStatuses: { 7: 503 },
  })

  await clickMap(page)
  const popup = page.getByRole('dialog', { name: 'Durak bilgisi' })
  await popup.getByRole('button', { name: 'Düzenle', exact: true }).click()
  const form = page.getByRole('dialog', { name: 'Durağı Düzenle' })
  await form.getByLabel('Güzergah').selectOption('8')
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click()

  await expect.poll(() => state.generations).toEqual([7, 8])
  expect(state.stops.find((stop) => stop.id === 71)).toEqual(expect.objectContaining({ routeId: 8, sequenceOrder: 3 }))
  expect(state.paths.find((path) => path.routeId === 7)?.isStale).toBe(true)
  expect(state.paths.find((path) => path.routeId === 8)?.isStale).toBe(false)

  const features = transportFeatures(state.routes, state.stops, state.paths)
  expect(features.pathFeatures.map((feature) => feature.get('routeId'))).toEqual([8])
  expect(routeArrowPlacements(features.pathFeatures[0].getGeometry(), 1).length).toBeGreaterThan(0)
  const sourcePreviews = features.routeFeatures.filter((feature) => feature.get('routeId') === 7)
  expect(sourcePreviews).toHaveLength(1)
  expect(sourcePreviews[0].get('featureKind')).toBe(TRANSPORT_ROUTE_KIND)
  expect(sourcePreviews[0].get('previewReason')).toBe('stale')
  await expect(page.getByRole('alert').filter({
    hasText: /^Durak taşındı ancak bazı güzergâh rotaları yeniden hesaplanamadı\. Kaynak Hat: Güvenli rota hatası\.$/,
  })).toBeVisible()
})

test('fast generation is disabled when creation would leave fewer than two active stops', async ({ page }) => {
  await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_CREATE, TRANSPORT_ROUTE_UPDATE], {
    routes: [ROUTES[0]],
    stops: [],
  })
  await stopTool(page).click()
  await clickMap(page)
  const form = stopForm(page)
  await expect(form.getByLabel('Durağı ekle ve rotayı hesapla')).toBeDisabled()
  await expect(form).toContainText('en az 2 durak')
})

test('cancel removes the temporary placement feature', async ({ page }) => {
  await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_CREATE], {
    routes: [ROUTES[0]],
    stops: [],
  })

  await stopTool(page).click()
  await clickMap(page)
  await expect.poll(() => layerHasPaint(page, '.transport-stop-pending-layer')).toBe(true)
  await stopForm(page).getByRole('button', { name: 'İptal' }).click()

  await expect(stopForm(page)).toHaveCount(0)
  await expect.poll(() => layerHasPaint(page, '.transport-stop-pending-layer')).toBe(false)
})

test('failed save creates no permanent ghost and never calls route generation', async ({ page }) => {
  const state = await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_CREATE, TRANSPORT_ROUTE_UPDATE], {
    routes: [ROUTES[0]],
    stops: [{ ...CENTER_STOP, sequenceOrder: 1 }],
    createStatus: 400,
  })

  await stopTool(page).click()
  await clickMap(page)
  const form = stopForm(page)
  await form.getByLabel('Durak Adı').fill('Kaydedilemeyen Durak')
  await form.getByLabel('Durağı ekle ve rotayı hesapla').check()
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click()

  await expect(form.getByRole('alert')).toHaveText('Durak kaydedilemedi.')
  expect(state.stops).toHaveLength(1)
  expect(state.generations).toHaveLength(0)
  await form.getByRole('button', { name: 'İptal' }).click()
  await expect.poll(() => layerHasPaint(page, '.transport-stop-pending-layer')).toBe(false)
})

test('switching to another map tool clears temporary stop placement state', async ({ page }) => {
  await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_CREATE, POINT_CREATE], {
    routes: [ROUTES[0]],
    stops: [],
  })

  await stopTool(page).click()
  await clickMap(page)
  await expect(stopForm(page)).toBeVisible()
  await toolbar(page).getByRole('button', { name: 'Nokta çiz (P)' }).click()

  await expect(stopForm(page)).toHaveCount(0)
  await expect(stopTool(page)).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => layerHasPaint(page, '.transport-stop-pending-layer')).toBe(false)
})

test('stop clicks use one replacing popup, empty map closes it, and read-only users get no mutations', async ({ page }) => {
  await openMap(page, [MAP_VIEW, TRANSPORT_VIEW])

  await clickMap(page)
  const popup = page.getByRole('dialog', { name: 'Durak bilgisi' })
  await expect(popup).toHaveCount(1)
  await expect(popup).toContainText('Merkez Durak')
  await expect(popup).toContainText('Merkez Hattı')
  await expect(popup.getByRole('button', { name: /Düzenle|Sil/ })).toHaveCount(0)

  await clickCoordinate(page, EAST_STOP.longitude, EAST_STOP.latitude, CENTER_STOP)
  await expect(popup).toHaveCount(1)
  await expect(popup).toContainText('Doğu Durak')
  await expect(popup).not.toContainText('Merkez Durak')

  await clickMap(page, 0.1, 0.15)
  await expect(popup).toHaveCount(0)
})

test('transport keeps the POI layer/source available and does not trigger Location Analysis', async ({ page }) => {
  const poi = {
    id: 501,
    name: 'Bağımsız POI',
    categoryId: 1,
    categoryName: 'Kafe',
    categoryPath: 'Yeme İçme / Kafe',
    workHours: null,
    longitude: MAP_CENTER.longitude - 4,
    latitude: MAP_CENTER.latitude,
  }
  const state = await openMap(page, [
    MAP_VIEW,
    TRANSPORT_VIEW,
    TRANSPORT_STOP_CREATE,
    POI_VIEW,
    LOCATION_ANALYSIS,
  ], { pois: [poi] })

  await expect.poll(() => state.poiReads).toBeGreaterThan(0)
  await expect(page.locator('.poi-layer')).toHaveCount(1)
  await expect(page.locator('.transport-stop-layer')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Konum Analizi', exact: true })).toBeVisible()

  await clickCoordinate(page, poi.longitude, poi.latitude)
  await expect(page.getByRole('heading', { name: 'POI Bilgisi' })).toBeVisible()

  await stopTool(page).click()
  await expect(stopTool(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.poi-layer')).toHaveCount(1)
  await expect(page.locator('.transport-stop-layer')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Konum Analizi', exact: true })).toBeVisible()
  expect(state.analysisRequests).toBe(0)
})
