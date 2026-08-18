import { expect, test } from '@playwright/test'

/**
 * The role permission editor.
 *
 * Every fixture mirrors the REAL backend contract:
 *
 *   GET  /api/admin/roles/{id}/permissions
 *        -> { role: RoleListItem, permissions: RolePermissionItem[] }
 *           RolePermissionItem = PermissionCatalogItem + { assigned }
 *           PermissionCatalogItem = { id, code, name, description, category,
 *                                     isActive, sortOrder }
 *   PUT  /api/admin/roles/{id}/permissions
 *        body -> { permissionCodes: string[] }   (DESIRED active set)
 *        200  -> the same RolePermissionsResponse, refreshed
 *
 * The response carries the whole catalog with an `assigned` flag per row, so
 * `GET /api/admin/permissions` is never called from this screen — a second
 * request would download the same rows twice.
 *
 * Nothing here touches a database: role_permissions is mutated only in the
 * backend's own suite. These tests prove the BROWSER honours the contract.
 */

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body),
})

/* --- Roller ------------------------------------------------------------------ */

const role = (id, name, flags) => ({
  id,
  name,
  userCount: 0,
  permissionCount: 0,
  isSystem: false,
  isLegacy: false,
  isAssignable: true,
  canRename: false,
  canDelete: false,
  canEditPermissions: true,
  ...flags,
})

const LEGACY_ADMIN = role(1, 'Admin', { userCount: 2, permissionCount: 4, isSystem: true, isLegacy: true, isAssignable: false, canEditPermissions: false })
const VIEWER = role(3, 'Viewer', { userCount: 1, permissionCount: 2, isSystem: true })
const GIS_EDITOR = role(4, 'GIS Editor', { userCount: 3, permissionCount: 4, isSystem: true })
const CUSTOM_EMPTY = role(9, 'Saha Ekibi', { canRename: true, canDelete: true })
const CUSTOM_ARCHIVE = role(10, 'Arşiv Ekibi', { permissionCount: 1, canRename: true, canDelete: true })

/* Yetenek bayrağının rol ADINDAN bağımsız olduğunu kanıtlayan iki rol: adı
   "Admin" ile başlayan özel bir rol DÜZENLENEBİLİR, kanonik "GIS Analyst"
   ise sunucu öyle dediği için DÜZENLENEMEZ. Ad üzerinden karar veren bir
   arayüz ikisinde de yanılırdı. */
const CUSTOM_ADMINLIKE = role(11, 'Admin Yardımcısı', { permissionCount: 1, canRename: true, canDelete: true, canEditPermissions: true })
const FROZEN_SYSTEM = role(12, 'GIS Analyst', { isSystem: true, permissionCount: 1, canEditPermissions: false })

const ROLES = [LEGACY_ADMIN, VIEWER, GIS_EDITOR, CUSTOM_EMPTY, CUSTOM_ARCHIVE, CUSTOM_ADMINLIKE, FROZEN_SYSTEM]

/* --- Katalog ------------------------------------------------------------------
   Sunucu sırası: önce `category`, sonra `sortOrder`, sonra `code`. Türkçe
   başlıklara çevrildiğinde bu sıra ALFABETİK DEĞİLDİR (Çizim… → Envanter →
   Katmanlar → Harita → Yetki Yönetimi → Rol Yönetimi), dolayısıyla ekranın
   kendi sıralamasını uygulayıp uygulamadığı buradan görünür. */

const permission = (id, code, name, category, sortOrder, extra = {}) => ({
  id,
  code,
  name,
  description: `${name} yetkisinin açıklaması.`,
  category,
  isActive: true,
  sortOrder,
  assigned: false,
  ...extra,
})

const CATALOG = [
  permission(20, 'drawings.point.create', 'Nokta Ekleme', 'DrawingCreate', 200),
  permission(21, 'drawings.line.create', 'Çizgi Ekleme', 'DrawingCreate', 210),
  permission(22, 'drawings.polygon.create', 'Poligon Ekleme', 'DrawingCreate', 220),
  /* sortOrder 300 önce gelir; Türkçe alfabede "Çizim Silme" öne geçerdi. */
  permission(23, 'drawings.view', 'Çizimleri Görüntüleme', 'DrawingManagement', 300),
  permission(24, 'drawings.delete', 'Çizim Silme', 'DrawingManagement', 340),
  permission(25, 'inventory.view', 'Envanteri Görüntüleme', 'Inventory', 500),
  permission(26, 'inventory.analysis', 'Envanter Analizi', 'Inventory', 510),
  // Kullanımdan kaldırılmış yetkiler katalogta KALIR, isActive=false ile.
  permission(27, 'layers.legacy.print', 'Katman Baskısı', 'Layers', 600, { isActive: false }),
  permission(28, 'layers.view', 'Katmanları Görüntüleme', 'Layers', 610),
  permission(29, 'map.view', 'Haritayı Görüntüleme', 'Map', 100),
  permission(30, 'permissions.assign', 'Yetki Atama', 'Permissions', 910),
  permission(31, 'roles.view', 'Rolleri Görüntüleme', 'Roles', 800),
]

