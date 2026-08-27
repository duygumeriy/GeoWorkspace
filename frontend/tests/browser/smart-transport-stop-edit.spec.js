import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { buildMyStopView, MY_STOP_SORT_OPTIONS } from '../../src/map/myStopsFilters.js'
import { createTransportLayers, transportFeatures } from '../../src/map/transport.js'

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const STOPS = [
  { id: 2, routeId: 1, routeName: 'Merkez Hattı', name: 'Çarşı', longitude: 32.85, latitude: 39.93, sequenceOrder: 2 },
  { id: 1, routeId: 1, routeName: 'Merkez Hattı', name: 'Atatürk', longitude: 32.84, latitude: 39.92, sequenceOrder: 1 },
  { id: 3, routeId: 2, routeName: 'Sahil Hattı', name: 'İskele', longitude: 29, latitude: 41, sequenceOrder: 1 },
]

test('stop popup exposes navigation and permission-gated mutation actions', async () => {
  const popup = await source('../../src/components/map/TransportStopPopup.jsx')
  expect(popup).toContain('Durağa Zoom Yap')
  expect(popup).toContain('Güzergahı Göster')
  expect(popup).toContain('{canEdit &&')
  expect(popup).toContain('{canDelete &&')
  expect(popup).toContain('Durak Adı')
  expect(popup).toContain('Konum')
})

test('popup and Duraklarım reuse one stop editor and permission codes, never roles', async () => {
  const [page, panel] = await Promise.all([
    source('../../src/pages/MapPage.jsx'),
    source('../../src/components/map/MyStopsPanel.jsx'),
  ])
  expect(page.match(/onEdit=\{editTransportStop\}/g)).toHaveLength(2)
  expect(page).toContain('<TransportStopEditForm')
  expect(page).toContain('canEdit={allowed.canUpdateTransportStop}')
  expect(panel).toContain('canEdit &&')
  expect(`${page}${panel}`).not.toMatch(/role\s*===/)
})

test('stop editor supports route, manual EPSG:4326 coordinates and map relocation', async () => {
  const form = await source('../../src/components/map/TransportStopEditForm.jsx')
  expect(form).toContain('Güzergah')
  expect(form).toContain('Longitude')
  expect(form).toContain('min="-180"')
  expect(form).toContain('max="180"')
  expect(form).toContain('Latitude')
  expect(form).toContain('min="-90"')
  expect(form).toContain('max="90"')
  expect(form).toContain('Haritada Taşı')
  expect(form).toContain('Taşımayı İptal Et')
})

test('relocation owns one preview layer and cleans its exact map listener', async () => {
  const relocation = await source('../../src/hooks/useTransportStopRelocation.js')
  expect(relocation).toContain('createTransportRelocationLayer()')
  expect(relocation).toContain("map.on('singleclick', handleClick)")
  expect(relocation).toContain("map.un('singleclick', handleClick)")
  expect(relocation).toContain('source?.clear()')
  expect(relocation).toContain('clearPending')
})

test('save uses the existing PUT contract and failure retires relocation preview', async () => {
  const [page, api] = await Promise.all([
    source('../../src/pages/MapPage.jsx'),
    source('../../src/services/transportApi.js'),
  ])
  expect(api).toContain("method: 'PUT'")
  expect(api).toContain('JSON.stringify({ name, routeId, longitude, latitude })')
  expect(page).toContain('await updateTransportStop(target.id, payload)')
  expect(page).toContain('cancelTransportStopRelocation()')
  expect(page).toContain("readApiError(response, 'Durak güncellenemedi.')")
  expect(page).toContain('await transport.refresh()')
  expect(page).toContain('await myStops.reload()')
})

test('delete uses confirmation and leaves sequence compaction to the backend', async () => {
  const page = await source('../../src/pages/MapPage.jsx')
  expect(page).toContain('pendingTransportStopDelete')
  expect(page).toContain('onConfirm={confirmTransportStopDelete}')
  expect(page).toContain('await deleteTransportStop(stop.id)')
  const start = page.indexOf('const confirmTransportStopDelete')
  const deleteFlow = page.slice(start, page.indexOf('useEffect(() =>', start))
  expect(deleteFlow).not.toContain('sequenceOrder')
})

test('Duraklarım search, route filter, sorting, clear and count compose', () => {
  expect(buildMyStopView(STOPS, { search: 'merkez', routeId: '1', sort: 'name-asc' }).map((stop) => stop.name)).toEqual(['Atatürk', 'Çarşı'])
  expect(buildMyStopView(STOPS, { sort: 'name-desc' }).map((stop) => stop.name)).toEqual(['İskele', 'Çarşı', 'Atatürk'])
  expect(buildMyStopView(STOPS, { sort: 'route-order' }).map((stop) => stop.id)).toEqual([1, 2, 3])
  expect(MY_STOP_SORT_OPTIONS.map((option) => option.label)).toEqual(['Güzergah Sırası', 'Durak Adı A-Z', 'Durak Adı Z-A'])
})

test('opening Duraklarım has no fit side effect while selecting a stop focuses and opens the existing popup', async () => {
  const [panel, page] = await Promise.all([
    source('../../src/components/map/MyStopsPanel.jsx'),
    source('../../src/pages/MapPage.jsx'),
  ])
  expect(panel).not.toContain('.fit(')
  expect(page).toContain('mapView.focusPoint(fromLonLat([stop.longitude, stop.latitude]))')
  expect(page).toContain('mapContext.activate(MAP_CONTEXTS.transportStopInfo)')
  expect(page).toContain('<TransportStopPopup')
})

test('a focused stop is temporarily visible without changing the hidden-layer preference', () => {
  let visible = false
  const { stopLayer } = createTransportLayers(() => 1, () => null, () => true, () => visible)
  const feature = transportFeatures([{ id: 1, name: 'Hat', colorHex: '#6D4AFF' }], [STOPS[1]]).stopFeatures[0]
  expect(stopLayer.getStyleFunction()(feature, 1)).toBeTruthy()
  expect(visible).toBe(false)
})

test('route geometry remains ordered by sequence and is re-derived after updates', () => {
  const routes = [{ id: 1, name: 'Hat', colorHex: '#6D4AFF' }]
  const reordered = [{ ...STOPS[1], sequenceOrder: 3 }, { ...STOPS[0], sequenceOrder: 1 }]
  const feature = transportFeatures(routes, reordered).routeFeatures[0]
  expect(feature.getGeometry().getCoordinates()).toHaveLength(2)
  expect(feature.get('routeId')).toBe(1)
  expect(reordered.map((stop) => stop.name)).toEqual(['Atatürk', 'Çarşı'])
})
