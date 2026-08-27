import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'

const source = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('all transport mutations use the existing activity allow-list', async () => {
  const registry = await source('../../../backend/src/StajProject.Api/Activity/ActivityActionRegistry.cs')
  for (const action of ['CreateRoute', 'UpdateRoute', 'DeleteRoute', 'RestoreRoute', 'ReorderStops', 'CreateStop', 'UpdateStop', 'DeleteStop', 'RestoreStop']) {
    expect(registry).toContain(`["Transport.${action}"]`)
  }
  for (const read of ['GetRoutes', 'GetRouteStops', 'GetOwnStops', 'GetRouteTrash', 'GetStopTrash']) {
    expect(registry).not.toContain(`["Transport.${read}"]`)
  }
})

test('activity catalog supplies user-friendly Turkish transport descriptions', async () => {
  const catalog = await source('../../../backend/src/StajProject.Domain/Common/ActivityActionCatalog.cs')
  for (const label of ['Güzergah oluşturuldu', 'Güzergah güncellendi', 'Güzergah silindi', 'Güzergah geri yüklendi', 'Durak sırası güncellendi', 'Durak oluşturuldu', 'Durak güncellendi', 'Durak silindi', 'Durak geri yüklendi']) {
    expect(catalog).toContain(label)
  }
})

test('Activity History renders meaningful route and stop resource labels without changing POI labels', async () => {
  const page = await source('../../src/pages/admin/ActivityPage.jsx')
  expect(page).toContain("transport_route: 'Güzergah'")
  expect(page).toContain("transport_stop: 'Durak'")
  expect(page).toContain("poi: 'POI'")
  expect(page).toContain('item.actorUsername')
  expect(page).toContain('item.resourceId')
})
