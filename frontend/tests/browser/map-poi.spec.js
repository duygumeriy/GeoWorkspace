import { expect, test } from '@playwright/test'
import { ALL_PERMISSIONS, VIEWER_PERMISSIONS, mockPermissions } from './permissions.js'

/**
 * Phase 2D: haritadaki POI deneyimi.
 *
 * ## Burada kanıtlanan şey
 *
 * POI'nin çizimlerden AYRI bir alan nesnesi olarak davrandığı: kendi yetkisi,
 * kendi ucu, kendi katmanı. Yerleştirme aracının diğer çizim araçlarıyla aynı
 * anda canlı olamadığı ve haritaya tıklamanın tek başına hiçbir şey
 * KAYDETMEDİĞİ.
 *
 * ## Burada kanıtlanmayan şey
 *
 * <b>Güvenlik.</b> Bir düğmeyi gizlemek yetkilendirme değildir; gerçek kapı
 * backend'dedir ve PoiApiAuthorizationTests tarafından ölçülür. Buradaki
 * testler arayüzün o gerçeği doğru yansıttığını gösterir.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/* Haritanın AÇILIŞ MERKEZİ (src/map/turkey.js). Birinci POI tam buraya
   konur: harita kabı `inset: 0` ile sayfayı doldurduğu ve görünümde açılışta
   padding olmadığı için, kabın orta pikseli bu koordinatın ta kendisidir.
   Böylece "POI'ye tıkla" adımı tahmine değil, deterministik tek bir piksele
   dayanır ve gerçek OpenLayers isabet denetiminden geçer. */
const MAP_CENTER = { longitude: 35.2433, latitude: 38.9637 }

const POIS = [
  {
    id: 11,
    name: 'Ankara Kalesi Kafe',
    categoryId: 3,
    categoryName: 'Kafe',
    categoryPath: 'Yeme-İçme / Kafe',
    workHours: {
      monday: { closed: false, open: '09:00', close: '18:00' },
      sunday: { closed: true },
    },
    ...MAP_CENTER,
  },
  {
    id: 12,
    name: 'İkinci Nokta',
    categoryId: 2,
    categoryName: 'Restoran',
    categoryPath: 'Yeme-İçme / Restoran',
    workHours: null,
    longitude: 32.87,
    latitude: 39.94,
  },
]

const CATEGORIES = [
  { id: 1, name: 'Yeme-İçme', parentId: null, path: 'Yeme-İçme', depth: 0 },
  { id: 3, name: 'Kafe', parentId: 1, path: 'Yeme-İçme / Kafe', depth: 1 },
  { id: 2, name: 'Restoran', parentId: 1, path: 'Yeme-İçme / Restoran', depth: 1 },
]

/** Yetkileri poi.* dışında Viewer profiline eşit bir küme. */
const withPoi = (...codes) => [...VIEWER_PERMISSIONS, ...codes]

/**
 * Oturum açar, POI ve çizim uçlarını taklit eder, haritayı açar.
 *
 * `role` sunucunun bildirdiği rol ADIDIR ve hiçbir görünürlük kararı vermez;
 * kanonik olmayan bir ad verilir ki hiçbir test yanlışlıkla ada dayanamasın.
 */
async function openMap(page, codes, { role = 'Saha Ekibi', pois = POIS, categories = CATEGORIES } = {}) {
  const permissions = await mockPermissions(page, codes)
  const calls = { pois: 0, categories: 0, created: [], drawingCreates: [] }

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({
      userId: 1, username: 'saha', email: 'saha@example.invalid',
      emailConfirmed: true, twoFactorEnabled: true, role, roles: [role],
    })),
  )

  // Çizim uçları: bu dosyada içerikleri değil, ÇAĞRILMAMALARI önemli.
  for (const path of ['points', 'lines', 'polygons', 'deleted']) {
    await page.route(`**/api/drawings/${path}`, (route) => route.fulfill(json([])))
  }
  for (const kind of ['point', 'line', 'polygon']) {
    await page.route(`**/api/drawings/${kind}`, (route) => {
      calls.drawingCreates.push(kind)
      return route.fulfill(json({ id: 1 }, 201))
    })
  }

  await page.route('**/api/poi/categories', (route) => {
    calls.categories += 1
    return route.fulfill(json(categories))
  })

  await page.route('**/api/poi', (route) => {
    if (route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData() ?? '{}')
      calls.created.push(body)
      return route.fulfill(json({
        id: 99,
        name: body.name,
        categoryId: body.categoryId,
        categoryName: 'Kafe',
        categoryPath: 'Yeme-İçme / Kafe',
        workHours: body.workHours,
        longitude: body.longitude,
        latitude: body.latitude,
      }, 201))
    }

    calls.pois += 1
    return route.fulfill(json(pois))
  })

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  return { permissions, calls }
}