const ACTIVE_TOTAL = CATALOG.filter((p) => p.isActive).length // 11

const INACTIVE_CODES = new Set(CATALOG.filter((p) => !p.isActive).map((p) => p.code))

/** Server-side view of one role's matrix, with permissionCount recomputed. */
function matrix(roleRow, assignedCodes) {
  const assigned = new Set(assignedCodes)
  const permissions = CATALOG.map((p) => ({ ...p, assigned: assigned.has(p.code) }))
  // Sayım YALNIZCA aktif bağları sayar — RoleListItem.PermissionCount gibi.
  const permissionCount = permissions.filter((p) => p.isActive && p.assigned).length
  return { role: { ...roleRow, permissionCount }, permissions }
}

/**
 * Models ReplaceRolePermissionsAsync.
 *
 * Two rules from the real service, and the tests lean on both:
 *   1. a requested code that is inactive is REJECTED outright (400);
 *   2. the request describes the ACTIVE set only — the role's existing
 *      inactive grants are outside its scope and survive untouched.
 */
function applyDesiredSet(currentAssigned, desiredCodes) {
  const rejected = desiredCodes.filter((code) => INACTIVE_CODES.has(code))
  if (rejected.length > 0) {
    return { error: `Kullanımdan kaldırılmış yetki atanamaz: ${rejected.sort().join(', ')}.` }
  }

  const preserved = [...currentAssigned].filter((code) => INACTIVE_CODES.has(code))
  return { assigned: new Set([...desiredCodes, ...preserved]) }
}

const EDITOR_CODES = ['map.view', 'drawings.point.create', 'drawings.line.create', 'drawings.view']

const MATRICES = {
  1: matrix(LEGACY_ADMIN, ['map.view', 'drawings.view', 'drawings.delete', 'roles.view']),
  3: matrix(VIEWER, ['map.view', 'drawings.view']),
  4: matrix(GIS_EDITOR, EDITOR_CODES),
  9: matrix(CUSTOM_EMPTY, []),
  // Atanmış AMA pasif bir bağ taşır: kaydetme sırasında düşürülmemeli.
  10: matrix(CUSTOM_ARCHIVE, ['layers.view', 'layers.legacy.print']),
  11: matrix(CUSTOM_ADMINLIKE, ['map.view']),
  12: matrix(FROZEN_SYSTEM, ['inventory.view']),
}

/* --- Kurulum ------------------------------------------------------------------ */

/**
 * Signs in and stubs the inventory plus the permission matrix.
 *
 * `puts` collects every PUT that reached the network, which is how "a legacy
 * role sends nothing" and "the body is the complete desired set" get proven.
 */
async function openRoles(page, { roles = ROLES, matrices = MATRICES, onGet, onPut } = {}) {
  const puts = []
  const gets = []

  await page.route('**/api/auth/me', (route) =>
    route.fulfill(json({ userId: 1, username: 'admin', emailConfirmed: true, twoFactorEnabled: true, role: 'Admin', roles: ['Admin'] })),
  )
  await page.route('**/api/admin/users', (route) => route.fulfill(json([])))
  await page.route('**/api/admin/roles', (route) => route.fulfill(json(roles)))

  /* Sunucunun kalıcı durumu. Kaydetme sonrası okumaların gerçekten değişmiş
     veri döndürmesi için gerekir — sabit bir yanıt, düşürülmüş bir bağı
     gizlerdi. */
  const state = new Map(
    Object.entries(matrices).map(([id, m]) => [
      Number(id),
      new Set(m.permissions.filter((p) => p.assigned).map((p) => p.code)),
    ]),
  )

  await page.route('**/api/admin/roles/*/permissions', async (route) => {
    const request = route.request()
    const id = Number(request.url().match(/roles\/(\d+)\/permissions/)[1])

    if (request.method() === 'PUT') {
      const body = JSON.parse(request.postData() ?? '{}')
      puts.push({ id, body })
      if (onPut) { await onPut(route, { id, body }); return }

      const outcome = applyDesiredSet(state.get(id) ?? new Set(), body.permissionCodes ?? [])
      if (outcome.error) { route.fulfill(json({ message: outcome.error }, 400)); return }

      state.set(id, outcome.assigned)
      // Yanıt matrisin YENİ hâlini ve rolün tazelenmiş sayımını taşır.
      route.fulfill(json(matrix(roles.find((r) => r.id === id), [...outcome.assigned])))
      return
    }

    gets.push(id)
    if (onGet) { await onGet(route, id); return }
    route.fulfill(json(matrix(roles.find((r) => r.id === id), [...(state.get(id) ?? [])])))
  })

  await page.goto('/login')
  await page.evaluate((expiresAt) => {
    sessionStorage.setItem('token', 'browser-test-admin-token')
    sessionStorage.setItem('expiresAt', expiresAt)
  }, new Date(Date.now() + 3_600_000).toISOString())
  await page.goto('/admin/roles')

  return { puts, gets }
}

