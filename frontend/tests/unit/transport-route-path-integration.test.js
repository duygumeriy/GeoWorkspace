import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')
const api = read('../../src/services/transportApi.js')
const hook = read('../../src/hooks/useTransportLayer.js')
const page = read('../../src/pages/admin/TransportRoutePage.jsx')
const mapPage = read('../../src/pages/MapPage.jsx')
const trashHook = read('../../src/hooks/useTrash.js')
const stopWorkflow = read('../../src/services/transportStopWorkflow.js')
const layers = read('../../src/components/map/LayersPanel.jsx')
const managementMap = read('../../src/components/admin/TransportManagementMap.jsx')

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, `missing source section start: ${startMarker}`)
  assert.ok(end > start, `missing source section end: ${endMarker}`)
  return source.slice(start, end)
}

test('transport path API uses only authenticated backend endpoints with no OSRM request construction', () => {
  assert.match(api, /authFetch\(`\/api\/transport\/routes\/\$\{routeId\}\/path\/generate`, \{ method: 'POST' \}\)/)
  assert.match(api, /authFetch\(`\/api\/transport\/routes\/\$\{routeId\}\/path`\)/)
  assert.match(api, /authFetch\('\/api\/transport\/routes\/paths'\)/)
  for (const forbidden of ['BaseUrl', 'baseUrl', 'waypoints', 'router.project-osrm.org', 'localhost:5000']) {
    assert.ok(!api.includes(forbidden), `browser transport client exposed ${forbidden}`)
  }
})

