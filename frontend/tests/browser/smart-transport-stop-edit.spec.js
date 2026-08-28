import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { buildMyStopView, MY_STOP_SORT_OPTIONS } from '../../src/map/myStopsFilters.js'
import { createTransportLayers, transportFeatures } from '../../src/map/transport.js'
import { persistStopThenMaybeGenerate } from '../../src/services/transportStopWorkflow.js'

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
  const [page, api, workflow] = await Promise.all([
    source('../../src/pages/MapPage.jsx'),
    source('../../src/services/transportApi.js'),
    source('../../src/services/transportStopWorkflow.js'),
  ])
  const apiStart = api.indexOf('export function updateTransportStop')
  expect(apiStart).toBeGreaterThanOrEqual(0)
  const updateContract = api.slice(apiStart, api.indexOf('\n}', apiStart) + 2)
  expect(updateContract).toContain('authFetch(`/api/transport/stops/${id}`')
  expect(updateContract).toContain("method: 'PUT'")
  expect(updateContract).toContain('JSON.stringify({ name, routeId, longitude, latitude })')

  const saveStart = page.indexOf('const saveTransportStopEdit')
  const saveFlow = page.slice(saveStart, page.indexOf('const requestTransportStopDelete', saveStart))
  expect(saveStart).toBeGreaterThanOrEqual(0)
  expect(saveFlow).toContain('const result = await persistStopThenMaybeGenerate({')
  expect(saveFlow).toContain('save: () => updateTransportStop(target.id, payload)')
  expect(saveFlow).toContain('routeId: payload.routeId')
  expect(saveFlow).toContain('generatePath,')
  expect(saveFlow).toContain('sourceRouteId: target.routeId')
  expect(saveFlow).toContain('generateTransferredRoutes: allowed.canUpdateTransportRoute')
  expect(saveFlow).toContain('reloadTransport: transport.refresh')
  expect(saveFlow).toContain("saveFailureMessage: 'Durak güncellenemedi.'")
  expect(saveFlow).toContain('if (!result.canonicalRefreshed || result.generationAttempted || result.refreshError)')
  expect(saveFlow).toContain('result.affectedRouteOutcomes.filter((outcome) => outcome.attempted && !outcome.generated)')
  expect(saveFlow).toContain('`${outcome.routeName}: ${outcome.error}`')
  expect(saveFlow).toContain('Durak taşındı ancak bazı güzergâh rotaları yeniden hesaplanamadı.')
  expect(saveFlow).toContain('Durak taşındı, etkilenen güzergâh rotaları yeniden hesaplandı.')
  expect(saveFlow).toContain('Durak başka güzergaha taşındı.')

  const workflowCall = saveFlow.indexOf('await persistStopThenMaybeGenerate({')
  const transportRefresh = saveFlow.indexOf('await transport.refresh()')
  const ownStopsRefresh = saveFlow.indexOf('await myStops.reload()')
  const catchStart = saveFlow.indexOf('} catch (error) {')
  const catchFlow = saveFlow.slice(catchStart, saveFlow.indexOf('} finally {', catchStart))
  expect(transportRefresh).toBeGreaterThan(workflowCall)
  expect(ownStopsRefresh).toBeGreaterThan(transportRefresh)
  expect(catchFlow).toContain('cancelTransportStopRelocation()')
  expect(catchFlow).toContain('setTransportStopEditVersion((value) => value + 1)')
  expect(catchFlow).not.toContain('transport.refresh()')

  expect(workflow).toContain('if (!response.ok) {')
  expect(workflow).toContain('throw new Error(await readApiError(response, saveFailureMessage))')
  const transferDecision = workflow.slice(
    workflow.indexOf('const canonicalSourceRouteId'),
    workflow.indexOf('if (!generatePath)', workflow.indexOf('const canonicalSourceRouteId')),
  )
  expect(transferDecision).toContain('canonicalSourceRouteId !== destinationRouteId')
  expect(transferDecision).toContain('snapshot = await reloadTransport?.()')
  expect(transferDecision).toContain('routeIds: [canonicalSourceRouteId, destinationRouteId]')
  expect(transferDecision).toContain('permitted: generateTransferredRoutes')
  expect(workflow).toContain('const uniqueRouteIds = [...new Set(')
  let generations = 0
  let saveError = null
  try {
    await persistStopThenMaybeGenerate({
      save: async () => new Response(JSON.stringify({ message: 'Durak reddedildi.' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
      routeId: 7,
      generatePath: true,
      generate: async () => {
        generations += 1
        return new Response(JSON.stringify({ routeId: 7 }), { status: 200 })
      },
      saveFailureMessage: 'Durak güncellenemedi.',
    })
  } catch (error) {
    saveError = error
  }
  expect(saveError?.message).toBe('Durak reddedildi.')
  expect(generations).toBe(0)
})

test('delete uses the shared regeneration workflow and leaves sequence compaction to the backend', async () => {
  const [page, adminMap] = await Promise.all([
    source('../../src/pages/MapPage.jsx'),
    source('../../src/components/admin/TransportManagementMap.jsx'),
  ])
  expect(page).toContain('pendingTransportStopDelete')
  expect(page).toContain('onConfirm={confirmTransportStopDelete}')
  expect(page).toContain('await deleteStopThenMaybeGenerate({')
  expect(page).toContain('remove: () => deleteTransportStop(stop.id)')
  expect(page).toContain('generatePath: allowed.canUpdateTransportRoute')
  expect(page).toContain('reloadTransport: transport.refresh')
  expect(adminMap).toContain('remove: () => deleteTransportStop(selectedStop.id)')
  expect(adminMap).toContain('generatePath: canUpdateRoute')
  expect(adminMap).toContain('reloadTransport: refreshTransport')
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
