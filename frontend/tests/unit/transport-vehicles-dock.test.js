import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  DOCK_EDGE_MARGIN,
  DOCK_POSITION_STORAGE_KEY,
  clampDockOffset,
  dockOffsetToPosition,
  dockPositionToOffset,
  isDockPosition,
  readDockPosition,
  writeDockPosition,
} from '../../src/map/dockPosition.js'

/**
 * Faz 6 — "Araçlar" yüzer paneli TAŞINABİLİR.
 *
 * Ölçülen şey sunum sözleşmesidir: varsayılan yer değişmedi, sürükleme
 * yalnızca tutamaktan başlar, panel kullanılabilir harita alanının dışına
 * çıkamaz ve konum tercihi hiçbir iş kararına (izleme/takip/seçim/yönetim)
 * dokunmaz.
 *
 * Kaynak taramaları YORUMSUZ metin üzerinde yapılır — Faz 5'te bir yorumdaki
 * sözcük yüzünden kırılan testler yaşandı.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const HOOK = stripComments(read('../../src/hooks/useDockDrag.js'))
const TOOLBAR = stripComments(read('../../src/components/map/DrawToolbar.jsx'))
const TOOLBAR_CSS = read('../../src/components/map/DrawToolbar.css').replace(/\/\*[\s\S]*?\*\//g, ' ')

const VIEWPORT = { width: 1000, height: 600 }
const DOCK = { width: 200, height: 50 }

/** localStorage'ın yalnızca kullanılan yüzeyi. */
function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial))
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
    get size() { return map.size },
  }
}

/* --- 13. Varsayılan yer DEĞİŞMEDİ: alt-orta --------------------------------- */

test('with no stored preference the dock keeps its bottom-centre default', () => {
  assert.equal(readDockPosition(fakeStorage()), null)
  // Konum yoksa piksel yerleşimi de yoktur: CSS varsayılanı işler.
  assert.equal(dockPositionToOffset({ position: null, viewport: VIEWPORT, dock: DOCK }), null)

  assert.match(TOOLBAR_CSS, /\.draw-toolbar\s*\{[^}]*bottom:\s*1\.25rem/)
  assert.match(TOOLBAR_CSS, /\.draw-toolbar\s*\{[^}]*left:\s*50%/)
  assert.match(TOOLBAR_CSS, /\.draw-toolbar\s*\{[^}]*transform:\s*translateX\(-50%\)/)

  /* Taşınmış panel sınıfı YALNIZCA çakışan varsayılanları geri alır; konum
     satır içi `left/top` ile gelir. */
  const placed = TOOLBAR_CSS.match(/\.draw-toolbar\.draw-toolbar--placed\s*\{([^}]*)\}/)
  assert.ok(placed, 'taşınmış yerleşim için ayrı bir kural olmalı')
  assert.match(placed[1], /bottom:\s*auto/)
  assert.match(placed[1], /right:\s*auto/)
  assert.match(placed[1], /transform:\s*none/)
})

test('the inline style is only emitted once a position exists', () => {
  assert.match(HOOK, /style:\s*offset\s*\?[\s\S]{0,140}:\s*undefined/)
  assert.ok(HOOK.includes('${offset.left}px'))
  assert.ok(HOOK.includes('${offset.top}px'))
  assert.match(HOOK, /placed:\s*Boolean\(offset\)/)
})

/* --- 14 / 15. Sürükleme YALNIZCA tutamaktan başlar --------------------------- */

