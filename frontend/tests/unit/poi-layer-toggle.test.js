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

test("the panel offers a fourth row, POI'ler, next to the drawing types", () => {
  assert.match(panel, /POI'ler/)
  assert.match(panel, /data-testid="layers-poi-row"/)

  // Çizim türleriyle AYNI görsel dil: aynı satır sınıfı, aynı AÇIK/KAPALI metni.
  const row = panel.slice(panel.indexOf('data-testid="layers-poi-row"'))
  assert.match(row.slice(0, 900), /layers-row/)
  assert.match(row.slice(0, 900), /AÇIK.*KAPALI|KAPALI/s)

  // İkinci bir simge kütüphanesi eklenmedi.
  assert.match(panel, /from 'lucide-react'/)
})

test('POI is NOT folded into the drawing type list', () => {
  /* Katılsaydı toplu seçime, stil düzenleyicisine ve /api/drawings/* uçlarına
     da kendiliğinden karışırdı. */
  assert.match(panel, /DRAWING_TYPE_LIST\.map/)
  const list = stripComments(between(panel, 'DRAWING_TYPE_LIST.map', 'data-testid="layers-poi-row"'))
  assert.ok(!/POI/.test(list))
})

/* --- Yetki --------------------------------------------------------------------- */

test('the row appears only for a caller holding poi.view, and by permission alone', () => {
  assert.match(panel, /\{poi\?\.permitted && \(/)

  const props = between(page, 'poi={{', 'onTogglePoi=')
  assert.match(props, /permitted: allowed\.canViewPoi/)

  /* Rol adına bakan hiçbir kural yoktur — ne burada ne panelde. */
  for (const source of [panel, props]) {
    assert.ok(!/Administrator|GIS Manager|Viewer|roleName|isAdmin/.test(source))
  }
})

test('without poi.view nothing POI-related is even constructed', () => {
  // Faz 4 davranışı korunur: yetki yoksa raster kurulmaz, uç çağrılmaz.
  assert.match(page, /permitted: allowed\.canViewPoi && poiLayerVisible/)
  assert.match(page, /permitted: allowed\.canViewPoi,/)
})

/* --- Varsayılan ---------------------------------------------------------------- */

test('the POI layer starts visible', () => {
  /* POI'ler haritanın normal içeriğidir; gizli açılmaları kullanıcıya kayıp
     veri gibi görünürdü. */
  assert.match(page, /const \[poiLayerVisible, setPoiLayerVisible\] = useState\(true\)/)
})

/* --- KAPALI -------------------------------------------------------------------- */

test('turning it off hides the real layers, not just their style', () => {
  /* Saydam bir stil POI'yi görünmez ama TIKLANABİLİR bırakırdı. */
  assert.match(hook, /layerRef\.current\?\.setVisible\(visible\)/)
  assert.match(page, /visible: poiLayerVisible/)

  // WMS rasteri de aynı anahtardan geçer.
  assert.match(page, /permitted: allowed\.canViewPoi && poiLayerVisible/)
})

test('turning it off stops POI hit detection', () => {
  const gate = between(page, 'const poiClickEnabled', '/**')

  assert.match(gate, /poiLayerVisible/)
})

test('no presentation request is issued while the layer is hidden', () => {
  /* Kanca yetkisiz durumda katmanı HİÇ kurmaz ve hiçbir dinleyici bağlamaz;
     kapalı katman aynı yoldan geçer, dolayısıyla kaydırma/yakınlaşma boyunca
     istek üretilmez. */
  const raster = read('../../src/hooks/usePoiPresentationLayer.js')
  const guard = raster.slice(raster.indexOf('if (!map || !permitted)'), raster.indexOf('let disposed'))

  assert.match(guard, /return undefined/)
  assert.match(guard, /setLayerActive\(false\)/)

  // Uçan istek, effect'in kendi temizliğinde iptal edilir.
  assert.match(raster, /entry\.controller\?\.abort\(\)/)
  assert.match(raster, /entry\.requestNumber \+= 1/)
})

test('hiding the layer retires the selection and its panel', () => {
  /* Görünmeyen bir kaydı anlatan açık bir panel bırakmak, kullanıcıya haritada
     olmayan bir şeyi gösterirdi. Aynı kural çizim tarafında da vardır. */
  const toggle = between(page, 'const togglePoiLayer', '}, [mapContext])')

  assert.match(toggle, /mapContext\.close\(MAP_CONTEXTS\.poiInfo\)/)
  assert.match(toggle, /setSelectedPoi\(null\)/)
})

test('toggling is pure presentation: it never writes to the database', () => {
  const toggle = between(page, 'const togglePoiLayer', '}, [mapContext])')

  for (const mutation of ['deletePoi', 'updatePoi', 'createPoi', 'fetch', 'authFetch', 'restore']) {
    assert.ok(!toggle.includes(mutation), `${mutation} must not run on a visibility toggle`)
  }

  // Panelin kendi metni de bunu söyler ve değişmedi.
  assert.match(panel, /kayıtlar veritabanında kalır/)
})

/* --- AÇIK ---------------------------------------------------------------------- */

test('turning it back on refetches the image but NOT the records', () => {
  /* Görünürlük yetkiden ayrıdır: katmanı kapatmak veriyi atmaz. Kaynak yalnızca
     `permitted` düştüğünde boşaltılır. */
  const clear = between(hook, 'if (permitted) {', '}, [permitted, load])')

  assert.match(clear, /sourceRef\.current\?\.clear\(\)/)
  assert.ok(!/visible/.test(clear), 'visibility must not clear the source')

  // Raster yeniden kurulduğunda ilk yüklemesini kendisi yapar.
  const raster = read('../../src/hooks/usePoiPresentationLayer.js')
  assert.match(raster, /map\.on\('change:size', scheduleLoad\)\n    scheduleLoad\(\)/)
})

/* --- Sayaç --------------------------------------------------------------------- */

test('the count comes from the records already loaded, not a second request', () => {
  assert.match(hook, /setCount\(source\.getFeatures\(\)\.length\)/)
  assert.match(hook, /const syncCount = useCallback/)
  assert.match(page, /count: poi\.count/)

  /* Sunucu listeyi kendi kurallarıyla süzer (aktif, silinmemiş, kategorisi
     aktif); tarayıcı o kuralları yeniden uygulamaz. */
  const loadFn = between(hook, 'const load = useCallback', '} catch (error)')
  assert.ok(!/isActive|isDeleted/.test(loadFn))
})

test('the count follows create and delete without a refetch', () => {
  assert.match(hook, /if \(feature\) sourceRef\.current\?\.addFeature\(feature\)\n    syncCount\(\)/)
  assert.match(hook, /if \(existing\) source\.removeFeature\(existing\)\n    syncCount\(\)/)
})

/* --- Yan etkisizlik ------------------------------------------------------------ */

test('the POI switch touches nothing else on the map', () => {
  const toggle = between(page, 'const togglePoiLayer', '}, [mapContext])')

  for (const other of [
    'toggleVisibility', 'setScopeLayerVisible', 'heatmap', 'presentationActiveRef',
    'point', 'line', 'polygon',
  ]) {
    assert.ok(!toggle.includes(other), `${other} must be untouched`)
  }
})

test('search never re-enables a layer the user hid', () => {
  /* Görünürlük açık bir tercihtir; arama onu sessizce geri almaz. */
  const handler = between(page, 'const focusSearchResult', '[mapView, mapContext, findPoiOnLayer')

  assert.match(handler, /if \(!poiLayerVisible\) return/)
  assert.ok(!/setPoiLayerVisible/.test(handler))

  // Kamera yine de gider: veri keşfi bir sunum kararı değildir.
  assert.ok(handler.indexOf('mapView.focusPoi(') < handler.indexOf('if (!poiLayerVisible) return'))
})

test('the creation draft is a separate layer and survives the switch', () => {
  /* "POI Ekle" bir DÜZENLEME durumudur, kalıcı sunumun parçası değil. */
  const poiModule = read('../../src/map/poi.js')

  assert.match(poiModule, /export function createPoiPendingLayer/)
  assert.match(poiModule, /export function createPoiDraftLayer/)

  const toggle = between(page, 'const togglePoiLayer', '}, [mapContext])')
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