test('the map flow performs one set-based path request rather than a path request per route', () => {
  assert.match(hook, /fetchTransportRoutePaths\(\)/)
  assert.ok(!/nextRoutes\.map\(.*fetchTransportRoutePath/s.test(hook))
})

test('Admin route filtering consumes the existing map snapshot without a duplicate path fetch', () => {
  assert.match(hook, /onSnapshot\?\.\(snapshot\)/)
  assert.match(managementMap, /onSnapshot:\s*onTransportSnapshot/)
  assert.match(page, /onTransportSnapshot=\{receiveTransportSnapshot\}/)
  assert.doesNotMatch(page, /fetchTransportRoutePaths/)
})

test('route generation is gated by transport.route.update and by two loaded stops', () => {
  assert.match(page, /const canUpdate = can\(PERMISSIONS\.TRANSPORT_ROUTE_UPDATE\)/)
  assert.match(page, /\{canUpdate && \(/)
  assert.match(page, /disabled=\{stops\.length < 2 \|\| stopsLoading \|\| pathLoading \|\| generatingPath\}/)
  assert.match(page, /en az 2 durak gerekli/)
  assert.ok(!/Administrator|roleName|isAdmin/.test(page))
})

test('generation loading blocks duplicate POSTs and success refreshes detail plus map data', () => {
  assert.match(page, /if \(!selectedRoute \|\| stops\.length < 2 \|\| generatingPath \|\| !canUpdate\) return/)
  assert.match(page, /setGeneratingPath\(true\)/)
  assert.match(page, /await loadPath\(selectedRoute\.id\)/)
  assert.match(page, /setMapRefreshVersion\(\(value\) => value \+ 1\)/)
  assert.match(page, /Rota hesaplandı ve harita güncellendi/)
})

test('safe backend generation failures are shown without browser-side infrastructure details', () => {
  assert.match(page, /readApiError\(response, 'Rota hesaplanamadı\.'\)/)
  assert.match(page, /role="alert"/)
  assert.ok(!/OSRM|Docker|BaseUrl|profile/.test(page))
})

test('all route path states, metadata, and stale regeneration action are represented', () => {
  for (const text of [
    'Oluşturulmadı',
    'Güncel değil',
    'Rotayı Güncelle',
    'Toplam Mesafe',
    'Tahmini Süre',
    'Durak Sayısı',
    'Son Hesaplama',
    'Durum',
  ]) {
    assert.ok(page.includes(text) || read('../../src/map/transportPathPresentation.js').includes(text), `missing ${text}`)
  }
  assert.match(page, /lastFailureReason/)
  assert.match(page, /eski yol geometrisi haritada gösterilmiyor/)
})

test('successful reorder refetches the path and keeps the new order when regeneration is stale', () => {
  const success = page.slice(page.indexOf("const response = await reorderTransportRouteStops"), page.indexOf('} catch (error)', page.indexOf("const response = await reorderTransportRouteStops")))
  assert.match(success, /await loadStops\(selectedId\)/)
  assert.match(success, /await loadPath\(selectedId\)/)
  assert.match(success, /refreshedPath\?\.isStale/)
  assert.match(success, /Durak sırası güncellendi ancak rota yeniden hesaplanamadı/)
  assert.ok(!success.includes('setStops(previous)'))
})

test('rejected reorder alone restores the previous stop order', () => {
  const reorder = sourceSection(page, 'const saveStopOrder', 'const dropStop')
  const snapshot = reorder.match(/const\s+(\w+)\s*=\s*stops/)
  assert.ok(snapshot, 'reorder must capture the pre-mutation stop order')

  const optimisticOrder = reorder.indexOf('setStops(numbered)')
  const rejectedResponse = reorder.indexOf("if (!response.ok) throw new Error")
  const canonicalReload = reorder.indexOf('await loadStops(selectedId)')
  const catchStart = reorder.indexOf('} catch (error)')
  const finallyStart = reorder.indexOf('} finally', catchStart)
  assert.ok(optimisticOrder > snapshot.index)
  assert.ok(rejectedResponse > optimisticOrder)
  assert.ok(canonicalReload > rejectedResponse && canonicalReload < catchStart)

  const rejected = reorder.slice(catchStart, finallyStart)
  assert.match(rejected, new RegExp(`setStops\\(${snapshot[1]}\\)`))
  assert.match(rejected, /setNotice\(\{ type: 'error'/)
  assert.doesNotMatch(rejected, /loadPath\(|setMapRefreshVersion|type: 'success'/)
})

test('stop creation and management map mutation refresh both selected path status and global path data', () => {
  const parentRefresh = sourceSection(page, 'const transportChanged', 'const focusManagedStop')
  assert.match(parentRefresh, /await Promise\.all\(\[/)
  assert.match(parentRefresh, /loadRoutes\(\)/)
  assert.match(parentRefresh, /loadStops\(selectedId\)/)
  assert.match(parentRefresh, /loadPath\(selectedId\)/)
  assert.match(parentRefresh, /managementView === 'stops' \? loadManagedStops\(\) : null/)
  assert.equal((parentRefresh.match(/loadManagedStops\(\)/g) ?? []).length, 1)
  assert.match(page, /onTransportChanged=\{transportChanged\}/)

  const managedLoader = sourceSection(page, 'const loadManagedStops', 'const loadStops')
  assert.match(managedLoader, /Promise\.all\(\[/)
  assert.match(managedLoader, /fetchTransportStops\(\)/)
  assert.match(managedLoader, /canRestoreStop \? fetchDeletedManagedTransportStops\(\) : null/)
  assert.doesNotMatch(managedLoader, /fetchTransportRouteStops|\.map\([^)]*fetch/)

  const createFlow = sourceSection(managementMap, 'const save = async', 'const saveSelectedStop')
  assert.match(createFlow, /await onTransportChanged\?\.\(\)/)
  assert.match(createFlow, /await refreshTransport\(\)/)

  const editFlow = sourceSection(managementMap, 'const saveSelectedStop', 'const removeSelectedStop')
  assert.match(editFlow, /reloadTransport:\s*refreshTransport/)
  assert.match(editFlow, /result\.generationAttempted/)
  assert.match(editFlow, /await refreshTransport\(\)/)
  assert.match(editFlow, /await onTransportChanged\?\.\(\)/)

  const deleteFlow = sourceSection(managementMap, 'const removeSelectedStop', 'return (')
  assert.match(deleteFlow, /deleteStopThenMaybeGenerate\(/)
  assert.match(deleteFlow, /reloadTransport:\s*refreshTransport/)
  assert.match(deleteFlow, /await onTransportChanged\?\.\(\)/)
  assert.match(deleteFlow, /result\.generationAttempted\) await refreshTransport\(\)/)
})

test('global stop create, delete, move or transfer, and restore use the same path-aware refresh', () => {
  assert.ok((mapPage.match(/await transport\.refresh\(\)/g) ?? []).length >= 4)

  const editStart = mapPage.indexOf('const saveTransportStopEdit')
  const editEnd = mapPage.indexOf('const requestTransportStopDelete', editStart)
  assert.ok(editStart >= 0 && editEnd > editStart)
  const editFlow = mapPage.slice(editStart, editEnd)
  assert.match(editFlow, /sourceRouteId:\s*target\.routeId/)
  assert.match(editFlow, /generateTransferredRoutes:\s*allowed\.canUpdateTransportRoute/)
  assert.match(editFlow, /reloadTransport:\s*transport\.refresh/)
  assert.match(editFlow, /result\.generationAttempted[\s\S]*await transport\.refresh\(\)[\s\S]*await myStops\.reload\(\)/)

  const sharedPersistStart = stopWorkflow.indexOf('export async function persistStopThenMaybeGenerate')
  const sharedPersistEnd = stopWorkflow.indexOf('export async function deleteStopThenMaybeGenerate', sharedPersistStart)
  assert.ok(sharedPersistStart >= 0 && sharedPersistEnd > sharedPersistStart)
  const sharedPersist = stopWorkflow.slice(sharedPersistStart, sharedPersistEnd)
  const transferDetection = sharedPersist.indexOf('canonicalSourceRouteId !== destinationRouteId')
  const canonicalTransferRefresh = sharedPersist.indexOf('snapshot = await reloadTransport?.()')
  const affectedGeneration = sharedPersist.indexOf('await generateAffectedRoutes({')
  assert.ok(transferDetection >= 0)
  assert.ok(canonicalTransferRefresh > transferDetection)
  assert.ok(affectedGeneration > canonicalTransferRefresh)
  assert.match(sharedPersist, /routeIds:\s*\[canonicalSourceRouteId, destinationRouteId\]/)

  const trashIntegrationStart = mapPage.indexOf('const trash = useTrash({')
  const trashIntegrationEnd = mapPage.indexOf('/** Box / area selection', trashIntegrationStart)
  assert.ok(trashIntegrationStart >= 0 && trashIntegrationEnd > trashIntegrationStart)
  const trashIntegration = mapPage.slice(trashIntegrationStart, trashIntegrationEnd)
  assert.match(trashIntegration, /reloadTransport:\s*transport\.refresh/)
  assert.match(trashIntegration, /canUpdateTransportRoute:\s*allowed\.canUpdateTransportRoute/)
  assert.match(trashIntegration, /onTransportRestored:/)
  assert.match(trashIntegration, /result\?\.generationAttempted[\s\S]*await transport\.refresh\(\)/)

  const stopRestoreStart = trashHook.indexOf('if (isTransportStop) {')
  const stopRestoreEnd = trashHook.indexOf('} else if (!res.ok)', stopRestoreStart)
  assert.ok(stopRestoreStart >= 0 && stopRestoreEnd > stopRestoreStart)
  const stopRestore = trashHook.slice(stopRestoreStart, stopRestoreEnd)
  assert.match(stopRestore, /restoreStopThenMaybeGenerate\(/)
  assert.match(stopRestore, /restore:\s*\(\) => restoreTransportStop\(id\)/)
  assert.match(stopRestore, /generatePath:\s*canUpdateTransportRoute/)
  assert.match(stopRestore, /reloadTransport/)

  const sharedRestoreStart = stopWorkflow.indexOf('export async function restoreStopThenMaybeGenerate')
  const sharedRestore = stopWorkflow.slice(sharedRestoreStart)
  assert.ok(sharedRestoreStart >= 0)
  const canonicalRefresh = sharedRestore.indexOf('snapshot = await reloadTransport?.()')
  const routabilityDecision = sharedRestore.indexOf('if (!generatePath || activeStopCount < 2)')
  const generation = sharedRestore.indexOf('await generateRouteSafely(routeId, generate)')
  assert.ok(canonicalRefresh >= 0)
  assert.ok(routabilityDecision > canonicalRefresh)
  assert.ok(generation > routabilityDecision)
})

test('master and child route toggles are independent from the stop toggle', () => {
  assert.match(mapPage, /hiddenTransportRouteIds/)
  assert.match(mapPage, /onToggleTransportRoute=\{toggleTransportRoute\}/)
  assert.match(mapPage, /onToggleTransportStops=\{\(\) => setTransportStopsVisible/)
  assert.match(layers, /aria-label="Güzergah görünürlüğü"/)
  assert.match(layers, /onToggleTransportRoute\?\.\(route\.id\)/)
  assert.match(layers, /transport\.routes\.map/)
})

test('the child list reflects active accessible routes already loaded by transport.view', () => {
  assert.match(hook, /filter\(\(route\) => route\.isActive === true\)/)
  assert.match(mapPage, /permitted: allowed\.canViewTransport/)
  assert.match(mapPage, /routes: transport\.routes\.map/)
  assert.match(layers, /\{transport\?\.permitted &&/)
})
