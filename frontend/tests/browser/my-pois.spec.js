import { expect, test } from '@playwright/test'
import { mockPermissions } from './permissions.js'

/**
 * "POI'lerim" — canlı Operatör profilinin ekranı.
 *
 * ## Profil
 *
 * Yetkiler tam olarak sahadaki özel rolün taşıdıklarıdır:
 *
 *   map.view, poi.view, poi.create, poi.update, poi.delete
 *
 * `poi.manage` ve hiçbir `drawings.*` yetkisi YOKTUR. Bu bilinçlidir: panelin
 * ve ortak Çöp Kutusu'nun yalnızca POI yetkisiyle çalıştığı ancak böyle
 * kanıtlanır. Rol ADI ("Operatör") sunucudan bildirilir ama hiçbir görünürlük
 * kararına girmez.
 *
 * ## Burada kanıtlanan şey
 *
 * Kapsamın SUNUCUDA daraldığı: harita herkesin POI'sini gösterirken
 * "POI'lerim" yalnızca kendi kayıtlarını listeler — istemci, ortak listeyi
 * süzerek bunu yapamaz, çünkü harita sözleşmesi kaydın sahibini taşımaz.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/** Canlı Operatör rolünün yetkileri — poi.manage YOK, drawings.* YOK. */
const OPERATOR_PERMISSIONS = ['map.view', 'poi.view', 'poi.create', 'poi.update', 'poi.delete']

/** Haritanın açılış merkezi: kabın orta pikseli tam bu koordinattır. */
const MAP_CENTER = { longitude: 35.2433, latitude: 38.9637 }

const OWN_POI = {
  id: 11,
  name: 'Kendi Kafem',
  categoryId: 3,
  categoryName: 'kafe',
  categoryPath: 'Yeme-İçme / kafe',
  workHours: { monday: { closed: false, open: '09:00', close: '18:00' }, sunday: { closed: true } },
  canUpdate: true,
  canDelete: true,
  ...MAP_CENTER,
}

/** Harita merkezinden UZAKTA kendi kaydı: odaklanmanın ölçülebildiği kayıt. */
const DISTANT_POI = {
  id: 13,
  name: 'İzmir Şubesi',
  categoryId: 3,
  categoryName: 'kafe',
  categoryPath: 'Yeme-İçme / kafe',
  workHours: null,
  canUpdate: true,
  canDelete: true,
  longitude: 27.1428,
  latitude: 38.4237,
}

/** Başkasının kaydı: haritada GÖRÜNÜR, "POI'lerim"de YOKTUR. */
const FOREIGN_POI = {
  id: 12,
  name: 'Başkasının Noktası',
  categoryId: 2,
  categoryName: 'restoran',
  categoryPath: 'Yeme-İçme / restoran',
  workHours: null,
  canUpdate: false,
  canDelete: false,
  longitude: 32.87,
  latitude: 39.94,
}

const CATEGORIES = [
  { id: 1, name: 'Yeme-İçme', parentId: null, path: 'Yeme-İçme', depth: 0 },
  { id: 3, name: 'kafe', parentId: 1, path: 'Yeme-İçme / kafe', depth: 1 },
  { id: 2, name: 'restoran', parentId: 1, path: 'Yeme-İçme / restoran', depth: 1 },
]

async function openMap(page, { mine = [OWN_POI], all = [OWN_POI, FOREIGN_POI] } = {}) {
  const calls = { mine: 0, updates: [], deletes: [], restores: [], drawingsDeleted: 0 }
  const state = { mine: [...mine], all: [...all], trash: [] }

  const permissions = await mockPermissions(page, OPERATOR_PERMISSIONS)

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({
      userId: 1, username: 'duygu2', email: 'duygu2@example.invalid',
      emailConfirmed: true, twoFactorEnabled: true,
      // Kanonik OLMAYAN özel rol: hiçbir karar bu ada bakmaz.
      role: 'Operatör', roles: ['Operatör'],
    })),
  )
  await page.route('**/api/auth/me/geographic-scope', (route) =>
    route.fulfill(json({ isRestricted: false, effectiveWkt: null, areaCount: 0 })),
  )

  /* Çizim uçları 403 döner: bu profilin hiçbir çizim yetkisi yoktur. Ortak
     Çöp Kutusu'nun bu yüzden DÜŞMEMESİ gereken durum tam olarak budur. */
  for (const path of ['points', 'lines', 'polygons', 'deleted']) {
    await page.route(`**/api/drawings/${path}`, (route) => {
      if (path === 'deleted') calls.drawingsDeleted += 1
      return route.fulfill(json({ message: 'Yetkiniz yok.' }, 403))
    })
  }

  await page.route('**/api/poi/categories', (route) => route.fulfill(json(CATEGORIES)))
  await page.route('**/api/poi/mine', (route) => {
    calls.mine += 1
    return route.fulfill(json(state.mine))
  })
  await page.route('**/api/poi/deleted', (route) => route.fulfill(json(state.trash)))

  await page.route('**/api/poi/*/restore', (route) => {
    const id = Number(route.request().url().match(/\/api\/poi\/(\d+)\/restore/)?.[1])
    calls.restores.push(id)

    const index = state.trash.findIndex((entry) => entry.poi.id === id)
    const [entry] = index === -1 ? [null] : state.trash.splice(index, 1)
    if (entry) {
      state.mine.push(entry.poi)
      state.all.push(entry.poi)
    }
    return route.fulfill(json(entry?.poi ?? OWN_POI))
  })

  await page.route(/\/api\/poi\/\d+$/, async (route) => {
    const id = Number(route.request().url().match(/\/api\/poi\/(\d+)$/)?.[1])

    if (route.request().method() === 'PUT') {
      const body = JSON.parse(route.request().postData() ?? '{}')
      calls.updates.push(body)
      const updated = { ...state.mine.find((poi) => poi.id === id), ...body }
      state.mine = state.mine.map((poi) => (poi.id === id ? updated : poi))
      state.all = state.all.map((poi) => (poi.id === id ? updated : poi))
      return route.fulfill(json(updated))
    }

    if (route.request().method() === 'DELETE') {
      calls.deletes.push(id)
      const removed = state.mine.find((poi) => poi.id === id)
      state.mine = state.mine.filter((poi) => poi.id !== id)
      state.all = state.all.filter((poi) => poi.id !== id)
      if (removed) {
        state.trash.push({ type: 'poi', deletedAt: '2026-08-24T10:00:00Z', creatorUsername: '', poi: removed })
      }
      return route.fulfill({ status: 204, body: '' })
    }

    return route.fulfill(json({}, 405))
  })

  await page.route('**/api/poi', (route) => route.fulfill(json(state.all)))

  await page.addInitScript((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())

  await page.goto('/map')
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  return { calls, state, permissions }
}