test('drag handlers are attached to the drag handle alone', () => {
  // Tutamak dışında hiçbir yerde işaretçi olayı yoktur.
  assert.equal((TOOLBAR.match(/handleProps/g) ?? []).length, 1)
  assert.match(TOOLBAR, /className="draw-toolbar-drag"[\s\S]{0,400}\{\.\.\.dock\.handleProps\}/)
  assert.equal(/onPointerDown=/.test(TOOLBAR), false, 'bileşende elle bağlanmış işaretçi olayı yok')

  // Panelin kökü ve içerideki düğmeler yalnızca kendi işlerini yapar.
  assert.equal(/onClick=\{onToggleCollapse\}/.test(TOOLBAR), true)
  assert.match(TOOLBAR, /className="draw-toolbar-drag"[\s\S]{0,400}<GripIcon/)
  const dragButton = TOOLBAR.match(/<button\s+type="button"\s+className="draw-toolbar-drag"[\s\S]*?>/)
  assert.ok(dragButton)
  assert.equal(/onClick/.test(dragButton[0]), false, 'tutamak bir eylem düğmesi değildir')
})

test('the drag handle carries an accessible label', () => {
  assert.match(TOOLBAR, /aria-label="Araç panelini taşı"/)
})

/* --- 16. Tek işaretçi sahipliği --------------------------------------------- */

test('one pointer owns the gesture, through pointer capture', () => {
  assert.ok(HOOK.includes('setPointerCapture'))
  assert.ok(HOOK.includes('releasePointerCapture'))
  // Başka bir işaretçinin hareketi sürüklemeyi ele geçiremez.
  assert.ok(HOOK.includes('drag.pointerId !== event.pointerId'))
  assert.ok(HOOK.includes('onPointerCancel'))
  // Fare/dokunmatik için ayrı uygulamalar yoktur.
  for (const legacy of ['mousedown', 'onMouseDown', 'touchstart', 'onTouchStart']) {
    assert.equal(HOOK.includes(legacy), false, `${legacy} ayrı bir uygulama olurdu`)
  }
})

/* --- 17. Harita kaydırması YALNIZCA sürükleme sırasında bastırılır ----------- */

test('map panning is suppressed only while the dock is being dragged', () => {
  // Yayılma yalnızca işaretçi işleyicilerinde durdurulur.
  assert.equal((HOOK.match(/stopPropagation/g) ?? []).length, 2)
  assert.match(HOOK, /onPointerDown[\s\S]*?stopPropagation/)
  assert.match(HOOK, /onPointerMove[\s\S]*?stopPropagation/)

  // Haritanın etkileşimleri KÜRESEL olarak kapatılmaz; kanca haritayı hiç görmez.
  for (const forbidden of ['setActive', 'getInteractions', 'ol/', 'map.']) {
    assert.equal(HOOK.includes(forbidden), false, `${forbidden} kancada olmamalı`)
  }

  // Tutamak tarayıcının kendi jestini de üstlenmez.
  assert.match(TOOLBAR_CSS, /\.draw-toolbar-drag\s*\{[^}]*touch-action:\s*none/)
})

/* --- 18 / 20. Kullanılabilir harita alanının DIŞINA çıkamaz ------------------ */

test('the dock cannot be dragged outside the usable map viewport', () => {
  const farRight = clampDockOffset({ left: 99999, top: 99999, viewport: VIEWPORT, dock: DOCK })
  assert.deepEqual(farRight, {
    left: VIEWPORT.width - DOCK.width - DOCK_EDGE_MARGIN,
    top: VIEWPORT.height - DOCK.height - DOCK_EDGE_MARGIN,
  })

  const farLeft = clampDockOffset({ left: -99999, top: -99999, viewport: VIEWPORT, dock: DOCK })
  assert.deepEqual(farLeft, { left: DOCK_EDGE_MARGIN, top: DOCK_EDGE_MARGIN })
})

test('safe bounds come from the map viewport itself, not from hardcoded chrome sizes', () => {
  /* Üst şerit ve kenar çubuğu `.map-viewport` kutusunun DIŞINDADIR; ölçüyü
     konumlanmış atadan okumak, iki ayrı doğruluk kaynağı tutmaktan iyidir. */
  assert.ok(HOOK.includes('offsetParent'))
  assert.equal(/topbar|sidebar|68px|240px/i.test(HOOK), false)
})