const rowFor = (page, name) => page.getByRole('button', { name: `${name} rolünün detayını aç` })
const drawer = (page, name) => page.getByRole('dialog', { name })
const box = (scope, name) => scope.getByRole('checkbox', { name: new RegExp(`^${name}(?![^ ])`) })
const saveButton = (scope) => scope.getByRole('button', { name: 'Değişiklikleri Kaydet' })
const resetButton = (scope) => scope.getByRole('button', { name: 'Değişiklikleri Geri Al' })

async function open(page, name, options) {
  const handles = await openRoles(page, options)
  await rowFor(page, name).click()
  const panel = drawer(page, name)
  await expect(panel.getByRole('heading', { name: 'Yetkiler' })).toBeVisible()
  return { ...handles, panel }
}

/* --- Yükleme ------------------------------------------------------------------ */

test('opening an editable system role loads its permission matrix', async ({ page }) => {
  const { gets, panel } = await open(page, 'GIS Editor')

  expect(gets).toEqual([4])
  await expect(panel.getByRole('checkbox')).toHaveCount(CATALOG.length)
  await expect(panel.getByText(`4 / ${ACTIVE_TOTAL} yetki seçili`)).toBeVisible()
})

test('opening a custom role loads its own matrix', async ({ page }) => {
  const { gets, panel } = await open(page, 'Arşiv Ekibi')

  expect(gets).toEqual([10])
  await expect(box(panel, 'Katmanları Görüntüleme')).toBeChecked()
  await expect(box(panel, 'Haritayı Görüntüleme')).not.toBeChecked()
})

test('a legacy role shows its permissions read-only', async ({ page }) => {
  const { panel } = await open(page, 'Admin')

  await expect(panel.getByText('Bu legacy rolün yetkileri geriye dönük uyumluluk nedeniyle değiştirilemez.')).toBeVisible()
  await expect(panel.getByText(`4 / ${ACTIVE_TOTAL} yetki atanmış`)).toBeVisible()

  // Atanmışlık görünür, ama hiçbir kutu değiştirilebilir değildir.
  await expect(box(panel, 'Haritayı Görüntüleme')).toBeChecked()
  await expect(box(panel, 'Haritayı Görüntüleme')).toBeDisabled()
  await expect(box(panel, 'Envanter Analizi')).not.toBeChecked()
  await expect(box(panel, 'Envanter Analizi')).toBeDisabled()

  await expect(saveButton(panel)).toHaveCount(0)
  await expect(resetButton(panel)).toHaveCount(0)
})

test('permissions are grouped by the categories the server sent', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')

  const headings = await panel.locator('.admin-permission-group h4').allTextContents()
  /* Gruplama anahtarı sunucunun `category` alanıdır; başlıklar onun Türkçe
     karşılığıdır. Sıra da sunucudan gelir — ekran kendi sıralamasını
     uygulamaz, aksi hâlde bu liste Türkçe alfabetik olurdu. */
  expect(headings).toEqual([
    'Çizim Oluşturma',
    'Çizim Yönetimi',
    'Envanter',
    'Katmanlar',
    'Harita',
    'Yetki Yönetimi',
    'Rol Yönetimi',
  ])
})

test('the server sort order inside a category is preserved', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')

  const names = await panel.locator('.admin-permission-text strong').allTextContents()
  expect(names.slice(0, 5)).toEqual([
    'Nokta Ekleme',
    'Çizgi Ekleme',
    'Poligon Ekleme',
    // sortOrder 300 önce, 340 sonra. Alfabetik olsaydı bu ikisi yer değiştirirdi.
    'Çizimleri Görüntüleme',
    'Çizim Silme',
  ])
})

test('assigned permissions are checked and unassigned ones are not', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')

  for (const code of ['Haritayı Görüntüleme', 'Nokta Ekleme', 'Çizgi Ekleme', 'Çizimleri Görüntüleme']) {
    await expect(box(panel, code)).toBeChecked()
  }
  for (const code of ['Poligon Ekleme', 'Çizim Silme', 'Envanteri Görüntüleme', 'Yetki Atama']) {
    await expect(box(panel, code)).not.toBeChecked()
  }
})

test('each row carries its technical permission code', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')

  await expect(panel.getByText('drawings.point.create', { exact: true })).toBeVisible()
  await expect(panel.getByText('map.view', { exact: true })).toBeVisible()
  // Açıklama da gösterilir; kod tek başına ne yaptığını anlatmaz.
  await expect(panel.getByText('Nokta Ekleme yetkisinin açıklaması.')).toBeVisible()
})

