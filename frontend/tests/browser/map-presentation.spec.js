import { expect, test } from '@playwright/test'
import { mockPermissions, VIEWER_PERMISSIONS } from './permissions.js'

/**
 * Phase 5 — WMS genel gösterimi ile WFS etkileşiminin bir arada çalışması.
 *
 * Ölçülen şey mimaridir, piksel değil: kalıcı çizimlerin NORMAL görünümünü
 * artık sunucudan gelen görüntü çizer, ama çizimlerin kimliği, seçimi ve
 * düzenlenmesi hâlâ yüklü vektör feature'ları üzerindedir. Görsel karşılaştırma
 * elle yapılır; burada doğrulanan, iki yolun birbirini yemediğidir.
 */

const USER_ID = 21

/* Düzenleme oturumu açabilen profil: tek bir PUT üç güncelleme yetkisini birden
   arar, bu yüzden "Düzenle" ancak üçü de varken görünür. */
const EDITOR_PERMISSIONS = [
  ...VIEWER_PERMISSIONS,
  'drawings.metadata.update',
  'drawings.geometry.update',
  'drawings.style.update',
]
const PRESENTATION_TYPES = ['point', 'line', 'polygon']
const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8vZVwAAAABJRU5ErkJggg==',
  'base64',
)

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })

function record(id, name, wkt) {
  return {
    id,
    name,
    wkt,
    style: { strokeColor: '#DC2626', strokeWidth: 4, fillColor: '#DC2626', fillOpacity: 0.3, pointRadius: 9, lineStyle: 'solid' },
    description: '',
    category: null,
    tags: [],
    createdDate: '2026-08-01T09:00:00Z',
    modifiedDate: '2026-08-01T09:00:00Z',
    createdBy: 'presentation-user',
    createdByUserId: USER_ID,
  }
}

/* Üç geometri BİLİNÇLİ olarak ayrık alanlardadır. Önceki hâlde çizgi tam olarak
   poligonun köşegeniydi ve nokta poligonun merkezine yakın duruyordu; haritanın
   ortasına yapılan bir tık hangi feature'ı seçeceği belirsiz olurdu. Ayrık
   yerleşim, isabet testinin ölçtüğü şeyi tek anlamlı kılar. Bunlar yalnızca bu
   spec'in taklit verisidir; üretim verisi ya da geometrisi değildir. */
const POINTS = [record(1, 'nokta1', 'POINT(31.4 39.9)')]
const LINES = [record(2, 'çizgi1', 'LINESTRING(34.0 39.8, 34.4 40.1)')]
const POLYGONS = [record(3, 'poligon1', 'POLYGON((32.6 39.8, 33.0 39.8, 33.0 40.1, 32.6 40.1, 32.6 39.8))')]

/* OpenLayers, ARDIŞIK ve aynı className'i taşıyan katmanları tek bir renderer
   kapsayıcısına/tuvaline birleştirir (`renderer/canvas/Layer.js` içindeki
   `useContainer`). Üç sunum katmanı z 7/8/9'da ardışıktır ve aynı className'i
   taşır, dolayısıyla DOM'da BİR kapsayıcı görünür. Mantıksal katman sayısı
   isteklerden okunur; 1 beklentisi aynı zamanda ikinci bir raster yığınının
   oluşmadığını da kanıtlar. */
const PRESENTATION_CONTAINERS = 1