const toolbar = (page) => page.getByRole('toolbar', { name: 'Çizim araçları' })
const poiButton = (page) => toolbar(page).getByRole('button', { name: 'POI Ekle aracı' })
const sheet = (page, title) => page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) })

/**
 * Birinci POI'nin üstüne tıklar.
 *
 * O POI haritanın açılış merkezine konumlandırıldığı için kabın tam ortası
 * onun pikselidir — tahminli bir arama değil, tek ve deterministik bir tık.
 * Gerçek fare olayı gönderilir, dolayısıyla OpenLayers'ın isabet denetimi
 * baypas EDİLMEZ.
 */
async function clickPoi(page) {
  await clickMap(page, 0.5, 0.5)
}

/** Haritanın ortasına tıklar; oran tabanlı olduğu için her viewport'ta çalışır. */
async function clickMap(page, fx = 0.5, fy = 0.5) {
  const box = await page.locator('.map-container').boundingBox()
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await page.waitForTimeout(120)
}

/* ===========================================================================
   1. Katman ve yetki
   =========================================================================== */

test('poi.view loads the POI endpoint', async ({ page }) => {
  const { calls } = await openMap(page, withPoi('poi.view'))

  await expect.poll(() => calls.pois).toBeGreaterThan(0)
  // POI görüntülemek çizim uçlarını KULLANMAZ.
  expect(calls.drawingCreates).toHaveLength(0)
})

test('without poi.view the endpoint is never requested', async ({ page }) => {
  const { calls } = await openMap(page, VIEWER_PERMISSIONS)

  await page.waitForTimeout(400)
  // Garanti 403 alacak bir istek hiç açılmaz.
  expect(calls.pois).toBe(0)

  /* Katman NESNESİ harita ömrü boyunca ayakta kalır — ölçülmesi gereken şey
     içinde POI olup olmadığıdır. Gözlemlenebilir kanıt: POI'nin bulunacağı
     piksele gerçek bir tık, hiçbir bilgi paneli açmaz. */
  await clickPoi(page)
  await expect(page.getByRole('heading', { name: 'POI Bilgisi' })).toHaveCount(0)
})

test('the POI layer is a single layer with its own canvas', async ({ page }) => {
  await openMap(page, withPoi('poi.view'))

  /* Tek kaynak, tek katman: POI başına katman açmak OpenLayers nesnelerini
     çoğaltır ve dinleyici sızdırırdı. İki POI taklit ediliyor, katman bir
     tane kalır — ve harita ömrü boyunca AYAKTA kalır; yetki değişimi veriyi
     temizler, katmanı yıkmaz. */
  await expect(page.locator('.map-container .poi-layer')).toHaveCount(1)
})

test('revoking poi.view clears the POI layer and closes the info sheet', async ({ page }) => {
  const { permissions } = await openMap(page, withPoi('poi.view'))

  await clickPoi(page)
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()

  // Yetkilendirme CANLIDIR; token değişmez, yeniden giriş yapılmaz.
  permissions.set(VIEWER_PERMISSIONS)
  await page.reload()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  // Açık panel kapanır …
  await expect(sheet(page, 'POI Bilgisi')).toHaveCount(0)

  /* … ve kaynak boşalır: aynı piksele yeniden tıklamak artık hiçbir POI
     seçmez. Katman nesnesinin kendisi ayakta kalır ve kalmalıdır. */
  await clickPoi(page)
  await expect(page.getByRole('heading', { name: 'POI Bilgisi' })).toHaveCount(0)

  expect(await page.evaluate(() => sessionStorage.getItem('token'))).toBe('browser-test-token')
})

/* ===========================================================================
   2. Araç yetkisi
   =========================================================================== */

test('POI Ekle appears with both poi.create and poi.view', async ({ page }) => {
  await openMap(page, withPoi('poi.view', 'poi.create'))
  await expect(poiButton(page)).toBeVisible()
})

