import { expect, test } from '@playwright/test'
import { fromLonLat, toLonLat } from 'ol/proj.js'
import { mockPermissions } from './permissions.js'
import {
  TRANSPORT_ROUTE_KIND,
  TRANSPORT_STOP_KIND,
  createTransportLayers,
  transportFeatures,
} from '../../src/map/transport.js'
import { TURKEY_CENTER_LON_LAT, TURKEY_ZOOM } from '../../src/map/turkey.js'

const MAP_VIEW = 'map.view'
const TRANSPORT_VIEW = 'transport.view'
const TRANSPORT_STOP_CREATE = 'transport.stop.create'
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
  createStatus = 201,
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
  await page.route('**/api/transport/routes/*/stops', (route) => {
    state.stopReads += 1
    const routeId = Number(new URL(route.request().url()).pathname.split('/').at(-2))
    return route.fulfill(json(state.stops.filter((stop) => stop.routeId === routeId)))
  })
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
    return route.fulfill(json(created, 201))
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
  await expect(form.getByLabel('Güzergah')).toHaveValue(String(ROUTES[0].id))
  await expect(form.getByRole('option', { name: 'Merkez Hattı' })).toHaveCount(1)
  await expect(form.getByRole('option', { name: 'Sahil Hattı' })).toHaveCount(0)
  await form.getByLabel('Durak Adı').fill('Yeni Durak')
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click()

  await expect.poll(() => state.created.length).toBe(1)
  expect(state.created[0].routeId).toBe(ROUTES[0].id)
  expect(state.created[0].longitude).toBeCloseTo(MAP_CENTER.longitude, 5)
  expect(state.created[0].latitude).toBeCloseTo(MAP_CENTER.latitude, 5)
  await expect.poll(() => state.routeReads).toBeGreaterThan(initialRouteReads)
  await expect.poll(() => state.stopReads).toBeGreaterThan(initialStopReads)
  await expect.poll(() => layerHasPaint(page, '.transport-route-layer')).toBe(true)

  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Durak bilgisi' })).toContainText('Yeni Durak')
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

test('failed save creates no permanent ghost and cleanup removes the controlled pending marker', async ({ page }) => {
  const state = await openMap(page, [MAP_VIEW, TRANSPORT_VIEW, TRANSPORT_STOP_CREATE], {
    routes: [ROUTES[0]],
    stops: [],
    createStatus: 400,
  })

  await stopTool(page).click()
  await clickMap(page)
  const form = stopForm(page)
  await form.getByLabel('Durak Adı').fill('Kaydedilemeyen Durak')
  await form.getByRole('button', { name: 'Kaydet', exact: true }).click()

  await expect(form.getByRole('alert')).toHaveText('Durak kaydedilemedi.')
  expect(state.stops).toHaveLength(0)
  expect(await layerHasPaint(page, '.transport-stop-layer')).toBe(false)
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