async function prepareMap(page, {
  permissions = VIEWER_PERMISSIONS,
  presentationHandler = null,
  updateHandler = null,
} = {}) {
  const permissionState = await mockPermissions(page, permissions, { userId: USER_ID })
  const presentationRequests = []
  const foreignRequests = []

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'presentation-browser-token')
    sessionStorage.setItem('expiresAt', expiresAt)
    window.__presentationLifecycle = { aborts: 0, created: [], revoked: [] }

    const nativeAbort = AbortController.prototype.abort
    AbortController.prototype.abort = function (...args) {
      window.__presentationLifecycle.aborts += 1
      return nativeAbort.apply(this, args)
    }
    const nativeCreate = URL.createObjectURL.bind(URL)
    const nativeRevoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (blob) => {
      const url = nativeCreate(blob)
      window.__presentationLifecycle.created.push(url)
      return url
    }
    URL.revokeObjectURL = (url) => {
      window.__presentationLifecycle.revoked.push(url)
      return nativeRevoke(url)
    }
  }, new Date(Date.now() + 3_600_000).toISOString())

  /* Tarayıcı GeoServer'a DOĞRUDAN gitmemelidir. Her istek kaydedilir ve
     testin sonunda uygulamanın kendi kaynağı dışında bir hedef aranır. */
  page.on('request', (request) => {
    const url = request.url()
    if (/:8080|\/geoserver\//.test(url)) foreignRequests.push(url)
  })

  await page.route('**/api/auth/me', (route) => route.fulfill(json({
    userId: USER_ID,
    username: 'presentation-user',
    role: 'Viewer',
    roles: ['Viewer'],
  })))
  await page.route('**/api/auth/me/geographic-scope', (route) => route.fulfill(json({
    isRestricted: false,
    effectiveWkt: null,
    areaCount: 0,
  })))
  /* Çizim listesi okumaları sayılır. Sunum sürümünü artıran TEK iki yol
     kalıcı bir mutasyon (PUT/POST/DELETE) ve bir yeniden yüklemedir; ikisi de
     kendi HTTP izini bırakır. Bu sayaç, bir tazelemenin mutasyon kaynaklı
     OLMADIĞINI kanıtlamayı doğrudan gözlenebilir kılar. */
  const drawingListRequests = []
  const listRoute = (path, body) => page.route(path, (route) => {
    drawingListRequests.push(route.request().url())
    return route.fulfill(json(body))
  })
  await listRoute('**/api/drawings/points', POINTS)
  await listRoute('**/api/drawings/lines', LINES)
  await listRoute('**/api/drawings/polygons', POLYGONS)
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: PIXEL_PNG,
  }))

  await page.route('**/api/map/presentation/*', async (route) => {
    const url = new URL(route.request().url())
    presentationRequests.push({
      url,
      kind: url.pathname.split('/').pop(),
      authorization: route.request().headers().authorization ?? '',
    })
    if (presentationHandler) return presentationHandler(route, presentationRequests.length)
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })
  })

  /* Kaydetme yolu: gerçek PUT ucunun taklidi. Sunucunun döndürdüğü kayıt,
     uygulamanın haritayı sunucu cevabından yeniden kurması içindir. */
  const updateRequests = []
  await page.route('**/api/drawings/polygon/*', async (route) => {
    if (route.request().method() !== 'PUT') return route.fallback()
    updateRequests.push(route.request().url())
    if (updateHandler) return updateHandler(route, updateRequests.length)
    const body = JSON.parse(route.request().postData() ?? '{}')
    return route.fulfill(json({
      ...POLYGONS[0],
      name: body.name ?? POLYGONS[0].name,
      wkt: body.wkt ?? POLYGONS[0].wkt,
      modifiedDate: '2026-08-22T10:00:00Z',
    }))
  })

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()
  return { permissionState, presentationRequests, foreignRequests, updateRequests, drawingListRequests }
}

/** The viewport a presentation request was made for: extent plus pixel size. */
const signatureOf = (item) =>
  `${item.url.searchParams.get('bbox')}|${item.url.searchParams.get('width')}x${item.url.searchParams.get('height')}`

/**
 * Waits until the debounced presentation traffic has stopped.
 *
 * Framing a drawing, opening a panel and resizing all move the view, and each
 * legitimately refreshes every visible raster. A baseline captured before that
 * burst lands would later be read as "the action under test caused requests".
 * This is a settle barrier on an observable — the request count — not a guess
 * at how long something takes.
 */
async function settlePresentation(requests) {
  let previous = -1
  await expect
    .poll(() => {
      const stable = requests.length === previous
      previous = requests.length
      return stable
    }, { timeout: 15000, intervals: [500] })
    .toBe(true)
}

