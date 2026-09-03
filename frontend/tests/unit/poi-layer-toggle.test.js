import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * Faz 5C — "Katmanlar → POI'ler" anahtarı ve kenar çubuğu etiketi.
 *
 * <b>Ölçülen şey MİMARİ karardır.</b> POI görünürlüğü bir stil hilesi değil,
 * gerçek katman görünürlüğüdür: saydam bir stil POI'yi görünmez yapar ama
 * TIKLANABİLİR bırakırdı ve kullanıcı kapattığı bir katmandaki bir noktaya
 * basıp bilgi paneli açabilirdi.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** `start` işaretinden `end` işaretine kadar; ikincisi BİRİNCİDEN SONRA aranır. */
const between = (source, start, end) => {
  const from = source.indexOf(start)
  return from < 0 ? '' : source.slice(from, source.indexOf(end, from + start.length))
}

/** Yorumlar neyin yapılmadığını anlatır; taramada işaretlemeden ayrılmalıdır. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

const panel = read('../../src/components/map/LayersPanel.jsx')
const page = read('../../src/pages/MapPage.jsx')
const hook = read('../../src/hooks/usePoiLayer.js')
const sidebar = read('../../src/components/map/Sidebar.jsx')

/* --- Satırın kendisi ---------------------------------------------------------- */