const sheet = (page, title) =>
  page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: title }) })

const myPois = (page) => sheet(page, /POI'lerim/)

async function openMyPois(page) {
  await page.getByRole('button', { name: "POI'lerim" }).click()
  await expect(myPois(page)).toBeVisible()
  return myPois(page)
}

const rowTitles = (page) => page.locator('.my-pois-panel .drawings-item-title')

async function clickMapCentre(page) {
  const box = await page.locator('.map-container').boundingBox()
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5)
  await page.waitForTimeout(150)
}

/* ===========================================================================
   1. Sidebar and scope
   =========================================================================== */

test("POI'lerim appears for a POI-only profile, Çizimlerim does not", async ({ page }) => {
  await openMap(page)

  await expect(page.getByRole('button', { name: "POI'lerim" })).toBeVisible()
  // İki panel BAĞIMSIZDIR: çizim yetkisi olmayan biri yalnızca POI'lerini görür.
  await expect(page.getByRole('button', { name: 'Çizimlerim' })).toHaveCount(0)
})

test("POI'lerim lists only own records while the map still shows everyone's", async ({ page }) => {
  const { calls } = await openMap(page)
  await openMyPois(page)

  // Kapsam sunucudan gelir: yalnızca kendi kaydı listelenir.
  await expect(rowTitles(page)).toHaveText(['#11 Kendi Kafem'])
  expect(calls.mine).toBeGreaterThan(0)

  /* Harita ortak envanterdir ve daralmaz. Panel kapatılır (Esc açık bağlamı
     bırakır) ve haritadaki kayda tıklamak bilgi panelini açar. */
  await page.keyboard.press('Escape')
  await expect(myPois(page)).toHaveCount(0)
  await clickMapCentre(page)
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()
})

test("a foreign POI is absent from POI'lerim", async ({ page }) => {
  await openMap(page)
  await openMyPois(page)

  await expect(myPois(page).getByText('Başkasının Noktası')).toHaveCount(0)
})

/* ===========================================================================
   2. Row actions
   =========================================================================== */

test('a row focuses the POI and hands over to POI Bilgisi', async ({ page }) => {
  await openMap(page)
  const panel = await openMyPois(page)

  await panel.getByRole('button', { name: 'Kendi Kafem kaydını haritada göster' }).click()

  // Tek birincil panel: liste yerini POI Bilgisi'ne bırakır.
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()
  await expect(myPois(page)).toHaveCount(0)
})

test('own rows offer edit and delete because the server said so', async ({ page }) => {
  await openMap(page)
  const panel = await openMyPois(page)

  await expect(panel.getByRole('button', { name: 'Kendi Kafem kaydını düzenle' })).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Kendi Kafem kaydını sil' })).toBeVisible()
})

/* ===========================================================================
   3. Delete -> Trash -> restore, with no drawing permissions at all
   =========================================================================== */