/** Per-kind request tally — the observable proof of which rasters were asked for. */
const countByKind = (requests) => ({
  point: requests.filter((item) => item.kind === 'point').length,
  line: requests.filter((item) => item.kind === 'line').length,
  polygon: requests.filter((item) => item.kind === 'polygon').length,
})

/** Selects poligon1, frames it, and opens its geometry edit session. */
async function enterPolygonEdit(page) {
  await page.getByRole('button', { name: 'Çizimlerim' }).click()
  await page.locator('.drawings-row').filter({ hasText: 'poligon1' }).locator('.drawings-item').click()
  await page.locator('.drawings-panel .map-sheet-close').click()

  const panel = page.locator('.selected-panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Düzenle' }).click()
  await expect(panel.getByRole('button', { name: 'Kaydet' })).toBeVisible()
  return panel
}

/* Düzenleme paneli, açıkken yakınlaştırma denetimini örter: düzenleme sırasında
   panel genişler (`.selected-panel.is-editing`, 400px) ve `.ol-zoom`'un kaydığı
   yeri de kaplar. Bu kasıtlı bir yerleşimdir; test onu zorlamaz. Görünüm
   değişikliği bunun yerine tarayıcı düzeyinde yapılır — aynı `change:size`
   yaşam döngüsünü çalıştırır ve hiçbir denetimin tıklanabilirliğine bağlı
   değildir. */
const EDIT_TEST_VIEWPORT = { width: 1100, height: 700 }

const kindsOf = (requests) => [...new Set(requests.map((item) => item.kind))].sort()

async function waitForKinds(page, requests, expected) {
  await expect
    .poll(() => kindsOf(requests), { timeout: 7000 })
    .toEqual([...expected].sort())
}

test('each geometry type gets exactly one authenticated presentation raster', async ({ page }) => {
  const { presentationRequests, foreignRequests } = await prepareMap(page)

  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  // One layer per type; no duplicate raster for the same kind on first load.
  for (const kind of PRESENTATION_TYPES) {
    expect(presentationRequests.filter((item) => item.kind === kind).length).toBe(1)
  }

  await expect(page.locator('.drawing-presentation-layer')).toHaveCount(PRESENTATION_CONTAINERS)
  expect(foreignRequests).toEqual([])
})

test('the presentation request carries the viewport and nothing else', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page)
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  for (const request of presentationRequests) {
    const keys = [...request.url.searchParams.keys()].sort()
    expect(keys).toEqual(['bbox', 'height', 'width'])
    expect(request.authorization).toMatch(/^Bearer /)

    // No GeoServer/security authority may leak out of the browser.
    for (const forbidden of ['cql', 'layers', 'styles', 'workspace', 'userid', 'ownerid', 'service', 'request']) {
      expect(request.url.search.toLowerCase()).not.toContain(forbidden)
    }

    expect(Number(request.url.searchParams.get('width'))).toBeGreaterThanOrEqual(64)
    expect(Number(request.url.searchParams.get('height'))).toBeGreaterThanOrEqual(64)
    expect(request.url.searchParams.get('bbox').split(',')).toHaveLength(4)
  }
})

test('the WFS features stay loaded and interactive behind the raster', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page)
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  /* The vector source is still where feature identity lives: the panel lists
     the records that came from the WFS-backed endpoints. */
  await page.getByRole('button', { name: 'Çizimlerim' }).click()
  await expect(page.locator('.drawings-panel')).toBeVisible()
  await expect(page.locator('.drawings-item-title')).toHaveCount(3)

  /* Selecting from the list is the SAME selection path a map click uses, so a
     working selection here means the vector features were never discarded. */
  const row = page.locator('.drawings-row').filter({ hasText: 'poligon1' })
  await row.locator('.drawings-item').click()
  await expect(row).toHaveClass(/is-selected/)
  await expect(row.locator('.drawings-item')).toHaveAttribute('aria-current', 'true')

  /* Seçili çizim paneli, bir kenar çubuğu paneli AÇIKKEN bilinçli olarak
     gösterilmez — sağda aynı anda tek yüzey durur. Seçimin gerçekten yapıldığı
     yukarıda satırın kendi durumundan okunur; panel ancak Çizimlerim
     kapandığında ortaya çıkar. */
  await page.locator('.drawings-panel .map-sheet-close').click()
  const selected = page.locator('.selected-panel')
  await expect(selected).toBeVisible()
  await expect(selected).toContainText('poligon1')
})

