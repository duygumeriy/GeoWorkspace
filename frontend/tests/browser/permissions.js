/**
 * Yetki ucunun ortak taklidi.
 *
 * Phase 7'den beri arayüz `GET /api/auth/me/permissions`'ı okur ve küme
 * gelene kadar korumalı hiçbir şey çizmez (fail-closed). Bu yüzden HER oturum
 * açan testin bu ucu da yanıtlaması gerekir — yanıtlamayan bir test, ölçmek
 * istediği ekranı değil boş bir kabuğu görürdü.
 *
 * Tek yerde durur: mevcut 14 spec'in her birine kendi taklidini yazmak, bir
 * yetki kodu değiştiğinde 14 ayrı yerde düzeltme demek olurdu.
 */

/** Kanonik 35 kodun tamamı — backend'in PermissionCodes sabitleriyle aynı. */
export const ALL_PERMISSIONS = Object.freeze([
  'map.view',
  'drawings.point.create',
  'drawings.line.create',
  'drawings.polygon.create',
  'drawings.view',
  'drawings.metadata.update',
  'drawings.geometry.update',
  'drawings.style.update',
  'drawings.delete',
  'drawings.restore',
  'measurement.use',
  'selection.use',
  'inventory.view',
  'inventory.analysis',
  'heatmap.view',
  'layers.view',
  'layers.manage',
  'users.view',
  'users.create',
  'users.update',
  'users.deactivate',
  'users.delete',
  'roles.view',
  'roles.create',
  'roles.update',
  'roles.delete',
  'permissions.view',
  'permissions.assign',
  'geography.view',
  'geography.manage',
  'activity.view',
  'poi.view',
  'poi.create',
  'poi.manage',
  'poi.categories.manage',
])

/** Yönetim panelini açan üç görüntüleme yetkisi. */
export const ADMIN_VIEW_PERMISSIONS = Object.freeze(['users.view', 'roles.view', 'permissions.view'])

/** Haritayı okuyabilen ama hiçbir şey oluşturamayan tipik bir profil. */
export const VIEWER_PERMISSIONS = Object.freeze([
  'map.view',
  'drawings.view',
  'inventory.view',
  'layers.view',
  'measurement.use',
  'selection.use',
])

/**
 * Yetki ucunu taklit eder ve kümeyi test SIRASINDA değiştirmenin yolunu döner.
 *
 * Dönen `set(...)`, canlı yetkilendirmeyi ölçen testler içindir: aynı oturumda
 * yetki verilir veya alınır, arayüz `refreshPermissions()` ile yeni kümeyi
 * okur — token değişmez, yeniden giriş yapılmaz.
 *
 * @param {import('@playwright/test').Page} page
 * @param {readonly string[]} codes başlangıç yetki kümesi
 * @param {{ userId?: number, status?: number }} [options] `status` fail-closed
 *   davranışını ölçmek için: 500 verildiğinde uç hata döner.
 */
export async function mockPermissions(page, codes = ALL_PERMISSIONS, { userId = 1, status = 200 } = {}) {
  const state = { codes: [...codes], userId, status, calls: 0 }

  await page.route('**/api/auth/me/permissions', (route) => {
    state.calls += 1

    if (state.status !== 200) {
      return route.fulfill({
        status: state.status,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Yetkiler okunamadı.' }),
      })
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ userId: state.userId, permissions: state.codes }),
    })
  })

  return {
    /** Sonraki okumanın döneceği küme. */
    set(next) {
      state.codes = [...next]
    },
    /** Sonraki okumanın HTTP durumu; fail-closed testleri için. */
    setStatus(next) {
      state.status = next
    },
    setUserId(next) {
      state.userId = next
    },
    /** Kaç kez okundu — "her bileşen kendi isteğini açmasın" için. */
    get calls() {
      return state.calls
    },
  }
}