test('delete removes the POI from map and list, and the POI-only trash still works', async ({ page }) => {
  const { calls } = await openMap(page)
  const panel = await openMyPois(page)

  await panel.getByRole('button', { name: 'Kendi Kafem kaydını sil' }).click()
  await page
    .getByRole('alertdialog', { name: "POI'yi sil", exact: true })
    .getByRole('button', { name: 'Sil', exact: true })
    .click()

  await expect.poll(() => calls.deletes.length).toBe(1)
  await expect(rowTitles(page)).toHaveCount(0)

  /* Çöp Kutusu, ÇİZİM uçları 403 dönerken de çalışır: her yarı kendi
     yetkisine bağlıdır ve çizim yarısının reddi POI yarısını düşürmez. */
  await page.getByRole('button', { name: 'Çöp Kutusu' }).click()
  const trash = sheet(page, /Çöp Kutusu/)
  await expect(trash.getByText('Kendi Kafem')).toBeVisible()
  await expect(trash.getByText('Silinen kayıtlar yüklenemedi.')).toHaveCount(0)

  await trash.getByRole('button', { name: 'Kendi Kafem kaydını geri yükle' }).click()
  await page
    .getByRole('alertdialog', { name: "POI'yi geri yükle", exact: true })
    .getByRole('button', { name: 'Geri Yükle', exact: true })
    .click()

  await expect.poll(() => calls.restores.length).toBe(1)
  await expect(trash.getByText('Kendi Kafem')).toHaveCount(0)

  // Geri yüklenen kayıt "POI'lerim"e de döner.
  await openMyPois(page)
  await expect(rowTitles(page)).toHaveText(['#11 Kendi Kafem'])
})

/* ===========================================================================
   4. Edit: one field is enough
   =========================================================================== */

async function openEditForm(page) {
  const panel = await openMyPois(page)
  await panel.getByRole('button', { name: 'Kendi Kafem kaydını düzenle' }).click()
  const form = sheet(page, 'POI Düzenle')
  await expect(form).toBeVisible()
  return form
}

const updateButton = (form) => form.getByRole('button', { name: 'Güncelle' })
const revertButton = (form) => form.getByRole('button', { name: 'Değişiklikleri Geri Al' })

test('the update button starts disabled: nothing has changed yet', async ({ page }) => {
  await openMap(page)
  const form = await openEditForm(page)

  await expect(updateButton(form)).toBeDisabled()
  await expect(revertButton(form)).toBeDisabled()
})

test('changing ONLY the name enables Güncelle', async ({ page }) => {
  await openMap(page)
  const form = await openEditForm(page)

  await form.getByLabel('POI Adı').fill('Yeni Ad')
  await expect(updateButton(form)).toBeEnabled()
})

test('changing ONLY the category enables Güncelle', async ({ page }) => {
  await openMap(page)
  const form = await openEditForm(page)

  await form.getByRole('searchbox', { name: 'Kategori', exact: true }).fill('restoran')
  await form
    .getByRole('listbox', { name: 'Kategoriler' })
    .getByRole('option', { name: 'Yeme-İçme / restoran', exact: true })
    .click()

  await expect(updateButton(form)).toBeEnabled()
})

test('changing ONLY a work-hours time enables Güncelle', async ({ page }) => {
  const { calls } = await openMap(page)
  const form = await openEditForm(page)

  /* Canlı hata tam olarak buydu: kategori dokunulmadan yalnızca saat
     değiştiğinde Güncelle kapalı kalıyordu. */
  await form.getByLabel('Pazartesi açılış saati').fill('10:00')
  await expect(updateButton(form)).toBeEnabled()

  await updateButton(form).click()
  await expect.poll(() => calls.updates.length).toBe(1)

  /* Gövde TAM geçerli durumu taşır. Konum artık düzenlenebilir bir alandır ve
     bu yüzden gövdededir — ama DEĞİŞMEMİŞTİR: yalnızca saati değiştiren bir
     kullanıcı kaydını taşımış olmaz. */
  expect(Object.keys(calls.updates[0]).sort()).toEqual([
    'categoryId', 'latitude', 'longitude', 'name', 'workHours',
  ])
  expect(calls.updates[0].categoryId).toBe(3)
  expect(calls.updates[0].workHours.monday).toEqual({ closed: false, open: '10:00', close: '18:00' })
  expect(calls.updates[0].longitude).toBeCloseTo(MAP_CENTER.longitude, 6)
  expect(calls.updates[0].latitude).toBeCloseTo(MAP_CENTER.latitude, 6)
})

test('changing a field and reverting it exactly disables Güncelle again', async ({ page }) => {
  await openMap(page)
  const form = await openEditForm(page)

  const nameField = form.getByLabel('POI Adı')
  await nameField.fill('Geçici')
  await expect(updateButton(form)).toBeEnabled()

  await nameField.fill('Kendi Kafem')
  // Anlamca eşit: kirli değil.
  await expect(updateButton(form)).toBeDisabled()
})