test('POI Ekle is hidden without poi.create', async ({ page }) => {
  await openMap(page, withPoi('poi.view'))
  await expect(poiButton(page)).toBeHidden()
})

test('POI Ekle is hidden with poi.create but no poi.view', async ({ page }) => {
  /* Oluşturma formu kategori listesini `GET /api/poi/categories` ile okur ve o
     uç `poi.view` arar. Yalnızca `poi.create` taşıyan birine araç gösterilseydi,
     açılan form açılır listesini 403 yüzünden hiç yükleyemez ve kişi asla
     kaydedemeyeceği bir akışa davet edilmiş olurdu. */
  const { calls } = await openMap(page, withPoi('poi.create'))

  await expect(poiButton(page)).toBeHidden()

  // Yetkisiz uçların hiçbiri çağrılmaz.
  await page.waitForTimeout(300)
  expect(calls.pois).toBe(0)
  expect(calls.categories).toBe(0)
})

test('a non-canonical role name with both codes opens the tool', async ({ page }) => {
  /* Ödevin "Operatör" rolü kanonik DEĞİLDİR ve kaynakta hiç geçmez; rol
     yönetimi ekranından map.view + poi.view + poi.create ile tanımlanır.
     Aracın görünmesinin tek sebebi taşınan yetki KODLARIDIR. */
  await openMap(page, withPoi('poi.view', 'poi.create'), { role: 'Operatör' })

  await expect(poiButton(page)).toBeVisible()

  // Ve araç gerçekten çalışır: mod açılır, tıklama formu getirir.
  await poiButton(page).click()
  await clickMap(page)
  await expect(sheet(page, 'POI Ekle')).toBeVisible()
})

test('a privileged role name without the code opens nothing', async ({ page }) => {
  // Ve tersi: ad ne olursa olsun, kod yoksa araç yoktur.
  await openMap(page, VIEWER_PERMISSIONS, { role: 'Administrator' })
  await expect(poiButton(page)).toBeHidden()
})

/* Oluşturma yeteneği İKİ yetkiye birden bağlıdır; dolayısıyla ikisinden
   HANGİSİ geri alınırsa alınsın akış aynı şekilde iptal olmalıdır. */
for (const [label, remaining] of [
  ['poi.create', ['poi.view']],
  ['poi.view', ['poi.create']],
]) {
  test(`revoking ${label} cancels placement and closes the create sheet`, async ({ page }) => {
    const { permissions } = await openMap(page, withPoi('poi.view', 'poi.create'))

    await poiButton(page).click()
    await clickMap(page)
    await expect(sheet(page, 'POI Ekle')).toBeVisible()

    permissions.set(withPoi(...remaining))
    await page.reload()
    await expect(page.locator('.map-container canvas').first()).toBeVisible()

    // Form kapanır ve araç kaybolur: yerleştirme etkileşimi de bağlanamaz.
    await expect(sheet(page, 'POI Ekle')).toHaveCount(0)
    await expect(poiButton(page)).toBeHidden()

    /* Bekleyen işaret de gitmiştir. Katman nesnesi ayakta kalır, o yüzden
       ölçülen şey DAVRANIŞTIR: haritaya tıklamak ne bir form açar ne de
       kalmış bir işaretten POI bilgisi getirir. */
    await clickMap(page)
    await expect(page.getByRole('heading', { name: 'POI Ekle' })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'POI Bilgisi' })).toHaveCount(0)
  })
}

test('losing poi.create alone keeps the permanent POIs on the map', async ({ page }) => {
  // Görüntüleme ile oluşturma ayrı yeteneklerdir: biri kapanınca diğeri
  // kapanmaz.
  const { permissions } = await openMap(page, withPoi('poi.view', 'poi.create'))

  permissions.set(withPoi('poi.view'))
  await page.reload()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  // POI'ler görünmeye ve seçilebilmeye devam eder …
  await clickPoi(page)
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()

  // … ama oluşturma arayüzünden hiçbir şey kalmaz.
  await expect(poiButton(page)).toBeHidden()
})

/* ===========================================================================
   3. Yerleştirme
   =========================================================================== */