test('the role list never fetches permissions per role', async ({ page }) => {
  const { gets } = await openRoles(page)
  await expect(rowFor(page, 'GIS Editor')).toBeVisible()

  /* Rol başına matris okuyan bir uygulama burada 7 istek yapardı. Yetki
     isteği YALNIZCA bir rol açıldığında anlamlıdır. */
  expect(gets).toEqual([])
})

test('the permission catalog endpoint is never called separately', async ({ page }) => {
  const catalogCalls = []
  await page.route('**/api/admin/permissions', (route) => { catalogCalls.push(route.request().method()); route.fulfill(json(CATALOG)) })

  await open(page, 'GIS Editor')

  /* Rol-yetki yanıtı katalog alanlarının tamamını zaten taşır; ikinci uç aynı
     satırları tekrar indirmek olurdu. */
  expect(catalogCalls).toEqual([])
})

test('switching roles loads the newly selected role, once each', async ({ page }) => {
  const { gets, panel } = await open(page, 'GIS Editor')
  await expect(panel.getByRole('checkbox').first()).toBeVisible()

  /* Detay modaldir: listeye dönmek için önce perde kapatılır. Temiz bir
     düzenleyicide bu tek hamledir, onay istenmez. */
  await page.locator('.admin-panel-scrim').click()
  await rowFor(page, 'Viewer').click()

  const viewer = drawer(page, 'Viewer')
  await expect(viewer.getByText(`2 / ${ACTIVE_TOTAL} yetki seçili`)).toBeVisible()

  // Rol başına TEK istek: ne açılışta fazladan, ne geri dönünce yeniden.
  expect(gets).toEqual([4, 3])
})

test('a slow response for a deselected role cannot overwrite the current one', async ({ page }) => {
  let releaseEditor
  const held = new Promise((resolve) => { releaseEditor = resolve })

  await openRoles(page, {
    onGet: async (route, id) => {
      if (id === 4) await held
      route.fulfill(json(MATRICES[id]))
    },
  })

  await rowFor(page, 'GIS Editor').click()
  await expect(drawer(page, 'GIS Editor').getByText('Rol yetkileri yükleniyor…')).toBeVisible()

  // Yanıt hâlâ yolda iken başka bir role geçilir.
  await page.locator('.admin-panel-scrim').click()
  await rowFor(page, 'Viewer').click()
  const viewer = drawer(page, 'Viewer')
  await expect(viewer.getByText(`2 / ${ACTIVE_TOTAL} yetki seçili`)).toBeVisible()

  releaseEditor()
  /* Geç gelen yanıt GIS Editor'e aitti; Viewer'ın matrisini ezerse ekran bir
     rolün yetkilerini başka bir rolün altında gösterirdi. */
  await expect(viewer.getByText(`2 / ${ACTIVE_TOTAL} yetki seçili`)).toBeVisible()
  await expect(box(viewer, 'Nokta Ekleme')).not.toBeChecked()
})

/* --- Düzenlenebilirlik --------------------------------------------------------- */

test('editability follows the capability flag, not the role name', async ({ page }) => {
  // Adı "Admin" ile başlayan ÖZEL rol: sunucu düzenlenebilir dediği için öyle.
  const { panel } = await open(page, 'Admin Yardımcısı')
  await expect(box(panel, 'Haritayı Görüntüleme')).toBeEnabled()
  await expect(saveButton(panel)).toBeVisible()

  // Kanonik bir sistem rolü, sunucu bayrağı false ise SALT OKUNUR olur.
  await page.getByRole('button', { name: 'Detayı kapat' }).click()
  await rowFor(page, 'GIS Analyst').click()
  const frozen = drawer(page, 'GIS Analyst')
  await expect(frozen.getByText('Bu rolün yetkileri sistem tarafından dondurulmuştur ve değiştirilemez.')).toBeVisible()
  await expect(box(frozen, 'Envanteri Görüntüleme')).toBeDisabled()
  await expect(saveButton(frozen)).toHaveCount(0)
})

test('a read-only role never sends a permission update', async ({ page }) => {
  const { puts, panel } = await open(page, 'Admin')

  // Kilitli kutuya tıklamak hiçbir şey yapmaz — ne durumu ne de ağı değiştirir.
  await panel.locator('.admin-permission-row').filter({ hasText: 'Envanter Analizi' }).click({ force: true })
  await expect(box(panel, 'Envanter Analizi')).not.toBeChecked()

  expect(puts).toEqual([])
})

/* --- Kirli durum --------------------------------------------------------------- */

test('a freshly opened editor is not dirty', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')

  await expect(saveButton(panel)).toBeDisabled()
  await expect(resetButton(panel)).toHaveCount(0)
  await expect(panel.getByText('Kaydedilmemiş değişiklik var')).toHaveCount(0)
})

