import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  FALLBACK_COLOR,
  FALLBACK_ICON,
  accentColor,
  iconForKey,
  isKnownIconKey,
  knownIconKeys,
} from '../../src/components/map/poiIconRegistry.js'
import {
  POI_FOCUS_ANIMATION_MS,
  POI_FOCUS_TARGET_ZOOM,
  POINT_ZOOM,
  focusZoomFor,
} from '../../src/map/mapView.js'

/* `services/api.js` ve onu içe aktaran kanca `import.meta.env` okur; node test
   koşucusu bunu çözemez (mevcut birim testlerinin hiçbiri o modülü içe
   aktarmaz). Bu yüzden oradaki sabitler KAYNAKTAN okunur — iddia yine gerçek
   değerin üzerindedir, ikinci bir kopya tutulmaz. */
const numberFrom = (source, pattern) => Number(source.match(pattern)[1])

/**
 * Faz 5 — POI arama.
 *
 * Buradaki testler DOM kurmadan, arama davranışının kural katmanını ölçer:
 * simge eşlemesi, renk yedeği, sınırlar, odak yakınlığı ve bileşenin
 * sözleşmesi (yetki kapısı, iptal, erişilebilirlik nitelikleri).
 */

const read = (path) => readFileSync(new URL(path, import.meta.url).pathname, 'utf8')

const component = read('../../src/components/map/PoiSearchBar.jsx')
const hook = read('../../src/hooks/usePoiSearch.js')
const page = read('../../src/pages/MapPage.jsx')
const registry = read('../../src/components/map/poiIconRegistry.js')
const taxonomy = read(
  '../../../backend/src/StajProject.Domain/Common/PoiCategoryTaxonomy.cs',
)

/* --- Simge kayıt defteri ------------------------------------------------------ */