test('activating the tool marks it pressed and one click opens the form', async ({ page }) => {
  const { calls } = await openMap(page, withPoi('poi.view', 'poi.create'))

  await expect(poiButton(page)).toHaveAttribute('aria-pressed', 'false')
  await poiButton(page).click()
  await expect(poiButton(page)).toHaveAttribute('aria-pressed', 'true')

  await clickMap(page)

  await expect(sheet(page, 'POI Ekle')).toBeVisible()
  // Tıklama tek başına HİÇBİR ŞEY kaydetmez.
  expect(calls.created).toHaveLength(0)
  expect(calls.drawingCreates).toHaveLength(0)
})

test('the temporary marker stays while the form is open and goes on cancel', async ({ page }) => {
  await openMap(page, withPoi('poi.view', 'poi.create'))

  await poiButton(page).click()
  await clickMap(page)

  /* Bekleyen konumun varlığı formun salt okunur Konum alanından okunur:
     katman sayısı her zaman 1'dir ve hiçbir şey kanıtlamaz. */
  const form = sheet(page, 'POI Ekle')
  await expect(form).toBeVisible()
  await expect(form.getByText(/^-?\d+\.\d{5}, -?\d+\.\d{5}$/)).toBeVisible()

  await form.getByRole('button', { name: 'İptal' }).click()

  await expect(sheet(page, 'POI Ekle')).toHaveCount(0)
  // İptal aracı da kapatır: bir sonraki deneme sıfırdan başlar.
  await expect(poiButton(page)).toHaveAttribute('aria-pressed', 'false')

  /* Ve gerçekten sıfırdan: yeniden açılan form boştur, bir önceki denemenin
     hiçbir durumu sızmaz. */
  await poiButton(page).click()
  await clickMap(page, 0.4, 0.6)
  await expect(sheet(page, 'POI Ekle').getByLabel('POI Adı')).toHaveValue('')
})

test('toggling the tool repeatedly does not stack interactions', async ({ page }) => {
  await openMap(page, withPoi('poi.view', 'poi.create'))

  for (let i = 0; i < 3; i += 1) {
    await poiButton(page).click()
    await expect(poiButton(page)).toHaveAttribute('aria-pressed', 'true')
    await poiButton(page).click()
    await expect(poiButton(page)).toHaveAttribute('aria-pressed', 'false')
  }

  await poiButton(page).click()
  await clickMap(page)

  /* Etkileşim üst üste binseydi tek tık birden çok drawend üretir ve birden
     çok form açardı. */
  await expect(page.getByRole('heading', { name: 'POI Ekle' })).toHaveCount(1)
})

test('POI placement and a drawing tool are never active together', async ({ page }) => {
  await openMap(page, ALL_PERMISSIONS)

  const pointTool = toolbar(page).getByRole('button', { name: /^Nokta çiz/ })

  await poiButton(page).click()
  await expect(poiButton(page)).toHaveAttribute('aria-pressed', 'true')

  // Başka bir araç açmak POI modunu kapatır — mod tektir.
  await pointTool.click()
  await expect(pointTool).toHaveAttribute('aria-pressed', 'true')
  await expect(poiButton(page)).toHaveAttribute('aria-pressed', 'false')

  await poiButton(page).click()
  await expect(poiButton(page)).toHaveAttribute('aria-pressed', 'true')
  await expect(pointTool).toHaveAttribute('aria-pressed', 'false')
})

/* ===========================================================================
   4. Kategoriler
   =========================================================================== */

test('the form loads categories and labels them by path', async ({ page }) => {
  const { calls } = await openMap(page, withPoi('poi.view', 'poi.create'))

  await poiButton(page).click()
  await clickMap(page)

  const form = sheet(page, 'POI Ekle')
  await expect.poll(() => calls.categories).toBeGreaterThan(0)

  const options = await form.getByLabel('Kategori').locator('option').allInnerTexts()
  expect(options).toContain('Yeme-İçme')
  expect(options).toContain('Yeme-İçme / Kafe')
  expect(options).toContain('Yeme-İçme / Restoran')
})

test('with no categories the form says so and blocks submission', async ({ page }) => {
  await openMap(page, withPoi('poi.view', 'poi.create'), { categories: [] })

  await poiButton(page).click()
  await clickMap(page)

  const form = sheet(page, 'POI Ekle')
  await expect(form.getByText('POI eklemek için önce bir kategori tanımlanmalıdır.')).toBeVisible()
  // categoryId=0 hiçbir yoldan gönderilemez.
  await form.getByLabel('POI Adı').fill('Deneme')
  await expect(form.getByRole('button', { name: 'Kaydet' })).toBeDisabled()
})