test('toggling a permission makes the editor dirty and toggling back clears it', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')

  await box(panel, 'Poligon Ekleme').check()
  await expect(saveButton(panel)).toBeEnabled()
  await expect(panel.getByText('Kaydedilmemiş değişiklik var')).toBeVisible()
  await expect(panel.getByText(`5 / ${ACTIVE_TOTAL} yetki seçili`)).toBeVisible()

  await box(panel, 'Poligon Ekleme').uncheck()
  await expect(saveButton(panel)).toBeDisabled()
  await expect(panel.getByText('Kaydedilmemiş değişiklik var')).toHaveCount(0)
})

test('dirty state compares sets, not the order things were touched', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')

  /* Aynı üyeliğe FARKLI sırayla dönülür. Kirli durum diziyi karşılaştırsaydı
     burada hâlâ "değişiklik var" derdi. */
  await box(panel, 'Nokta Ekleme').uncheck()
  await box(panel, 'Çizgi Ekleme').uncheck()
  await expect(saveButton(panel)).toBeEnabled()

  await box(panel, 'Çizgi Ekleme').check()
  await box(panel, 'Nokta Ekleme').check()

  await expect(saveButton(panel)).toBeDisabled()
  await expect(panel.getByText(`4 / ${ACTIVE_TOTAL} yetki seçili`)).toBeVisible()
})

/* --- Kaydetme ------------------------------------------------------------------ */

test('saving sends the complete desired set to the right role', async ({ page }) => {
  const { puts, panel } = await open(page, 'GIS Editor')

  await box(panel, 'Poligon Ekleme').check()
  await box(panel, 'Çizimleri Görüntüleme').uncheck()
  await saveButton(panel).click()

  await expect(page.getByRole('status')).toContainText("'GIS Editor' rolünün yetkileri güncellendi.")

  expect(puts).toHaveLength(1)
  expect(puts[0].id).toBe(4)
  /* Gövde bir fark değil, HEDEF kümedir — sunucu ekle/çıkar hesabını kendi
     yapar. Anahtar `permissionCodes`'tur ve kimlik koddur, Id değil. */
  expect(Object.keys(puts[0].body)).toEqual(['permissionCodes'])
  expect([...puts[0].body.permissionCodes].sort()).toEqual(
    ['drawings.line.create', 'drawings.point.create', 'drawings.polygon.create', 'map.view'],
  )
})

test('a successful save clears the dirty state and syncs both permission counts', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')

  await box(panel, 'Poligon Ekleme').check()
  await saveButton(panel).click()

  await expect(page.getByRole('status')).toContainText('yetkileri güncellendi')
  await expect(saveButton(panel)).toBeDisabled()
  await expect(panel.getByText('Kaydedilmemiş değişiklik var')).toHaveCount(0)
  await expect(panel.getByText(`5 / ${ACTIVE_TOTAL} yetki seçili`)).toBeVisible()

  // Detay başlığındaki sayım ve LİSTE satırı, sayfa yenilenmeden birlikte döner.
  await expect(panel.locator('.admin-detail-grid')).toContainText('5')
  await page.getByRole('button', { name: 'Detayı kapat' }).click()
  await expect(rowFor(page, 'GIS Editor')).toContainText('5')
})

test('nothing is presented as saved before the server answers', async ({ page }) => {
  let releasePut
  const held = new Promise((resolve) => { releasePut = resolve })

  const { panel } = await open(page, 'GIS Editor', {
    onPut: async (route, { body }) => {
      await held
      route.fulfill(json(matrix(GIS_EDITOR, body.permissionCodes)))
    },
  })

  await box(panel, 'Poligon Ekleme').check()
  await saveButton(panel).click()

  /* İstek uçarken kaydedilmiş gibi görünmez: düğme beklemede, kirli durum
     sürüyor ve rol satırındaki sayı hâlâ sunucunun bildiği değer. */
  await expect(panel.getByRole('button', { name: 'Kaydediliyor…' })).toBeVisible()
  await expect(panel.getByText('Kaydedilmemiş değişiklik var')).toBeVisible()
  await expect(page.getByRole('status')).toHaveCount(0)

  releasePut()
  await expect(page.getByRole('status')).toContainText('yetkileri güncellendi')
})

/* --- Başarısız kaydetme --------------------------------------------------------- */

test('a rejected save keeps the selection, the dirty state and the old count', async ({ page }) => {
  let attempts = 0
  const { puts, panel } = await open(page, 'GIS Editor', {
    onPut: (route, { body }) => {
      attempts += 1
      if (attempts === 1) {
        route.fulfill(json({ message: 'Tanınmayan yetki kodu: drawings.polygon.create.' }, 400))
        return
      }
      route.fulfill(json(matrix(GIS_EDITOR, body.permissionCodes)))
    },
  })

  await box(panel, 'Poligon Ekleme').check()
  await saveButton(panel).click()

  await expect(panel.getByRole('alert')).toContainText('Tanınmayan yetki kodu')
  // Çalışma seçimi DURUR; sunucu reddetti diye sessizce geri alınmaz.
  await expect(box(panel, 'Poligon Ekleme')).toBeChecked()
  await expect(saveButton(panel)).toBeEnabled()
  await expect(page.getByRole('status')).toHaveCount(0)

  // Rol satırı olmamış bir kaydetmeyi olmuş gibi göstermez.
  await expect(rowFor(page, 'GIS Editor')).toContainText('4')

  // Tekrar denemek mümkündür ve ikinci istek aynı hedef kümeyi taşır.
  await saveButton(panel).click()
  await expect(page.getByRole('status')).toContainText('yetkileri güncellendi')
  expect(puts).toHaveLength(2)
})

