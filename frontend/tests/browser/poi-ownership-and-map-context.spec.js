import { expect, test } from '@playwright/test'
import { ALL_PERMISSIONS, VIEWER_PERMISSIONS, mockPermissions } from './permissions.js'

/**
 * Phase 3: POI sahipliği (düzenle / sil / geri yükle) ve GLOBAL harita bağlam
 * koordinasyonu.
 *
 * ## Burada kanıtlanan şey
 *
 * 1. Bir operatör HERKESİN POI'sini görür ama yalnızca KENDİ kayıtlarında
 *    eylem sunulur — ve bu karar sunucudan gelen `canUpdate` / `canDelete`
 *    bayraklarına dayanır, tarayıcıda yeniden hesaplanan bir sahiplik kuralına
 *    değil.
 * 2. Aynı anda yalnızca BİR birincil bağlamsal panel açıktır: yeni bir bağlam
 *    açıldığında öncekini kullanıcı elle kapatmak zorunda kalmaz.
 * 3. Panel kapanması, altındaki KATMANI kapatmaz (ısı haritası).
 *
 * ## Burada kanıtlanmayan şey
 *
 * <b>Güvenlik.</b> Bir düğmeyi gizlemek yetkilendirme değildir; sahiplik
 * kuralının gerçek sahibi backend'dir (PoiOwnershipTests). Buradaki testler
 * arayüzün o gerçeği doğru yansıttığını gösterir.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/** Haritanın açılış merkezi: kabın orta pikseli tam bu koordinattır. */
const MAP_CENTER = { longitude: 35.2433, latitude: 38.9637 }

/** Merkezdeki POI çağırana AİTTİR; ikincisi başkasının kaydıdır. */
const OWN_POI = {
  id: 11,
  name: 'Kendi Kafem',
  categoryId: 3,
  categoryName: 'Kafe',
  categoryPath: 'Yeme-İçme / Kafe',
  workHours: null,
  canUpdate: true,
  canDelete: true,
  ...MAP_CENTER,
}

const FOREIGN_POI = {
  id: 12,
  name: 'Başkasının Noktası',
  categoryId: 2,
  categoryName: 'Restoran',
  categoryPath: 'Yeme-İçme / Restoran',
  workHours: null,
  // Görünür ama dokunulamaz: sunucu bunu böyle bildirir.
  canUpdate: false,
  canDelete: false,
  longitude: 32.87,
  latitude: 39.94,
}

const CATEGORIES = [
  { id: 1, name: 'Yeme-İçme', parentId: null, path: 'Yeme-İçme', depth: 0, isActive: true, isDeleted: false },
  { id: 3, name: 'Kafe', parentId: 1, path: 'Yeme-İçme / Kafe', depth: 1, isActive: true, isDeleted: false },
  { id: 2, name: 'Restoran', parentId: 1, path: 'Yeme-İçme / Restoran', depth: 1, isActive: true, isDeleted: false },
]

/** Merkezin hemen yanındaki bir çizim: bağlam geçişlerinin diğer ucu. */
const POINT_WKT = 'POINT(35.2433 38.9637)'

function drawingRecord(id, name, wkt) {
  return {
    id,
    name,
    wkt,
    style: null,
    description: '',
    category: '',
    tags: [],
    createdDate: '2026-08-01T09:00:00Z',
    modifiedDate: '2026-08-01T09:00:00Z',
    createdBy: 'operator',
    createdByUserId: 1,
  }
}