/* ===========================================================================
   5. Kayıt
   =========================================================================== */

test('the POST body carries exactly the five client-owned fields', async ({ page }) => {
  const { calls } = await openMap(page, withPoi('poi.view', 'poi.create'))

  await poiButton(page).click()
  await clickMap(page)

  const form = sheet(page, 'POI Ekle')
  await form.getByLabel('POI Adı').fill('  Yeni POI  ')
  await form.getByLabel('Kategori').selectOption('3')
  await form.getByRole('button', { name: 'Kaydet' }).click()

  await expect.poll(() => calls.created.length).toBe(1)

  const body = calls.created[0]
  expect(Object.keys(body).sort()).toEqual(['categoryId', 'latitude', 'longitude', 'name', 'workHours'])
  expect(body.name).toBe('Yeni POI')
  expect(body.categoryId).toBe(3)

  // Sunucuya ait alanlar ve geometri temsilleri gönderilmez.
  for (const forbidden of ['userId', 'createdDate', 'modifiedDate', 'isActive', 'isDeleted', 'wkt', 'srid', 'creatorUsername']) {
    expect(body).not.toHaveProperty(forbidden)
  }

  // Tıklanan nokta EPSG:4326'ya geri çevrilmiştir.
  expect(Number.isFinite(body.longitude)).toBe(true)
  expect(Math.abs(body.longitude)).toBeLessThanOrEqual(180)
  expect(Math.abs(body.latitude)).toBeLessThanOrEqual(90)

  // POI hiçbir koşulda çizim ucundan geçmez.
  expect(calls.drawingCreates).toHaveLength(0)
})

test('an untouched day is omitted while closed and open days are explicit', async ({ page }) => {
  const { calls } = await openMap(page, withPoi('poi.view', 'poi.create'))

  await poiButton(page).click()
  await clickMap(page)

  const form = sheet(page, 'POI Ekle')
  await form.getByLabel('POI Adı').fill('Mesai POI')
  await form.getByLabel('Kategori').selectOption('3')

  await form.getByRole('checkbox', { name: 'Pazartesi' }).check()
  await form.getByLabel('Pazartesi açılış saati').fill('09:00')
  await form.getByLabel('Pazartesi kapanış saati').fill('18:00')

  /* `exact: true` ŞART: "Pazar" aksi hâlde "Pazartesi" ile de eşleşir ve
     locator iki öğe bulup düşer. Üretimdeki etiketler doğrudur, düzeltilmesi
     gereken locator'dır. */
  const sundayEnabled = form.getByRole('checkbox', { name: 'Pazar', exact: true })
  await sundayEnabled.check()

  /* Pazar satırı, o kutunun EN YAKIN `.poi-hours-day` atasıdır.

     `filter({ has })` ile kurulmaz: oradaki iç locator her aday satıra göre
     çözülmek zorundadır, `form`dan başlatılan bir locator ise kökü diyaloğa
     yeniden sabitler ve hiçbir satırın içinde eşleşmez. Atadan yürümek bu
     belirsizliği tamamen ortadan kaldırır ve nth()/last() gibi konum
     tahminlerine de gerek bırakmaz. */
  const sundayRow = sundayEnabled.locator('xpath=ancestor::li[contains(@class,"poi-hours-day")][1]')

  // Satır içinde tek "Kapalı" vardır; `exact` yine de başka bir etiketin
  // ileride onu içerecek şekilde büyümesine karşı sabitler.
  await sundayRow.getByRole('checkbox', { name: 'Kapalı', exact: true }).check()

  await form.getByRole('button', { name: 'Kaydet' }).click()
  await expect.poll(() => calls.created.length).toBe(1)

  const hours = calls.created[0].workHours
  expect(hours.monday).toEqual({ closed: false, open: '09:00', close: '18:00' })
  expect(hours.sunday).toEqual({ closed: true })
  // Dokunulmayan gün "Kapalı"ya DÖNÜŞMEZ; gövdeye hiç girmez.
  expect(hours).not.toHaveProperty('tuesday')
})

