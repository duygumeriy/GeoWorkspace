import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

/**
 * Faz 5D — arama artık haritayı sürekli işgal etmez.
 *
 * <b>Kapanış bir "gizleme" değil, SÖKÜLMEDİR</b> ve ölçülen esas karar budur:
 * uçan isteğin iptali, açılır listenin kaybolması, klavye imlecinin sıfırlanması
 * ve sorgunun temizlenmesi bileşenin kaldırılmasından KENDİLİĞİNDEN gelir. Ayrı
 * bir "kapanışta şunları da temizle" yordamı, aynı işi ikinci kez ve
 * ayrışabilir biçimde yapmak olurdu.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const between = (source, start, end) => {
  const from = source.indexOf(start)
  return from < 0 ? '' : source.slice(from, source.indexOf(end, from + start.length))
}

const page = read('../../src/pages/MapPage.jsx')
const quick = read('../../src/components/map/QuickActions.jsx')
const quickCss = read('../../src/components/map/QuickActions.css')
const bar = read('../../src/components/map/PoiSearchBar.jsx')
const barCss = read('../../src/components/map/PoiSearchBar.css')
const hook = read('../../src/hooks/usePoiSearch.js')

/**
 * Bir modülden alınan İSİMLER.
 *
 * Kesin biçimli bir import satırı beklemek, aynı modülden ikinci bir isim
 * alındığı anda kırılır — ki bu meşru bir değişikliktir. Ölçülen şey neyin
 * ALINDIĞIDIR.
 */
const namedImports = (source, modulePath) => {
  const pattern = new RegExp(`import \\{([^}]*)\\} from '${modulePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`, 's')
  const match = source.match(pattern)
  assert.ok(match, `${modulePath} içe aktarımı bulunamadı`)
  return match[1].split(',').map((name) => name.trim()).filter(Boolean)
}

/* --- Düğme --------------------------------------------------------------------- */