test('a map click still selects the vector under the presentation raster', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page)
  // The raster must be live: only then does the vector drop its normal style
  // for the transparent, interaction-only one this test is really measuring.
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  /* Kamerayı test tahmin etmez: listeden seçmek uygulamanın KENDİ fitExtent'ini
     çalıştırır ve poligonu çerçeveler. Ardından seçim temizlenir, böylece
     panelin geri gelmesinin tek olası sebebi harita tıklaması olur. */
  await page.getByRole('button', { name: 'Çizimlerim' }).click()
  await page.locator('.drawings-row').filter({ hasText: 'poligon1' }).locator('.drawings-item').click()
  await page.locator('.drawings-panel .map-sheet-close').click()

  const selected = page.locator('.selected-panel')
  await expect(selected).toBeVisible()
  await selected.locator('.map-sheet-close').click()
  await expect(selected).toBeHidden()

  /* Çerçevelenmiş poligonun içi. Diğer iki geometri ayrık alanlardadır, bu
     yüzden merkez tık tek bir feature'a karşılık gelir. Zamanlama numarası
     yoktur: Playwright'ın kendi yeniden deneme davranışı OpenLayers'ın
     `singleclick` gecikmesini karşılar. */
  const box = await page.locator('.map-container').boundingBox()
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)

  /* Seçim ve vurgulama hâlâ istemci-vektör tarafındadır: raster bir PNG'dir ve
     hiçbir feature kimliği taşımaz. Panelin açılması, şeffaf etkileşim
     stilinin isabet algılamasını koruduğunu kanıtlar. */
  await expect(selected).toBeVisible()
  await expect(selected).toContainText('poligon1')
})

test('every geometry type still has its features in the vector source', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page)
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  await page.getByRole('button', { name: 'Katmanlar' }).click()

  for (const label of ['Noktalar', 'Çizgiler', 'Poligonlar']) {
    const row = page.locator('.layers-row').filter({ hasText: label })
    // The count comes from the loaded features, not from the raster.
    await expect(row.locator('.layers-row-count')).toHaveText('1 kayıt')
    await expect(row).toHaveAttribute('aria-pressed', 'true')
  }
})

test('hiding and showing a layer in the same view reuses the cached raster', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page)
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)
  await settlePresentation(presentationRequests)

  await page.getByRole('button', { name: 'Katmanlar' }).click()
  const pointRow = page.locator('.layers-row').filter({ hasText: 'Noktalar' })

  await pointRow.click()
  await expect(pointRow).toHaveAttribute('aria-pressed', 'false')

  const before = countByKind(presentationRequests)

  await pointRow.click()
  await expect(pointRow).toHaveAttribute('aria-pressed', 'true')

  /* Görünüm değişmedi, dolayısıyla eldeki görüntü hâlâ tam olarak doğru
     cevaptır. Her anahtar hareketinde yeniden istemek, aynı resmi ikinci kez
     indirmek olurdu. */
  await settlePresentation(presentationRequests)
  expect(countByKind(presentationRequests)).toEqual(before)
})

test('a layer hidden across a viewport change is refetched when shown again', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page)
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)
  await settlePresentation(presentationRequests)

  await page.getByRole('button', { name: 'Katmanlar' }).click()
  const pointRow = page.locator('.layers-row').filter({ hasText: 'Noktalar' })
  await pointRow.click()
  await expect(pointRow).toHaveAttribute('aria-pressed', 'false')

  /* Gizliyken harita hareket eder. Gizli tür `moveend` üzerinde istenmez, bu
     yüzden elindeki görüntü GÜNCELDİR ama BAŞKA BİR YERİ gösterir. */
  await page.setViewportSize({ width: 1100, height: 700 })
  await settlePresentation(presentationRequests)
  const before = countByKind(presentationRequests)

  await pointRow.click()
  await expect(pointRow).toHaveAttribute('aria-pressed', 'true')

  // Yanlış görünümün resmi güvenilemez: geri açılırken tazelenmelidir.
  await expect
    .poll(() => countByKind(presentationRequests).point, { timeout: 8000 })
    .toBeGreaterThan(before.point)
})