test('a dock wider than the viewport still keeps its left edge reachable', () => {
  const narrow = { width: 300, height: 400 }
  const wide = { width: 520, height: 60 }
  const clamped = clampDockOffset({ left: 400, top: 10, viewport: narrow, dock: wide })
  assert.equal(clamped.left, DOCK_EDGE_MARGIN)
})

/* --- 19. Yeniden boyutlanma geri kelepçeler ---------------------------------- */

test('a shrinking viewport pulls a far-edge dock back into view', () => {
  const parked = dockOffsetToPosition({ left: 780, top: 530, viewport: VIEWPORT, dock: DOCK })
  assert.ok(isDockPosition(parked))

  const shrunk = { width: 480, height: 320 }
  const offset = dockPositionToOffset({ position: parked, viewport: shrunk, dock: DOCK })

  assert.ok(offset.left + DOCK.width <= shrunk.width - DOCK_EDGE_MARGIN + 1)
  assert.ok(offset.top + DOCK.height <= shrunk.height - DOCK_EDGE_MARGIN + 1)
  assert.ok(offset.left >= DOCK_EDGE_MARGIN)
  assert.ok(offset.top >= DOCK_EDGE_MARGIN)
})

test('the hook reclamps on window resize and on map-area resize', () => {
  assert.ok(HOOK.includes("window.addEventListener('resize'"))
  assert.ok(HOOK.includes("window.removeEventListener('resize'"))
  assert.ok(HOOK.includes('ResizeObserver'))
  assert.ok(HOOK.includes('observer?.disconnect()'))
})

/* --- 21 / 22 / 23. Depolama: doğrulanır, kelepçelenir, kırılmaz -------------- */

test('the stored preference is versioned and presentation-only', () => {
  assert.equal(DOCK_POSITION_STORAGE_KEY, 'map.transportDockPosition.v1')
})

test('a stored position is validated and then clamped to the current viewport', () => {
  const storage = fakeStorage({
    // Oran aralık dışı: hata değil, kelepçelenecek bir değerdir.
    [DOCK_POSITION_STORAGE_KEY]: JSON.stringify({ xRatio: 3.4, yRatio: -2 }),
  })

  const stored = readDockPosition(storage)
  assert.ok(isDockPosition(stored))

  const offset = dockPositionToOffset({ position: stored, viewport: VIEWPORT, dock: DOCK })
  assert.deepEqual(offset, {
    left: VIEWPORT.width - DOCK.width - DOCK_EDGE_MARGIN,
    top: DOCK_EDGE_MARGIN,
  })
})

test('invalid stored state falls back to the default position', () => {
  for (const raw of ['', 'not json', '{}', 'null', '[]', '{"xRatio":"0.5","yRatio":0.5}',
    '{"xRatio":null,"yRatio":0.5}', '{"left":10,"top":10}', JSON.stringify({ xRatio: Number.NaN, yRatio: 0.2 })]) {
    const storage = fakeStorage({ [DOCK_POSITION_STORAGE_KEY]: raw })
    assert.equal(readDockPosition(storage), null, `${raw} reddedilmeli`)
  }

  assert.equal(readDockPosition(null), null)
  assert.equal(readDockPosition(undefined), null)
})