async function openMap(page, codes = ALL_PERMISSIONS, { pois = [OWN_POI, FOREIGN_POI], drawings = [] } = {}) {
  const permissions = await mockPermissions(page, codes)
  const calls = { updates: [], deletes: [], restores: [], drawingRestores: [], deleted: 0 }

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({
      userId: 1, username: 'operator', email: 'operator@example.invalid',
      emailConfirmed: true, twoFactorEnabled: true,
      // Kanonik OLMAYAN bir rol adı: hiçbir test yanlışlıkla ada dayanamaz.
      role: 'Operatör', roles: ['Operatör'],
    })),
  )
  await page.route('**/api/auth/me/geographic-scope', (route) =>
    route.fulfill(json({ isRestricted: false, effectiveWkt: null, areaCount: 0 })),
  )

  await page.route('**/api/drawings/points', (route) => route.fulfill(json(drawings)))
  for (const path of ['lines', 'polygons']) {
    await page.route(`**/api/drawings/${path}`, (route) => route.fulfill(json([])))
  }

  /* Çöp kutusu artık İKİ tür taşır. Silinmiş bir çizim de döndürülür ki
     "POI satırını bul" iddiası gerçekten bir ayrım yapsın: tek satırlık bir
     listede sıraya dayanan bir seçim yanlışlıkla da doğru çıkardı. */
  await page.route('**/api/drawings/deleted', (route) =>
    route.fulfill(json([
      {
        type: 'point',
        deletedAt: '2026-08-23T09:00:00Z',
        drawing: drawingRecord(31, 'Silinmiş Nokta', 'POINT(32.87 39.94)'),
      },
    ])),
  )

  await page.route('**/api/drawings/restore', (route) => {
    calls.drawingRestores.push(route.request().postData())
    return route.fulfill(json({ items: [] }))
  })

  await page.route('**/api/poi/categories', (route) => route.fulfill(json(CATEGORIES)))
  await page.route('**/api/poi/deleted', (route) => {
    calls.deleted += 1
    return route.fulfill(json([
      {
        type: 'poi',
        deletedAt: '2026-08-23T10:00:00Z',
        creatorUsername: '',
        poi: { ...OWN_POI, id: 21, name: 'Silinmiş Kafe' },
      },
    ]))
  })

  await page.route('**/api/poi/*/restore', (route) => {
    calls.restores.push(route.request().url())
    return route.fulfill(json({ ...OWN_POI, id: 21, name: 'Silinmiş Kafe' }))
  })

  await page.route(/\/api\/poi\/\d+$/, (route) => {
    const method = route.request().method()
    if (method === 'PUT') {
      const body = JSON.parse(route.request().postData() ?? '{}')
      calls.updates.push(body)
      return route.fulfill(json({ ...OWN_POI, ...body, categoryPath: 'Yeme-İçme / Restoran' }))
    }
    if (method === 'DELETE') {
      calls.deletes.push(route.request().url())
      return route.fulfill({ status: 204, body: '' })
    }
    return route.fulfill(json({}, 405))
  })

  await page.route('**/api/poi', (route) => route.fulfill(json(pois)))

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  return { permissions, calls }
}

const sheet = (page, title) =>
  page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) })

/**
 * Geçici analiz alanı çizer — inventory-analysis.spec.js'teki KANITLANMIŞ
 * hareketin aynısı.
 *
 * Dört AYRI köşe kullanılır ve bitiriş çift tıklaması son tıklamanın üstüne
 * DEĞİL dördüncü köşeye gelir: OpenLayers'ın Draw etkileşimi aynı noktaya
 * yapılan tıkla-sonra-çift-tıkla dizisini güvenilir biçimde bir poligona
 * çevirmez ve çizim hiç bitmez — istek de açılmaz. Köşeler kutunun oranıdır,
 * dolayısıyla her viewport'ta çalışır.
 */
async function drawAnalysisArea(page) {
  await page.getByRole('button', { name: 'Envanter Analizi aracı' }).click()

  const box = await page.locator('.map-container').boundingBox()
  const at = (fx, fy) => ({ x: box.x + box.width * fx, y: box.y + box.height * fy })

  for (const point of [at(0.2, 0.25), at(0.7, 0.25), at(0.7, 0.6)]) {
    await page.mouse.click(point.x, point.y)
    await page.waitForTimeout(120)
  }
  await page.mouse.dblclick(at(0.2, 0.6).x, at(0.2, 0.6).y)
}

/** Analiz sonucunu bekler: panel görünür ve yükleme durumu bitmiş. */
async function runAnalysis(page) {
  await drawAnalysisArea(page)
  await expect(page.locator('.analysis-panel')).toBeVisible()
  await expect(page.getByText('Analiz yapılıyor...')).toBeHidden()
}