test('the trigger lives in the existing control stack, at the bottom', () => {
  /* İkinci bir yüzen düğme, aynı işi yapan iki ayrı görsel dil olurdu. */
  assert.match(quick, /className=\{`quick-action poi-search-trigger/)

  // `children` (temel harita seçicisi) ÖNCE, arama SONRA: yığının en altı.
  assert.ok(quick.indexOf('{children}') < quick.indexOf('search?.permitted'))
})

test('the trigger is visually indistinguishable from the other controls', () => {
  /* Genişlik, yükseklik, kenarlık, gölge, hover ve tema davranışı tek bir
     sınıftan gelir; burada tanımlanan tek şey ETKİN durumdur. */
  assert.match(quick, /quick-action poi-search-trigger/)

  const active = between(quickCss, '.poi-search-trigger.is-open {', '}')
  assert.match(active, /border-color: var\(--border-strong\)/)
  assert.match(active, /color: var\(--primary-light\)/)

  // Aynı vurgu temel harita seçicisinin açık durumundan geliyor, yeni değil.
  const basemap = read('../../src/components/map/BasemapSelector.css')
  assert.match(between(basemap, '.basemap-trigger.is-open {', '}'), /var\(--primary-light\)/)
})

test('the trigger uses lucide-react, not a new icon library', () => {
  /* Ölçülen şey ikon KAYNAĞIDIR, import satırının biçimi değil: aynı yığın
     artık yolculuk kısayolunu da barındırdığı için aynı paketten ikinci bir
     ikon alınması meşrudur ve bu sözleşmeyi zayıflatmaz. */
  const icons = namedImports(quick, 'lucide-react')
  assert.ok(icons.includes('Search'), 'arama ikonu lucide-react\'ten gelmiyor')

  // Ve düğme gerçekten o ikonu çiziyor.
  assert.match(between(quick, 'poi-search-trigger', '</button>'), /<Search size=\{18\}/)

  /* Arama tetikleyicisi için İKİNCİ bir ikon kütüphanesi açılmaz: bileşendeki
     tek ikon kaynağı lucide-react'tir. */
  const iconImports = [...quick.matchAll(/from '([^']+)'/g)]
    .map(([, module]) => module)
    .filter((module) => /icon/i.test(module) || module === 'lucide-react')
  assert.deepEqual([...new Set(iconImports)].sort(), ['../ui/icons/index.js', 'lucide-react'])

  /* Yolculuk kısayolunun ikonu da AYNI import'tan gelir; bu bir bonus
     gözlemdir, arama sözleşmesinin koşulu değildir. */
  assert.ok(icons.some((name) => name.startsWith('Route as ')))
})

test('the trigger reports its state to assistive technology', () => {
  assert.match(quick, /aria-label="Haritada Ara"/)
  assert.match(quick, /aria-pressed=\{Boolean\(search\.open\)\}/)
  assert.match(quick, /title="Haritada Ara"/)
})

/* --- Açıklık ------------------------------------------------------------------- */

test('the search overlay starts CLOSED', () => {
  assert.match(page, /const \[poiSearchOpen, setPoiSearchOpen\] = useState\(false\)/)
})

test('the toggle is a single owner, and clicking twice returns to closed', () => {
  const toggle = between(page, 'const togglePoiSearch', '}, [])')

  assert.match(toggle, /setPoiSearchOpen\(\(current\) => !current\)/)
  assert.match(quick, /onClick=\{search\.onToggle\}/)
})

test('closed means NOT MOUNTED, so no request can exist while it is closed', () => {
  assert.match(page, /\{globalSearchTypes\.length > 0 && poiSearchOpen && \(/)

  /* Kanca yalnızca monte olduğunda istek açar ve sökülürken uçanı iptal eder;
     kapalıyken çalışacak hiçbir kod yoktur. */
  assert.match(hook, /useEffect\(\(\) => \(\) => \{\s*requestIdRef\.current \+= 1\s*controllerRef\.current\?\.abort\(\)/)
})

test('reopening starts clean: fresh query, no dropdown, no stale index', () => {
  /* Hepsi SÖKÜLMEDEN gelir — üç ayrı sıfırlama satırı yazılmadı. */
  assert.match(bar, /const \[query, setQuery\] = useState\(''\)/)
  assert.match(bar, /const \[open, setOpen\] = useState\(false\)/)
  assert.match(bar, /const \[activeIndex, setActiveIndex\] = useState\(-1\)/)
})

test('opening focuses the input so the user can type immediately', () => {
  const effect = between(bar, 'if (enabled) inputRef.current?.focus()', '}, [enabled])')

  assert.ok(effect.length > 0, 'the focus effect must exist')
  // Zamanlayıcı hilesi yok.
  assert.ok(!/setTimeout/.test(bar))
})

test('closing returns focus to the trigger', () => {
  const close = between(page, 'const closePoiSearch', '}, [])')

  assert.match(close, /setPoiSearchOpen\(false\)/)
  assert.match(close, /poiSearchButtonRef\.current\?\.focus\(\)/)
  assert.match(quick, /ref=\{search\.buttonRef\}/)
})

/* --- Temizle ve kapat AYRI eylemlerdir ----------------------------------------- */

test('clear and close never collapse into one ambiguous button', () => {
  assert.match(bar, /aria-label="Aramayı temizle"/)
  assert.match(bar, /aria-label="Aramayı kapat"/)

  // Temizle YALNIZCA silinecek metin varken; kapat her zaman.
  assert.match(bar, /\{query\.length > 0 && \(/)
  assert.match(bar, /\{typeof onClose === 'function' && \(/)

  // Görsel olarak da ayrılırlar.
  assert.match(bar, /poi-search-divider/)
  assert.match(barCss, /\.poi-search-divider \{/)
})

test('clear empties the query but leaves the bar open', () => {
  const clear = between(bar, 'const clear = useCallback', '}, [close, reset])')

  assert.match(clear, /setQuery\(''\)/)
  assert.match(clear, /reset\(\)/)
  assert.match(clear, /inputRef\.current\?\.focus\(\)/)
  // Kutuyu KAPATMAZ.
  assert.ok(!/onClose/.test(clear))
})

test('the close button fits the approved bar height', () => {
  const close = between(barCss, '.poi-search-close {', '}')

  assert.match(close, /width: 28px/)
  assert.match(close, /height: 28px/)

  // Onaylanmış geometri DEĞİŞMEDİ.
  assert.match(barCss, /min-height: 38px/)
  assert.match(barCss, /width: min\(420px, calc\(100vw - 8rem\)\)/)
  assert.match(barCss, /top: 1rem/)
  assert.match(barCss, /left: 50%/)
})

/* --- Klavye -------------------------------------------------------------------- */

test('Escape closes the dropdown first, then the whole search', () => {
  /* Birleşik kutuların standart davranışı. Tek Escape her şeyi kapatsaydı,
     listeden vazgeçmek isteyen kullanıcı yazdığını da kaybederdi. */
  const escape = between(bar, "if (event.key === 'Escape')", "if (!results.length) return")

  assert.match(escape, /if \(hasPanel\) \{\s*close\(\)/)
  assert.match(escape, /onClose\?\.\(\)/)
  assert.ok(escape.indexOf('if (hasPanel)') < escape.indexOf('onClose?.()'))
})

test('result navigation and selection still work', () => {
  assert.match(bar, /event\.key === 'ArrowDown'/)
  assert.match(bar, /event\.key === 'ArrowUp'/)
  assert.match(bar, /event\.key === 'Enter'/)
  assert.match(bar, /aria-activedescendant=/)
  assert.match(bar, /role="combobox"/)
  assert.match(bar, /role="listbox"/)
})

/* --- Yetki ve katman ----------------------------------------------------------- */

test('the trigger derives from at least one permitted searchable type', () => {
  const trigger = between(page, 'search={{', 'onGoTurkey=')
  const types = between(page, 'const globalSearchTypes', 'useEffect(() => {')

  assert.match(trigger, /permitted: globalSearchTypes\.length > 0/)
  assert.match(types, /allowed\.canViewPoi/)
  assert.match(types, /allowed\.canViewDrawings/)
  assert.match(types, /allowed\.canViewTransport/)
  assert.match(quick, /\{search\?\.permitted && \(/)

  for (const source of [quick, trigger, types]) {
    assert.ok(!/Administrator|GIS Manager|'Viewer'|isAdmin|username/.test(source))
  }
})

test('a hidden POI layer does NOT hide the search trigger', () => {
  /* Katmanı kapatmak veri keşfini kapatmaz — Faz 5C'de kurulan anlam. */
  const trigger = between(page, 'search={{', 'onGoTurkey=')

  assert.ok(!/poiLayerVisible/.test(trigger))
})

test('selecting a result never re-enables the hidden POI layer', () => {
  const handler = between(page, 'const focusSearchResult', 'const togglePoiLayer')

  assert.match(handler, /if \(!poiLayerVisible\) return/)
  assert.ok(!/setPoiLayerVisible/.test(handler))
})

/* --- Duyarlılık ---------------------------------------------------------------- */

test('the trigger inherits the existing responsive stack behaviour', () => {
  /* Denetim yığını dar ekranda satıra dönüşür ve yatay telefonda küçülür;
     arama düğmesi aynı sınıfı kullandığı için bunların hepsini devralır —
     masaüstüne özgü bir düğme yaratılmadı. */
  assert.match(quickCss, /@media \(max-width: 640px\)/)
  assert.match(quickCss, /flex-direction: row/)
  assert.match(between(quickCss, '@media (max-height: 480px)', '\n}\n'), /width: 40px/)

  // Açık kutunun dar ekran yerleşimi de korunuyor.
  assert.match(barCss, /min-height: 42px/)
})