test('Değişiklikleri Geri Al restores every field without a request', async ({ page }) => {
  const { calls } = await openMap(page)
  const form = await openEditForm(page)

  await form.getByLabel('POI Adı').fill('Geçici Ad')
  await form.getByLabel('Pazartesi açılış saati').fill('11:00')
  await form.getByRole('searchbox', { name: 'Kategori', exact: true }).fill('restoran')
  await form
    .getByRole('listbox', { name: 'Kategoriler' })
    .getByRole('option', { name: 'Yeme-İçme / restoran', exact: true })
    .click()

  await expect(updateButton(form)).toBeEnabled()
  await revertButton(form).click()

  // Her alan açılıştaki hâline döner…
  await expect(form.getByLabel('POI Adı')).toHaveValue('Kendi Kafem')
  await expect(form.getByLabel('Pazartesi açılış saati')).toHaveValue('09:00')
  await expect(form.getByText('Seçili: Yeme-İçme / kafe')).toBeVisible()

  // …form AÇIK kalır, hiçbir istek gitmez ve Güncelle yeniden kapanır.
  await expect(form).toBeVisible()
  expect(calls.updates).toEqual([])
  await expect(updateButton(form)).toBeDisabled()
})

/* ===========================================================================
   5. Context handover
   =========================================================================== */

test("only one primary panel is open as POI'lerim hands over", async ({ page }) => {
  await openMap(page)

  await openMyPois(page)
  await page.getByRole('button', { name: 'Çöp Kutusu' }).click()
  // Kullanıcı önceki paneli ELLE kapatmak zorunda değildir.
  await expect(myPois(page)).toHaveCount(0)
  expect(await page.getByRole('dialog').count()).toBeLessThanOrEqual(1)

  await openMyPois(page)
  await clickMapCentre(page)
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()
  await expect(myPois(page)).toHaveCount(0)
})

test("revoking poi.view removes POI'lerim and closes its panel", async ({ page }) => {
  const { permissions } = await openMap(page)
  await openMyPois(page)

  // Yetkilendirme CANLIDIR; token değişmez, yeniden giriş yapılmaz.
  permissions.set(['map.view'])
  await page.reload()
  await expect(page.locator('.map-container canvas').first()).toBeVisible()

  await expect(page.getByRole('button', { name: "POI'lerim" })).toHaveCount(0)
  await expect(myPois(page)).toHaveCount(0)
})

/* ===========================================================================
   6. Konum düzenleme: elle, haritada sürükleyerek, geri alarak
   ===========================================================================

   Ölçülen sözleşme: taslak koordinat KAYDEDİLENE KADAR bir niyettir. Kalıcı
   kayıt yalnızca sunucu kabul ettiğinde taşınır; reddedilen bir istek haritayı
   veritabanında olmayan bir konumu anlatır hâlde bırakamaz. */

const longitudeField = (form) => form.getByLabel('Boylam', { exact: true })
const latitudeField = (form) => form.getByLabel('Enlem', { exact: true })

/** Sürükleme için taslak işaretin bulunduğu piksel: haritanın tam ortası. */
async function mapCentrePixel(page) {
  const box = await page.locator('.map-container').boundingBox()
  return { x: box.x + box.width * 0.5, y: box.y + box.height * 0.5 }
}

test('the footer keeps Geri Al, İptal and Güncelle in ONE right-aligned group', async ({ page }) => {
  await openMap(page)
  const form = await openEditForm(page)

  const actions = form.locator('.poi-form-actions')

  // Sıra korunur ve üçü de AYNI grubun çocuğudur.
  await expect(actions.getByRole('button')).toHaveText([
    'Değişiklikleri Geri Al',
    'İptal',
    'Güncelle',
  ])

  /* "Geri Al" bir kenara itilmiş değil, İptal'in komşusudur: aralarındaki
     boşluk, grubun kendi boşluğundan büyük olamaz. Piksel-mükemmel bir
     karşılaştırma değil, `space-between`/`margin-right:auto` düzeninin geri
     gelmediğinin kanıtıdır. */
  const revert = await revertButton(form).boundingBox()
  const cancel = await form.getByRole('button', { name: 'İptal' }).boundingBox()
  const update = await updateButton(form).boundingBox()

  expect(cancel.x - (revert.x + revert.width)).toBeLessThan(24)
  // Geri Al, birincil eylemden BÜYÜK değildir.
  expect(revert.height).toBeLessThanOrEqual(update.height + 1)
})

test('an overnight work-hours interval is accepted and stored verbatim', async ({ page }) => {
  const { calls } = await openMap(page)
  const form = await openEditForm(page)

  await form.getByLabel('Pazartesi açılış saati').fill('17:00')
  await form.getByLabel('Pazartesi kapanış saati').fill('01:00')

  // Gece aşımı bir hata DEĞİLDİR: yalnızca ne anlama geldiği söylenir.
  await expect(form.getByText('Açılış ve kapanış saati aynı olamaz.')).toHaveCount(0)
  await expect(form.getByText('01:00 — ertesi gün kapanır')).toBeVisible()
  await expect(updateButton(form)).toBeEnabled()

  await updateButton(form).click()
  await expect.poll(() => calls.updates.length).toBe(1)
  // Saatler OLDUĞU GİBİ gider; "ertesi gün" için ek bir alan uydurulmaz.
  expect(calls.updates[0].workHours.monday).toEqual({ closed: false, open: '17:00', close: '01:00' })
})