test('a 403 explains the missing permission instead of ending the session', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor', {
    onPut: (route) => route.fulfill(json({ message: 'Forbidden' }, 403)),
  })

  await box(panel, 'Poligon Ekleme').check()
  await saveButton(panel).click()

  await expect(panel.getByRole('alert')).toContainText('Bu rolün yetkilerini değiştirmek için gerekli izne sahip değilsiniz.')
  /* 403 oturumun bittiği anlamına GELMEZ: token geçerli, yetki eksik. Girişe
     atmak, yönetim ekranına dokunduğu için kullanıcıyı uygulamadan atmak
     olurdu. */
  await expect(page).toHaveURL(/\/admin\/roles$/)
  await expect(panel).toBeVisible()
  await expect(box(panel, 'Poligon Ekleme')).toBeChecked()
})

/* --- Geri alma ----------------------------------------------------------------- */

test('reset restores the server baseline without touching the network', async ({ page }) => {
  const { puts, panel } = await open(page, 'GIS Editor')

  await box(panel, 'Poligon Ekleme').check()
  await box(panel, 'Haritayı Görüntüleme').uncheck()
  await expect(saveButton(panel)).toBeEnabled()

  await resetButton(panel).click()

  await expect(box(panel, 'Poligon Ekleme')).not.toBeChecked()
  await expect(box(panel, 'Haritayı Görüntüleme')).toBeChecked()
  await expect(saveButton(panel)).toBeDisabled()
  await expect(resetButton(panel)).toHaveCount(0)
  // Geri alma yerel bir işlemdir; sunucuya sorulacak bir şey yoktur.
  expect(puts).toEqual([])
})

/* --- Kaydedilmemiş değişiklik koruması ------------------------------------------- */

const discardDialog = (page) => page.getByRole('alertdialog', { name: 'Kaydedilmemiş yetki değişiklikleri var.' })

test('closing the drawer while dirty asks before discarding', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')
  await box(panel, 'Poligon Ekleme').check()

  await page.getByRole('button', { name: 'Detayı kapat' }).click()
  await expect(discardDialog(page)).toBeVisible()

  // Vazgeçmek düzenleyiciyi olduğu gibi bırakır.
  await discardDialog(page).getByRole('button', { name: 'Düzenlemeye Dön' }).click()
  await expect(panel).toBeVisible()
  await expect(box(panel, 'Poligon Ekleme')).toBeChecked()

  await page.getByRole('button', { name: 'Detayı kapat' }).click()
  await discardDialog(page).getByRole('button', { name: 'Değişiklikleri Yoksay' }).click()
  await expect(panel).toHaveCount(0)
})

test('reaching another role while dirty passes through the guard', async ({ page }) => {
  const { gets, panel } = await open(page, 'GIS Editor')
  await box(panel, 'Poligon Ekleme').check()

  // Listeye dönüş perdeden geçer ve perde de kapatma korumasına tabidir.
  await page.locator('.admin-panel-scrim').click()
  await expect(discardDialog(page)).toBeVisible()

  await discardDialog(page).getByRole('button', { name: 'Düzenlemeye Dön' }).click()
  await expect(drawer(page, 'GIS Editor')).toBeVisible()
  // Engellenen geçiş hiçbir yükleme başlatmaz.
  expect(gets).toEqual([4])

  await page.locator('.admin-panel-scrim').click()
  await discardDialog(page).getByRole('button', { name: 'Değişiklikleri Yoksay' }).click()

  await rowFor(page, 'Viewer').click()
  await expect(drawer(page, 'Viewer')).toBeVisible()
  expect(gets).toEqual([4, 3])
})

test('Escape also passes through the guard instead of dropping the changes', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')
  await box(panel, 'Poligon Ekleme').check()

  await page.keyboard.press('Escape')
  await expect(discardDialog(page)).toBeVisible()

  await discardDialog(page).getByRole('button', { name: 'Düzenlemeye Dön' }).click()
  await expect(box(panel, 'Poligon Ekleme')).toBeChecked()
})