test('moving the map refreshes the rasters and releases the superseded Blob URLs', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page)
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  const before = presentationRequests.length

  await page.locator('.ol-zoom-in').click()
  await page.waitForTimeout(300)
  await page.setViewportSize({ width: 1200, height: 760 })

  await expect.poll(() => presentationRequests.length, { timeout: 8000 }).toBeGreaterThan(before)

  const lifecycle = await page.evaluate(() => window.__presentationLifecycle)
  expect(lifecycle.created.length).toBeGreaterThan(0)
  // Every replaced image hands its object URL back; nothing is leaked.
  expect(lifecycle.revoked.length).toBeGreaterThan(0)
  expect(lifecycle.created.length).toBeGreaterThanOrEqual(lifecycle.revoked.length)
})

test('an upstream failure falls back to the vectors instead of blanking the map', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page, {
    presentationHandler: (route) => route.fulfill({
      status: 502,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'GeoServer harita görüntüsü üretilemedi.' }),
    }),
  })

  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  // The map is still usable and the records are still there: the display path
  // degraded, the data path did not.
  await page.getByRole('button', { name: /Çizimlerim/ }).click()
  await expect(page.getByText('poligon1')).toBeVisible()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()
})

test('no drawings.view means no presentation request at all', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page, {
    permissions: ['map.view', 'layers.view'],
  })

  await page.waitForTimeout(1500)
  expect(presentationRequests).toEqual([])
})

test('the heatmap stays an independent, separately permissioned raster', async ({ page }) => {
  const heatmapRequests = []
  await page.route('**/api/heatmap/image?*', (route) => {
    heatmapRequests.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })
  })

  const { presentationRequests } = await prepareMap(page, {
    permissions: [...VIEWER_PERMISSIONS, 'inventory.analysis'],
  })
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  // The presentation path never touches the heatmap endpoint on its own.
  expect(heatmapRequests).toEqual([])

  await page.getByRole('button', { name: 'Isı Haritası Analizi' }).click()
  await page.getByRole('switch', { name: 'Isı haritasını göster' }).click()

  await expect.poll(() => heatmapRequests.length, { timeout: 7000 }).toBeGreaterThan(0)

  /* İki raster BİRLİKTE durur, biri diğerinin yerini almaz. İkisi ayrı
     kapsayıcılardır çünkü className'leri farklıdır — bu yüzden sunum
     katmanları ısı haritasının kapsayıcısını yeniden kullanamaz. */
  await expect(page.locator('.drawing-presentation-layer')).toHaveCount(PRESENTATION_CONTAINERS)
  await expect(page.locator('.heatmap-layer')).toHaveCount(1)

  // Her sunum türü hâlâ tam olarak bir kez istenmiş olmalıdır.
  for (const kind of PRESENTATION_TYPES) {
    expect(presentationRequests.filter((item) => item.kind === kind).length).toBe(1)
  }
})

/* --- Kaydedilmemiş düzenleme sırasında sunum askısı ------------------------
   Sunum görüntüsü veritabanındaki hâli gösterir. Kullanıcı bir geometriyi
   taşırken bu hâlâ doğrudur ama ekrandakiyle uyuşmaz: askıya alınmazsa çizimin
   eski konumu hayalet bir kopya olarak kalır. Aşağıdaki testler bunu istek
   davranışı üzerinden ölçer — hangi türün ne zaman yeniden istendiği,
   renderer'ın DOM ayrıntılarına bağlı olmayan gözlenebilir kanıttır. */