test('switching a day to 24 hours enables Güncelle and sends the explicit flag', async ({ page }) => {
  const { calls } = await openMap(page)
  const form = await openEditForm(page)

  await form.getByRole('checkbox', { name: 'Pazartesi 24 saat açık' }).check()

  // Saat alanları kalkar; kesintisiz açık bir günün saati sorulmaz.
  await expect(form.getByLabel('Pazartesi açılış saati')).toHaveCount(0)
  await expect(updateButton(form)).toBeEnabled()

  await updateButton(form).click()
  await expect.poll(() => calls.updates.length).toBe(1)

  // Sahte bir aralık uydurulmaz; Pazar'ın kapalılığı da olduğu gibi kalır.
  expect(calls.updates[0].workHours.monday).toEqual({ closed: false, open24Hours: true })
  expect(calls.updates[0].workHours.sunday).toEqual({ closed: true })
})

test('a stored 24-hour day opens with its toggle on and can go back to a range', async ({ page }) => {
  const alwaysOpen = {
    ...OWN_POI,
    workHours: { monday: { closed: false, open24Hours: true }, sunday: { closed: true } },
  }
  const { calls } = await openMap(page, { mine: [alwaysOpen], all: [alwaysOpen, FOREIGN_POI] })

  const form = await openEditForm(page)

  // Kayıt olduğu gibi hidratlanır: kutu işaretli, saat alanları yok.
  await expect(form.getByRole('checkbox', { name: 'Pazartesi 24 saat açık' })).toBeChecked()
  await expect(form.getByLabel('Pazartesi açılış saati')).toHaveCount(0)
  await expect(updateButton(form)).toBeDisabled()

  await form.getByRole('checkbox', { name: 'Pazartesi 24 saat açık' }).uncheck()

  /* Saat alanları geri gelir ama DEĞER UYDURULMAZ: boş bir aralık geçerli bir
     program değildir, bu yüzden kullanıcı saatleri kendisi yazana kadar
     gönderim engellenir. */
  await form.getByLabel('Pazartesi açılış saati').fill('09:00')
  await form.getByLabel('Pazartesi kapanış saati').fill('18:00')
  await expect(updateButton(form)).toBeEnabled()

  await updateButton(form).click()
  await expect.poll(() => calls.updates.length).toBe(1)
  expect(calls.updates[0].workHours.monday).toEqual({ closed: false, open: '09:00', close: '18:00' })
})

test('Değişiklikleri Geri Al restores a 24-hour day exactly', async ({ page }) => {
  const alwaysOpen = {
    ...OWN_POI,
    workHours: { monday: { closed: false, open24Hours: true } },
  }
  const { calls } = await openMap(page, { mine: [alwaysOpen], all: [alwaysOpen, FOREIGN_POI] })

  const form = await openEditForm(page)
  const allDay = form.getByRole('checkbox', { name: 'Pazartesi 24 saat açık' })

  await allDay.uncheck()
  await form.getByLabel('Pazartesi açılış saati').fill('17:00')
  await form.getByLabel('Pazartesi kapanış saati').fill('01:00')
  await expect(updateButton(form)).toBeEnabled()

  await revertButton(form).click()

  // Dördüncü durum da açılıştaki hâline döner.
  await expect(allDay).toBeChecked()
  await expect(form.getByLabel('Pazartesi açılış saati')).toHaveCount(0)
  await expect(updateButton(form)).toBeDisabled()
  await expect(form).toBeVisible()
  expect(calls.updates).toEqual([])
})

test('an interval with no duration is blocked before any request', async ({ page }) => {
  const { calls } = await openMap(page)
  const form = await openEditForm(page)

  await form.getByLabel('Pazartesi açılış saati').fill('17:00')
  await form.getByLabel('Pazartesi kapanış saati').fill('17:00')

  /* Mesai doğrulaması GÖNDERİMDE çalışır — oluşturma formundaki kalıbın
     aynısı: kullanıcı saatini yazarken her ara değerde kırmızı bir uyarı
     görmez, gönderdiğinde ne olduğunu öğrenir. Bu yüzden geri bildirim
     tıklamadan SONRA aranır; tıklamadan önce aramak, üretimde hiç olmayan bir
     UX'i sınamak olurdu. */
  await updateButton(form).click()

  /* Hata, İLGİLENDİĞİ günün satırına bağlıdır ve orada aranır: formun herhangi
     bir yerindeki `alert`i sormak, ileride eklenecek başka bir uyarıyla
     (sunucu hatası, koordinat hatası) belirsizleşirdi. */
  const monday = form
    .getByRole('checkbox', { name: 'Pazartesi', exact: true })
    .locator('xpath=ancestor::li[contains(@class,"poi-hours-day")][1]')

  await expect(monday.getByRole('alert')).toHaveText('Açılış ve kapanış saati aynı olamaz.')
  // İstek AÇILMAZ: istemci doğrulaması garanti reddedilecek bir çağrıyı açmaz.
  expect(calls.updates).toEqual([])
  // Form açık kalır; kullanıcı düzeltebilir.
  await expect(form).toBeVisible()
})

