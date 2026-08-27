import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'
import { provinceAreaWkts, regionAreaWkts } from '../../src/map/locationAnalysis.js'
import { PROVINCES, REGIONS } from '../../src/map/turkeyGeography.js'

/**
 * "Konum Analizi" — ödevin kullanıcıya görünen yüzü.
 *
 * <b>Her şey ağ sınırında taklit edilir.</b> Gerçek GeoServer'a, gerçek
 * `analysis_poi` tablosuna ve gerçek ağırlıklı rastere DOKUNULMAZ; ölçülen şey
 * arayüzün sözleşmesidir — hangi yetkiyle görünür, hangi doğrulamayla
 * çalışır, sunucuya NE gönderir. Gerçek uçtan uca doğrulama Phase 6'nın elle
 * yapılan kabul adımıdır.
 */

const LOCATION_ANALYSIS = 'location.analysis'
const POI_VIEW = 'poi.view'
const BASE_PERMISSIONS = ['map.view', 'drawings.view', 'layers.view']
const BOTH = [...BASE_PERMISSIONS, LOCATION_ANALYSIS, POI_VIEW]

const provinceTarget = (province) => ({
  key: province.code,
  name: province.name,
  areaWkts: provinceAreaWkts(province.code),
  provinceKeys: [],
})

const regionTarget = (region) => ({
  key: region.key,
  name: region.name,
  areaWkts: regionAreaWkts(region.key),
  provinceKeys: region.provinceCodes,
})

const unrestrictedCatalog = {
  isRestricted: false,
  regions: REGIONS.map(regionTarget),
  provinces: PROVINCES.map(provinceTarget),
}

/**
 * Zarfın TAMAMINI dolduran opak bir raster.
 *
 * Kırpma testleri için gereklidir: 1x1'lik saydam bir PNG ile maskenin bir şey
 * kesip kesmediği ÖLÇÜLEMEZ. Bu görüntü baştan sona boyalıdır, dolayısıyla
 * ekranda kalan her piksel maskenin geçirdiği pikseldir.
 */
const SOLID_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEACAYAAABccqhmAAADI0lEQVR4nO3UMQ0AIQDAQHgXJPi3hJxHBkPvFHTqPGv/A0j6XgcA7xgAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAhBkAjK4LvaQEC9T0hKEAAAAASUVORK5CYII=',
  'base64',
)

const PIXEL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8vZVwAAAABJRU5ErkJggg==',
  'base64',
)

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/** Gerçek taksonominin ŞEKLİ DEĞİL, KENDİSİ: adlar ve ana-alt ilişkileri
    `PoiCategoryTaxonomy.cs` ile birebir aynıdır. Uydurma bir "Kategori A/B"
    taksonomisi, gerçek ağaçta ortaya çıkan bir hatayı gizleyebilirdi. */
const CATEGORIES = [
  { id: 1, name: 'Yeme İçme', path: 'Yeme İçme', slug: 'yeme-icme', parentId: null, depth: 0 },
  { id: 2, name: 'Kafe', path: 'Yeme İçme / Kafe', slug: 'kafe', parentId: 1, depth: 1 },
  { id: 3, name: 'Restoran', path: 'Yeme İçme / Restoran', slug: 'restoran', parentId: 1, depth: 1 },
  { id: 4, name: 'Sağlık Kurumları', path: 'Sağlık Kurumları', slug: 'saglik-kurumlari', parentId: null, depth: 0 },
  { id: 5, name: 'Eczane', path: 'Sağlık Kurumları / Eczane', slug: 'eczane', parentId: 4, depth: 1 },
  { id: 6, name: 'Eğitim Kurumları', path: 'Eğitim Kurumları', slug: 'egitim-kurumlari', parentId: null, depth: 0 },
  { id: 7, name: 'Okullar', path: 'Eğitim Kurumları / Okullar', slug: 'okullar', parentId: 6, depth: 1 },
]

const NORMAL_APP_POI = {
  id: 901,
  name: 'Normal Uygulama POI',
  categoryId: 5,
  categoryName: 'Eczane',
  categoryPath: 'Sağlık Kurumları / Eczane',
  longitude: 32.85,
  latitude: 39.92,
  workHours: null,
}

/** Bir kategorinin kapanışındaki kategori sayısı: kendisi + tüm torunları. */
const subtreeSize = (slug) => {
  const root = CATEGORIES.find((category) => category.slug === slug)
  if (!root) return 1
  let count = 0
  const walk = (id) => {
    count += 1
    for (const child of CATEGORIES.filter((category) => category.parentId === id)) walk(child.id)
  }
  walk(root.id)
  return count
}

const summaryFor = (criteria, total = 1533) => ({
  target: { partCount: 1, minLongitude: 32.7, minLatitude: 39.8, maxLongitude: 33, maxLatitude: 40 },
  totalMatchingPoiCount: total,
  totalWeightedContribution: 700.5,
  criteria: criteria.map((criterion) => ({
    categorySlug: criterion.categorySlug,
    categoryName: CATEGORIES.find((category) => category.slug === criterion.categorySlug)?.name ?? '',
    weight: criterion.weight,
    normalizedWeight: criterion.weight / 100,
    matchingPoiCount: Math.round(total / criteria.length),
    weightedContribution: 1,
    /* Kapsanan kategori sayısı GERÇEK kapanıştır: bir kök, kendisi + tüm
       torunlarıdır. Sabit 1 yazmak, üst kategori seçiminin sayacı nasıl
       etkilediğini gizlerdi. */
    coveredCategoryCount: subtreeSize(criterion.categorySlug),
  })),
})

async function prepareMap(page, {
  permissions = BOTH,
  role = 'Custom Location Analyst',
  summaryStatus = 200,
  summaryTotal = 1533,
  imageHandler = null,
  heatmapBody = PIXEL_PNG,
  pointsHandler = null,
  scopeWkt = null,
  targetCatalog = null,
  normalPois = [],
} = {}) {
  await mockPermissions(page, permissions, { userId: 42 })

  const summaryRequests = []
  const imageRequests = []
  const pointRequests = []
  const rasterPointRequests = []
  const catalogRequests = []

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'location-analysis-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())

  await page.route('**/api/auth/me', (route) => route.fulfill(json({
    userId: 42,
    username: 'analysis-user',
    role,
    roles: [role],
  })))
  await page.route('**/api/auth/me/geographic-scope', (route) => route.fulfill(json(
    scopeWkt
      ? { isRestricted: true, effectiveWkt: scopeWkt, areaCount: 1 }
      : { isRestricted: false, effectiveWkt: null, areaCount: 0 },
  )))
  const resolvedCatalog = targetCatalog ?? (scopeWkt
    ? {
        isRestricted: true,
        regions: [],
        provinces: scopeWkt === ANKARA_SCOPE
          ? PROVINCES.filter((province) => province.code === 'TR-06').map(provinceTarget)
          : [],
      }
    : unrestrictedCatalog)
  await page.route('**/api/analysis/location/catalog', (route) => {
    catalogRequests.push({ method: route.request().method(), url: route.request().url() })
    return route.fulfill(json(resolvedCatalog))
  })
  // Genel POI listesi ÖNCE kaydedilir: Playwright son eklenen route'u önce
  // dener ve geniş POI deseni kategori ucuyla da eşleşirdi — kategoriler boş
  // gelir, açılır listeler boş kalırdı.
  await page.route('**/api/poi**', (route) => route.fulfill(json(normalPois)))
  await page.route('**/api/poi/categories', (route) => route.fulfill(json(CATEGORIES)))
  await page.route('**/api/map/presentation/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }))
  await page.route('**/api/heatmap/image?*', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }))
  await page.route('**/api/drawings/points', (route) => route.fulfill(json([])))
  await page.route('**/api/drawings/lines', (route) => route.fulfill(json([])))
  await page.route('**/api/drawings/polygons', (route) => route.fulfill(json([])))
  await page.route('**/tile.openstreetmap.org/**', (route) => route.fulfill({
    status: 200,
    contentType: 'image/png',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: PIXEL_PNG,
  }))

  /* Vektör liste ucu: analiz POI'leri artık haritaya feature olarak çizilir.
     Desen `/points` ile BİTER; `/points/image` ve `/points/hit-test` ile
     eşleşmez. */
  await page.route('**/api/analysis/location/points', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    pointRequests.push(body)
    if (pointsHandler) return pointsHandler(route, body, pointRequests.length)
    return route.fulfill(json({
      pois: analysisPoiCluster(),
      totalCount: analysisPoiCluster().length,
      limit: 5000,
      truncated: false,
    }))
  })

  /* Raster nokta örtüsü ARTIK ÇAĞRILMAMALIDIR; route yalnızca çağrıldığını
     yakalayabilmek için duruyor. */
  await page.route('**/api/analysis/location/points/image', async (route) => {
    rasterPointRequests.push(JSON.parse(route.request().postData() ?? '{}'))
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG })
  })

  /* Görüntü ucu ÖZETTEN ÖNCE kaydedilir: Playwright son eklenen route'u önce
     dener ve `/location` deseni `/location/image` ile de eşleşirdi. */
  await page.route('**/api/analysis/location/image', async (route) => {
    imageRequests.push(JSON.parse(route.request().postData() ?? '{}'))
    if (imageHandler) return imageHandler(route, imageRequests.length)
    return route.fulfill({ status: 200, contentType: 'image/png', body: heatmapBody })
  })

  await page.route('**/api/analysis/location', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}')
    summaryRequests.push(body)
    if (summaryStatus !== 200) {
      return route.fulfill(json({ message: 'Analiz çalıştırılamadı.' }, summaryStatus))
    }
    return route.fulfill(json(summaryFor(body.criteria ?? [], summaryTotal)))
  })

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  return { catalogRequests, summaryRequests, imageRequests, pointRequests, rasterPointRequests }
}