test('the roles page cannot be left while permission changes are unsaved', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')
  await box(panel, 'Poligon Ekleme').check()

  /* Rota koruması için ayrı bir engelleyici yoktur ve gerekmez: detay modaldir
     ve perdesi kenar çubuğunu da kapatır, dolayısıyla gezinme bağlantısı
     tıklanamaz. Sayfayı terk etmenin tek yolu detayı kapatmaktır — ve o yol
     onaya bağlıdır. */
  const guarded = await page.evaluate(() => {
    const link = [...document.querySelectorAll('.admin-nav-item')]
      .find((a) => a.textContent.includes('Kullanıcılar'))
    const rect = link.getBoundingClientRect()
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    return top?.classList.contains('admin-panel-scrim')
  })
  expect(guarded).toBe(true)

  await page.locator('.admin-panel-scrim').click()
  await expect(discardDialog(page)).toBeVisible()
  await expect(page).toHaveURL(/\/admin\/roles$/)

  await discardDialog(page).getByRole('button', { name: 'Değişiklikleri Yoksay' }).click()
  await expect(panel).toHaveCount(0)

  // Çekmece kapandıktan sonra gezinme yeniden mümkündür.
  await page.getByRole('navigation', { name: 'Yönetim menüsü' })
    .getByRole('link', { name: 'Kullanıcılar' }).click()
  await expect(page).toHaveURL(/\/admin\/users$/)
})

test('rename and delete are closed while permission changes are unsaved', async ({ page }) => {
  const { panel } = await open(page, 'Arşiv Ekibi')

  await expect(panel.getByRole('button', { name: 'Yeniden Adlandır' })).toBeEnabled()

  await box(panel, 'Haritayı Görüntüleme').check()

  /* İkisi de listeyi sunucudan yeniden okur ve açık düzenleyiciyi tazelenmiş
     veriyle ezerdi; işaretlemeler sessizce kaybolurdu. */
  await expect(panel.getByRole('button', { name: 'Yeniden Adlandır' })).toBeDisabled()
  await expect(panel.getByRole('button', { name: 'Rolü Sil' })).toBeDisabled()
  await expect(panel.getByText('Önce yetki değişikliklerini kaydedin veya geri alın')).toBeVisible()

  await resetButton(panel).click()
  await expect(panel.getByRole('button', { name: 'Yeniden Adlandır' })).toBeEnabled()
})

/* --- Pasif yetkiler ------------------------------------------------------------- */

test('an inactive permission is visible but can never be newly assigned', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')

  const inactive = box(panel, 'Katman Baskısı')
  await expect(inactive).toBeVisible()
  await expect(inactive).toBeDisabled()
  await expect(inactive).not.toBeChecked()
  // Durum yalnızca renkle değil, metinle de anlatılır.
  await expect(panel.locator('.admin-permission-row', { hasText: 'Katman Baskısı' })).toContainText('Pasif')

  // Payda yalnızca ATANABİLİR yetkileri sayar; pasif satır seçilebilirmiş gibi
  // gösterilmez.
  await expect(panel.getByText(`4 / ${ACTIVE_TOTAL} yetki seçili`)).toBeVisible()
  expect(ACTIVE_TOTAL).toBe(CATALOG.length - 1)
})

test('an existing inactive grant is shown, explained and never dropped by a save', async ({ page }) => {
  const { puts, panel } = await open(page, 'Arşiv Ekibi')

  const inactive = box(panel, 'Katman Baskısı')
  await expect(inactive).toBeChecked()
  await expect(inactive).toBeDisabled()
  await expect(panel.getByText('kullanımdan kaldırılmış 1 yetki bağı var')).toBeVisible()
  await expect(panel.getByText('kaydetme sırasında SİLİNMEZ')).toBeVisible()

  await box(panel, 'Haritayı Görüntüleme').check()
  await saveButton(panel).click()
  await expect(page.getByRole('status')).toContainText('yetkileri güncellendi')

  /* Pasif kod gövdeye GİRMEZ: sunucu onu reddederdi (400) ve zaten mevcut pasif
     bağları isteğe bakmadan korur. Gövde yalnızca aktif hedef kümedir. */
  expect([...puts[0].body.permissionCodes].sort()).toEqual(['layers.view', 'map.view'])
  expect(puts[0].body.permissionCodes).not.toContain('layers.legacy.print')

  // Bağ yanıtta da duruyor: kaydetme onu düşürmedi.
  await expect(box(panel, 'Katman Baskısı')).toBeChecked()
})

/* --- Kategori toplu seçimi ------------------------------------------------------- */

