import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { buildTrashView, trashRecordOf } from '../../src/map/trashFilters.js'
import { createTransportLayers, transportFeatures } from '../../src/map/transport.js'

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const ROUTES = [{ id: 1, name: 'Merkez', colorHex: '#123456', isActive: true }]
const STOPS = [
  { id: 1, routeId: 1, routeName: 'Merkez', name: 'Bir', longitude: 32.8, latitude: 39.9, sequenceOrder: 1 },
  { id: 2, routeId: 1, routeName: 'Merkez', name: 'İki', longitude: 32.9, latitude: 40, sequenceOrder: 2 },
]

test('transport records use the existing Trash panel and filters', async () => {
  const [page, trash] = await Promise.all([source('../../src/pages/MapPage.jsx'), source('../../src/components/map/TrashPanel.jsx')])
  expect(page.match(/<TrashPanel/g)).toHaveLength(1)
  expect(trash).toContain("item.type === 'transport-stop'")
  expect(trash).toContain("item.type === 'transport-route'")
})

test('personal deleted stop source is backend scoped and other users are not filtered in React', async () => {
  const [hook, api] = await Promise.all([source('../../src/hooks/useTrash.js'), source('../../src/services/transportApi.js')])
  expect(api).toContain("authFetch('/api/transport/stops/trash')")
  expect(hook).toContain('fetchDeletedTransportStops()')
  expect(hook).not.toMatch(/stop\.(userId|ownerId)\s*===/)
})

test('trash understands deleted stop and route records', () => {
  const stop = { type: 'transport-stop', stop: { id: 4, name: 'Durak' }, deletedAt: '2026-08-26T10:00:00Z' }
  const route = { type: 'transport-route', route: { id: 5, name: 'Hat' }, deletedAt: '2026-08-26T11:00:00Z' }
  expect(trashRecordOf(stop).name).toBe('Durak')
  expect(buildTrashView([stop, route], { type: 'transport-route' }).items).toEqual([route])
})

test('stop restore uses the shared regeneration workflow while route restore stays independent', async () => {
  const [api, hook, page, workflow] = await Promise.all([
    source('../../src/services/transportApi.js'),
    source('../../src/hooks/useTrash.js'),
    source('../../src/pages/MapPage.jsx'),
    source('../../src/services/transportStopWorkflow.js'),
  ])
  expect(api).toContain('`/api/transport/stops/${id}/restore`')
  expect(api).toContain('`/api/transport/routes/${id}/restore`')
  expect(hook).toContain('stopRestoreResult = await restoreStopThenMaybeGenerate({')
  expect(hook).toContain('restore: () => restoreTransportStop(id)')
  expect(hook).toContain('generatePath: canUpdateTransportRoute')
  expect(hook).toContain('reloadTransport,')
  expect(hook).toContain('restoreTransportRoute(id)')
  expect(workflow).toContain('export async function restoreStopThenMaybeGenerate({')
  expect(page).toContain('reloadTransport: transport.refresh')
  expect(page).toContain('canUpdateTransportRoute: allowed.canUpdateTransportRoute')
  expect(page).toContain("type === 'transport-route' || result?.generationAttempted || result?.refreshError")
  expect(page).toContain('await myStops.reload()')
})

test('route restore remains independent from child-stop restore and role names', async () => {
  const [api, page] = await Promise.all([source('../../src/services/transportApi.js'), source('../../src/pages/MapPage.jsx')])
  expect(api).not.toContain('restoreTransportRouteStops')
  expect(page).not.toMatch(/role\s*===\s*["']/)
})

test('existing Layers panel owns native transport record groups', async () => {
  const [page, layers] = await Promise.all([source('../../src/pages/MapPage.jsx'), source('../../src/components/map/LayersPanel.jsx')])
  expect(page.match(/<LayersPanel/g)).toHaveLength(1)
  expect(layers).toContain('Güzergâhlar')
  expect(layers).toContain('Duraklar')
})

test('Güzergahlar toggle hides and restores route line styles without refetch', () => {
  let visible = true
  const { routeLayer, routeSource } = createTransportLayers(() => null, () => null, () => visible)
  routeSource.addFeatures(transportFeatures(ROUTES, STOPS).routeFeatures)
  const feature = routeSource.getFeatures()[0]
  expect(routeLayer.getStyleFunction()(feature, 1)).toBeTruthy()
  visible = false
  expect(routeLayer.getStyleFunction()(feature, 1)).toBeUndefined()
  expect(routeSource.getFeatures()).toHaveLength(1)
})

test('individual Duraklar visibility hides a marker even when its selection remains', () => {
  let selected = null
  const hidden = new Set([1])
  const { stopLayer, stopSource } = createTransportLayers(
    () => selected, () => null, () => true, () => true, () => true, () => null,
    (id) => !hidden.has(id),
  )
  stopSource.addFeatures(transportFeatures(ROUTES, STOPS).stopFeatures)
  const [first, second] = stopSource.getFeatures()
  expect(stopLayer.getStyleFunction()(first, 1)).toBeUndefined()
  expect(stopLayer.getStyleFunction()(second, 1)).toBeTruthy()
  selected = 1
  expect(stopLayer.getStyleFunction()(first, 1)).toBeUndefined()
  expect(selected).toBe(1)
})

test('visibility state lives outside refresh and selected-route highlighting respects it', async () => {
  const [page, hook, map] = await Promise.all([source('../../src/pages/MapPage.jsx'), source('../../src/hooks/useTransportLayer.js'), source('../../src/map/transport.js')])
  expect(page).toContain('const [transportRoutesVisible, setTransportRoutesVisible] = useState(true)')
  expect(page).toContain('hiddenStopIds: layerVisibility.hiddenTransportStopIds')
  expect(hook).not.toMatch(/setTransport(Routes|Stops)Visible/)
  expect(map).toContain("if (!stopVisible(feature.get('stopId'))) return undefined")
})

test('hidden-stop placement keeps its pending layer separate and leaves POI/Location Analysis untouched', async () => {
  const [placement, page, layers] = await Promise.all([source('../../src/hooks/useTransportStopPlacement.js'), source('../../src/pages/MapPage.jsx'), source('../../src/components/map/LayersPanel.jsx')])
  expect(placement).toContain('createTransportPendingLayer')
  expect(page).toContain('hiddenTransportStopIds')
  expect(layers).toContain('data-testid="layers-poi-row"')
  expect(page).toContain('<LocationAnalysisPanel')
})