test('entering geometry editing suspends only the edited type', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page, { permissions: EDITOR_PERMISSIONS })
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  await enterPolygonEdit(page)
  await settlePresentation(presentationRequests)
  const before = countByKind(presentationRequests)

  // Bir viewport değişimi normalde ÜÇ türü de yeniden ister.
  await page.setViewportSize(EDIT_TEST_VIEWPORT)

  await expect.poll(() => countByKind(presentationRequests).line, { timeout: 8000 })
    .toBeGreaterThan(before.line)
  await expect.poll(() => countByKind(presentationRequests).point, { timeout: 8000 })
    .toBeGreaterThan(before.point)

  /* Düzenlenen tür istenmez: kayıtlı görüntü zaten ekrandan kaldırılmıştır ve
     yerine gelecek bir görüntü, kullanıcı kaydetmeden önce eskimiş olurdu. */
  expect(countByKind(presentationRequests).polygon).toBe(before.polygon)
})

test('dragging during an edit session issues no presentation request for that type', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page, { permissions: EDITOR_PERMISSIONS })
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  await enterPolygonEdit(page)
  await settlePresentation(presentationRequests)
  const before = countByKind(presentationRequests)

  // Gerçek bir işaretçi sürüklemesi: köşe taşıma jesti.
  const box = await page.locator('.map-container').boundingBox()
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + 40, cy + 30, { steps: 8 })
  await page.mouse.move(cx + 80, cy + 60, { steps: 8 })
  await page.mouse.up()

  /* Hareket başına istek YOKTUR. Bu bir performans notu değil, mimari kuraldır:
     kaydedilmemiş bir geometri sunucuda yoktur, dolayısıyla ondan yeni bir
     görüntü istenemez. */
  await expect.poll(() => countByKind(presentationRequests).polygon, { timeout: 2000 })
    .toBe(before.polygon)
})

test('a successful save refreshes the edited type from the server', async ({ page }) => {
  const { presentationRequests, updateRequests } = await prepareMap(page, { permissions: EDITOR_PERMISSIONS })
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  const panel = await enterPolygonEdit(page)
  await settlePresentation(presentationRequests)
  const before = countByKind(presentationRequests)

  await panel.getByRole('button', { name: 'Kaydet' }).click()

  // Önce yazma gerçekleşir...
  await expect.poll(() => updateRequests.length, { timeout: 8000 }).toBe(1)
  // ...ve ancak ondan SONRA yeni görüntü istenir.
  await expect.poll(() => countByKind(presentationRequests).polygon, { timeout: 8000 })
    .toBeGreaterThan(before.polygon)

  await expect(panel.getByRole('button', { name: 'Düzenle' })).toBeVisible()
})

test('cancelling an edit causes no mutation-driven presentation refresh', async ({ page }) => {
  const { presentationRequests, updateRequests, drawingListRequests } =
    await prepareMap(page, { permissions: EDITOR_PERMISSIONS })
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  const panel = await enterPolygonEdit(page)

  /* Çizimi listeden seçmek haritayı ONA ÇERÇEVELER. O görünüm değişikliği
     GÖRÜNÜR rasterleri meşru biçimde tazeler — ama askıya alınmış olan tür
     tazelenmez. Yani İptal anında poligonun elindeki görüntü hâlâ ÖNCEKİ
     görünüme aittir. Ölçüm ancak bu yerleşim trafiği durduktan sonra
     anlamlıdır. */
  await settlePresentation(presentationRequests)
  const beforeCount = presentationRequests.length
  const listBefore = drawingListRequests.length

  const lastBefore = (kind) => [...presentationRequests.slice(0, beforeCount)]
    .reverse()
    .find((item) => item.kind === kind)

  /* Askıya ALINMAMIŞ bir tür, düzenleme boyunca güncel görünüm için
     tazelenmeye devam etti; imzası bu yüzden "haritanın şu anki yeri"dir. */
  const currentSignature = signatureOf(lastBefore('line'))
  const suspendedWasStale = signatureOf(lastBefore('polygon')) !== currentSignature

  await panel.getByRole('button', { name: 'İptal' }).click()
  await expect(panel.getByRole('button', { name: 'Düzenle' })).toBeVisible()
  // Kayıt yerinde durur: İptal yalnızca yerel düzenlemeyi geri alır.
  await expect(panel).toContainText('poligon1')

  await settlePresentation(presentationRequests)
  const added = presentationRequests.slice(beforeCount)

  /* ASIL İDDİA. Sunum sürümünü yalnızca kalıcı bir mutasyon ya da bir yeniden
     yükleme artırabilir ve ikisinin de kendi HTTP izi vardır. İkisi de yoksa,
     aşağıdaki trafik ne olursa olsun MUTASYON KAYNAKLI OLAMAZ — İptal hiçbir
     şeyi geçersiz kılmamıştır. */
  expect(updateRequests).toEqual([])
  expect(drawingListRequests.length).toBe(listBefore)

  if (added.length === 0) {
    /* Görünüm imzası hiç değişmemişse eldeki raster olduğu gibi yeniden
       kullanılır ve tek bir istek bile atılmaz. */
    expect(suspendedWasStale).toBe(false)
    return
  }

  /* Tek bir görünüm turu: her tür EN FAZLA bir kez ve hepsi AYNI, güncel
     görünüm için. Bu, "aynı bbox için ikinci bir tazeleme" ve "yalnızca
     poligona özel bir istek" senaryolarının ikisini de reddeder. */
  const kinds = added.map((item) => item.kind)
  expect(new Set(kinds).size, 'no kind may be refreshed twice').toBe(kinds.length)
  expect([...new Set(added.map(signatureOf))], 'one round, one viewport').toEqual([currentSignature])

  /* Ve bu tur ancak askıdaki türün önbelleği eskimişse gereklidir: harita,
     poligon askıdayken hareket etmişti. */
  expect(suspendedWasStale).toBe(true)
  expect(kinds).toContain('polygon')
})