test('the category control selects and clears only its selectable rows', async ({ page }) => {
  const { panel } = await open(page, 'Arşiv Ekibi')

  const layers = panel.locator('.admin-permission-group', { hasText: 'Katmanlar' })
  // Katmanlar kategorisinde tek bir AKTİF satır olduğu için toplu kontrol
  // gösterilmez; kalabalık eden bir düğme hiçbir şeyi kolaylaştırmazdı.
  await expect(layers.getByRole('button')).toHaveCount(0)

  const drawings = panel.locator('.admin-permission-group', { hasText: 'Çizim Oluşturma' })
  await drawings.getByRole('button', { name: 'Tümünü Seç' }).click()

  for (const name of ['Nokta Ekleme', 'Çizgi Ekleme', 'Poligon Ekleme']) {
    await expect(box(panel, name)).toBeChecked()
  }
  await expect(saveButton(panel)).toBeEnabled()

  // Pasif bağ toplu seçimden etkilenmez.
  await expect(box(panel, 'Katman Baskısı')).toBeChecked()
  await expect(box(panel, 'Katman Baskısı')).toBeDisabled()

  await drawings.getByRole('button', { name: 'Tümünü Kaldır' }).click()
  for (const name of ['Nokta Ekleme', 'Çizgi Ekleme', 'Poligon Ekleme']) {
    await expect(box(panel, name)).not.toBeChecked()
  }
  // Başlangıç durumuna dönüldü: artık kirli değil.
  await expect(saveButton(panel)).toBeDisabled()
})

/* --- Boş küme ve hata ------------------------------------------------------------ */

test('a role with no permissions says so and still offers the catalog', async ({ page }) => {
  const { panel } = await open(page, 'Saha Ekibi')

  await expect(panel.getByText('Bu role henüz yetki atanmamış.')).toBeVisible()
  await expect(panel.getByText(`0 / ${ACTIVE_TOTAL} yetki seçili`)).toBeVisible()
  await expect(panel.getByRole('checkbox')).toHaveCount(CATALOG.length)
  await expect(saveButton(panel)).toBeDisabled()

  await box(panel, 'Haritayı Görüntüleme').check()
  await expect(saveButton(panel)).toBeEnabled()
})

test('a failed matrix load stays inside the section and can be retried', async ({ page }) => {
  let attempts = 0
  await openRoles(page, {
    onGet: (route, id) => {
      attempts += 1
      if (attempts === 1) { route.fulfill(json({ message: 'Rol yetkileri okunamadı.' }, 500)); return }
      route.fulfill(json(MATRICES[id]))
    },
  })

  await rowFor(page, 'GIS Editor').click()
  const panel = drawer(page, 'GIS Editor')

  await expect(panel.getByRole('alert')).toContainText('Rol yetkileri okunamadı.')
  // Detay kendiliğinden kapanmaz ve liste kullanılabilir kalır.
  await expect(panel).toBeVisible()
  await expect(panel.getByText('Rol adı')).toBeVisible()
  await expect(rowFor(page, 'Viewer')).toBeVisible()

  await panel.getByRole('button', { name: 'Tekrar dene' }).click()
  await expect(panel.getByText(`4 / ${ACTIVE_TOTAL} yetki seçili`)).toBeVisible()
})

/* --- Klavye --------------------------------------------------------------------- */

test('the editor can be driven from the keyboard alone', async ({ page }) => {
  const { panel } = await open(page, 'GIS Editor')

  const target = box(panel, 'Poligon Ekleme')
  await target.focus()
  await page.keyboard.press('Space')
  await expect(target).toBeChecked()
  await expect(saveButton(panel)).toBeEnabled()

  await page.keyboard.press('Space')
  await expect(target).not.toBeChecked()
  await expect(saveButton(panel)).toBeDisabled()

  // Kilitli kutular odak sırasının dışındadır; gezinmeyi tıkayan devre dışı
  // duraklar bırakmaz.
  await expect(box(panel, 'Katman Baskısı')).toBeDisabled()
})

/* --- Dar ekranlar ---------------------------------------------------------------- */

const overflows = (page) => page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
)

test.describe('tablet', () => {
  test.use({ viewport: { width: 768, height: 1024 } })

  test('the permission editor fits a tablet drawer', async ({ page }) => {
    const { panel } = await open(page, 'GIS Editor')

    expect(await overflows(page)).toBe(false)
    await expect(box(panel, 'Haritayı Görüntüleme')).toBeVisible()
    await saveButton(panel).scrollIntoViewIfNeeded()
    await expect(saveButton(panel)).toBeInViewport()
  })
})

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('the permission editor fits a phone and keeps its controls reachable', async ({ page }) => {
    const { panel } = await open(page, 'GIS Editor')

    expect(await overflows(page)).toBe(false)

    await box(panel, 'Poligon Ekleme').check()
    await expect(saveButton(panel)).toBeInViewport()
    await expect(resetButton(panel)).toBeInViewport()
    expect(await overflows(page)).toBe(false)

    /* Uzun kodlar satırın içinde kırılır; panelin dışına taşıp çekmeceyi yatay
       kaydırılabilir hâle getirmezler. */
    await expect(panel.getByText('drawings.polygon.create', { exact: true })).toBeVisible()
    const fits = await panel.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
    expect(fits).toBe(true)

    await saveButton(panel).click()
    await expect(page.getByRole('status')).toContainText('yetkileri güncellendi')
    expect(await overflows(page)).toBe(false)
  })
})
