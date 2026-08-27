import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { searchGlobalRecords } from '../../src/map/globalSearch.js'

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8')
const data = {
  drawings: [{ key: 'polygon:1', name: 'Yetki Alanı', type: 'polygon' }],
  stops: [{ id: 3, name: 'Cumhuriyet Durağı', routeName: 'Merkez Hattı', routeId: 7 }],
  routes: [{ id: 7, name: 'Merkez Hattı', stopCount: 1 }],
}

test('global search has a type selector and type-specific placeholder', async () => {
  const search = await source('../../src/components/map/PoiSearchBar.jsx')
  expect(search).toContain('aria-label="Arama türü"')
  expect(search).toContain('availableTypes.map')
  expect(search).toContain('placeholder={`${selectedType?.label')
})

test('available search types are driven only by exact read permissions', async () => {
  const page = await source('../../src/pages/MapPage.jsx')
  expect(page).toContain('allowed.canViewPoi')
  expect(page).toContain('allowed.canViewDrawings')
  expect(page).toContain('allowed.canViewTransport')
  expect(page).toContain("{ id: 'stop', label: 'Durak' }")
  expect(page).toContain("{ id: 'route', label: 'Güzergah' }")
  expect(page).not.toMatch(/role\s*===/)
})

test('local drawing, stop and route search only queries the selected type', () => {
  expect(searchGlobalRecords('drawing', 'yetki', data)).toEqual(data.drawings)
  expect(searchGlobalRecords('stop', 'merkez', data)).toEqual(data.stops)
  expect(searchGlobalRecords('route', 'MERKEZ', data)).toEqual(data.routes)
  expect(searchGlobalRecords('drawing', 'cumhuriyet', data)).toEqual([])
})

test('POI search preserves the existing endpoint and result badge', async () => {
  const [hook, search] = await Promise.all([
    source('../../src/hooks/useGlobalMapSearch.js'),
    source('../../src/components/map/PoiSearchBar.jsx'),
  ])
  expect(hook).toContain("type === 'poi'")
  expect(hook).toContain('usePoiSearch')
  expect(search).toContain('<PoiCategoryBadge')
})

test('result selection focuses the actual feature architecture for every type', async () => {
  const page = await source('../../src/pages/MapPage.jsx')
  expect(page).toContain("result.searchType === 'drawing'")
  expect(page).toContain('workspace.selectFeature(result.key)')
  expect(page).toContain("result.searchType === 'stop'")
  expect(page).toContain('focusMyStop(result)')
  expect(page).toContain("result.searchType === 'route'")
  expect(page).toContain('showTransportRoute(result.id)')
  expect(page).toContain('mapView.focusPoi')
})

test('route focus handles zero, one and complete multi-stop geometry without persisting geometry', async () => {
  const page = await source('../../src/pages/MapPage.jsx')
  expect(page).toContain('routeStops.length === 0')
  expect(page).toContain('routeStops.length === 1')
  expect(page).toContain('boundingExtent(routeStops.map')
  expect(page).not.toContain('updateTransportRouteGeometry')
})

test('search control remains compact and responsive', async () => {
  const css = await source('../../src/components/map/PoiSearchBar.css')
  expect(css).toContain('.global-search-type')
  expect(css).toContain('@media (max-width: 640px)')
  expect(css).toContain('max-height: min(60vh, 22rem)')
})
