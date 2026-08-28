import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { buildMyStopView, myStopRouteOptions } from '../../src/map/myStopsFilters.js'
import { createTransportLayers, transportFeatures } from '../../src/map/transport.js'

const OWN = { id: 11, routeId: 1, routeName: 'Kampüs Hattı', routeColor: '#123456', name: 'Üniversite Durağı', longitude: 32.85, latitude: 39.93, sequenceOrder: 1 }
const OTHER_ROUTE = { id: 12, routeId: 2, routeName: 'Sahil Hattı', routeColor: '#654321', name: 'İskele', longitude: 29, latitude: 41, sequenceOrder: 2 }
const source = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('Duraklarım reuses the existing sidebar, MapSheet and map-context architecture', async () => {
  const [sidebar, contexts, panel] = await Promise.all([source('../../src/components/map/Sidebar.jsx'), source('../../src/map/mapContexts.js'), source('../../src/components/map/MyStopsPanel.jsx')])
  expect(sidebar).toContain("id: 'myStops'")
  expect(contexts).toContain("myStops: 'myStops'")
  expect(panel).toContain('<MapSheet')
  expect(panel).not.toContain('<aside')
})

test('menu and actions are permission based without a runtime role-name dependency', async () => {
  const [page, sidebar] = await Promise.all([source('../../src/pages/MapPage.jsx'), source('../../src/components/map/Sidebar.jsx')])
  expect(page).toContain('const canOpenMyStops = allowed.canViewTransport')
  expect(page).toContain('canDelete={allowed.canDeleteTransportStop}')
  expect(`${page}${sidebar}`).not.toMatch(/role\s*===\s*["']/)
})

test('mine endpoint is server scoped and client create has no owner field', async () => {
  const [api, hook] = await Promise.all([source('../../src/services/transportApi.js'), source('../../src/hooks/useMyStops.js')])
  expect(api).toContain("authFetch('/api/transport/stops/mine')")
  expect(api).toContain('JSON.stringify({ name, routeId, longitude, latitude })')
  expect(hook).toContain('fetchOwnTransportStops()')
  expect(hook).not.toMatch(/filter\([^)]*(user|owner)/i)
})

test('search matches stop and route names case-insensitively', () => {
  expect(buildMyStopView([OWN, OTHER_ROUTE], { search: 'ünİVERSİTE' })).toEqual([OWN])
  expect(buildMyStopView([OWN, OTHER_ROUTE], { search: 'kampüs' })).toEqual([OWN])
})

test('route options come from real stop data rather than hardcoded names', () => {
  expect(myStopRouteOptions([OTHER_ROUTE, OWN])).toEqual([['1', 'Kampüs Hattı'], ['2', 'Sahil Hattı']])
})

test('route filter and search compose', () => {
  const duplicate = { ...OWN, id: 13, routeId: 2, routeName: 'Sahil Hattı' }
  expect(buildMyStopView([OWN, OTHER_ROUTE, duplicate], { search: 'üniversite', routeId: '2' })).toEqual([duplicate])
})

test('empty and no-result states are distinct', async () => {
  const panel = await source('../../src/components/map/MyStopsPanel.jsx')
  expect(buildMyStopView([], {})).toEqual([])
  expect(buildMyStopView([OWN], { search: 'bulunmaz' })).toEqual([])
  expect(panel).toContain('Henüz eklediğiniz bir durak bulunmuyor.')
  expect(panel).toContain('Bu filtrelere uygun durak bulunamadı.')
})

test('selection focuses the geographic coordinate and reuses the existing popup', async () => {
  const page = await source('../../src/pages/MapPage.jsx')
  expect(page).toContain('mapView.focusPoint(fromLonLat([stop.longitude, stop.latitude]))')
  expect(page).toContain('<TransportStopPopup')
  expect(page).not.toContain('MyStopPopup')
})

test('selected stop highlight replaces the previous selection in the same layer', () => {
  let selected = 11
  const { stopLayer } = createTransportLayers(() => selected)
  const features = transportFeatures([{ id: 1, name: 'Hat', colorHex: '#123456' }], [OWN, { ...OWN, id: 14, sequenceOrder: 2 }]).stopFeatures
  const style = stopLayer.getStyleFunction()

  const stopStyleState = (feature) => {
    const styles = style(feature, 1)
    const base = styles.filter((item) => item.getText()?.getText() === String(feature.get('sequenceOrder')))
    const halos = styles.filter((item) => item.getImage() && !item.getText())
    return { base, halos }
  }

  expect(features.map((feature) => feature.get('terminal'))).toEqual(['start', 'end'])
  let first = stopStyleState(features[0])
  let second = stopStyleState(features[1])
  expect(first.base).toHaveLength(1)
  expect(second.base).toHaveLength(1)
  expect(first.base[0].getImage()).toBeTruthy()
  expect(second.base[0].getImage()).toBeTruthy()
  expect(first.halos).toHaveLength(1)
  expect(second.halos).toHaveLength(0)
  expect(first.halos[0].getImage().getRadius()).toBeGreaterThan(first.base[0].getImage().getRadius())

  selected = 14
  first = stopStyleState(features[0])
  second = stopStyleState(features[1])
  expect(first.base).toHaveLength(1)
  expect(second.base).toHaveLength(1)
  expect(first.base[0].getImage()).toBeTruthy()
  expect(second.base[0].getImage()).toBeTruthy()
  expect(first.halos).toHaveLength(0)
  expect(second.halos).toHaveLength(1)
  expect(second.halos[0].getImage().getRadius()).toBeGreaterThan(second.base[0].getImage().getRadius())
})

test('delete removes mine, refreshes transport, and leaves POI/Drawing/Location Analysis implementations isolated', async () => {
  const page = await source('../../src/pages/MapPage.jsx')
  expect(page).toContain('myStops.remove(stop.id)')
  expect(page).toContain('await transport.refresh()')
  expect(page).toContain('<MyPoisPanel')
  expect(page).toContain('<DrawingsPanel')
  expect(page).toContain('<LocationAnalysisPanel')
})