test('typing a new longitude enables Güncelle and is what gets sent', async ({ page }) => {
  const { calls } = await openMap(page)
  const form = await openEditForm(page)

  await expect(longitudeField(form)).toHaveValue(String(MAP_CENTER.longitude))
  await longitudeField(form).fill('30.5')

  await expect(updateButton(form)).toBeEnabled()
  await updateButton(form).click()

  await expect.poll(() => calls.updates.length).toBe(1)
  expect(calls.updates[0].longitude).toBeCloseTo(30.5, 6)
  // Dokunulmayan eksen aynen korunur; yarım koordinat gönderilmez.
  expect(calls.updates[0].latitude).toBeCloseTo(MAP_CENTER.latitude, 6)

  /* Yanıt kaydın kanonik hâlidir: satır ve haritadaki işaret yeni konuma
     taşınır — tam sayfa yenilemesi olmadan. */
  await openMyPois(page)
  await expect(myPois(page).getByText('30.50000, 38.96370')).toBeVisible()
})

test('an out-of-range coordinate is refused client-side and sends nothing', async ({ page }) => {
  const { calls } = await openMap(page)
  const form = await openEditForm(page)

  await longitudeField(form).fill('999')

  await expect(form.getByText(/Boylam -180 ile 180 arasında/)).toBeVisible()
  await expect(updateButton(form)).toBeDisabled()

  // Yarım / bozuk girdi de bir sayıya dönüşmez ve 0'a düşürülmez.
  await longitudeField(form).fill('abc')
  await expect(updateButton(form)).toBeDisabled()

  expect(calls.updates).toEqual([])
})

test('dragging the draft marker rewrites the coordinate fields', async ({ page }) => {
  const { calls } = await openMap(page)
  const form = await openEditForm(page)

  await form.getByRole('button', { name: 'Haritada Taşı' }).click()
  await expect(form.getByRole('button', { name: 'Taşımayı Bitir' })).toHaveAttribute('aria-pressed', 'true')

  const centre = await mapCentrePixel(page)
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x + 140, centre.y + 70, { steps: 12 })
  await page.mouse.up()

  // Kutular sürüklenen noktadan yeniden yazılır; dönüşüm 3857 → 4326'dır.
  await expect(longitudeField(form)).not.toHaveValue(String(MAP_CENTER.longitude))
  await expect(updateButton(form)).toBeEnabled()

  const dragged = Number(await longitudeField(form).inputValue())
  const draggedLatitude = Number(await latitudeField(form).inputValue())
  expect(dragged).toBeGreaterThan(MAP_CENTER.longitude)
  // Aşağı sürüklemek enlemi KÜÇÜLTÜR; boylam/enlem hiçbir yerde takas edilmez.
  expect(draggedLatitude).toBeLessThan(MAP_CENTER.latitude)
  expect(Math.abs(dragged)).toBeLessThanOrEqual(180)

  await updateButton(form).click()
  await expect.poll(() => calls.updates.length).toBe(1)
  expect(calls.updates[0].longitude).toBeCloseTo(dragged, 4)
  expect(calls.updates[0].latitude).toBeCloseTo(draggedLatitude, 4)
})

test('Değişiklikleri Geri Al brings the dragged marker home without a request', async ({ page }) => {
  const { calls } = await openMap(page)
  const form = await openEditForm(page)

  await form.getByRole('button', { name: 'Haritada Taşı' }).click()
  const centre = await mapCentrePixel(page)
  await page.mouse.move(centre.x, centre.y)
  await page.mouse.down()
  await page.mouse.move(centre.x + 160, centre.y - 90, { steps: 12 })
  await page.mouse.up()

  await expect(updateButton(form)).toBeEnabled()
  await revertButton(form).click()

  // Konum da açılıştaki hâline döner: anlık görüntü koordinatı TAŞIR.
  await expect(longitudeField(form)).toHaveValue(String(MAP_CENTER.longitude))
  await expect(latitudeField(form)).toHaveValue(String(MAP_CENTER.latitude))
  await expect(updateButton(form)).toBeDisabled()
  await expect(form).toBeVisible()
  expect(calls.updates).toEqual([])
})

test('a geographic refusal keeps the draft on screen and the record where it was', async ({ page }) => {
  const { calls, state } = await openMap(page)

  // Sunucu tek otoritedir: haritada sürükleyebilmek taşıyabilmek DEĞİLDİR.
  await page.route(/\/api\/poi\/\d+$/, (route) =>
    route.request().method() === 'PUT'
      ? route.fulfill({
          status: 403,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Bu alana POI taşıma yetkiniz bulunmuyor.' }),
        })
      : route.fallback(),
  )

  const form = await openEditForm(page)
  await longitudeField(form).fill('10.5')
  await updateButton(form).click()

  // Sunucunun mesajı olduğu gibi görünür ve izin verilen alanı AÇIKLAMAZ.
  await expect(form.getByText('Bu alana POI taşıma yetkiniz bulunmuyor.')).toBeVisible()
  await expect(form).toBeVisible()
  // Taslak yerinde durur; kullanıcı düzeltebilir ya da geri alabilir.
  await expect(longitudeField(form)).toHaveValue('10.5')
  await expect(updateButton(form)).toBeEnabled()
  await expect(revertButton(form)).toBeEnabled()

  // Kalıcı kayıt kıpırdamadı.
  expect(state.mine[0].longitude).toBeCloseTo(MAP_CENTER.longitude, 6)
  expect(calls.updates).toEqual([])
})