test('a failed save does not refresh the presentation', async ({ page }) => {
  const { presentationRequests, updateRequests } = await prepareMap(page, {
    permissions: EDITOR_PERMISSIONS,
    updateHandler: (route) => route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Çizim güncellenemedi.' }),
    }),
  })
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  const panel = await enterPolygonEdit(page)
  await settlePresentation(presentationRequests)
  const before = countByKind(presentationRequests)

  await panel.getByRole('button', { name: 'Kaydet' }).click()
  await expect.poll(() => updateRequests.length, { timeout: 8000 }).toBe(1)

  /* Yazma başarısızsa görüntü tazelenmez — ve eski görüntü kullanıcının
     kaydedilmemiş düzenlemesinin üzerine geri getirilmez. */
  await page.waitForTimeout(600)
  expect(countByKind(presentationRequests).polygon).toBe(before.polygon)
})

test('layer visibility stays independent of edit suspension', async ({ page }) => {
  const { presentationRequests } = await prepareMap(page, { permissions: EDITOR_PERMISSIONS })
  await waitForKinds(page, presentationRequests, PRESENTATION_TYPES)

  await enterPolygonEdit(page)
  await settlePresentation(presentationRequests)

  /* İki durum bağımsızdır: biri kullanıcının kapattığı katman, diğeri
     kaydedilmemiş düzenleme yüzünden askıya alınan sunum. Katman anahtarı
     düzenleme sırasında da eskisi gibi çalışır. */
  await page.getByRole('button', { name: 'Katmanlar' }).click()
  const pointRow = page.locator('.layers-row').filter({ hasText: 'Noktalar' })
  await pointRow.click()
  await expect(pointRow).toHaveAttribute('aria-pressed', 'false')

  // Nokta gizliyken görünüm değişir: çizgi tazelenir, gizli nokta istenmez.
  await page.setViewportSize(EDIT_TEST_VIEWPORT)
  await settlePresentation(presentationRequests)
  const hidden = countByKind(presentationRequests)

  await pointRow.click()
  await expect(pointRow).toHaveAttribute('aria-pressed', 'true')

  // Geri açılan nokta, DEĞİŞMİŞ görünüm için tazelenir.
  await expect.poll(() => countByKind(presentationRequests).point, { timeout: 8000 })
    .toBeGreaterThan(hidden.point)

  /* Düzenlenen tür askıda kalır: ne görünüm değişikliği ne de başka bir türün
     katman anahtarı onu geri getirir. */
  await settlePresentation(presentationRequests)
  expect(countByKind(presentationRequests).polygon).toBe(hidden.polygon)
})