test('every canonical icon_key in the backend taxonomy has a Lucide component', () => {
  /* Kayıt defteri ile taksonomi ayrışırsa, gerçek bir kategori yedek simgeye
     düşer ve kimse fark etmez. */
  const keys = [...taxonomy.matchAll(/new\("[^"]+",\s*"[^"]+",\s*(?:null|"[^"]+"),\s*"([^"]+)"/g)].map(
    (match) => match[1],
  )

  assert.equal(keys.length, 44, 'the taxonomy should still define 44 categories')

  const missing = keys.filter((key) => !isKnownIconKey(key))
  assert.deepEqual(missing, [], `unmapped icon keys: ${missing.join(', ')}`)
})

test('the registry maps exactly the canonical key set, with no extras', () => {
  const keys = new Set(
    [...taxonomy.matchAll(/new\("[^"]+",\s*"[^"]+",\s*(?:null|"[^"]+"),\s*"([^"]+)"/g)].map((m) => m[1]),
  )

  assert.equal(knownIconKeys().length, keys.size)
  for (const key of knownIconKeys()) assert.ok(keys.has(key), `stale key in registry: ${key}`)
})

test('known icon keys resolve to distinct components', () => {
  assert.equal(iconForKey('pill').displayName, 'Pill')
  assert.equal(iconForKey('coffee').displayName, 'Coffee')
  assert.equal(iconForKey('utensils-crossed').displayName, 'UtensilsCrossed')
  assert.equal(iconForKey('badge-dollar-sign').displayName, 'BadgeDollarSign')
  assert.equal(iconForKey('shopping-basket').displayName, 'ShoppingBasket')
})

test('an unknown or malformed icon key falls back to MapPin instead of crashing', () => {
  /* `undefined` bir bileşen bekleyen JSX'e verilirse React render sırasında
     düşerdi; yedek bu yüzden bir DEĞER, bir istisna değil. */
  for (const value of ['definitely-not-an-icon', '', null, undefined, 42, {}, []]) {
    assert.equal(iconForKey(value), FALLBACK_ICON)
  }

  assert.equal(FALLBACK_ICON.displayName, 'MapPin')
})

test('the registry never copies taxonomy metadata', () => {
  // Ad, slug ve renk veritabanından gelir; burada ikinci bir kopya olmamalı.
  assert.ok(!/Eczane|Yeme-İçme|saglik-kurumlari|#EF4444/.test(registry))
})

/* --- Renk yedeği -------------------------------------------------------------- */

test('a valid colour is canonicalised and kept', () => {
  assert.equal(accentColor('#ef4444'), '#EF4444')
  assert.equal(accentColor('#22C55E'), '#22C55E')
})

test('a missing or malformed colour degrades to the neutral fallback', () => {
  for (const value of [null, undefined, '', 'red', '#FFF', '#EF4444FF', '#GGGGGG', 42]) {
    assert.equal(accentColor(value), FALLBACK_COLOR)
  }

  // Backend'deki PoiCategoryPalette.Fallback ile aynı değer.
  assert.equal(FALLBACK_COLOR, '#64748B')
})

/* --- Sınırlar ve odak --------------------------------------------------------- */

test('the client mirrors the backend search contract', () => {
  const api = read('../../src/services/api.js')

  assert.equal(numberFrom(api, /minQueryLength: (\d+)/), 2)
  assert.equal(numberFrom(api, /maxQueryLength: (\d+)/), 100)
  assert.equal(numberFrom(api, /defaultLimit: (\d+)/), 8)
  assert.match(api, /POI_SEARCH_PATH = '\/api\/poi\/search'/)
})

test('the debounce waits for a pause, not a keystroke', () => {
  const debounce = numberFrom(hook, /POI_SEARCH_DEBOUNCE_MS = (\d+)/)

  assert.ok(debounce >= 250 && debounce <= 300, `debounce was ${debounce}`)
})

test('going to a POI lands on a fixed target zoom, not a minimum', () => {
  assert.equal(POI_FOCUS_TARGET_ZOOM, 16)
  assert.ok(POI_FOCUS_TARGET_ZOOM > POINT_ZOOM)
})

test('the POI focus animation is smooth and map-native', () => {
  assert.ok(POI_FOCUS_ANIMATION_MS >= 450 && POI_FOCUS_ANIMATION_MS <= 650)
})

test('POI focus zooms IN from far away and OUT from too close', () => {
  /* Deterministik olmasının özü: 19. seviyeden başka bir POI'ye giden kişi
     hedefe 19'da değil, 16'da varmalıdır. */
  const view = read('../../src/hooks/useMapView.js')
  const helper = view.slice(view.indexOf('const focusPoi = useCallback'))

  assert.match(helper.slice(0, 400), /zoom: POI_FOCUS_TARGET_ZOOM/)
  // Alt sınır mantığı KULLANILMAZ: focusZoomFor burada çağrılmaz.
  assert.ok(!/focusZoomFor/.test(helper.slice(0, 400)))
})

test('search and "Zoom Yap" share ONE camera contract', () => {
  /* İkinci bir kamera yolu, aynı eylemin iki farklı yerde bitmesi ve birinin
     sessizce ayrışması demek olurdu. */
  const view = read('../../src/hooks/useMapView.js')

  assert.equal((view.match(/POI_FOCUS_TARGET_ZOOM/g) ?? []).length, 2, 'declared once, used once')

  assert.match(page, /const focusSearchResult[\s\S]*?mapView\.focusPoi\(/)
  assert.match(page, /const zoomToSelectedPoi[\s\S]*?mapView\.focusPoi\(/)
})

test('the global focusPoint keeps its never-zoom-out rule', () => {
  /* POI'lerim, envanter ve çizim gezinmesi buna güvenir; POI kamerası onu
     değiştirmemelidir. */
  assert.equal(focusZoomFor(19, 16), 19)
  assert.equal(focusZoomFor(6, 16), 16)
  assert.equal(focusZoomFor(Number.NaN, 15), 15)

  const view = read('../../src/hooks/useMapView.js')
  const generic = view.slice(view.indexOf('const focusPoint = useCallback'), view.indexOf('const focusPoi = useCallback'))

  assert.match(generic, /focusZoomFor\(view\.getZoom\(\), minZoom\)/)
})

/* --- "Zoom Yap" --------------------------------------------------------------- */

test('the POI info panel offers a non-destructive Zoom Yap action', () => {
  const sheet = read('../../src/components/map/PoiInfoSheet.jsx')

  assert.match(sheet, /Zoom Yap/)
  // İkincil görünüm: "Sil"in kırmızısını PAYLAŞMAZ.
  assert.match(sheet, /className="poi-button secondary poi-button-zoom"/)
  assert.ok(!/poi-button danger[^]*Zoom Yap/.test(sheet))
  // İkinci bir simge kütüphanesi eklenmedi.
  assert.match(sheet, /from 'lucide-react'/)
})

test('Zoom Yap reads the selected POI and keeps lon = X, lat = Y', () => {
  const start = page.indexOf('const zoomToSelectedPoi')
  const handler = page.slice(start, page.indexOf('}, [selectedPoi, mapView])', start))

  assert.match(handler, /fromLonLat\(\[selectedPoi\.longitude, selectedPoi\.latitude\]\)/)
  // Projeksiyon dönüşümü yeniden yazılmaz; Mercator matematiği elle kurulmaz.
  assert.ok(!/setCenter\(/.test(handler))
  assert.ok(!/setZoom\(/.test(handler))
})

test('Zoom Yap never closes the panel or clears the selection', () => {
  /* Bakmak için yaklaştığı kaydın bilgilerini tam o anda kaybetmek, düğmeyi
     işe yaramaz kılardı. */
  const start = page.indexOf('const zoomToSelectedPoi')
  const handler = page.slice(start, page.indexOf('}, [selectedPoi, mapView])', start))

  assert.ok(!/setSelectedPoi/.test(handler))
  assert.ok(!/mapContext\.close/.test(handler))
  assert.ok(!/mapContext\.activate/.test(handler))
})

test('a POI without a readable coordinate offers no Zoom Yap', () => {
  // Kamerayı tanımsız bir yere göndermek sessiz bir hata olurdu.
  const sheet = read('../../src/components/map/PoiInfoSheet.jsx')
  const guard = sheet.slice(sheet.indexOf('const canZoom'), sheet.indexOf('return ('))

  assert.match(guard, /Number\.isFinite\(poi\.longitude\)/)
  assert.match(guard, /Number\.isFinite\(poi\.latitude\)/)
})

test('three buttons wrap instead of overflowing a narrow panel', () => {
  const css = read('../../src/components/map/PoiSheets.css')
  const actions = css.slice(css.indexOf('.poi-info-actions {'), css.indexOf('.poi-button.danger'))

  assert.match(actions, /flex-wrap: wrap/)
  // Yıkıcı eylem görsel olarak AYRI kalır.
  assert.match(css, /\.poi-button\.danger \{\s*background: var\(--danger/)
})

/* --- Hook sözleşmesi ---------------------------------------------------------- */

test('a query shorter than the minimum opens no request', () => {
  assert.match(hook, /term\.length < POI_SEARCH_LIMITS\.minQueryLength/)
  assert.match(hook, /reset\(\)/)
})

test('the hook is disabled entirely without permission', () => {
  assert.match(hook, /if \(!enabled \|\|/)
})

test('a stale response can never overwrite a newer one', () => {
  /* İki koruma birden gerekir: abort uçan isteği keser, sayaç ise iptalden
     ÖNCE yola çıkmış geç bir cevabı eler. */
  assert.match(hook, /new AbortController\(\)/)
  assert.match(hook, /requestIdRef\.current \+= 1/)
  assert.ok(
    (hook.match(/requestId !== requestIdRef\.current/g) ?? []).length >= 3,
    'every write-back must re-check the request id',
  )
})

test('teardown aborts the in-flight request and clears the timer', () => {
  assert.match(hook, /window\.clearTimeout\(timer\)/)
  assert.match(hook, /useEffect\(\(\) => \(\) => \{[\s\S]*controllerRef\.current\?\.abort\(\)/)
})

test('an abort is treated as lifecycle, not as an error', () => {
  assert.match(hook, /searchError\?\.name === 'AbortError'/)
})

test('a failed search does not retry automatically', () => {
  // Otomatik yeniden deneme sonsuz döngüye dönüşebilirdi.
  assert.ok(!/setTimeout\([^)]*retry/i.test(hook))
})

/* --- Bileşen sözleşmesi ------------------------------------------------------- */

test('the search bar renders only when at least one searchable type is permitted', () => {
  /* Global arama POI, çizim ve ulaşımı kapsar. Bileşenin kendi kapısı sürer;
     çağıran ise izinli tür listesinin boş olmamasını ve açıklığı birlikte arar. */
  assert.match(component, /if \(!enabled\) return null/)
  assert.match(page, /\{globalSearchTypes\.length > 0 && poiSearchOpen && \(/)

  const trigger = page.slice(page.indexOf('search={{'), page.indexOf('onGoTurkey='))
  assert.match(trigger, /permitted: globalSearchTypes\.length > 0/)
  assert.match(page, /allowed\.canViewPoi \? \[\{ id: 'poi'/)
  assert.match(page, /allowed\.canViewDrawings \? \[\{ id: 'drawing'/)
  assert.match(page, /allowed\.canViewTransport/)
})

test('no role name or username decides visibility', () => {
  for (const source of [component, hook, registry]) {
    assert.ok(!/Administrator|GIS Manager|'Viewer'|username ===/.test(source))
  }
})

test('the input exposes full combobox semantics', () => {
  assert.match(component, /role="combobox"/)
  assert.match(component, /aria-expanded=\{hasPanel\}/)
  assert.match(component, /aria-controls=\{listboxId\}/)
  assert.match(component, /aria-activedescendant=/)
  assert.match(component, /role="listbox"/)
  assert.match(component, /role="option"/)
  assert.match(component, /aria-selected=/)
})

test('arrow keys, Enter and Escape are all handled', () => {
  assert.match(component, /event\.key === 'ArrowDown'/)
  assert.match(component, /event\.key === 'ArrowUp'/)
  assert.match(component, /event\.key === 'Enter'/)
  assert.match(component, /event\.key === 'Escape'/)
})

test('arrow navigation wraps around the result list', () => {
  assert.match(component, /\(current \+ 1\) % results\.length/)
  assert.match(component, /current <= 0 \? results\.length - 1 : current - 1/)
})

test('each result type has its own presentation and POI metadata remains POI-specific', () => {
  assert.match(component, /result\.searchType === 'poi'/)
  assert.match(component, /<PoiCategoryBadge/)
  assert.match(component, /iconKey=\{result\.iconKey\}/)
  assert.match(component, /colorHex=\{result\.colorHex\}/)
  assert.match(component, /\{result\.name\}/)
  assert.match(component, /result\.searchType === 'poi' \? result\.categoryName/)

  assert.match(component, /result\.searchType === 'drawing' \? <Shapes/)
  assert.match(component, /result\.searchType === 'stop' \? <BusFront/)
  assert.match(component, /<Route size=\{17\}/)

  // Görünüm sözleşmesi aynı sınıftan gelmeye devam ediyor.
  assert.match(component, /className="poi-search-option-icon"/)
})

test('the clear button resets the query and the results', () => {
  const clear = component.slice(component.indexOf('const clear = useCallback'))

  assert.match(clear.slice(0, 300), /setQuery\(''\)/)
  assert.match(clear.slice(0, 300), /reset\(\)/)
  assert.match(component, /aria-label="Aramayı temizle"/)
})

test('the empty and error states are distinct and non-destructive', () => {
  assert.match(component, /selectedType\?\.label \?\? 'Kayıt'\} bulunamadı\./)
  assert.match(component, /poi-search-note-error/)
  assert.match(component, /role="alert"/)
  assert.ok(!/setPoiLayerVisible/.test(component))
})

/* --- Harita entegrasyonu ------------------------------------------------------ */

test('choosing a result uses the existing focus helper with lon/lat in that order', () => {
  const handler = page.slice(page.indexOf('const focusSearchResult'))

  assert.match(
    handler.slice(0, 900),
    /mapView\.focusPoi\(fromLonLat\(\[result\.longitude, result\.latitude\]\)\)/,
  )
})

test('no raw camera mutation bypasses the helper', () => {
  const handler = page.slice(page.indexOf('const focusSearchResult'), page.indexOf('const editMyPoi'))

  assert.ok(!/setCenter\(/.test(handler))
  assert.ok(!/setZoom\(/.test(handler))
})

test('selecting a result creates no second persistent marker layer', () => {
  /* POI'nin haritadaki gösterimi Faz 4 WMS rasterine aittir; arama yalnızca
     kamerayı oynatır. */
  const handler = page.slice(page.indexOf('const focusSearchResult'), page.indexOf('const editMyPoi'))

  assert.ok(!/addLayer|new VectorLayer|new VectorSource/.test(handler))
  assert.ok(!/addLayer|VectorLayer/.test(component))
})

test('the detail panel opens only from the canonical loaded record', () => {
  // Arama sonucu dar bir sözleşmedir; paneli eksik bir kayıtla beslemek
  // düzenle/sil düğmelerini yanlış davrandırırdı.
  const handler = page.slice(page.indexOf('const focusSearchResult'), page.indexOf('const editMyPoi'))

  assert.match(handler, /findPoiOnLayer\(result\.id\)/)
  assert.match(handler, /if \(!record\) return/)
})

/* --- Sınır ------------------------------------------------------------------- */

test('search introduces no direct GeoServer access', () => {
  for (const source of [component, hook, registry]) {
    assert.ok(!/:8080|\/geoserver|geoworkspace|poi_read|poi_all/.test(source))
  }
})

test('the search request goes through authFetch, carrying no token in the URL', () => {
  const api = read('../../src/services/api.js')
  const fn = api.slice(api.indexOf('export function searchPois'))

  assert.match(fn.slice(0, 400), /authFetch\(/)
  assert.ok(!/token/i.test(fn.slice(0, 400)))
})

/* --- Responsive --------------------------------------------------------------- */

test('the closed control is compact but not cramped', () => {
  const css = read('../../src/components/map/PoiSearchBar.css')
  const field = css.slice(css.indexOf('.poi-search-field {'), css.indexOf('.poi-search-field:focus-within'))

  const height = Number(field.match(/min-height: (\d+)px/)[1])
  assert.ok(height >= 36 && height <= 40, `desktop control height was ${height}px`)

  // Metin küçülmedi ve temizle düğmesi dokunma hedefini korudu.
  assert.match(css, /font-size: 14px/)
  const clear = css.slice(css.indexOf('.poi-search-clear {'))
  assert.match(clear.slice(0, 400), /width: 28px/)
  assert.match(clear.slice(0, 400), /height: 28px/)
})

test('touch viewports keep a larger control than the desktop one', () => {
  const css = read('../../src/components/map/PoiSearchBar.css')
  const mobile = css.slice(css.indexOf('@media (max-width: 640px)'))

  const touchHeight = Number(mobile.match(/min-height: (\d+)px/)[1])
  assert.ok(touchHeight >= 40 && touchHeight <= 42, `touch control height was ${touchHeight}px`)
})

test('the focus ring and clear semantics survive the compaction', () => {
  const css = read('../../src/components/map/PoiSearchBar.css')

  assert.match(css, /\.poi-search-clear:focus-visible,[\s\S]*outline: 2px solid var\(--primary-light\)/)
  assert.match(component, /aria-label="Aramayı temizle"/)
})

test('the search bar reflows below the controls on narrow viewports', () => {
  const css = read('../../src/components/map/PoiSearchBar.css')

  // Masaüstünde üst-orta, dar ekranda tam genişlik — taşmadan.
  assert.match(css, /@media \(max-width: 640px\)/)
  assert.match(css, /width: min\(420px, calc\(100vw - 8rem\)\)/)
  assert.match(css, /max-height: min\(60vh, 22rem\)/)
})

test('the overlay sits above the quick actions and below the panels', () => {
  const css = read('../../src/components/map/PoiSearchBar.css')
  const zIndex = Number(css.match(/\.poi-search \{[\s\S]*?z-index: (\d+);/)[1])

  assert.ok(zIndex > 20, 'must sit above QuickActions (20)')
  assert.ok(zIndex < 40, 'must sit below docked panels (40+)')
})