async function openPanel(page) {
  if (await page.getByRole('button', { name: 'Menüyü aç' }).isVisible()) {
    await page.getByRole('button', { name: 'Menüyü aç' }).click()
  }
  await page.getByRole('button', { name: 'Konum Analizi', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Konum Analizi' })).toBeVisible()
  await expect(page.getByLabel('İl', { exact: true })).toBeEnabled()
}

/**
 * Ölçüt satırının aranabilir kategori kutusundan bir kategori seçer.
 *
 * <b>Ayrı bir arama kutusu + `select` YOKTUR.</b> Satırda tek bir combobox
 * vardır: tıklamak listeyi açar, yazmak daraltır, seçenek `role="option"`
 * taşır. Yardımcı bu yüzden `selectOption` kullanamaz — o yalnızca gerçek bir
 * `<select>` üzerinde çalışır.
 */
async function chooseCategory(page, index, label, { type = null } = {}) {
  const box = page.getByRole('combobox', { name: `Kategori ${index}`, exact: true })
  await box.click()
  if (type !== null) await box.fill(type)
  await page.getByRole('option', { name: label, exact: true }).click()
  await expect(box).toHaveValue(label)
}

/** Açık listedeki seçeneklerin metinleri. */
async function categoryOptions(page, index, { type = null } = {}) {
  const box = page.getByRole('combobox', { name: `Kategori ${index}`, exact: true })
  await box.click()
  if (type !== null) await box.fill(type)
  return page.getByRole('listbox', { name: `Kategori ${index} listesi` }).getByRole('option').allTextContents()
}

/** Ankara'yı seçer ve iki ölçütü verilen ağırlıklarla doldurur. */
async function configure(page, { first = 'Eczane', firstWeight = 50, second = 'Eğitim Kurumları / Okullar', secondWeight = 50 } = {}) {
  await page.getByLabel('İl', { exact: true }).selectOption({ label: 'Ankara' })

  await chooseCategory(page, 1, `Sağlık Kurumları / ${first}`)
  await page.getByLabel('Ağırlık 1').fill(String(firstWeight))

  await chooseCategory(page, 2, second)
  await page.getByLabel('Ağırlık 2').fill(String(secondWeight))
}

/* --- Yetki kapısı ------------------------------------------------------------- */

test('both permissions together reveal the entry', async ({ page }) => {
  const { catalogRequests, summaryRequests, imageRequests, pointRequests } = await prepareMap(page)
  await expect(page.getByRole('button', { name: 'Konum Analizi', exact: true })).toBeVisible()
  expect(catalogRequests).toHaveLength(0)
  expect(summaryRequests).toHaveLength(0)
  expect(imageRequests).toHaveLength(0)
  expect(pointRequests).toHaveLength(0)
})

test('the authorized catalog loads lazily once and remains usable after reopening', async ({ page }) => {
  const { catalogRequests, summaryRequests } = await prepareMap(page)
  expect(catalogRequests).toHaveLength(0)

  await openPanel(page)
  await expect.poll(() => catalogRequests.length).toBe(1)
  expect(catalogRequests[0]).toMatchObject({
    method: 'GET',
    url: expect.stringContaining('/api/analysis/location/catalog'),
  })
  await expect(page.getByLabel('İl', { exact: true }).locator('option')).toHaveCount(PROVINCES.length + 1)
  expect(summaryRequests).toHaveLength(0)

  await page.getByRole('button', { name: 'Konum Analizi panelini kapat' }).click()
  await expect(page.getByRole('dialog', { name: 'Konum Analizi' })).toHaveCount(0)
  await openPanel(page)

  expect(catalogRequests).toHaveLength(1)
  await expect(page.getByLabel('İl', { exact: true }).locator('option')).toHaveCount(PROVINCES.length + 1)
  expect(summaryRequests).toHaveLength(0)
})

test('location.analysis alone does not reveal the entry', async ({ page }) => {
  /* Uç İKİ yetki birden arar; yalnızca birine sahip birine giriş göstermek
     garanti 403 alacak bir akışa davet etmek olurdu. */
  await prepareMap(page, { permissions: [...BASE_PERMISSIONS, LOCATION_ANALYSIS] })
  await expect(page.getByRole('button', { name: 'Konum Analizi', exact: true })).toBeHidden()
})

test('poi.view alone does not reveal the entry', async ({ page }) => {
  await prepareMap(page, { permissions: [...BASE_PERMISSIONS, POI_VIEW] })
  await expect(page.getByRole('button', { name: 'Konum Analizi', exact: true })).toBeHidden()
})

test('the entry follows the permission code, not the role name', async ({ page }) => {
  /* Adı "Administrator" olan ama yetki taşımayan biri girişi GÖRMEZ; adı
     tanınmayan özel bir rol taşıyan biri GÖRÜR. */
  await prepareMap(page, { permissions: BASE_PERMISSIONS, role: 'Administrator' })
  await expect(page.getByRole('button', { name: 'Konum Analizi', exact: true })).toBeHidden()
})

test('the existing drawing heatmap entry stays a separate feature', async ({ page }) => {
  await prepareMap(page)
  // Konum analizi yetkisi, çizim ısı haritasının menüsünü AÇMAZ.
  await expect(page.getByRole('button', { name: 'Isı Haritası Analizi', exact: true })).toBeHidden()
})

/* --- Alan seçimi --------------------------------------------------------------- */

test('choosing a province sets the target area', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  await expect(page.getByText('Henüz bir alan seçilmedi.')).toBeVisible()
  await page.getByLabel('İl', { exact: true }).selectOption({ label: 'Ankara' })
  await expect(page.getByText(/Seçili alan:/)).toContainText('Ankara')
})

test('switching to draw mode activates the polygon tool', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  await page.getByRole('button', { name: 'Haritada Çiz' }).click()
  await expect(page.getByRole('button', { name: 'Haritada Çiz' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText(/Haritada alanı çizin/)).toBeVisible()
})

test('switching area mode clears the previous target', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  await page.getByLabel('İl', { exact: true }).selectOption({ label: 'Ankara' })
  await expect(page.getByText(/Seçili alan:/)).toContainText('Ankara')

  await page.getByRole('button', { name: 'Haritada Çiz' }).click()
  await expect(page.getByText('Henüz bir alan seçilmedi.')).toBeVisible()
})

/* --- Ölçütler ve ağırlıklar ------------------------------------------------------ */

test('the analyze button stays disabled until the total is exactly 100', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  const analyze = page.getByRole('button', { name: 'ANALİZİ BAŞLAT' })
  await expect(analyze).toBeDisabled()

  await configure(page, { firstWeight: 50, secondWeight: 49 })
  await expect(page.getByText('99 / 100')).toBeVisible()
  await expect(analyze).toBeDisabled()
  // Devre dışı stil TEK BAŞINA yeterli değildir: gerekçe metni de okunur.
  await expect(page.getByText(/toplamı 100 olmalıdır/i)).toBeVisible()

  await page.getByLabel('Ağırlık 2').fill('51')
  await expect(page.getByText('101 / 100')).toBeVisible()
  await expect(analyze).toBeDisabled()

  await page.getByLabel('Ağırlık 2').fill('50')
  await expect(page.getByText('100 / 100')).toBeVisible()
  await expect(analyze).toBeEnabled()
})

/**
 * Düğmenin GÖZLE GÖRÜLÜR olması.
 *
 * <b>`toBeVisible()` bu hatayı yakalayamaz.</b> Phase 6'da düğme DOM'daydı,
 * etkindi, ölçülebilir bir kutusu vardı — Playwright'ın "görünür" tanımını
 * eksiksiz karşılıyordu. Görünmeyen şey RENKTİ: tanımsız bir `--accent`
 * belirteci arka planı `transparent` bırakıyor, `color: #fff` ile birlikte açık
 * temada beyaz zemin üzerinde beyaz metin üretiyordu. Bu yüzden burada
 * hesaplanmış stil ölçülür: arka plan saydam olmamalı ve metin rengiyle
 * çakışmamalıdır.
 */
async function analyzePaint(page) {
  return page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).evaluate((node) => {
    const style = getComputedStyle(node)
    return {
      color: style.color,
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage,
    }
  })
}

for (const scheme of /** @type {const} */ (['light', 'dark'])) {
  test(`the analyze button is painted, not just present (${scheme} theme)`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme })
    await prepareMap(page)
    await openPanel(page)

    const analyze = page.getByRole('button', { name: 'ANALİZİ BAŞLAT' })

    // Geçerli form: görünür VE etkin.
    await configure(page)
    await expect(page.getByText('100 / 100')).toBeVisible()
    await expect(page.getByText('Toplam geçerli.')).toBeVisible()
    await expect(analyze).toBeVisible()
    await expect(analyze).toBeEnabled()

    const paint = await analyzePaint(page)
    // Bir zemin ÇİZİLMİŞ olmalı: düz renk ya da degrade.
    const hasBackdrop =
      paint.backgroundImage !== 'none' ||
      !/^rgba\(\s*0,\s*0,\s*0,\s*0\s*\)$/.test(paint.backgroundColor)
    expect(hasBackdrop, `arka plan çizilmedi: ${JSON.stringify(paint)}`).toBe(true)
    // Düz renkli bir zemin metinle AYNI olamazdı — o hâlde düğme okunamaz.
    expect(paint.backgroundColor).not.toBe(paint.color)
  })
}

test('the analyze button stays visible while the form is invalid', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  const analyze = page.getByRole('button', { name: 'ANALİZİ BAŞLAT' })

  // Alan yok: düğme GÖRÜNÜR ama devre dışı, gerekçesi yazılı.
  await expect(analyze).toBeVisible()
  await expect(analyze).toBeDisabled()
  await expect(page.getByText(/Önce bir hedef alan seçin/)).toBeVisible()

  // Toplam 90: yine görünür, yine devre dışı.
  await configure(page, { firstWeight: 50, secondWeight: 40 })
  await expect(page.getByText('90 / 100')).toBeVisible()
  await expect(analyze).toBeVisible()
  await expect(analyze).toBeDisabled()
  await expect(page.getByText(/toplamı 100 olmalıdır/i)).toBeVisible()

  // Düzeltince görünürlüğünü KORUYARAK etkinleşir.
  await page.getByLabel('Ağırlık 2').fill('50')
  await expect(analyze).toBeVisible()
  await expect(analyze).toBeEnabled()
})

/**
 * Phase 6'nın elle denediği GERÇEK çift: iki ayrı kök kategori. Kurgu
 * taksonomisi bu ikisini de taşır, dolayısıyla "Kategori A / B" soyutlamasına
 * düşmeden gerçek adlarla sınanır.
 */
test('two unrelated root categories at 50/50 enable the analyze button', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  await page.getByLabel('İl', { exact: true }).selectOption({ label: 'Ankara' })
  await expect(page.getByText('Seçili alan:')).toBeVisible()

  await chooseCategory(page, 1, 'Sağlık Kurumları')
  await page.getByLabel('Ağırlık 1').fill('50')
  await chooseCategory(page, 2, 'Eğitim Kurumları')
  await page.getByLabel('Ağırlık 2').fill('50')

  await expect(page.getByText('100 / 100')).toBeVisible()
  await expect(page.getByText('Toplam geçerli.')).toBeVisible()

  const analyze = page.getByRole('button', { name: 'ANALİZİ BAŞLAT' })
  await expect(analyze).toBeVisible()
  await expect(analyze).toBeEnabled()
})