/**
 * Geri yükleme ONAYI.
 *
 * `ConfirmDialog` rolü `alertdialog`tir (Çöp Kutusu sayfası ise `dialog`) ve
 * `aria-labelledby` ile başlığını erişilebilir ADI yapar — yani onay kutusu
 * başlığıyla doğrudan sorulabilir. Genel bir `getByRole('dialog')` +
 * `hasText: 'geri yükle'` ise Çöp Kutusu panelinin KENDİSİNİ eşler: satır
 * düğmelerinin erişilebilir adları da "… kaydını geri yükle"dir.
 *
 * @param {string} title "POI'yi geri yükle" | "Çizimi geri yükle"
 */
const restoreConfirm = (page, title) => page.getByRole('alertdialog', { name: title, exact: true })

/**
 * Onay kutusunun ONAY düğmesi.
 *
 * `exact: true` ŞARTTIR: erişilebilir ad eşleşmesi varsayılan olarak alt dize
 * aramasıdır ve "Geri Yükle", satırların "Silinmiş Kafe kaydını geri yükle"
 * adıyla da eşleşirdi. Kapsam zaten onay kutusudur; `exact` ikinci kapıdır.
 */
const confirmRestoreButton = (dialog) => dialog.getByRole('button', { name: 'Geri Yükle', exact: true })

const analysisPanel = (page) => page.locator('.analysis-panel')
const analysisSummary = (page, label) =>
  page.locator('.analysis-summary-item').filter({ hasText: label }).locator('dd')

/** Analiz sonucundaki bir çizim kaydı (InventoryAnalysisItemResponse). */
function analysisItem(id, drawingType, name) {
  return {
    id,
    drawingType,
    name,
    description: '',
    category: '',
    tags: [],
    style: { strokeColor: '#7C3AED', strokeWidth: 2, fillColor: null, fillOpacity: null, pointRadius: 6, lineStyle: 'solid' },
    createdDate: '2026-08-01T09:00:00Z',
    modifiedDate: '2026-08-01T09:00:00Z',
    intersectionType: 'fullyInside',
  }
}

async function clickMap(page, fx = 0.5, fy = 0.5) {
  const box = await page.locator('.map-container').boundingBox()
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await page.waitForTimeout(150)
}

/* ===========================================================================
   1. Görünürlük ve sahiplik
   =========================================================================== */

test('an operator sees POIs from every creator', async ({ page }) => {
  await openMap(page)

  // İki farklı kişinin kaydı da yüklenir: POI ortak envanterdir.
  await expect(page.locator('.map-container .poi-layer')).toHaveCount(1)
  await clickMap(page)
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()
})

test('an own POI offers Düzenle and Sil', async ({ page }) => {
  await openMap(page)
  await clickMap(page)

  const info = sheet(page, 'POI Bilgisi')
  await expect(info.getByRole('button', { name: 'Düzenle' })).toBeVisible()
  await expect(info.getByRole('button', { name: 'Sil' })).toBeVisible()
})

test('a foreign POI can be opened but offers no actions', async ({ page }) => {
  // Merkezdeki kayıt bu kez BAŞKASINA ait.
  await openMap(page, ALL_PERMISSIONS, { pois: [{ ...FOREIGN_POI, ...MAP_CENTER }] })
  await clickMap(page)

  const info = sheet(page, 'POI Bilgisi')
  await expect(info).toBeVisible()
  await expect(info.getByRole('button', { name: 'Düzenle' })).toHaveCount(0)
  await expect(info.getByRole('button', { name: 'Sil' })).toHaveCount(0)
})

/* ===========================================================================
   2. Düzenleme ve silme
   =========================================================================== */