test('a blocked localStorage breaks neither reading nor writing', () => {
  const blocked = {
    getItem() { throw new Error('SecurityError') },
    setItem() { throw new Error('SecurityError') },
    removeItem() { throw new Error('SecurityError') },
  }

  assert.equal(readDockPosition(blocked), null)
  assert.doesNotThrow(() => writeDockPosition(blocked, { xRatio: 0.5, yRatio: 0.5 }))
  assert.doesNotThrow(() => writeDockPosition(blocked, null))

  // Kanca da depolamaya erişimi korumalı okur.
  assert.match(HOOK, /try\s*\{\s*return window\.localStorage/)
})

test('writing then reading round-trips, and clearing removes the key', () => {
  const storage = fakeStorage()
  writeDockPosition(storage, { xRatio: 0.25, yRatio: 0.75 })
  assert.deepEqual(readDockPosition(storage), { xRatio: 0.25, yRatio: 0.75 })

  writeDockPosition(storage, null)
  assert.equal(storage.size, 0)
  assert.equal(readDockPosition(storage), null)
})

/* --- 24. Aç/kapa davranışı DEĞİŞMEDİ ---------------------------------------- */

test('expand/collapse remains the chevron button’s job, with its aria semantics', () => {
  assert.match(TOOLBAR, /className="draw-toolbar-handle"[\s\S]{0,200}aria-expanded=\{false\}/)
  assert.match(TOOLBAR, /aria-controls="draw-toolbar-panel"/)
  assert.match(TOOLBAR, /draw-toolbar-collapse"[\s\S]{0,200}aria-expanded/)
  // Katlama kararı hâlâ dışarıdan gelir; sürükleme onu hiç çağırmaz.
  assert.equal(HOOK.includes('Collapse'), false)
  assert.equal(HOOK.includes('collapsed'), false)
})

/* --- 25. Sürüklemek hiçbir iş kararına dokunmaz ------------------------------ */

test('dragging never watches, follows, selects or manages anything', () => {
  for (const forbidden of [
    'watch', 'Watch', 'follow', 'Follow', 'select', 'Select',
    'simulation', 'Simulation', 'route', 'Route', 'manage', 'Manage', 'fetch',
  ]) {
    assert.equal(HOOK.includes(forbidden), false, `${forbidden} sunum kancasında olmamalı`)
  }

  // Kanca yalnızca konum modülünü ve React'i tanır.
  const imports = [...HOOK.matchAll(/from '([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(imports.sort(), ['../map/dockPosition.js', 'react'])
})

test('the position module is presentation-only too', () => {
  const POSITION = stripComments(read('../../src/map/dockPosition.js'))
  assert.equal(/import\s/.test(POSITION), false, 'konum modülünün bağımlılığı yoktur')
  for (const forbidden of ['fetch', 'signalR', 'watch', 'follow', 'simulation']) {
    assert.equal(POSITION.includes(forbidden), false)
  }
})

/* --- 26. Duyarlı yerleşim: sayfa taşması yok -------------------------------- */

/**
 * Yalnızca BİLDİRİM gövdeleri.
 *
 * `[^{}]*` gövdesi, içinde başka bir blok TAŞIYAN at-rule'ları dışarıda
 * bırakır; dolayısıyla `@media (min-width: 1280px)` gibi bir MEDYA ÖZELLİĞİ
 * hiçbir zaman bir boyut bildirimi sanılamaz. Dosyanın tamamını genel bir
 * belirteç için taramak, tam olarak bu yanlış eşleşmeyi üretiyordu.
 */
const declarationRules = (css) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => ({
    selector: match[1].trim(),
    body: match[2],
  }))

const CSS_RULES = declarationRules(TOOLBAR_CSS)
const rulesFor = (selector) => CSS_RULES.filter((rule) => rule.selector === selector)

/** `max-width`/`min-width` DEĞİL, sabit `width` bildirimi. */
const declaresFixedWidth = (body) => /(^|[\s;])width:\s*\d/.test(body)

test('the dock container is bounded at its default and at every breakpoint', () => {
  const base = rulesFor('.draw-toolbar')
  assert.ok(base.length >= 1, '.draw-toolbar kuralı bulunmalı')
  assert.match(base[0].body, /max-width:\s*calc\(100% - 1\.5rem\)/)

  /* Panel kabı sabit bir genişliğe ÇİVİLENMEZ — ne varsayılanında ne de
     herhangi bir kırılma noktasında. Genişlik içeriğe ve kelepçeye aittir. */
  for (const rule of [...base, ...rulesFor('.draw-toolbar--collapsed')]) {
    assert.equal(declaresFixedWidth(rule.body), false, `${rule.selector} sabit genişlik dayatmamalı`)
  }
})

test('a placed dock stays bounded even where the base rule drops its max-width', () => {
  /* 640px altında temel kural `max-width: none` der ve panel sol/sağ kenara
     yaslanır. Taşınmış panelde `right: auto` olduğu için sınırı ARTIK bu kural
     taşır; olmasaydı yerleştirilmiş panel dar ekranda yatay taşma üretebilirdi. */
  const placed = rulesFor('.draw-toolbar.draw-toolbar--placed')
  assert.equal(placed.length, 1)
  assert.match(placed[0].body, /max-width:\s*calc\(100% - 1\.5rem\)/)
  assert.match(placed[0].body, /right:\s*auto/)
  assert.equal(declaresFixedWidth(placed[0].body), false)
})

test('no rule solves overflow with a large min-width or an overflow-x band-aid', () => {
  /* GERÇEK sözleşme: hiçbir bildirim, paneli ya da sayfayı dar ekranda
     zorlayacak büyüklükte bir asgari genişlik dayatmaz. Küçük dokunma
     hedefleri (28/40/44px) meşrudur ve bu eşiğin çok altındadır. */
  for (const rule of CSS_RULES) {
    for (const [, value] of rule.body.matchAll(/min-width:\s*(\d+)px/g)) {
      assert.ok(
        Number(value) < 100,
        `${rule.selector} içindeki min-width: ${value}px bir taşma çözümü olurdu`,
      )
    }
  }

  // Taşma gizlenerek de çözülmez.
  assert.equal(/overflow-x:\s*hidden/.test(TOOLBAR_CSS), false)
})

test('the drag handle is a small touch target, never a width driver', () => {
  /* İki kural: temel ve `pointer: coarse`. İkisi de erişilebilirlik asgarisi
     ölçeğindedir — bir yerleşim dayatması değil. */
  const handle = rulesFor('.draw-toolbar-drag')
  assert.equal(handle.length, 2)

  const widths = handle.map((rule) => {
    const found = rule.body.match(/min-width:\s*(\d+)px/)
    assert.ok(found, '.draw-toolbar-drag bir dokunma hedefi genişliği bildirmeli')
    return Number(found[1])
  })

  assert.deepEqual([...widths].sort((left, right) => left - right), [28, 44])
  for (const width of widths) assert.ok(width <= 48)

  // Büyük hedef DOKUNMATİĞE bağlıdır, her ekrana değil.
  assert.match(TOOLBAR_CSS, /@media \(pointer: coarse\)\s*\{[\s\S]*?\.draw-toolbar-drag\s*\{[^}]*min-width:\s*44px/)
})

test('the narrow breakpoint lets the dock wrap instead of overflowing', () => {
  const narrow = TOOLBAR_CSS.match(/@media \(max-width: 560px\)\s*\{([\s\S]*?)\n\}/)
  assert.ok(narrow, '560px kırılma noktası korunmalı')
  assert.match(narrow[1], /\.draw-toolbar\s*\{[^}]*flex-wrap:\s*wrap/)
})

/* --- Erişilebilirlik: sürükleme bir EKLENTİDİR ------------------------------- */

test('the panel stays operable without dragging: keyboard move and reset', () => {
  assert.ok(HOOK.includes('onKeyDown'))
  for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home']) {
    assert.ok(HOOK.includes(key), `${key} klavye desteği beklenir`)
  }
  // Varsayılana dönüş panele ayrı bir düğme EKLEMEZ.
  assert.equal(/Varsayılan Konuma Dön/.test(TOOLBAR), false)
})

test('no continuous animation is introduced on the dock', () => {
  assert.equal(/@keyframes/.test(TOOLBAR_CSS), false)
  assert.equal(/animation:/.test(TOOLBAR_CSS), false)
})