/* --- Bölge / il kademesi -----------------------------------------------------------

   <b>Veri kümesindeki hiyerarşi Bölge(7) → İl(81)'dir.</b> İlin ALTINDA bir
   birim (ilçe) yoktur — ne veritabanında ne de coğrafya JSON'unda. Bu yüzden
   kademe, gerçekten var olan yönde kurulur: bölge seçmek il listesini
   daraltır ve bölge tek başına da bir hedef alandır. */

test('choosing a region narrows the province list to that region', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  const all = await page.getByLabel('İl', { exact: true }).locator('option').count()

  await page.getByLabel('Bölge').selectOption({ label: 'Marmara' })

  const labels = await page.getByLabel('İl', { exact: true }).locator('option').allTextContents()
  expect(labels.length).toBeLessThan(all)
  expect(labels).toContain('İstanbul')
  // Başka bir bölgenin ili listede kalmaz.
  expect(labels).not.toContain('Ankara')
})

test('a region is a valid target area on its own', async ({ page }) => {
  const { summaryRequests } = await prepareMap(page)
  await openPanel(page)

  await page.getByLabel('Bölge').selectOption({ label: 'İç Anadolu' })
  await expect(page.getByText('Seçili alan:')).toBeVisible()
  await expect(page.getByText(/İç Anadolu Bölgesi/)).toBeVisible()

  /* Yaklaşıklık SÖYLENİR: bölge sınırı il sınırlarının birleşimidir ve
     resmî sınırı birebir takip etmez. */
  await expect(page.getByText(/yaklaşıklıktır/)).toBeVisible()

  await chooseCategory(page, 1, 'Sağlık Kurumları')
  await page.getByLabel('Ağırlık 1').fill('50')
  await chooseCategory(page, 2, 'Eğitim Kurumları')
  await page.getByLabel('Ağırlık 2').fill('50')
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect.poll(() => summaryRequests.length).toBeGreaterThan(0)
  expect(summaryRequests[0].areaWkts.length).toBeGreaterThan(0)
  expect(summaryRequests[0].areaWkts[0]).toMatch(/^POLYGON \(/)
})

test('picking a province after a region narrows the target further', async ({ page }) => {
  const { summaryRequests } = await prepareMap(page)
  await openPanel(page)

  await page.getByLabel('Bölge').selectOption({ label: 'İç Anadolu' })
  await page.getByLabel('İl', { exact: true }).selectOption({ label: 'Ankara' })

  // Daha dar olan KAZANIR: kullanıcının son söylediği şeydir.
  await expect(page.getByText('Seçili alan: Ankara')).toBeVisible()

  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => summaryRequests.length).toBeGreaterThan(0)
})

test('Temizle resets the region as well', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  await page.getByLabel('Bölge').selectOption({ label: 'Marmara' })
  await expect(page.getByText(/Marmara Bölgesi/)).toBeVisible()

  await page.getByRole('button', { name: 'Temizle', exact: true }).click()

  await expect(page.getByLabel('Bölge')).toHaveValue('')
  await expect(page.getByText('Henüz bir alan seçilmedi.')).toBeVisible()
})

/* --- Coğrafi yetki ----------------------------------------------------------------

   <b>Bu, projede coğrafi yetkinin OKUMA yolunda uygulandığı ilk yerdir.</b>
   Sunucu kararı kesindir (dört analiz ucu da aynı kapıdan geçer); ön yüzün
   işi kullanıcıyı YÖNLENDİRMEKTİR — seçemeyeceği bir ili listeleyip sonra
   403 göstermek, nedeni anlaşılmayan bir hata olurdu. */

/** Ankara'yı bütünüyle kapsayan, ama Türkiye'nin kalanını kapsamayan alan. */
const ANKARA_SCOPE = 'POLYGON ((30 38, 35 38, 35 41, 30 41, 30 38))'

/** Ankara'nın yalnızca küçük bir parçası: hiçbir il tamamen içine sığmaz. */
const TINY_SCOPE = 'POLYGON ((32.8 39.9, 32.95 39.9, 32.95 40.0, 32.8 40.0, 32.8 39.9))'

const CENTRAL_ANATOLIA = REGIONS.find((region) => region.key === 'IC_ANADOLU')
const SAMSUN = PROVINCES.find((province) => province.code === 'TR-55')
const CENTRAL_ANATOLIA_AND_SAMSUN = {
  isRestricted: true,
  regions: [regionTarget(CENTRAL_ANATOLIA)],
  provinces: PROVINCES
    .filter((province) => CENTRAL_ANATOLIA.provinceCodes.includes(province.code) || province.code === SAMSUN.code)
    .map(provinceTarget),
}

test('an unrestricted user still sees every province', async ({ page }) => {
  /* Kural değişikliği, coğrafi alanı tanımlı olmayan mevcut kurulumları
     KAPATMAMALIDIR. */
  await prepareMap(page)
  await openPanel(page)

  const options = await page.getByLabel('İl', { exact: true }).locator('option').count()
  expect(options).toBeGreaterThan(70)
  await expect(page.getByText(/Coğrafi yetkiniz/)).toBeHidden()
})

test('a restricted user only sees provinces inside their own area', async ({ page }) => {
  await prepareMap(page, { scopeWkt: ANKARA_SCOPE })
  await openPanel(page)

  const labels = await page.getByLabel('İl', { exact: true }).locator('option').allTextContents()

  expect(labels).toContain('Ankara')
  // Yetki alanının dışındaki iller listede HİÇ görünmez.
  expect(labels).not.toContain('İstanbul')
  expect(labels).not.toContain('İzmir')

  await expect(page.getByText(/Coğrafi yetkinize uygun bölgeler ve iller/)).toBeVisible()
})

test('a user whose area covers no whole province is told to draw instead', async ({ page }) => {
  /* Yüklem "kapsıyor mu"dur: yetki alanı Ankara'nın bir parçasıysa "Ankara"
     ili seçilemez, çünkü ilin tamamı yetkinin dışına taşar. Kullanıcıya
     çıkmaz sokak değil, doğru yol gösterilir. */
  await prepareMap(page, { scopeWkt: TINY_SCOPE })
  await openPanel(page)

  const labels = await page.getByLabel('İl', { exact: true }).locator('option').allTextContents()
  // Yalnızca "Seçiniz…" kalır.
  expect(labels.filter((label) => label !== 'Seçiniz…')).toHaveLength(0)

  await expect(page.getByText(/haritada, yetki alanınızın içinde çizin/)).toBeVisible()
})

test('backend-authorized İç Anadolu and standalone Samsun populate only their legitimate selectors', async ({ page }) => {
  await prepareMap(page, { scopeWkt: ANKARA_SCOPE, targetCatalog: CENTRAL_ANATOLIA_AND_SAMSUN })
  await openPanel(page)

  const regionLabels = await page.getByLabel('Bölge').locator('option').allTextContents()
  expect(regionLabels).toEqual(['Tüm bölgeler', 'İç Anadolu'])

  const provinceLabels = await page.getByLabel('İl', { exact: true }).locator('option').allTextContents()
  expect(provinceLabels).toContain('Samsun')
  for (const code of CENTRAL_ANATOLIA.provinceCodes) {
    expect(provinceLabels).toContain(PROVINCES.find((province) => province.code === code).name)
  }
  expect(provinceLabels).not.toContain('İstanbul')
  await expect(page.getByText('Coğrafi yetkinize uygun bölgeler ve iller listeleniyor. Daha dar bir alan için haritada çizebilirsiniz.')).toBeVisible()
})

test('selecting an authorized region sends its canonical identity and geometry', async ({ page }) => {
  const requests = await prepareMap(page, { scopeWkt: ANKARA_SCOPE, targetCatalog: CENTRAL_ANATOLIA_AND_SAMSUN })
  await openPanel(page)

  await page.getByLabel('Bölge').selectOption('IC_ANADOLU')
  await chooseCategory(page, 1, 'Sağlık Kurumları')
  await page.getByLabel('Ağırlık 1').fill('50')
  await chooseCategory(page, 2, 'Eğitim Kurumları')
  await page.getByLabel('Ağırlık 2').fill('50')
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect.poll(() => requests.summaryRequests.length).toBe(1)
  expect(requests.summaryRequests[0]).toMatchObject({
    administrativeTargetType: 'region',
    administrativeTargetKey: 'IC_ANADOLU',
    areaWkts: regionAreaWkts('IC_ANADOLU'),
  })
})

test('selecting standalone Samsun does not promote Karadeniz and sends province identity', async ({ page }) => {
  const requests = await prepareMap(page, { scopeWkt: ANKARA_SCOPE, targetCatalog: CENTRAL_ANATOLIA_AND_SAMSUN })
  await openPanel(page)

  await expect(page.getByLabel('Bölge').locator('option', { hasText: 'Karadeniz' })).toHaveCount(0)
  await page.getByLabel('İl', { exact: true }).selectOption('TR-55')
  await chooseCategory(page, 1, 'Sağlık Kurumları')
  await page.getByLabel('Ağırlık 1').fill('50')
  await chooseCategory(page, 2, 'Eğitim Kurumları')
  await page.getByLabel('Ağırlık 2').fill('50')
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect.poll(() => requests.summaryRequests.length).toBe(1)
  expect(requests.summaryRequests[0]).toMatchObject({
    administrativeTargetType: 'province',
    administrativeTargetKey: 'TR-55',
  })
})

test('authorized search and mode switches cannot leak a prior administrative selection', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await prepareMap(page, { scopeWkt: ANKARA_SCOPE, targetCatalog: CENTRAL_ANATOLIA_AND_SAMSUN })
  await openPanel(page)

  await page.getByLabel('İl ara').fill('sam')
  await expect(page.getByLabel('İl', { exact: true }).locator('option')).toHaveText(['Seçiniz…', 'Samsun'])
  await page.getByLabel('İl', { exact: true }).selectOption('TR-55')
  await page.getByRole('button', { name: 'Haritada Çiz' }).click()
  await page.getByRole('button', { name: 'İl Seç' }).click()

  await expect(page.getByLabel('Bölge')).toHaveValue('')
  await expect(page.getByLabel('İl', { exact: true })).toHaveValue('')
  await expect(page.getByRole('dialog', { name: 'Konum Analizi' })).toBeVisible()
})

/* --- Aranabilir kategori kutusu ---------------------------------------------------

   Satırda TEK bir denetim vardır. Önceki düzen ("Kategori 1 ara" + "Kategori 1")
   aynı soruyu iki kez soruyordu ve kullanıcı yazdıktan SONRA ayrıca seçmek
   zorundaydı; beş ölçütlü bir analizde panelde on denetim oluyordu. */