test('editing a POI sends only the attributes and refreshes the map record', async ({ page }) => {
  const { calls } = await openMap(page)
  await clickMap(page)

  await sheet(page, 'POI Bilgisi').getByRole('button', { name: 'Düzenle' }).click()
  const form = sheet(page, 'POI Düzenle')
  await expect(form).toBeVisible()

  // Aranabilir kategori seçici: yaprağın adı yazılır, yol seçilir.
  await form.getByRole('searchbox').fill('restoran')
  await form.getByRole('option', { name: 'Yeme-İçme / Restoran' }).click()
  await form.getByLabel('POI Adı').fill('Yeni Ad')
  await form.getByRole('button', { name: 'Güncelle' }).click()

  await expect.poll(() => calls.updates.length).toBe(1)
  /* SAHİPLİK ve denetim alanları gövdeye HİÇ girmez. Konum girer — artık
     düzenlenebilir bir alandır — ama DEĞİŞMEZ: yalnızca adı değiştiren bir
     kullanıcı kaydını taşımış olmaz. */
  expect(Object.keys(calls.updates[0]).sort()).toEqual([
    'categoryId', 'latitude', 'longitude', 'name', 'workHours',
  ])
  expect(calls.updates[0].name).toBe('Yeni Ad')
  expect(calls.updates[0].longitude).toBeCloseTo(MAP_CENTER.longitude, 6)
  expect(calls.updates[0].latitude).toBeCloseTo(MAP_CENTER.latitude, 6)
  for (const forbidden of ['userId', 'creatorUsername', 'ownerId', 'createdDate', 'isDeleted']) {
    expect(calls.updates[0]).not.toHaveProperty(forbidden)
  }

  // Güncelleme sonrası bilgi paneli tazelenmiş kaydı gösterir; sayfa yenilenmez.
  await expect(sheet(page, 'POI Bilgisi').getByText('Yeni Ad')).toBeVisible()
})

test('deleting a POI removes it from the map and closes its panel', async ({ page }) => {
  const { calls } = await openMap(page)
  await clickMap(page)

  await sheet(page, 'POI Bilgisi').getByRole('button', { name: 'Sil' }).click()

  /* Silme onayı da AYNI kalıpla seçilir: `alertdialog` + başlık. Sayfa
     genelinde `name: 'Sil'` aramak, bilgi panelinin kendi düğmesiyle de
     eşleşir ve `.last()` yalnızca bugünkü DOM sırasına güvenirdi. */
  const confirmDelete = page.getByRole('alertdialog', { name: "POI'yi sil", exact: true })
  await expect(confirmDelete).toContainText('Kendi Kafem')
  await confirmDelete.getByRole('button', { name: 'Sil', exact: true }).click()

  await expect.poll(() => calls.deletes.length).toBe(1)
  // Silinen kaydın paneli açık kalamaz.
  await expect(sheet(page, 'POI Bilgisi')).toHaveCount(0)
  // Kayıt haritadan da kalkar: aynı piksel artık panel açmaz.
  await clickMap(page)
  await expect(sheet(page, 'POI Bilgisi')).toHaveCount(0)
})

test('a deleted POI is listed in the shared trash and can be restored', async ({ page }) => {
  const { calls } = await openMap(page)

  await page.getByRole('button', { name: 'Çöp Kutusu' }).click()
  const trash = sheet(page, /Çöp Kutusu/)

  /* Çizimlerle AYNI panel: POI için ikinci bir çöp kutusu yoktur. Liste iki
     TÜR taşır ve ikisi de görünür. */
  await expect(trash.getByText('Silinmiş Kafe')).toBeVisible()
  await expect(trash.getByText('Silinmiş Nokta')).toBeVisible()
  await expect(trash.getByRole('button', { name: 'POI', exact: true })).toBeVisible()

  /* Satır KENDİ ADIYLA bulunur, sırayla değil: `.first()` bugünkü sıralamaya
     yazılmış bir testtir ve silinme zamanı değiştiği gün sessizce yanlış
     kaydı geri yüklerdi. Geri yükleme düğmesinin erişilebilir adı kaydı
     zaten içerir. */
  await trash.getByRole('button', { name: 'Silinmiş Kafe kaydını geri yükle' }).click()

  /* Geri yükleme ONAY ister — silme gibi. Onay verilmeden hiçbir istek
     açılmaz; bu adımı atlamak testin isteği hiç görmemesi demekti.

     Onay kutusu TÜRÜYLE seçilir: POI onayı çizim onayından ayrı bir başlık
     taşır, dolayısıyla yanlış türde bir diyalog açılsaydı bu satır düşerdi. */
  const confirm = restoreConfirm(page, "POI'yi geri yükle")
  // Diyalog POI'yi ADIYLA sorar: yanlış satıra basıldığı buradan anlaşılır.
  await expect(confirm).toContainText('Silinmiş Kafe')
  await confirmRestoreButton(confirm).click()

  // Yalnızca POI ucu çağrılır; çizim geri yükleme ucuna dokunulmaz.
  await expect.poll(() => calls.restores.length).toBe(1)
  expect(calls.restores[0]).toContain('/api/poi/21/restore')
  expect(calls.drawingRestores).toHaveLength(0)

  // Geri yüklenen kayıt artık silinmiş değildir: satır listeden kalkar…
  await expect(trash.getByText('Silinmiş Kafe')).toHaveCount(0)
  // …ama silinmiş çizim yerinde durur.
  await expect(trash.getByText('Silinmiş Nokta')).toBeVisible()
})