test('an opening time that is not before closing is blocked before any request', async ({ page }) => {
  const { calls } = await openMap(page, withPoi('poi.view', 'poi.create'))

  await poiButton(page).click()
  await clickMap(page)

  const form = sheet(page, 'POI Ekle')
  await form.getByLabel('POI Adı').fill('Ters Mesai')
  await form.getByLabel('Kategori').selectOption('3')
  await form.getByRole('checkbox', { name: 'Pazartesi' }).check()
  await form.getByLabel('Pazartesi açılış saati').fill('18:00')
  await form.getByLabel('Pazartesi kapanış saati').fill('09:00')

  await form.getByRole('button', { name: 'Kaydet' }).click()

  await expect(form.getByText('Açılış saati kapanış saatinden önce olmalıdır.')).toBeVisible()
  expect(calls.created).toHaveLength(0)
})

test('a successful save closes the form, drops the marker and shows the POI', async ({ page }) => {
  const { calls } = await openMap(page, withPoi('poi.view', 'poi.create'))

  await poiButton(page).click()
  await clickMap(page)

  const form = sheet(page, 'POI Ekle')
  await form.getByLabel('POI Adı').fill('Kaydedilen POI')
  await form.getByLabel('Kategori').selectOption('3')

  /* Ölçülen şey MUTLAK istek sayısı değil, kaydetmenin YENİ bir istek açıp
     açmadığıdır: geliştirme sunucusu StrictMode altında çalışır ve efektleri
     bilerek iki kez çağırır, dolayısıyla açılıştaki GET sayısı 1 olmak
     zorunda değildir. */
  const beforeSave = calls.pois

  await form.getByRole('button', { name: 'Kaydet' }).click()

  await expect(sheet(page, 'POI Ekle')).toHaveCount(0)
  await expect(page.getByText('POI başarıyla eklendi.')).toBeVisible()
  await expect(poiButton(page)).toHaveAttribute('aria-pressed', 'false')

  /* Yeni kayıt AYNI eşlemeden geçip kaynağa eklenir; ikinci bir GET
     açılmaz — az önce yazılanı yeniden indirmek olurdu. */
  expect(calls.pois).toBe(beforeSave)
})

test('a failed save keeps the form, its values and the pending marker', async ({ page }) => {
  await openMap(page, withPoi('poi.view', 'poi.create'))

  await page.route('**/api/poi', (route) => {
    if (route.request().method() !== 'POST') return route.fulfill(json(POIS))
    return route.fulfill(json({ message: 'Bu alanda POI ekleme yetkiniz bulunmuyor.' }, 403))
  })

  await poiButton(page).click()
  await clickMap(page)

  const form = sheet(page, 'POI Ekle')
  await form.getByLabel('POI Adı').fill('Alan Dışı')
  await form.getByLabel('Kategori').selectOption('3')
  await form.getByRole('button', { name: 'Kaydet' }).click()

  // Coğrafi ret açıkça söylenir ama izin verilen alan AÇIKLANMAZ.
  const alert = form.getByRole('alert')
  await expect(alert).toContainText('Bu alanda POI ekleme yetkiniz bulunmuyor.')
  await expect(alert).not.toContainText('POLYGON')

  /* Form açık, değerler ve bekleyen konum yerinde. Konum, katman sayısıyla
     değil formun salt okunur çıktısıyla doğrulanır — katman her zaman vardır
     ve hiçbir şey kanıtlamaz. */
  await expect(form.getByLabel('POI Adı')).toHaveValue('Alan Dışı')
  await expect(form.getByText(/^-?\d+\.\d{5}, -?\d+\.\d{5}$/)).toBeVisible()
})

test('save is disabled while a request is in flight', async ({ page }) => {
  const { calls } = await openMap(page, withPoi('poi.view', 'poi.create'))

  let release
  const gate = new Promise((resolve) => { release = resolve })

  await page.route('**/api/poi', async (route) => {
    if (route.request().method() !== 'POST') return route.fulfill(json(POIS))
    calls.created.push(JSON.parse(route.request().postData() ?? '{}'))
    await gate
    return route.fulfill(json({ id: 99, name: 'x', longitude: 32, latitude: 39, workHours: null }, 201))
  })

  await poiButton(page).click()
  await clickMap(page)

  const form = sheet(page, 'POI Ekle')
  await form.getByLabel('POI Adı').fill('Tek Kayıt')
  await form.getByLabel('Kategori').selectOption('3')

  const save = form.getByRole('button', { name: /Kaydet|Kaydediliyor/ })
  await save.click()
  await expect(save).toBeDisabled()
  await save.click({ force: true }).catch(() => {})

  release()
  await expect(sheet(page, 'POI Ekle')).toHaveCount(0)
  expect(calls.created).toHaveLength(1)
})