test('the criterion row exposes one searchable combobox, not a search box plus a select', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  const box = page.getByLabel('Kategori 1', { exact: true })

  await expect(box).toHaveRole('combobox')
  await expect(box).toHaveAttribute('aria-expanded', 'false')

  // Eski ikinci denetim GERİ GELMEMELİDİR.
  await expect(page.getByLabel('Kategori 1 ara')).toHaveCount(0)
})

test('clicking the box opens the full list and typing narrows it', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  const box = page.getByLabel('Kategori 1', { exact: true })
  const list = page.getByRole('listbox', { name: 'Kategori 1 listesi' })

  // Tıklamak listeyi açar: kutu bir arama KAPISI değil, bir seçicidir.
  await box.click()
  await expect(box).toHaveAttribute('aria-expanded', 'true')
  await expect(list).toBeVisible()

  const before = await list.getByRole('option').count()
  expect(before).toBeGreaterThan(1)

  await box.fill('eczane')

  const after = await list.getByRole('option').allTextContents()
  expect(after.length).toBeLessThan(before)
  expect(after).toContain('Sağlık Kurumları / Eczane')
  // Eşleşmeyen dal listeden düşer.
  expect(after.join(' ')).not.toContain('Okullar')
})

test('selecting from the list puts the category in the same control', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  const box = page.getByLabel('Kategori 1', { exact: true })

  await box.click()
  await box.fill('eczane')
  await page.getByRole('option', { name: 'Sağlık Kurumları / Eczane', exact: true }).click()

  /* Seçimden sonra AYNI alan seçili kategoriyi gösterir; ayrı bir "Seçili: …"
     satırına ya da ikinci bir denetime gerek yoktur. */
  await expect(box).toHaveValue('Sağlık Kurumları / Eczane')
  await expect(box).toHaveAttribute('aria-expanded', 'false')
  await expect(page.getByRole('listbox', { name: 'Kategori 1 listesi' })).toBeHidden()
})

test('the list can be driven from the keyboard alone', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  const box = page.getByLabel('Kategori 1', { exact: true })

  await box.focus()
  await box.fill('eczane')
  await page.keyboard.press('ArrowDown')

  /* Odak ALANDA kalır ve etkin seçenek `aria-activedescendant` ile
     bildirilir — WAI-ARIA'nın combobox kalıbı budur. */
  await expect(box).toBeFocused()
  await expect(box).toHaveAttribute('aria-activedescendant', /option-0$/)

  await page.keyboard.press('Enter')
  await expect(box).toHaveValue('Sağlık Kurumları / Eczane')

  /* Escape seçimi DEĞİŞTİRMEZ, yalnızca listeyi kapatır — ve PANELİ
     kapatmaz. Panel bir diyalogdur ve Escape ile kapanır; olay yukarı
     çıksaydı listeyi kapatmak için basılan tuş kurulan bütün analiz formunu
     silerdi. */
  await box.click()
  await page.keyboard.press('Escape')
  await expect(box).toHaveValue('Sağlık Kurumları / Eczane')
  await expect(page.getByRole('dialog', { name: 'Konum Analizi' })).toBeVisible()
})

test('searching one row does not filter the other', async ({ page }) => {
  /* Sorgu SATIR BAŞINADIR: bir satırda yazmak diğerinin seçeneklerini
     daraltmamalıdır. İkinci satırın listesi TIKLANMADAN okunur — açık bir
     liste komşu satırın üstünü örter ve oraya tıklamak, kullanıcının
     istemediği bir kategoriyi seçmek olurdu. */
  await prepareMap(page)
  await openPanel(page)

  const first = page.getByLabel('Kategori 1', { exact: true })
  await first.click()
  await first.fill('eczane')

  const second = await page
    .getByRole('listbox', { name: 'Kategori 2 listesi', includeHidden: true })
    .getByRole('option', { includeHidden: true })
    .allTextContents()

  expect(second.join(' ')).toContain('Okullar')
  expect(second.join(' ')).toContain('Eczane')
})

test('search never resurrects a category the rules already excluded', async ({ page }) => {
  /* Arama yalnızca bir GÖRÜNÜM filtresidir: seçilebilirlik kuralları önce
     uygulanır. Aksi hâlde yazarak, üst kategorisi zaten seçilmiş bir
     kategoriyi geri getirmek mümkün olurdu. */
  await prepareMap(page)
  await openPanel(page)

  await chooseCategory(page, 1, 'Yeme İçme')

  const options = await categoryOptions(page, 2, { type: 'kafe' })
  expect(options.join(' ')).not.toContain('Kafe')
  await expect(page.getByText('Aramanızla eşleşen kategori yok.')).toBeVisible()
})

test('the selected category survives a search that would exclude it', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  await chooseCategory(page, 1, 'Eğitim Kurumları / Okullar')

  const box = page.getByLabel('Kategori 1', { exact: true })
  await box.click()
  await box.fill('eczane')

  /* Yazmak yalnızca listeyi daraltır; SEÇİM değişmez. Escape ile alan
     seçili kategoriye geri döner — kullanıcı neyin seçili olduğunu
     kaybetmez. */
  await page.keyboard.press('Escape')
  await expect(box).toHaveValue('Eğitim Kurumları / Okullar')
})

test('the selection can be cleared back to unset', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  await chooseCategory(page, 1, 'Sağlık Kurumları / Eczane')
  await page.getByRole('button', { name: 'Kategori 1 seçimini temizle' }).click()

  /* Temizlemek satırı SİLMEZ: ölçüt "henüz seçilmedi" durumuna döner ve
     analiz düğmesi yine kapalı kalır. */
  await expect(page.getByLabel('Kategori 1', { exact: true })).toHaveValue('')
  await expect(page.getByRole('button', { name: 'ANALİZİ BAŞLAT' })).toBeDisabled()
})

test('a sixth criterion cannot be added', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  const add = page.getByRole('button', { name: '+ Kriter ekle' })
  for (let i = 0; i < 3; i += 1) await add.click()

  await expect(page.getByLabel('Kategori 5', { exact: true })).toBeVisible()
  await expect(add).toBeDisabled()
  await expect(page.getByLabel('Kategori 6', { exact: true })).toHaveCount(0)
})

test('the last two criteria cannot be removed', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  await expect(page.getByRole('button', { name: '1. kriteri kaldır' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '2. kriteri kaldır' })).toBeDisabled()
})

test('an ancestor removes its descendants from the other row', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  await chooseCategory(page, 1, 'Yeme İçme')

  /* "Yeme İçme" alt ağacının tamamını kapsar; kafe ve restoran ikinci satırda
     SEÇİLEBİLİR OLMAMALIDIR — sunucu da ikisini birlikte reddeder. */
  const options = await categoryOptions(page, 2)
  expect(options).not.toContain('Yeme İçme')
  expect(options).not.toContain('Yeme İçme / Kafe')
  expect(options).not.toContain('Yeme İçme / Restoran')
  expect(options).toContain('Eğitim Kurumları / Okullar')
})

/* --- Gönderilen analiz ----------------------------------------------------------- */

test('analyze posts the summary and then the weighted image', async ({ page }) => {
  const { summaryRequests, imageRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page, { firstWeight: 10, secondWeight: 90 })

  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect.poll(() => summaryRequests.length).toBeGreaterThan(0)
  expect(summaryRequests[0].criteria).toEqual([
    { categorySlug: 'eczane', weight: 10 },
    { categorySlug: 'okullar', weight: 90 },
  ])
  expect(summaryRequests[0].areaWkts.length).toBeGreaterThan(0)
  expect(summaryRequests[0].areaWkts[0]).toMatch(/^POLYGON \(/)

  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)
  await expect(page.locator('.location-analysis-layer')).toHaveCount(1)
  await expect(page.getByText('Eşleşen POI:')).toBeVisible()
})

test('the image request carries canonical EPSG:4326 lon/lat degrees, never Web Mercator metres', async ({ page }) => {
  /* PHASE 4C REGRESYONU. Ham 3857 metreleri göndermek doğrulamayı GEÇER ama
     dünyanın başka bir yerini çizer; eksen takası ise sunucunun işidir ve
     burada uygulanmamalıdır. */
  const { imageRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)

  const parts = imageRequests[0].bbox.split(',').map(Number)
  expect(parts).toHaveLength(4)

  // Derece ölçeğinde: hiçbir değer metre olamaz.
  for (const value of parts) expect(Math.abs(value)).toBeLessThan(200)
  expect(parts[0]).toBeGreaterThanOrEqual(-180)
  expect(parts[2]).toBeLessThanOrEqual(180)
  expect(parts[1]).toBeGreaterThanOrEqual(-90)
  expect(parts[3]).toBeLessThanOrEqual(90)
  // Kanonik düzen: min < max her iki eksende de.
  expect(parts[0]).toBeLessThan(parts[2])
  expect(parts[1]).toBeLessThan(parts[3])

  // Boyutlar ve piksel oranı ayrı alanlardır; oran boyutları çarpmaz.
  expect(imageRequests[0].width).toBeGreaterThan(0)
  expect(imageRequests[0].height).toBeGreaterThan(0)
  expect(imageRequests[0].pixelRatio).toBeGreaterThanOrEqual(1)
})

/* --- Coğrafi kararlılık: bildirilen GERÇEK hatanın regresyonu ---------------------

   Canlı tarayıcıda gönderilen analiz hiç değişmediği hâlde, harita
   kaydırılıp yakınlaştırıldıkça ısı lekesi başka bir coğrafyaya taşınıyordu.
   Sebeplerden biri mimariydi: görüntü GÖRÜNÜMDEN türetiliyor, her `moveend`
   yeni bir zarf ve yeni bir normalleştirme üretiyordu.

   Sözleşme artık şudur: görüntü ANALİZ ALANINA aittir. Kaydırmak ve
   yakınlaştırmak saf gezinmedir. */

/** Haritayı gerçekten kaydırır ve yakınlaştırır (moveend üretir). */
async function panAndZoom(page) {
  const canvas = page.locator('.map-container canvas').first()
  const box = await canvas.boundingBox()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2 - 120, { steps: 12 })
  await page.mouse.up()

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -600)
  await page.waitForTimeout(400)
  await page.mouse.wheel(0, 900)
  await page.waitForTimeout(600)
}

test('panning inside the current LOD never requests a new heatmap', async ({ page }) => {
  const { imageRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)
  const afterAnalyse = imageRequests.length

  const canvas = page.locator('.map-container canvas').first()
  const box = await canvas.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 - 180, box.y + box.height / 2 - 120, { steps: 12 })
  await page.mouse.up()
  await page.waitForTimeout(400)

  expect(imageRequests.length).toBe(afterAnalyse)
})