test('the shared trash still restores drawings through their own endpoint', async ({ page }) => {
  const { calls } = await openMap(page)

  await page.getByRole('button', { name: 'Çöp Kutusu' }).click()
  const trash = sheet(page, /Çöp Kutusu/)

  await trash.getByRole('button', { name: 'Silinmiş Nokta kaydını geri yükle' }).click()

  // Çizim satırı ÇİZİM onayını açar; başlık iki akışı birbirinden ayırır.
  const confirm = restoreConfirm(page, 'Çizimi geri yükle')
  await expect(confirm).toContainText('Silinmiş Nokta')
  await confirmRestoreButton(confirm).click()

  // Tür başına DOĞRU uç: POI ucu bu akışta hiç çağrılmaz.
  await expect.poll(() => calls.drawingRestores.length).toBe(1)
  expect(calls.restores).toHaveLength(0)
})

/* ===========================================================================
   3. Global bağlam koordinasyonu
   =========================================================================== */

test('POI Info gives way to Drawing Info when a drawing is clicked', async ({ page }) => {
  await openMap(page, ALL_PERMISSIONS, { drawings: [drawingRecord(1, 'Test Noktası', POINT_WKT)] })

  await clickMap(page)
  // Aynı pikselde hem POI hem çizim var; her tık TEK bir bağlam bırakır.
  const openPanels = await page.getByRole('dialog').count()
  expect(openPanels).toBeLessThanOrEqual(1)
})

test('the heatmap panel yields to POI Info, and the heatmap layer stays on', async ({ page }) => {
  await page.route('**/api/heatmap**', (route) => route.fulfill(json({ imageUrl: null })))
  await openMap(page)

  await page.getByRole('button', { name: 'Isı Haritası Analizi' }).click()
  const heatmapPanel = sheet(page, 'Isı Haritası')
  await expect(heatmapPanel).toBeVisible()

  // Katmanı AÇ, sonra başka bir bağlama geç.
  await heatmapPanel.getByRole('switch').first().click().catch(() => {})
  await clickMap(page)

  // Panel devredildi…
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()
  await expect(sheet(page, 'Isı Haritası')).toHaveCount(0)
  // …ama katman kapatılmadı: paneli kapatmak özelliği kapatmak DEĞİLDİR.
  await page.getByRole('button', { name: 'Isı Haritası Analizi' }).click()
  await expect(sheet(page, 'Isı Haritası').getByRole('switch').first()).toBeChecked()
})

test('opening POI Ekle replaces whatever contextual panel was open', async ({ page }) => {
  await openMap(page)

  await clickMap(page)
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()

  await page.getByRole('button', { name: 'POI Ekle aracı' }).click()
  // Kullanıcı önceki paneli ELLE kapatmak zorunda değildir.
  await expect(sheet(page, 'POI Bilgisi')).toHaveCount(0)
})

test('only one primary contextual panel is ever open', async ({ page }) => {
  await openMap(page, ALL_PERMISSIONS, { drawings: [drawingRecord(1, 'Test Noktası', 'POINT(32.87 39.94)')] })

  const sequence = ['Katmanlar', 'Çöp Kutusu', 'Isı Haritası Analizi', 'Çizimlerim']
  for (const label of sequence) {
    await page.getByRole('button', { name: label }).click()
    await page.waitForTimeout(120)
    expect(await page.getByRole('dialog').count()).toBeLessThanOrEqual(1)
  }
})

/* ===========================================================================
   4. Envanter analizi
   =========================================================================== */