test("the panel offers a canonical POI'ler group", () => {
  assert.match(panel, /POI'ler/)
  assert.match(panel, /data-testid="layers-poi-row"/)

  // Kalıcı kayıt gruplarıyla aynı disclosure/checkbox dili.
  const row = panel.slice(panel.indexOf('data-testid="layers-poi-row"'))
  assert.match(row.slice(0, 1400), /Disclosure/)
  assert.match(row.slice(0, 1400), /VisibilityCheckbox/)

  // İkinci bir simge kütüphanesi eklenmedi.
  assert.match(panel, /from 'lucide-react'/)
})

test('POI is NOT folded into the drawing type list', () => {
  /* Katılsaydı toplu seçime, stil düzenleyicisine ve /api/drawings/* uçlarına
     da kendiliğinden karışırdı. */
  assert.match(panel, /drawings\?\.permitted/)
  assert.match(panel, /poi\?\.permitted/)
  assert.ok(!/\/api\/drawings/.test(stripComments(panel)))
})

/* --- Yetki --------------------------------------------------------------------- */

test('the row appears only for a caller holding poi.view, and by permission alone', () => {
  /* Kapı satır içi JSX yerine adlandırılmış bir türetmededir; ölçülen şey
     kapının KENDİSİDİR, yazıldığı yer değil. */
  const showPoi = between(panel, 'const showPoi =', '\n').replace('const showPoi =', '').trim()
  assert.match(showPoi, /^poi\?\.permitted && poi\.count > 0 &&/)

  /* Arama yalnızca SUNUM süzgecidir: kendi başına satırı açamaz, yani yetki
     ve kayıt varlığı dışında alternatif bir dal yoktur. */
  const withoutSearchFilter = showPoi.replace(/\(!searching \|\| [^)]*\)/, '')
  assert.ok(!withoutSearchFilter.includes('||'), 'no alternative branch may substitute for poi.view')

  /* Bölüm YALNIZCA bu türetmeden geçer; kapı ile satır arasında ikinci bir
     koşullu giriş yoktur. */
  assert.equal((panel.match(/data-testid="layers-poi-row"/g) ?? []).length, 1)
  assert.match(panel, /\{showPoi && \(\s*<section className="layers-section" data-testid="layers-poi-row">/)

  /* Panel yetkisiz POI verisini kendisi çekmez. */
  assert.doesNotMatch(stripComments(panel), /fetch|\/api\//)

  const props = between(page, 'poi={{', 'onSetPoiVisibility=')
  assert.match(props, /permitted: allowed\.canViewPoi/)

  /* Rol adına bakan hiçbir kural yoktur — ne burada ne panelde. */
  for (const source of [panel, props]) {
    assert.ok(!/Administrator|GIS Manager|Viewer|roleName|isAdmin/.test(source))
  }
})

test('without poi.view no POI data or presentation request is authorized', () => {
  /* Vektör katman nesnesinin haritaya bir kez bağlanması bir yetki kararı
     değildir; veri yükleme ve raster kurulumu `permitted` kapılarındadır. */
  const vector = between(page, 'const poi = usePoiLayer', 'const {')
  const raster = between(page, 'usePoiPresentationLayer(mapInstance, {', '})')

  assert.match(vector, /permitted: allowed\.canViewPoi/)
  assert.match(raster, /permitted: allowed\.canViewPoi && normalPoiLayerVisible/)
  assert.match(hook, /if \(!permitted\) return/)
})

/* --- Varsayılan ---------------------------------------------------------------- */

test('the POI record visibility starts with an empty hidden-ID set', () => {
  /* POI'ler haritanın normal içeriğidir; gizli açılmaları kullanıcıya kayıp
     veri gibi görünürdü. */
  const visibilityHook = read('../../src/hooks/useLayerVisibility.js')
  assert.match(visibilityHook, /hiddenPoiIds, setHiddenPoiIds\] = useState\(\(\) => new Set\(\)\)/)
})

/* --- KAPALI -------------------------------------------------------------------- */

test('individual hiding returns no vector style and suspends the complete raster', () => {
  const poiMap = read('../../src/map/poi.js')
  assert.match(poiMap, /if \(!isPoiVisible\(feature\.get\('poiId'\)\)\) return undefined/)
  assert.match(page, /suspended: layerVisibility\.hiddenPoiIds\.size > 0/)
})

test('individual hiding stops POI hit detection through the no-style predicate', () => {
  assert.match(hook, /isRecordVisible\(hiddenIdsRef\.current, poiId\)/)
  assert.match(hook, /sourceRef\.current\?\.changed\(\)/)
})

test('no presentation request is issued while individual filtering is active', () => {
  /* Kanca yetkisiz durumda katmanı HİÇ kurmaz ve hiçbir dinleyici bağlamaz;
     kapalı katman aynı yoldan geçer, dolayısıyla kaydırma/yakınlaşma boyunca
     istek üretilmez. */
  const raster = read('../../src/hooks/usePoiPresentationLayer.js')
  assert.match(raster, /if \(suspendedRef\.current\) return/)
  assert.match(raster, /!suspendedRef\.current/)
})

test('individual hiding does not mutate POI selection state', () => {
  const visibilityHook = read('../../src/hooks/useLayerVisibility.js')
  assert.ok(!/setSelectedPoi|mapContext/.test(visibilityHook))
})

test('toggling is pure presentation: it never writes to the database', () => {
  const toggle = read('../../src/hooks/useLayerVisibility.js')

  for (const mutation of ['deletePoi', 'updatePoi', 'createPoi', 'fetch', 'authFetch', 'restore']) {
    assert.ok(!toggle.includes(mutation), `${mutation} must not run on a visibility toggle`)
  }

  assert.match(panel, /kayıtlar korunur/)
})

/* --- AÇIK ---------------------------------------------------------------------- */

test('showing every POI restores presentation without refetching records', () => {
  /* Görünürlük yetkiden ayrıdır: katmanı kapatmak veriyi atmaz. Kaynak yalnızca
     `permitted` düştüğünde boşaltılır. */
  const raster = read('../../src/hooks/usePoiPresentationLayer.js')
  assert.match(raster, /if \(!suspended\) scheduleLoadRef\.current\?\.\(\)/)
  const visibilityRedraw = between(hook, '/* Seçim değiştiğinde', '/* --- Veri')
  assert.match(visibilityRedraw, /sourceRef\.current\?\.changed\(\)/)
  assert.ok(!/clear\(/.test(visibilityRedraw))
})

/* --- Sayaç --------------------------------------------------------------------- */

test('the count comes from the records already loaded, not a second request', () => {
  assert.match(hook, /setCount\(canonicalPois\.length\)/)
  assert.match(hook, /const syncRecords = useCallback/)
  assert.match(page, /count: poi\.count/)

  /* Sunucu listeyi kendi kurallarıyla süzer (aktif, silinmemiş, kategorisi
     aktif); tarayıcı o kuralları yeniden uygulamaz. */
  const loadFn = between(hook, 'const load = useCallback', '} catch (error)')
  assert.ok(!/isActive|isDeleted/.test(loadFn))
})

test('the count follows create and delete without a refetch', () => {
  assert.match(hook, /if \(feature\) sourceRef\.current\?\.addFeature\(feature\)\n    syncRecords\(\)/)
  assert.match(hook, /if \(existing\) source\.removeFeature\(existing\)\n    syncRecords\(\)/)
})

/* --- Yan etkisizlik ------------------------------------------------------------ */

test('the POI visibility state touches nothing else on the map', () => {
  const toggle = read('../../src/hooks/useLayerVisibility.js')

  for (const other of [
    'setScopeLayerVisible', 'heatmap', 'presentationActiveRef',
    'point', 'line', 'polygon',
  ]) {
    assert.ok(!toggle.includes(other), `${other} must be untouched`)
  }
})

test('search never re-enables a layer the user hid', () => {
  /* Görünürlük açık bir tercihtir; arama onu sessizce geri almaz. */
  const handler = between(page, 'const focusSearchResult', 'const zoomToSelectedPoi')

  assert.match(handler, /isPoiSelectable\(result\.id\)/)
  assert.ok(!/setHiddenPoiIds/.test(handler))

  // Kamera yine de gider: veri keşfi bir sunum kararı değildir.
  assert.ok(handler.indexOf('mapView.focusPoi(') < handler.indexOf('isPoiSelectable('))
})

test('the creation draft is a separate layer and survives the switch', () => {
  /* "POI Ekle" bir DÜZENLEME durumudur, kalıcı sunumun parçası değil. */
  const poiModule = read('../../src/map/poi.js')

  assert.match(poiModule, /export function createPoiPendingLayer/)
  assert.match(poiModule, /export function createPoiDraftLayer/)

  const toggle = read('../../src/hooks/useLayerVisibility.js')
  assert.ok(!/pending|draft|Placement/i.test(toggle))
})

/* --- Kenar çubuğu -------------------------------------------------------------- */

test('the sidebar entry reads "Yönetim Paneli"', () => {
  assert.match(sidebar, /label: 'Yönetim Paneli'/)
})

test('the old wording is gone from navigation but the plumbing is untouched', () => {
  const code = sidebar.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*/g, '')

  assert.ok(!/'Kullanıcı Yönetimi'/.test(code), 'no navigation item may still carry the old label')

  // Kimlik, rota ve yetki kapısı OLDUĞU GİBİ durur — bu bir metin düzeltmesidir.
  assert.match(sidebar, /id: 'admin-users'/)
  assert.match(sidebar, /navigate\('\/admin'\)/)
  assert.match(sidebar, /canAny\(ADMIN_ENTRY_PERMISSIONS\)/)
})

test('the admin shell already used the same words, so the two now agree', () => {
  const layout = read('../../src/components/admin/AdminLayout.jsx')

  assert.match(layout, /Yönetim Paneli/)
})

test('the permission catalogue group keeps its own, unrelated label', () => {
  /* "Kullanıcı Yönetimi" yetki matrisinde bir GRUP adıdır ve o ekranda hâlâ
     doğrudur; yeniden adlandırma yalnızca gezinme etiketiydi. */
  const catalogue = read('../../src/components/admin/rolePermissions.js')

  assert.match(catalogue, /Users: 'Kullanıcı Yönetimi'/)
})