test('crossing heatmap LOD boundaries requests new rasters over the unchanged analysis extent', async ({ page }) => {
  const { imageRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)

  const originalBbox = imageRequests[0].bbox
  const zoomIn = page.locator('.ol-zoom-in')

  /* Ankara'ya fit edilen uzak görünümden çok yakın banda kadar ilerle.
     Aynı bant içindeki ara zoomlar istek açmaz; yalnızca sınırlar açar. */
  for (let index = 0; index < 10; index += 1) {
    await zoomIn.click()
    await page.waitForTimeout(280)
  }

  await expect.poll(() => new Set(imageRequests.map((request) => request.heatmapLod)).size)
    .toBeGreaterThanOrEqual(3)

  expect(new Set(imageRequests.map((request) => request.heatmapLod))).toEqual(
    new Set(['far', 'medium', 'near', 'very_near']),
  )
  expect(imageRequests.every((request) => request.bbox === originalBbox)).toBe(true)

  const atVeryNear = imageRequests.length
  await zoomIn.click()
  await page.waitForTimeout(350)
  expect(imageRequests.length).toBe(atVeryNear)
})

test('the heatmap window is the analysis area, not the viewport', async ({ page }) => {
  const { imageRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)
  const [minLon, minLat, maxLon, maxLat] = imageRequests[0].bbox.split(',').map(Number)

  /* Pencere Ankara ilinin KENDİ zarfıdır (yaklaşık lon 30.74..34.06,
     lat 38.56..40.79, artı küçük bir çekirdek payı).

     Sınır DAR tutulur ve bu bilinçlidir: il seçilince harita zaten alana
     yakınlaşır (`fitToArea`), dolayısıyla gevşek bir sınır ekran penceresiyle
     alan zarfını ayırt EDEMEZDİ. Ekran penceresi ayrıca ekranın en-boy
     oranını taşır; alan zarfı taşımaz. */
  expect(minLon).toBeCloseTo(30.74, 1)
  expect(minLat).toBeCloseTo(38.56, 1)
  expect(maxLon).toBeCloseTo(34.06, 1)
  expect(maxLat).toBeCloseTo(40.79, 1)

  /* Görüntü artık ekranın değil alanın çözünürlüğündedir; oran BİR'dir,
     çünkü ısı çekirdeğinin yarıçapı coğrafi bir ölçüdür ve izleyicinin
     ekran yoğunluğuna göre değişemez. */
  expect(imageRequests[0].pixelRatio).toBe(1)
})

test('the same analysis asks for the same window every time', async ({ page }) => {
  const { imageRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)

  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)
  const first = imageRequests[0]

  await panAndZoom(page)

  // Aynı analizi yeniden çalıştır: pencere BİREBİR aynı olmalıdır.
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => imageRequests.length).toBeGreaterThan(1)
  const second = imageRequests[imageRequests.length - 1]

  expect(second.bbox).toBe(first.bbox)
})

test('changing the weights keeps the window and changes only the analysis', async ({ page }) => {
  /* Ağırlık değişimi ile projeksiyon kayması ayırt edilebilmelidir: desen
     değişir, COĞRAFYA değişmez. */
  const { imageRequests } = await prepareMap(page)
  await openPanel(page)

  await configure(page, { firstWeight: 90, secondWeight: 10 })
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)
  const heavyHealth = imageRequests[imageRequests.length - 1]

  await page.getByLabel('Ağırlık 1').fill('10')
  await page.getByLabel('Ağırlık 2').fill('90')
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => imageRequests.length).toBeGreaterThan(1)
  const heavyEducation = imageRequests[imageRequests.length - 1]

  // Aynı alan → aynı pencere.
  expect(heavyEducation.bbox).toBe(heavyHealth.bbox)
  // Farklı ağırlık → farklı analiz.
  expect(heavyEducation.criteria).not.toEqual(heavyHealth.criteria)
})

test('a drawn area gets its own window, with nothing left from the province', async ({ page }) => {
  const { imageRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)

  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)
  const province = imageRequests[imageRequests.length - 1]

  // Alanı değiştirmek gönderilmiş analizi geçersizler.
  await page.getByRole('button', { name: 'Haritada Çiz' }).click()
  await expect(page.getByText('Henüz bir alan seçilmedi.')).toBeVisible()

  // Yeni alan seçilene kadar yeni bir görüntü İSTENMEZ.
  await page.waitForTimeout(400)
  expect(imageRequests[imageRequests.length - 1].bbox).toBe(province.bbox)
})

test('the browser never sends GeoServer internals', async ({ page }) => {
  const { imageRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)

  const keys = Object.keys(imageRequests[0]).map((key) => key.toLowerCase())
  for (const forbidden of ['cql_filter', 'cql', 'env', 'sld', 'sld_body', 'layers', 'styles', 'viewparams']) {
    expect(keys).not.toContain(forbidden)
  }
  expect(keys.sort()).toEqual(
    [
      'administrativetargetkey',
      'administrativetargettype',
      'areawkts',
      'bbox',
      'criteria',
      'heatmaplod',
      'height',
      'pixelratio',
      'width',
    ].sort(),
  )
})

test('changing a weight after analysing removes the stale heatmap', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect(page.locator('.location-analysis-layer')).toHaveCount(1)

  /* Yeni ağırlıklar SESSİZCE çizilmez ve eski raster de ekranda bırakılmaz:
     ikisi de kullanıcıya istemediği bir cevabı doğru gibi gösterirdi. */
  await page.getByLabel('Ağırlık 1').fill('40')
  await expect(page.locator('.location-analysis-layer')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'ANALİZİ BAŞLAT' })).toBeDisabled()
})

test('an empty result is an honest empty state, not a blank raster', async ({ page }) => {
  await prepareMap(page, { summaryTotal: 0 })
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect(page.getByText('Seçilen alan ve kriterlere uygun POI bulunamadı.')).toBeVisible()
  await expect(page.locator('.location-analysis-layer')).toHaveCount(0)
})

test('an upstream image failure is reported and can be retried', async ({ page }) => {
  await prepareMap(page, {
    imageHandler: (route, callNumber) =>
      callNumber === 1
        ? route.fulfill(json({ message: 'GeoServer geçerli bir PNG yanıtı döndürmedi.' }, 502))
        : route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL_PNG }),
  })
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect(page.getByRole('alert')).toContainText(/harita sunucusuna ulaşılamadı/i)
  await page.getByRole('button', { name: 'Yeniden dene' }).click()
  await expect(page.locator('.location-analysis-layer')).toHaveCount(1)
})

test('a summary failure is shown without leaving a heatmap behind', async ({ page }) => {
  await prepareMap(page, { summaryStatus: 400 })
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect(page.getByRole('alert')).toBeVisible()
  await expect(page.locator('.location-analysis-layer')).toHaveCount(0)
})

test('clear removes the result, the area and the criteria', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect(page.locator('.location-analysis-layer')).toHaveCount(1)

  await page.getByRole('button', { name: 'Temizle', exact: true }).click()

  await expect(page.locator('.location-analysis-layer')).toHaveCount(0)
  await expect(page.getByText('Henüz bir alan seçilmedi.')).toBeVisible()
  await expect(page.getByText('0 / 100')).toBeVisible()
  await expect(page.getByRole('button', { name: 'ANALİZİ BAŞLAT' })).toBeDisabled()
})

test('active analysis hides normal POIs and Clear removes analysis markers then restores normal POIs', async ({ page }) => {
  await prepareMap(page, { normalPois: [NORMAL_APP_POI] })
  await expect(page.locator('.poi-layer')).toBeVisible()
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect(page.locator('.location-analysis-layer')).toHaveCount(1)
  await expect(page.locator('.poi-layer')).toBeHidden()
  await expect(page.locator('.poi-presentation-layer')).toHaveCount(0)

  await page.getByLabel(POI_TOGGLE).check()
  await expect(page.locator('.location-analysis-points-layer')).toHaveCount(1)

  await page.getByRole('button', { name: 'Temizle', exact: true }).click()
  await expect(page.locator('.location-analysis-points-layer')).toHaveCount(0)
  await expect(page.locator('.poi-layer')).toBeVisible()
})

test('clear preserves a normal POI layer that was already disabled', async ({ page }) => {
  await prepareMap(page, { normalPois: [NORMAL_APP_POI] })
  await page.getByRole('button', { name: 'Katmanlar' }).click()
  const normalPoiRow = page.getByTestId('layers-poi-row')
  await normalPoiRow.click()
  await expect(normalPoiRow).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('button', { name: 'Katmanlar panelini kapat' }).click()

  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await page.getByRole('button', { name: 'Temizle', exact: true }).click()

  await expect(page.locator('.poi-layer')).toBeHidden()
})

test('analysis POI toggle never reveals unrelated normal POIs', async ({ page }) => {
  await prepareMap(page, { normalPois: [NORMAL_APP_POI] })
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await page.getByLabel(POI_TOGGLE).check()
  await expect(page.locator('.location-analysis-points-layer')).toHaveCount(1)
  await expect(page.locator('.poi-layer')).toBeHidden()

  await page.getByLabel(POI_TOGGLE).uncheck()
  await expect(page.locator('.location-analysis-points-layer')).toHaveCount(0)
  await expect(page.locator('.poi-layer')).toBeHidden()
})

/* --- Efsane --------------------------------------------------------------------- */

/* --- Sonuç etiketleri ------------------------------------------------------------ */

test('the result names the criterion the way the selector named it', async ({ page }) => {
  /* Bildirilen GERÇEK karışıklık: seçicide "Sağlık Kurumları / Eczane" yazıyor,
     sonuç satırında yalnızca "Eczane" görünüyordu — kullanıcı seçmediği bir
     ölçüte bakıyormuş gibi oluyordu. Sunucu ölçütün kimliğini zaten doğru
     döndürüyor; yanlış olan tek şey etiketin BİÇİMİYDİ. */
  await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  const summary = page.locator('.la-summary')
  await expect(summary).toBeVisible()

  // Seçicideki etiketin AYNISI.
  await expect(summary).toContainText('Sağlık Kurumları / Eczane')
  await expect(summary).toContainText('Eğitim Kurumları / Okullar')

  /* Seçilen ölçütün adı, yalın bir yaprak adına İNDİRGENMEMELİDİR. Satırın
     tamamı yol olduğu için yalın ad tek başına hiçbir satırda kalmaz. */
  const rows = await summary.locator('li > span:first-child').allTextContents()
  expect(rows).not.toContain('Eczane')
  expect(rows).not.toContain('Okullar')
})