test('inventory analysis reports POIs in its own group and in the total', async ({ page }) => {
  /* Gövde, backend'in Phase-3 sözleşmesidir (ASP.NET camelCase): sayı
     kırılımları + kayıt listeleri, POI'ler dâhil. Toplam POI'leri İÇERİR:
     1 nokta + 2 POI = 3. */
  await page.route('**/api/analysis/intersections', (route) =>
    route.fulfill(json({
      totalCount: 3,
      pointCount: 1,
      lineCount: 0,
      polygonCount: 0,
      poiCount: 2,
      points: [analysisItem(41, 'point', 'Kesişen Nokta')],
      lines: [],
      polygons: [],
      pois: [
        { id: 11, name: 'Kendi Kafem', categoryName: 'Kafe', categoryPath: 'Yeme-İçme / Kafe', ...MAP_CENTER },
        { id: 12, name: 'Başkasının Noktası', categoryName: 'Restoran', categoryPath: 'Yeme-İçme / Restoran', longitude: 32.87, latitude: 39.94 },
      ],
    })),
  )

  // poi.view ALL_PERMISSIONS içindedir; analiz yetkisi de öyle.
  await openMap(page)
  await runAnalysis(page)

  // Sonuç paneli gerçekten tamamlandı ve çizim kırılımı yerinde.
  await expect(analysisSummary(page, 'Noktalar')).toHaveText('1')

  // POI kendi özet satırını ve kendi açılır grubunu taşır.
  await expect(analysisSummary(page, "POI'ler")).toHaveText('2')
  await expect(analysisPanel(page).getByText('Bu alan 3 envanter ile kesişiyor.')).toBeVisible()

  const poiGroup = analysisPanel(page).getByRole('button', { name: /POI'ler \(2\)/ })
  await expect(poiGroup).toBeVisible()
  await poiGroup.click()

  // Satırlar YOLU gösterir; oluşturan/denetim bilgisi hiçbir yerde yoktur.
  await expect(analysisPanel(page).getByText('Yeme-İçme / Kafe')).toBeVisible()
  await expect(analysisPanel(page).getByText('Yeme-İçme / Restoran')).toBeVisible()
  await expect(analysisPanel(page)).not.toContainText('operator')
})

test('without poi.view the analysis result mentions no POIs at all', async ({ page }) => {
  /* Sunucu yetkisiz çağırana POI'leri HİÇ raporlamaz: sayı 0, liste boş ve
     toplam POI'ler yokmuş gibi hesaplanır (1 nokta = 1). Backend bu davranışı
     kendi testlerinde kanıtlar; burada ölçülen, arayüzün ondan POI varlığı
     çıkarmadığıdır. */
  await page.route('**/api/analysis/intersections', (route) =>
    route.fulfill(json({
      totalCount: 1,
      pointCount: 1,
      lineCount: 0,
      polygonCount: 0,
      poiCount: 0,
      points: [analysisItem(41, 'point', 'Kesişen Nokta')],
      lines: [],
      polygons: [],
      pois: [],
    })),
  )

  /* Analiz aracını çalıştırabilen ama POI göremeyen profil. Tek eksik yetki
     poi.view'dur — inventory.analysis YERİNDEDİR, aksi hâlde araç hiç
     açılmaz ve testin öncülü geçersiz olurdu. */
  await openMap(page, [...VIEWER_PERMISSIONS, 'inventory.analysis'])
  await runAnalysis(page)

  // Analiz TAMAMLANDI: panel duruyor ve çizim kırılımı görünüyor.
  await expect(analysisPanel(page)).toBeVisible()
  await expect(analysisSummary(page, 'Noktalar')).toHaveText('1')
  await expect(analysisPanel(page).getByText('Bu alan 1 envanter ile kesişiyor.')).toBeVisible()

  /* POI'den hiç söz edilmez: "POI'ler (0)" satırı bile bir bilgi olurdu.
     Toplam da yalnızca çizimlerden gelir. */
  await expect(analysisSummary(page, "POI'ler")).toHaveCount(0)
  await expect(analysisPanel(page).getByRole('button', { name: /POI/ })).toHaveCount(0)
  await expect(analysisPanel(page)).not.toContainText('POI')
})