/* ===========================================================================
   6. Tıklama ve bilgi paneli
   =========================================================================== */

test('clicking a POI opens the info sheet with no creator metadata', async ({ page }) => {
  await openMap(page, withPoi('poi.view'))

  await clickPoi(page)

  const info = sheet(page, 'POI Bilgisi')
  await expect(info).toBeVisible()
  await expect(info.getByText('Yeme-İçme / Kafe')).toBeVisible()

  /* Harita sözleşmesi oluşturan bilgisi taşımaz; panel de göstermez. */
  const body = await info.innerText()
  for (const token of ['saha', 'creator', 'Oluşturan', 'isDeleted', '{', '"closed"']) {
    expect(body).not.toContain(token)
  }
})

test('the info sheet renders all three work-hour states in Turkish', async ({ page }) => {
  await openMap(page, withPoi('poi.view'))
  await clickPoi(page)

  const info = sheet(page, 'POI Bilgisi')
  await expect(info.getByText('Pazartesi')).toBeVisible()
  await expect(info.getByText('09:00 – 18:00')).toBeVisible()
  await expect(info.getByText('Kapalı')).toBeVisible()
  // "Belirtilmemiş" ile "Kapalı" AYRI şeylerdir ve ayrı gösterilir.
  await expect(info.getByText('Belirtilmemiş').first()).toBeVisible()
})

test('clicking empty map closes the info sheet', async ({ page }) => {
  await openMap(page, withPoi('poi.view'))
  await clickPoi(page)
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()

  await clickMap(page, 0.1, 0.85)
  await expect(sheet(page, 'POI Bilgisi')).toHaveCount(0)
})

test('a drawing point does not open the POI info sheet', async ({ page }) => {
  /* İsabet denetimi YALNIZCA POI katmanına kapsanır: bir çizim noktası POI
     DEĞİLDİR ve bilgi paneli açmamalıdır. */
  await openMap(page, ALL_PERMISSIONS, { pois: [] })

  await toolbar(page).getByRole('button', { name: /^Nokta çiz/ }).click()
  await clickMap(page)

  // Çizimin kendi öznitelik popup'ı açılır, POI paneli değil.
  await expect(page.getByRole('heading', { name: 'POI Bilgisi' })).toHaveCount(0)
})

test('the temporary placement marker is not clickable as a POI', async ({ page }) => {
  await openMap(page, withPoi('poi.view', 'poi.create'), { pois: [] })

  await poiButton(page).click()
  await clickMap(page)
  await expect(sheet(page, 'POI Ekle')).toBeVisible()

  await sheet(page, 'POI Ekle').getByRole('button', { name: 'İptal' }).click()
  await clickMap(page)

  // Geçici işaret kalıcı kaynağa hiç girmediği için tıklanacak bir şey yok.
  await expect(page.getByRole('heading', { name: 'POI Bilgisi' })).toHaveCount(0)
})

/* ===========================================================================
   7. Regresyon
   =========================================================================== */

test('the existing drawing, measurement and selection tools still work', async ({ page }) => {
  await openMap(page, ALL_PERMISSIONS)

  await expect(toolbar(page).getByRole('button', { name: /^Nokta çiz/ })).toBeVisible()
  await expect(toolbar(page).getByRole('button', { name: /^Çizgi çiz/ })).toBeVisible()
  await expect(toolbar(page).getByRole('button', { name: /^Poligon çiz/ })).toBeVisible()
  await expect(toolbar(page).getByRole('button', { name: 'Ölçüm aracı (M)' })).toBeVisible()
  await expect(toolbar(page).getByRole('button', { name: 'Envanter Analizi aracı' })).toBeVisible()

  // Çizim akışı POI eklenmesinden etkilenmez.
  await toolbar(page).getByRole('button', { name: /^Nokta çiz/ }).click()
  await clickMap(page)
  await expect(page.getByRole('heading', { name: /öznitelik|Nokta/i }).first()).toBeVisible()
})