test('a root criterion keeps its own name and says the count includes descendants', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)

  await page.getByLabel('İl', { exact: true }).selectOption({ label: 'Ankara' })
  await chooseCategory(page, 1, 'Sağlık Kurumları')
  await page.getByLabel('Ağırlık 1').fill('50')
  await chooseCategory(page, 2, 'Eğitim Kurumları')
  await page.getByLabel('Ağırlık 2').fill('50')
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  const summary = page.locator('.la-summary')
  await expect(summary).toBeVisible()

  const rows = await summary.locator('li > span:first-child').allTextContents()
  expect(rows).toEqual(['Sağlık Kurumları', 'Eğitim Kurumları'])

  /* Üst kategori seçildiğinde sayaç alt ağacın tamamıdır; bunu söylememek
     eksik bir sayım izlenimi verirdi. */
  await expect(summary).toContainText('Sayılar kapsanan alt kategorileri de içerir.')
})

/* --- Alan kırpması ---------------------------------------------------------------

   İstenen pencere bir DİKDÖRTGENDİR, seçilen alan ise değildir; üstelik ısı
   çekirdeği kaynak noktanın ötesine taşar. Kırpma olmadan (ya da yalnızca
   sınırlayıcı kutuya kırpınca) seçilmemiş komşu illerin üzerinde boyalı bir
   alan kalırdı.

   Ölçüldü: Ankara poligonu kendi sınırlayıcı kutusunun yalnızca %42,6'sını
   doldurur. Bu testin ayırt ediciliği buradan gelir — kutuya kırpılmış bir
   raster boyalı dikdörtgenin ~%100'ünü doldururdu. */

/** Isı haritası katmanının KENDİ tuvalindeki opak piksellerin dağılımı. */
async function heatmapCoverage(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.location-analysis-layer canvas')
    if (!canvas) return null
    const context = canvas.getContext('2d', { willReadFrequently: true })
    const { data, width, height } = context.getImageData(0, 0, canvas.width, canvas.height)

    let opaque = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (data[(y * width + x) * 4 + 3] === 0) continue
        opaque += 1
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }

    if (opaque === 0) return { opaque: 0, boxArea: 0, fill: 0 }
    const boxArea = (maxX - minX + 1) * (maxY - minY + 1)
    return { opaque, boxArea, fill: opaque / boxArea }
  })
}

test('the heatmap is clipped to the province polygon, not to its bounding box', async ({ page }) => {
  /* Raster BAŞTAN SONA opaktır: ekranda kalan her piksel maskenin geçirdiği
     pikseldir, GeoServer'ın boyadığı değil. */
  await prepareMap(page, { heatmapBody: SOLID_PNG })
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect.poll(async () => (await heatmapCoverage(page))?.opaque ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0)

  const coverage = await heatmapCoverage(page)

  /* Sınırlayıcı kutuya kırpılmış bir raster kutusunu TAMAMEN doldururdu.
     Ankara poligonu kutusunun yarısından azını doldurur. */
  expect(coverage.fill).toBeLessThan(0.75)

  // Ama bir şey gerçekten çizilmiş olmalı: boş bir katman da bu sınırı geçerdi.
  expect(coverage.fill).toBeGreaterThan(0.15)
})

test('a drawn area clips the heatmap to that area alone', async ({ page }) => {
  /* Alan değiştiğinde maske de değişir: ilin şeklinden kalan hiçbir şey
     yeni alanın üstünde durmamalıdır. */
  await prepareMap(page, { heatmapBody: SOLID_PNG })
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect.poll(async () => (await heatmapCoverage(page))?.opaque ?? 0, { timeout: 15_000 })
    .toBeGreaterThan(0)

  // Alanı bırak: gönderilmiş analiz düşer, raster da onunla gider.
  await page.getByRole('button', { name: 'Haritada Çiz' }).click()
  await expect(page.getByText('Henüz bir alan seçilmedi.')).toBeVisible()

  await expect.poll(async () => {
    const coverage = await heatmapCoverage(page)
    return coverage === null ? 0 : coverage.opaque
  }, { timeout: 10_000 }).toBe(0)
})

/* --- Analiz POI örtüsü ------------------------------------------------------------

   Kullanıcı analize giren POI'leri GÖRMEK istedi. Örtü sunucuda çizilir ve tek
   bir PNG olarak gelir; 7853 nokta tarayıcıya indirilmez. Buradaki testlerin
   işi, örtünün ısı haritasıyla AYNI analizi göstermesini sabitlemektir. */

const POI_TOGGLE = "Analiz POI'lerini Göster"

test('the analysis POI overlay is off until it is asked for', async ({ page }) => {
  const { pointRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)

  // Analiz gönderilmeden anahtar YOKTUR: gösterecek bir küme de yoktur.
  await expect(page.getByLabel(POI_TOGGLE)).toBeHidden()

  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  const toggle = page.getByLabel(POI_TOGGLE)
  await expect(toggle).toBeVisible()
  await expect(toggle).not.toBeChecked()

  /* Varsayılan KAPALI: analizin cevabı ısı haritasıdır, binlerce nokta
     sorulmadan onun üstüne serilmez. */
  await page.waitForTimeout(300)
  expect(pointRequests).toHaveLength(0)
})

test('turning the overlay on requests exactly the analysed set', async ({ page }) => {
  const { imageRequests, pointRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)

  await page.getByLabel(POI_TOGGLE).check()
  await expect.poll(() => pointRequests.length).toBeGreaterThan(0)

  /* ÖRTÜ ILE RASTER AYNI ANALİZDİR: aynı alan, aynı ölçütler. Ayrışan bir
     örtü, kullanıcının analize girmeyen noktaları sonuç sanması olurdu.
     Pencere ARTIK KARŞILAŞTIRILMAZ: vektör listesi bir görüntü penceresi
     taşımaz, çünkü noktalar rasterleştirilmez. */
  const points = pointRequests[0]
  const heatmap = imageRequests[0]
  expect(points.areaWkts).toEqual(heatmap.areaWkts)
  expect(points.criteria).toEqual(heatmap.criteria)
  expect(points.bbox).toBeUndefined()

  // Tarayıcı burada da GeoServer iç bilgisi göndermez.
  const keys = Object.keys(points).map((key) => key.toLowerCase())
  for (const forbidden of ['cql_filter', 'cql', 'env', 'sld', 'sld_body', 'layers', 'styles', 'viewparams']) {
    expect(keys).not.toContain(forbidden)
  }
})

test('the overlay follows the analysis and disappears on clear', async ({ page }) => {
  const { pointRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await page.getByLabel(POI_TOGGLE).check()
  await expect.poll(() => pointRequests.length).toBeGreaterThan(0)
  const afterFirst = pointRequests.length

  // Yeni ağırlıklar → yeni analiz → örtü de yenilenir.
  await page.getByLabel('Ağırlık 1').fill('10')
  await page.getByLabel('Ağırlık 2').fill('90')
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => pointRequests.length).toBeGreaterThan(afterFirst)
  expect(pointRequests[pointRequests.length - 1].criteria)
    .not.toEqual(pointRequests[0].criteria)

  // Temizle: anahtar da örtü de gider.
  await page.getByRole('button', { name: 'Temizle', exact: true }).click()
  await expect(page.getByLabel(POI_TOGGLE)).toBeHidden()
})