/* ===========================================================================
   7. Satıra tıklamak: odaklan ve yaklaş
   ===========================================================================

   Bu bölüm KAMERAYI ölçer, dolayısıyla kameranın ne zaman durduğunu bilmek
   zorundadır. `reducedMotion: 'reduce'`, uygulamanın KENDİ erişilebilirlik
   davranışını açar (`useReducedMotion` → `useMapView.duration()` → 0): görünüm
   animasyon yapmadan doğrudan hedefine gider. Bu bir test kancası değildir —
   hareket duyarlılığı olan gerçek kullanıcıların gördüğü üretim davranışıdır —
   ve ara karelerde ölçüm yapma ihtimalini tamamen ortadan kaldırır.

   Neden gerekliydi: OpenLayers, haritaya basılan ilk `pointerdown`'da süregelen
   görünüm animasyonlarını İPTAL EDER (`View.beginInteraction`). Animasyon
   sürerken haritanın ortasına tıklamak, kamerayı yolun ortasında dondurup
   POI'nin ortada OLMADIĞI bir noktaya tıklamak demekti; iki test tam olarak
   bu yüzden düşüyordu. */

test.describe('POI odaklama', () => {
  // Uygulamanın kendi "azaltılmış hareket" yolu: kamera anında yerleşir.
  test.use({ reducedMotion: 'reduce' })

/** Ölçek çizgisinin metre karşılığı — yakınlığın ÜRETİMDEKİ gözlenebilir izi. */
async function scaleMetres(page) {
  const text = await page.locator('.ol-scale-line-inner').textContent()
  const [, value, unit] = text.trim().match(/^([\d.,]+)\s*(\w+)$/)
  return Number(value.replace(',', '.')) * (unit === 'km' ? 1000 : 1)
}

/**
 * POI ayrıntı ölçeği: 1 km'lik ölçek çizgisi ~13. yakınlık düzeyine karşılık
 * gelir, dolayısıyla bunun altına inmiş bir harita POI'yi gerçekten
 * gösterebiliyordur. `before`den küçük olmak tek başına yeterli bir kanıt
 * değildi — 200 km'den 20 km'ye inmek de o testi geçirirdi.
 */
const POI_DETAIL_SCALE_METRES = 1000

test('clicking the row content zooms to the POI and hands over to POI Bilgisi', async ({ page }) => {
  await openMap(page, { mine: [OWN_POI, DISTANT_POI], all: [OWN_POI, DISTANT_POI, FOREIGN_POI] })
  const panel = await openMyPois(page)

  // Açılış: Türkiye ölçeği — bu yakınlıkta tek bir POI ayırt edilemez.
  const before = await scaleMetres(page)

  await panel.getByRole('button', { name: 'İzmir Şubesi kaydına git' }).click()

  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()
  // Tek birincil panel: liste yerini bilgi paneline bırakır.
  await expect(myPois(page)).toHaveCount(0)

  /* Yakınlık ARTAR (ölçek çizgisi küçülür) ve POI ayrıntı düzeyine ULAŞIR:
     "gittim" demek, oraya bakabilmektir. Azaltılmış hareket açık olduğu için
     bu değer tek adımda yerleşir; ara kare yoktur. */
  expect(before).toBeGreaterThan(POI_DETAIL_SCALE_METRES)
  await expect.poll(() => scaleMetres(page)).toBeLessThanOrEqual(POI_DETAIL_SCALE_METRES)

  /* Merkez de POI'nin kendisidir: paneli bırakıp haritanın tam ortasına
     tıklamak aynı kaydı yeniden açar. Kamera yukarıdaki ölçüm sayesinde
     çoktan yerleşmiştir, dolayısıyla bu tık onu yolun ortasında dondurmaz. */
  await page.keyboard.press('Escape')
  await clickMapCentre(page)
  await expect(sheet(page, 'POI Bilgisi').getByText('İzmir Şubesi')).toBeVisible()
})

test('a POI that is already close does not zoom the user back out', async ({ page }) => {
  await openMap(page)

  /* --- ÖNKOŞUL ---------------------------------------------------------------
     Kanıtlanması gereken durum "şu kadar metre ölçek" DEĞİL, şudur: kullanıcı,
     normal POI odaklanmasının götüreceği yerden DAHA YAKINDA. O yer bir sabitten
     tahmin edilmez — ÜRETİMİN KENDİSİNE sorulur: bir kez odaklanılır ve ölçek
     çizgisinin o andaki değeri referans alınır. Böylece ne POINT_ZOOM bir
     ScaleLine kovasından geri türetilir ne de kova sınırlarına bağımlı bir eşik
     yazılır. */
  const panel = await openMyPois(page)
  await panel.getByRole('button', { name: 'Kendi Kafem kaydına git' }).click()
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()
  // Kamera yerleşene kadar beklenir; azaltılmış hareketle bu tek adımdır.
  await expect.poll(() => scaleMetres(page)).toBeLessThanOrEqual(POI_DETAIL_SCALE_METRES)

  /** Normal POI odaklanmasının ölçeği — referans budur. */
  const focusedScale = await scaleMetres(page)

  await page.keyboard.press('Escape')
  await expect(sheet(page, 'POI Bilgisi')).toHaveCount(0)

  /* Kullanıcı BİR adım daha yaklaşır. Tek tıklama yeter ve bu ölçülerek
     doğrulanır: OpenLayers'ın yakınlaştırma denetimi tam bir yakınlık düzeyi
     ilerletir ve bir sonraki düzey bu enlemde farklı bir ScaleLine kovasına
     düşer. Tıklama BURSTU atılmaz — bir önceki geçiş gözlenmeden ikinci bir tık
     gönderilmez; denetimin kendi animasyonu (uygulamanınki değil, bu yüzden
     azaltılmış hareket onu kısaltmaz) aksi hâlde iptal edilir ve adımlar
     kaybolur. Bu testin önceki hâli tam olarak buna düşüyordu: 24 tıklama
     yalnızca beş kova ilerletebilmişti. */
  await page.locator('.ol-zoom-in').click()
  await expect.poll(() => scaleMetres(page)).toBeLessThan(focusedScale)

  /* --- SÖZLEŞME --------------------------------------------------------------
     Artık kullanıcı odak düzeyinden daha yakındadır; aynı POI'ye yeniden
     odaklanmak onu GERİ ÇEKMEMELİDİR. */
  const before = await scaleMetres(page)

  const reopened = await openMyPois(page)
  await reopened.getByRole('button', { name: 'Kendi Kafem kaydına git' }).click()

  // Odaklanmanın kendisi yine olur: doğru kayıt açılır, liste devreder.
  await expect(sheet(page, 'POI Bilgisi').getByText('Kendi Kafem')).toBeVisible()
  await expect(myPois(page)).toHaveCount(0)

  /* Kural `max(mevcut, POI yakınlığı)`dır. Küçülen ya da AYNI kalan bir ölçek
     çizgisi "geri çekilmedi" demektir; burada beklenen zaten eşitliktir, bu
     yüzden `<` istenmez — onu istemek, üretimden hiç vaat etmediği fazladan bir
     yakınlaştırmayı talep etmek olurdu. Yasak olan tek şey `after > before`. */
  await expect.poll(() => scaleMetres(page)).toBeLessThanOrEqual(before)
})

test('Düzenle and Sil do not also trigger the row focus handler', async ({ page }) => {
  await openMap(page)
  const panel = await openMyPois(page)

  await panel.getByRole('button', { name: 'Kendi Kafem kaydını düzenle' }).click()

  // Düzenleme bağlamı açılır; satırın odak eylemi TETİKLENMEZ.
  await expect(sheet(page, 'POI Düzenle')).toBeVisible()
  await expect(sheet(page, 'POI Bilgisi')).toHaveCount(0)

  await sheet(page, 'POI Düzenle').getByRole('button', { name: 'İptal' }).click()

  const reopened = await openMyPois(page)
  await reopened.getByRole('button', { name: 'Kendi Kafem kaydını sil' }).click()

  await expect(page.getByRole('alertdialog', { name: "POI'yi sil", exact: true })).toBeVisible()
  await expect(sheet(page, 'POI Bilgisi')).toHaveCount(0)
})

test('after a move, the row shows the NEW coordinate and focuses it', async ({ page }) => {
  await openMap(page, { mine: [OWN_POI, DISTANT_POI], all: [OWN_POI, DISTANT_POI, FOREIGN_POI] })

  const panel = await openMyPois(page)
  await panel.getByRole('button', { name: 'İzmir Şubesi kaydını düzenle' }).click()

  const form = sheet(page, 'POI Düzenle')
  await longitudeField(form).fill('29.05')
  await latitudeField(form).fill('41.02')
  await updateButton(form).click()
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()

  // Satır ESKİ konumu göstermeye devam edemez: kullanıcıyı artık orada olmayan
  // bir noktaya götürürdü.
  const reopened = await openMyPois(page)
  await expect(reopened.getByText('29.05000, 41.02000')).toBeVisible()

  await reopened.getByRole('button', { name: 'İzmir Şubesi kaydına git' }).click()
  await expect(sheet(page, 'POI Bilgisi')).toBeVisible()
  // Kamera YERLEŞENE kadar beklenir; yoksa aşağıdaki tık onu yolun ortasında
  // dondurur ve merkezde başka bir POI bulunurdu.
  await expect.poll(() => scaleMetres(page)).toBeLessThanOrEqual(POI_DETAIL_SCALE_METRES)

  await page.keyboard.press('Escape')
  await clickMapCentre(page)
  // Merkezde YENİ konumdaki kayıt vardır — eski İzmir konumunda değil.
  await expect(sheet(page, 'POI Bilgisi').getByText('İzmir Şubesi')).toBeVisible()
  await expect(sheet(page, 'POI Bilgisi').getByText('29.05000, 41.02000')).toBeVisible()
})
})