test('panning and zooming never refetches the analysis POIs', async ({ page }) => {
  const { pointRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await page.getByLabel(POI_TOGGLE).check()
  await expect.poll(() => pointRequests.length).toBeGreaterThan(0)

  const before = pointRequests.length
  await panAndZoom(page)

  /* Örtü de ANALİZE aittir: veri gezinmeyle yeniden çekilmez. Vektörler
     zaten haritada durur ve OpenLayers onları her ölçekte KESKİN çizer —
     rasterin pikselleşme sorunu yapısal olarak ortadan kalkar. */
  expect(pointRequests.length).toBe(before)
})

test('the overlay disappears when the analysis permission is missing', async ({ page }) => {
  /* Yeni bir yetki TANIMLANMADI: örtü konum analizinin erişim sözleşmesine
     bağlıdır. */
  await prepareMap(page, { permissions: [...BASE_PERMISSIONS, POI_VIEW] })
  await expect(page.getByRole('button', { name: 'Konum Analizi', exact: true })).toBeHidden()
  await expect(page.getByLabel(POI_TOGGLE)).toBeHidden()
})

/* --- Çalışma zamanı: BEYAZ EKRAN regresyonu ---------------------------------------

   Phase 5C, POI kartını bir `ol/Overlay` ile haritaya çaktı ama kartın kök
   düğümünü JSX içinde render edip OpenLayers'a VERDİ. OpenLayers o düğümü
   kendi overlay konteynerine TAŞIR; React ise onu hâlâ MapPage ağacının bir
   çocuğu sanmaya devam eder. Bir sonraki uzlaştırmada React kardeş düğümler
   için `insertBefore` çağırır, düğüm artık o ebeveynin çocuğu olmadığı için
   `NotFoundError` fırlar ve TÜM uygulama beyaz ekrana düşer.

   <b>`toBeVisible()` bunu yakalayamazdı.</b> Çökme bir DOM görünürlüğü sorunu
   değil, yakalanmamış bir istisnadır; bu yüzden ölçülen şey `pageerror`dır.
   Ayrıca çökme yalnızca Overlay DOM'u taşıDIKTAN SONRA React yeniden
   uzlaştırınca ortaya çıkar — test bu yüzden kart açıldıktan SONRA bir
   yeniden render'ı ZORLAR. */

/** Sayfadaki yakalanmamış istisnaları toplar. */
function collectPageErrors(page) {
  const errors = []
  page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`))
  return errors
}

test('the app survives the analysis POI popup and later React renders', async ({ page }) => {
  const pageErrors = collectPageErrors(page)

  await analyseWithOverlay(page, {
    /* Isı haritası yetkisi BİLEREK verilir: çökmeyi tetikleyen şey, JSX'te
       karttan ÖNCE gelen kardeşin mount edilmesidir. */
    permissions: [...BOTH, 'heatmap.view'],
  })

  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeVisible()
  expect(pageErrors, `kart açılırken hata: ${pageErrors.join(' | ')}`).toEqual([])

  /* --- Asıl tetikleyici ----------------------------------------------------

     Overlay konteyneri DOM'da taşıDIKTAN SONRA, React'in kartın ÖNÜNE bir
     kardeş düğüm eklemesi gerekir. Isı haritası paneli MapPage'de tam olarak
     o konumdadır ve kapalıyken `null` döner; açmak React'i
     `parent.insertBefore(panel, kartınKökü)` çağırmaya zorlar.

     Overlay'in kökü bir JSX düğümü olsaydı OpenLayers onu çoktan başka bir
     ebeveyne taşımış olurdu ve bu çağrı `NotFoundError` ile patlayıp TÜM
     uygulamayı beyaz ekrana düşürürdü — ölçülen çökme buydu. */
  if (await page.getByRole('button', { name: 'Menüyü aç' }).isVisible()) {
    await page.getByRole('button', { name: 'Menüyü aç' }).click()
  }
  await page.getByRole('button', { name: 'Isı Haritası Analizi', exact: true }).click()
  await page.waitForTimeout(600)

  expect(
    pageErrors,
    `önceki kardeş mount edilirken hata: ${pageErrors.join(' | ')}`,
  ).toEqual([])

  /* Uygulama SADECE hata vermemiş değil, AYAKTA olmalı: beyaz ekranın
     tanımı kabuğun kaybolmasıdır. */
  await expect(page.locator('.map-container canvas').first()).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Isı Haritası Analizi' })).toBeVisible()

  // Kardeşi tekrar söküp takmak da güvenli olmalı.
  await page.getByRole('button', { name: 'Isı Haritası Analizi panelini kapat' }).click()
  await page.waitForTimeout(400)
  expect(pageErrors, `kardeş unmount edilirken hata: ${pageErrors.join(' | ')}`).toEqual([])
  await expect(page.locator('.map-container canvas').first()).toBeVisible()
})

test('the overlay container is owned by OpenLayers, never by the React tree', async ({ page }) => {
  /* Çökmenin KÖKÜ tek bir cümledir: overlay'in kök düğümü hem bir JSX
     ağacının çocuğu hem de OpenLayers'ın taşıdığı bir düğüm olamaz. Burada
     ölçülen şey tam olarak o sınırdır — hata mesajı değil, SAHİPLİK. */
  await analyseWithOverlay(page, {
  })
  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeVisible()

  const ownership = await page.evaluate(() => {
    const popup = document.querySelector('.analysis-poi-popup')
    const container = popup?.parentElement
    return {
      // Kartın kökü, OpenLayers'ın overlay konteynerinin İÇİNDEDİR.
      insideOverlayContainer: Boolean(container?.closest('.ol-overlaycontainer-stopevent')),
      // Konteyner bizim ürettiğimiz ÇIPLAK div'dir: JSX'ten gelen bir sınıf taşımaz.
      containerIsBare: container?.className === '',
      // Kart, harita kabuğunun JSX kardeşleri arasında DEĞİLDİR.
      notASiblingOfPanels: !popup?.parentElement?.querySelector(':scope > .map-sheet'),
    }
  })

  expect(ownership.insideOverlayContainer).toBe(true)
  expect(ownership.containerIsBare).toBe(true)
  expect(ownership.notASiblingOfPanels).toBe(true)
})

test('StrictMode double mounting leaves exactly one overlay behind', async ({ page }) => {
  /* Geliştirme modunda React her efekti mount → cleanup → mount olarak iki kez
     çalıştırır. Konteyner efektin İÇİNDE üretilseydi ya da temizlik overlay'i
     haritadan almasaydı, ikinci montaj ikinci bir overlay bırakır ve kart
     ekranda çift görünürdü. */
  const pageErrors = collectPageErrors(page)

  await analyseWithOverlay(page, {
  })
  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeVisible()

  const counts = await page.evaluate(() => ({
    popups: document.querySelectorAll('.analysis-poi-popup').length,
    cards: document.querySelectorAll('.analysis-poi-popup .app-card').length,
    /* YALNIZCA overlay konteynerleri sayılır: OpenLayers kendi denetimlerini
       (zoom, ölçek, atıf) de aynı kutunun içine koyar ve onlar bu testin
       konusu değildir. */
    overlayContainers: document.querySelectorAll(
      '.ol-overlaycontainer-stopevent > .ol-overlay-container',
    ).length,
    overlayContainerClasses: [...document.querySelectorAll(
      '.ol-overlaycontainer-stopevent > .ol-overlay-container',
    )].map((node) => node.className),
  }))

  expect(counts.popups).toBe(1)
  expect(counts.cards).toBe(1)
  /* YETİM overlay kalmamalı: her montaj kendi overlay'ini bırakırsa bu sayı
     büyür ve kart ekranda çift görünürdü. */
  expect(
    counts.overlayContainers,
    `fazladan overlay: ${JSON.stringify(counts.overlayContainerClasses)}`,
  ).toBe(1)

  expect(pageErrors).toEqual([])
})

test('opening the map with the analysis popup mounted raises no runtime error', async ({ page }) => {
  /* Kart, gönderilmiş bir analiz olmasa da MapPage ağacında MONTELİDİR;
     Overlay harita hazır olur olmaz kurulur. Çökme bu yüzden kullanıcı hiçbir
     şey yapmadan, /map açılışında da gelebilir. */
  const pageErrors = collectPageErrors(page)

  await prepareMap(page)
  await openPanel(page)
  await configure(page)

  await expect(page.locator('.map-container canvas').first()).toBeVisible()
  expect(pageErrors, `açılışta hata: ${pageErrors.join(' | ')}`).toEqual([])
})

/* --- Analiz POI incelemesi --------------------------------------------------------

   Analiz POI'leri artık GERÇEK OpenLayers feature'larıdır: normal POI'lerle
   aynı kategori rozetleriyle çizilir, yakınlaştırmada pikselleşmez ve kimlik
   zaten tarayıcıdadır. Tıklama bu yüzden ağa çıkmaz — isabet denetimi normal
   POI etkileşimiyle aynı kalıptır. */

/**
 * Analiz POI kümesi — <b>gerçek</b> taksonomiden, Ankara zarfının merkezinde.
 *
 * Küme bir IZGARADIR ve bu bilinçlidir: il seçilince harita Ankara'ya
 * yakınlaşır (`fitToArea`) ve test haritanın merkezine tıklar. Tek bir noktayı
 * merkeze koymak kırılgan olurdu — Web Mercator'da bir zarfın enlem merkezi
 * aritmetik ortalamadan sapar. Izgara o farkı yutar ve gerçek kullanıma da
 * benzer: gerçek Ankara kümesi 1882 kayıttır.
 *
 * İki ayrı kategori kullanılır ki rozetin KAYIT BAŞINA çözüldüğü, hepsinin
 * aynı simgeye düşmediği görülebilsin.
 */
function analysisPoiCluster(overrides = {}) {
  const rows = []
  let id = 1

  for (let stepLon = -10; stepLon <= 10; stepLon += 1) {
    for (let stepLat = -10; stepLat <= 10; stepLat += 1) {
      const isSchool = id % 2 === 0

      rows.push({
        id: id++,
        featureId: `osm:${id - 1}`,
        name: isSchool ? 'Halide Edip Adıvar İlköğretim Okulu' : 'Selda Yıldırım Eczanesi',
        categoryId: isSchool ? 35 : 33,
        categorySlug: isSchool ? 'okullar' : 'eczane',
        categoryName: isSchool ? 'Okullar' : 'Eczane',
        categoryPath: isSchool ? 'Eğitim Kurumları / Okullar' : 'Sağlık Kurumları / Eczane',
        longitude: 32.4005 + stepLon * 0.01,
        latitude: 39.6754 + stepLat * 0.01,
        source: 'OpenStreetMap',
        ...overrides,
      })
    }
  }

  return rows
}

/** Kümeyi tek bir alana göre yeniden yazan bir yanıt gövdesi. */
const clusterBody = (overrides = {}) => ({
  pois: analysisPoiCluster(overrides),
  totalCount: analysisPoiCluster().length,
  limit: 5000,
  truncated: false,
})

/**
 * Haritaya TEK tıklar.
 *
 * Art arda gelen iki tıklama OpenLayers için bir ÇİFT TIKLAMADIR ve `singleclick`
 * bilinçli olarak bastırılır (çift tık yakınlaştırmadır). Testin ölçmek
 * istediği şey bu değil, dolayısıyla tıklamalar ayrılır.
 */
async function clickMap(page, dx = 0, dy = 0) {
  const box = await page.locator('.map-container canvas').first().boundingBox()
  await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy)
  await page.waitForTimeout(320)
}

async function analyseWithOverlay(page, options = {}) {
  const handles = await prepareMap(page, options)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => handles.imageRequests.length).toBeGreaterThan(0)
  await page.getByLabel(POI_TOGGLE).check()
  await expect.poll(() => handles.pointRequests.length).toBeGreaterThan(0)
  return handles
}

test('clicking does nothing while the POI overlay is off', async ({ page }) => {
  const { imageRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)

  // Örtü KAPALI: görünmeyen bir noktayı tıklamak diye bir şey yoktur.
  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeHidden()
})

test('clicking a rendered POI opens its card without going to the server', async ({ page }) => {
  /* Noktalar gerçek feature'lardır: kimlik zaten tarayıcıdadır ve her tıklama
     için bir sorgu açmak gereksiz bir gidiş dönüş olurdu. */
  const requestedPaths = []
  await page.route('**/api/analysis/**', async (route) => {
    requestedPaths.push(new URL(route.request().url()).pathname)
    await route.fallback()
  })

  await analyseWithOverlay(page)
  const before = requestedPaths.length

  await clickMap(page)

  const popup = page.getByRole('dialog', { name: 'Analiz POI bilgisi' })
  await expect(popup).toBeVisible()

  // Tıklama HİÇBİR analiz isteği açmamalı.
  expect(requestedPaths.slice(before)).toEqual([])

  /* Kart, kaydın kendi kategorisini TAM YOLLA gösterir — panelin ölçüt
     seçicisiyle aynı biçim. */
  await expect(popup).toContainText(/Eğitim Kurumları \/ Okullar|Sağlık Kurumları \/ Eczane/)
  await expect(popup).toContainText('OpenStreetMap')
  await expect(popup).toContainText('39.')
})

test('overlapping analysis POIs resolve to exactly one rendered feature and one popup', async ({ page }) => {
  const coordinate = { longitude: 32.4005, latitude: 39.6754 }
  const overlapping = [
    {
      featureId: 'osm:42', id: 42, name: 'Birinci POI', categoryId: 33,
      categorySlug: 'eczane', categoryName: 'Eczane',
      categoryPath: 'Sağlık Kurumları / Eczane', source: 'OpenStreetMap', ...coordinate,
    },
    {
      featureId: 'app:42', id: 42, name: 'İkinci POI', categoryId: 33,
      categorySlug: 'eczane', categoryName: 'Eczane',
      categoryPath: 'Sağlık Kurumları / Eczane', source: 'Uygulama', ...coordinate,
    },
  ]

  await analyseWithOverlay(page, {
    pointsHandler: (route) => route.fulfill(json({
      pois: overlapping,
      totalCount: overlapping.length,
      limit: 5000,
      truncated: false,
    })),
  })

  await clickMap(page)

  const popups = page.getByRole('dialog', { name: 'Analiz POI bilgisi' })
  await expect(popups).toHaveCount(1)
  const text = await popups.textContent()
  expect(['Birinci POI', 'İkinci POI'].filter((name) => text.includes(name))).toHaveLength(1)
})

test('the analysis POIs are vectors, and the raster overlay is never requested', async ({ page }) => {
  /* Raster nokta örtüsü ARTIK KULLANILMIYOR: pikselleşiyordu ve noktaları
     projenin kendi kategori simgeleriyle değil anonim dairelerle çiziyordu. */
  const { pointRequests, rasterPointRequests } = await analyseWithOverlay(page)

  expect(pointRequests.length).toBeGreaterThan(0)
  expect(rasterPointRequests, 'WMS nokta PNG\'i istenmemeli').toHaveLength(0)

  // İstek yalnızca aktif analizi taşır; GeoServer iç bilgisi YOKTUR.
  const keys = Object.keys(pointRequests[0]).map((key) => key.toLowerCase())
  expect(keys.sort()).toEqual([
    'administrativetargetkey',
    'administrativetargettype',
    'areawkts',
    'criteria',
  ].sort())
  for (const forbidden of ['cql_filter', 'cql', 'env', 'sld', 'layers', 'styles', 'viewparams', 'sql']) {
    expect(keys).not.toContain(forbidden)
  }

  // Katman gerçekten vektördür: kendi tuvalini taşır.
  await expect(page.locator('.location-analysis-points-layer'))
    .toHaveCount(1)
})

test('the panel reports how many POIs are drawn', async ({ page }) => {
  await analyseWithOverlay(page)

  await expect(page.getByText(/Haritada .* POI gösteriliyor/)).toBeVisible()
})

test('a truncated result says so instead of hiding the difference', async ({ page }) => {
  /* Kesme SESSİZ OLMAZ: eksik bir sonucu tam sanmak, analizin cevabını
     yanlış okumaktır. */
  await analyseWithOverlay(page, {
    pointsHandler: (route) => route.fulfill(json({
      ...clusterBody(),
      totalCount: 9000,
      limit: 5000,
      truncated: true,
    })),
  })

  await expect(page.getByText(/yalnızca ilk .* POI çizildi/)).toBeVisible()
})

test('a POI without a name is named honestly, never "null"', async ({ page }) => {
  /* Gerçek Ankara kümesinde 182 adsız kayıt var. */
  await analyseWithOverlay(page, {
    pointsHandler: (route) => route.fulfill(json(clusterBody({ name: null }))),
  })

  await clickMap(page)

  const popup = page.getByRole('dialog', { name: 'Analiz POI bilgisi' })
  await expect(popup).toBeVisible()
  await expect(popup).toContainText('İsimsiz POI')
  await expect(popup).not.toContainText('null')
  await expect(popup).not.toContainText('undefined')

  // Kategori satırı hâlâ kaydın ne olduğunu söyler.
  await expect(popup).toContainText(/Eğitim Kurumları \/ Okullar|Sağlık Kurumları \/ Eczane/)
})

test('clicking empty space closes the card', async ({ page }) => {
  await analyseWithOverlay(page)

  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeVisible()

  /* Kümenin dışına tıkla: normal POI bilgi panelindeki davranışın aynısı. */
  await clickMap(page, -420, -260)
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeHidden()
})

test('the popup closes with its own button', async ({ page }) => {
  await analyseWithOverlay(page)

  await clickMap(page)
  const popup = page.getByRole('dialog', { name: 'Analiz POI bilgisi' })
  await expect(popup).toBeVisible()

  await page.getByRole('button', { name: 'POI bilgisini kapat' }).click()
  await expect(popup).toBeHidden()
})

test('turning the overlay off removes the vectors and the popup', async ({ page }) => {
  await analyseWithOverlay(page)

  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeVisible()

  await page.getByLabel(POI_TOGGLE).uncheck()
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeHidden()
  await expect(page.locator('.location-analysis-points-layer')).toHaveCount(0)

  // Katman yokken tıklamak kart açmaz.
  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeHidden()
})

test('a new analysis closes the popup from the previous one', async ({ page }) => {
  /* Gösterilen kayıt ÖNCEKİ analize aitti; yeni analizin sonucuymuş gibi
     ekranda kalması, kullanıcının yanlış bir cevaba bakması olurdu. */
  await analyseWithOverlay(page, {
  })

  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeVisible()

  await page.getByLabel('Ağırlık 1').fill('10')
  await page.getByLabel('Ağırlık 2').fill('90')
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeHidden()
})

test('Temizle closes the popup', async ({ page }) => {
  await analyseWithOverlay(page, {
  })

  await clickMap(page)
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeVisible()

  await page.getByRole('button', { name: 'Temizle', exact: true }).click()
  await expect(page.getByRole('dialog', { name: 'Analiz POI bilgisi' })).toBeHidden()
})

/* --- Isı haritası görünümü: birleşik vs tek ölçüt ---------------------------------

   <b>Ölçülen kök neden.</b> Yuvadaki değer POI BAŞINA ağırlıktır ve
   `vec:Heatmap` onları toplar; bir ölçütün yüzeye katkısı `sayı × ağırlık`
   olur. Gerçek veride Alışveriş 345, Demiryolu 52 POI taşır, dolayısıyla
   80/20 ile 20/80 arasındaki gerçek etki oranı 26,5:1'den yalnızca 1,66:1'e
   iniyordu ve kalabalık kategori HER İKİ hâlde de baskındı.

   İki ayrı düzeltme yapıldı: ağırlık ölçüt başına POI sayısına
   normalleştirildi (yüzde artık gerçekten etkili) ve tek ölçütlü görünüm
   eklendi (kategori kimliği, toplanan bir yüzeyde yapısal olarak
   kaybolduğu için). */

test('the heatmap can be narrowed to a single criterion', async ({ page }) => {
  const { imageRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)

  // Birleşik görünüm: ölçüt kesiti YOK.
  expect(imageRequests[0].criterionSlug).toBeUndefined()

  const before = imageRequests.length
  await page.getByLabel('Isı haritası görünümü').selectOption({ value: 'eczane' })
  await expect.poll(() => imageRequests.length).toBeGreaterThan(before)

  const focused = imageRequests[imageRequests.length - 1]
  expect(focused.criterionSlug).toBe('eczane')

  /* Analizin KENDİSİ değişmez: aynı alan, aynı ölçütler, aynı pencere.
     Değişen yalnızca hangi kategorilerin çizildiğidir. */
  expect(focused.areaWkts).toEqual(imageRequests[0].areaWkts)
  expect(focused.criteria).toEqual(imageRequests[0].criteria)
  expect(focused.bbox).toBe(imageRequests[0].bbox)

  await expect(page.getByText(/Bu görünümde ağırlık etkisizdir/)).toBeVisible()
})

test('focused heatmap criterion filters analysis markers and combined view restores all markers', async ({ page }) => {
  const rows = analysisPoiCluster().slice(0, 3) // eczane, okul, eczane
  const { pointRequests } = await prepareMap(page, {
    pointsHandler: (route) => route.fulfill(json({
      pois: rows,
      totalCount: rows.length,
      limit: 5000,
      truncated: false,
    })),
  })
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await page.getByLabel(POI_TOGGLE).check()

  const markerCount = page.locator('.la-hint', { hasText: 'POI gösteriliyor' }).locator('strong')
  await expect(markerCount).toHaveText('3')
  await expect.poll(() => pointRequests.length).toBe(1)

  await page.getByLabel('Isı haritası görünümü').selectOption({ value: 'eczane' })
  await expect(markerCount).toHaveText('2')
  expect(pointRequests).toHaveLength(1)

  await page.getByLabel('Isı haritası görünümü').selectOption({ value: '' })
  await expect(markerCount).toHaveText('3')
  expect(pointRequests).toHaveLength(1)
})

test('a new analysis returns the heatmap to the combined view', async ({ page }) => {
  /* Önceki analizin ölçüt kesiti, yeni ölçüt kümesinde var OLMAYABİLİR. */
  const { imageRequests } = await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()
  await expect.poll(() => imageRequests.length).toBeGreaterThan(0)

  await page.getByLabel('Isı haritası görünümü').selectOption({ value: 'eczane' })
  await expect.poll(() => imageRequests.length).toBeGreaterThan(1)

  await page.getByLabel('Ağırlık 1').fill('10')
  await page.getByLabel('Ağırlık 2').fill('90')
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  await expect.poll(() => imageRequests[imageRequests.length - 1].criterionSlug).toBeUndefined()
  await expect(page.getByLabel('Isı haritası görünümü')).toHaveValue('')
})

test('the legend states relative density and never promises a best location', async ({ page }) => {
  await prepareMap(page)
  await openPanel(page)
  await configure(page)
  await page.getByRole('button', { name: 'ANALİZİ BAŞLAT' }).click()

  const legend = page.getByLabel('Konum analizi yoğunluk açıklaması')
  await expect(legend).toBeVisible()
  await expect(legend).toContainText('Göreli yoğunluk (0–1)')
  /* Normalleştirme artık GÖRÜNTÜYE değil ALANA göredir ve efsane bunu
     söylemelidir. Görünüme bağlı üretimde 1.0'ın anlamı her kaydırmada
     değişiyordu; "bu görüntüdeki en yoğun nokta" o mimarinin ifadesiydi.
     Birleşik görünümde yüzeyin AĞIRLIKLI olduğu da söylenir. */
  await expect(legend).toContainText('analiz alanındaki')
  await expect(legend).toContainText('Ağırlıklı yoğunluk')
  await expect(legend).not.toContainText('Bu görüntüdeki en yoğun noktaya göre')

  /* <b>İki görsel dil, iki soru.</b> Rampanın rengi bir KATEGORİYİ temsil
     etmez; kategori kimliğini yalnızca işaretler taşır. Efsane bunu açıkça
     söylemelidir, yoksa kullanıcı kırmızıyı "alışveriş" sanır. */
  await expect(legend).toContainText('Renkler')
  await expect(legend).toContainText('gösterir, kategoriyi değil')
  await expect(legend).toContainText('işaretler')

  /* Kırmızı bir yer ÖNERİSİ değildir: ölçek görelidir ve iki analizin
     kırmızısı karşılaştırılamaz. */
  await expect(legend).not.toContainText(/en iyi/i)
  await expect(legend).not.toContainText(/uygun/i)
})
