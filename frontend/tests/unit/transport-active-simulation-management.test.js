import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  LIFECYCLE_OPERATIONS,
  activeSimulationManagement,
  activeSimulationRows,
  activeSimulationsPresentation,
  batchResultSummary,
  clearManagedRuns,
  eligibleLifecycleTargets,
  isLifecyclePending,
  lifecycleCapabilities,
  lifecycleIntent,
  lifecyclePendingKey,
  lifecycleRequestTargets,
  manageAllActiveRuns,
  managedRouteIdsOf,
  managedRunTargets,
  reconcileManagedRuns,
  toggleManagedRun,
  toggleWatchedRun,
  watchAllActiveRuns,
} from '../../src/map/activeSimulations.js'

/**
 * ÇOK HATLI paylaşılan simülasyon yönetimi (Faz 4B).
 *
 * Sınanan asıl ayrım BEŞ kavramın bağımsızlığıdır: AKTİF (sunucu gerçeği),
 * İZLENEN (haritada araç), SEÇİLİ (ayrıntı bağlamı), TAKİP EDİLEN (kamera) ve
 * YÖNETİLEN (toplu komut hedefi). Bunlardan birinin diğerini sessizce
 * sürüklemesi, kullanıcının hiç vermediği bir kararın uygulanması demektir —
 * ve bu fazda o karar canlı bir yayını herkes için bitirebilir.
 *
 * İkinci iddia KİMLİK GÜVENLİĞİDİR: yönetim seçimi de, dondurulmuş onay niyeti
 * de ÇALIŞTIRMA kimliğine bağlıdır; yerine geçen B, A için verilmiş hiçbir
 * kararı devralmaz.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const HOOK = stripComments(read('../../src/hooks/useTransportSimulation.js'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const API = stripComments(read('../../src/services/transportApi.js'))
const LIST = read('../../src/components/map/ActiveSimulationsList.jsx')
const BAR = stripComments(read('../../src/components/map/ActiveSimulationManagementBar.jsx'))
const CSS = read('../../src/components/map/JourneyPlanner.css')

const ROUTE_A = 1
const ROUTE_B = 2
const ROUTE_C = 3
const ROUTE_D = 4

const RUN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RUN_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const RUN_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
const RUN_D = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
const RUN_B2 = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2'

const state = (routeId, simulationId, status = 'Running', progressPercent = 20) => ({
  routeId,
  simulationId,
  status,
  longitude: 30,
  latitude: 40,
  progressPercent,
  updatedAtUtc: '2026-09-01T10:00:00Z',
})

/** A çalışıyor, B duraklatılmış, C çalışıyor, D çalışıyor. */
const seed = () => ({
  [ROUTE_A]: state(ROUTE_A, RUN_A),
  [ROUTE_B]: state(ROUTE_B, RUN_B, 'Paused'),
  [ROUTE_C]: state(ROUTE_C, RUN_C),
  [ROUTE_D]: state(ROUTE_D, RUN_D),
})

const routes = [
  { id: ROUTE_A, name: 'A Hattı', colorHex: '#111111' },
  { id: ROUTE_B, name: 'B Hattı', colorHex: '#222222' },
  { id: ROUTE_C, name: 'C Hattı', colorHex: '#333333' },
  { id: ROUTE_D, name: 'D Hattı', colorHex: '#444444' },
]

const OPERATOR = { canStart: false, canStop: true }
const FULL = { canStart: true, canStop: true }

/* --- 1-10. YÖNETİM DURUMU ------------------------------------------------------ */

test('management selection stores routeId -> simulationId and holds several runs', () => {
  let managed = {}
  managed = toggleManagedRun(managed, { routeId: ROUTE_B, simulationId: RUN_B })
  managed = toggleManagedRun(managed, { routeId: ROUTE_C, simulationId: RUN_C })

  // Anahtar ROTA, değer ÇALIŞTIRMA: rota tek başına bir seçim DEĞİLDİR.
  assert.deepEqual(managed, { [ROUTE_B]: RUN_B, [ROUTE_C]: RUN_C })
  assert.deepEqual(managedRouteIdsOf(managed), [ROUTE_B, ROUTE_C])

  // Kimliksiz bir seçim KURULAMAZ.
  assert.deepEqual(toggleManagedRun({}, { routeId: ROUTE_A, simulationId: null }), {})
  assert.deepEqual(toggleManagedRun({}, { routeId: null, simulationId: RUN_A }), {})

  // Aynı satıra ikinci tıklama seçimi KALDIRIR.
  managed = toggleManagedRun(managed, { routeId: ROUTE_B, simulationId: RUN_B })
  assert.deepEqual(managed, { [ROUTE_C]: RUN_C })
})

test('managing does not watch, follow or select — and neither does the reverse', () => {
  const byRoute = seed()

  const managed = toggleManagedRun({}, { routeId: ROUTE_C, simulationId: RUN_C })
  const watched = toggleWatchedRun({}, { routeId: ROUTE_A, simulationId: RUN_A })

  /* İki kutu AYRI: yönetim seçimi izleme kaydını üretmez, izleme de yönetim
     seçimi üretmez. Aynı biçimi paylaşmaları onları aynı kavram yapmaz. */
  assert.deepEqual(watched, { [ROUTE_A]: RUN_A })
  assert.deepEqual(managed, { [ROUTE_C]: RUN_C })

  const presentation = activeSimulationsPresentation({
    byRoute,
    routes,
    watchedRuns: watched,
    managedRuns: managed,
    selectedRouteId: ROUTE_B,
    followedRouteId: ROUTE_A,
    loaded: true,
    ...OPERATOR,
  })

  const row = (routeId) => presentation.rows.find((item) => item.routeId === routeId)

  // A: işaretçi + kamera, ama YÖNETİLMİYOR.
  assert.equal(row(ROUTE_A).isWatched, true)
  assert.equal(row(ROUTE_A).isFollowed, true)
  assert.equal(row(ROUTE_A).isManaged, false)

  // B: seçili ve duraklatılmış, ama izlenmiyor ve yönetilmiyor.
  assert.equal(row(ROUTE_B).isSelected, true)
  assert.equal(row(ROUTE_B).isManaged, false)
  assert.equal(row(ROUTE_B).isWatched, false)

  // C: YÖNETİLİYOR ama haritada HİÇ görünmüyor.
  assert.equal(row(ROUTE_C).isManaged, true)
  assert.equal(row(ROUTE_C).isWatched, false)
  assert.equal(row(ROUTE_C).isFollowed, false)
  assert.equal(row(ROUTE_C).isSelected, false)
})

test('a replacement run never inherits the management selection of the run it replaced', () => {
  const managed = { [ROUTE_B]: RUN_B }

  // B biter, AYNI hatta B2 başlar.
  const byRoute = { ...seed(), [ROUTE_B]: state(ROUTE_B, RUN_B2, 'Running', 0) }

  // Bayat kayıt HEDEFE dönüşmez.
  assert.deepEqual(managedRunTargets(managed, byRoute), [])

  // Ve uzlaştırma onu düşürür: B2 seçimi DEVRALMAZ.
  assert.deepEqual(reconcileManagedRuns(managed, byRoute), {})

  const rows = activeSimulationRows({
    byRoute,
    routes,
    managedRuns: managed,
    capabilities: lifecycleCapabilities(OPERATOR),
  })

  assert.equal(rows.find((row) => row.routeId === ROUTE_B).isManaged, false)
})

test('a terminal run drops out of the management selection', () => {
  const managed = { [ROUTE_A]: RUN_A, [ROUTE_C]: RUN_C }
  const byRoute = { ...seed(), [ROUTE_A]: state(ROUTE_A, RUN_A, 'Cancelled') }

  assert.deepEqual(reconcileManagedRuns(managed, byRoute), { [ROUTE_C]: RUN_C })

  // Değişiklik yoksa AYNI referans döner: gereksiz render tetiklenmez.
  const stable = { [ROUTE_C]: RUN_C }
  assert.equal(reconcileManagedRuns(stable, byRoute), stable)
})

/* --- 11-14. AKTİFLERİ SEÇ / SEÇİMİ TEMİZLE / ARAMA ----------------------------- */

test('"Aktifleri Seç" covers only the runs that are active right now', () => {
  const byRoute = { [ROUTE_A]: state(ROUTE_A, RUN_A), [ROUTE_B]: state(ROUTE_B, RUN_B, 'Paused') }

  const managed = manageAllActiveRuns(byRoute)
  assert.deepEqual(managed, { [ROUTE_A]: RUN_A, [ROUTE_B]: RUN_B })

  // SONRADAN başlayan D kendiliğinden seçime GİRMEZ.
  const later = { ...byRoute, [ROUTE_D]: state(ROUTE_D, RUN_D) }
  assert.deepEqual(reconcileManagedRuns(managed, later), { [ROUTE_A]: RUN_A, [ROUTE_B]: RUN_B })
  assert.equal(managedRunTargets(managed, later).length, 2)

  // Terminal çalıştırma "aktif" sayılmaz.
  assert.deepEqual(manageAllActiveRuns({ [ROUTE_A]: state(ROUTE_A, RUN_A, 'Completed') }), {})

  /* AKTİFLERİ SEÇ ile TÜMÜNÜ İZLE aynı veriyi üretse de AYRI kutulara yazar:
     biri komut hedefi, diğeri harita işaretçisidir. */
  assert.deepEqual(watchAllActiveRuns(byRoute), managed)
})

test('"Seçimi Temizle" clears management only', () => {
  const watched = { [ROUTE_A]: RUN_A }
  assert.deepEqual(clearManagedRuns(), {})
  // İzleme kutusuna DOKUNULMAZ: temizleme yalnızca kendi kutusunu boşaltır.
  assert.deepEqual(watched, { [ROUTE_A]: RUN_A })
})

test('search filters only what is drawn and never the management selection', () => {
  const byRoute = seed()
  const managed = { [ROUTE_A]: RUN_A, [ROUTE_C]: RUN_C }

  const presentation = activeSimulationsPresentation({
    byRoute,
    routes,
    managedRuns: managed,
    search: 'C Hattı',
    loaded: true,
    ...OPERATOR,
  })

  // Yalnızca C çizilir…
  assert.equal(presentation.visibleCount, 1)
  assert.equal(presentation.totalCount, 4)

  // …ama gizlenen A HÂLÂ yönetim seçimindedir ve komut hedefidir.
  assert.equal(presentation.management.managedCount, 2)
  assert.deepEqual(
    eligibleLifecycleTargets(LIFECYCLE_OPERATIONS.PAUSE, { managedRuns: managed, byRoute })
      .map((target) => target.routeId),
    [ROUTE_A, ROUTE_C],
  )
})

/* --- 15-20. YETKİ -------------------------------------------------------------- */

test('a view-only user sees no management surface at all', () => {
  const presentation = activeSimulationsPresentation({
    byRoute: seed(),
    routes,
    managedRuns: { [ROUTE_A]: RUN_A },
    loaded: true,
    canStart: false,
    canStop: false,
  })

  assert.equal(presentation.management.canManage, false)
  assert.equal(presentation.management.actions.length, 0)
  assert.equal(presentation.management.managedCount, 0)
  assert.equal(presentation.management.hasSelection, false)

  /* Satırda yaşam döngüsü alanları HİÇ VAR OLMAZ — `false` bile değildir.
     "Gizlenmiş bir eylem" ile "olmayan bir eylem" farklı şeylerdir. */
  const keys = Object.keys(presentation.rows[0])
  for (const forbidden of ['showPause', 'showResume', 'showReset', 'showRestart']) {
    assert.ok(!keys.includes(forbidden), `izleyicinin satırında yaşam döngüsü: ${forbidden}`)
  }
  assert.equal(presentation.rows[0].canManage, false)
  assert.equal(presentation.rows[0].isManaged, false)

  // İzleme denetimleri KORUNUR: Faz 4A davranışı bozulmadı.
  assert.equal(presentation.rows[0].watchLabel, 'İzle')
  assert.equal(presentation.canWatchAll, true)
})

test('lifecycle capabilities come only from effective permission codes', () => {
  assert.deepEqual(lifecycleCapabilities({ canStart: false, canStop: false }), {
    canManage: false, canPause: false, canResume: false, canReset: false, canRestart: false,
  })

  // YALNIZCA DURDURMA: duraklat/sürdür/sıfırla açılır, yeniden başlat AÇILMAZ.
  assert.deepEqual(lifecycleCapabilities(OPERATOR), {
    canManage: true, canPause: true, canResume: true, canReset: true, canRestart: false,
  })

  /* YALNIZCA BAŞLATMA: hiçbir yönetim denetimi açılmaz. Başlatabilmek,
     başkalarının çalıştırmalarına dokunma yetkisi DEĞİLDİR. */
  assert.deepEqual(lifecycleCapabilities({ canStart: true, canStop: false }), {
    canManage: false, canPause: false, canResume: false, canReset: false, canRestart: false,
  })

  // İKİSİ birden: yeniden başlatma açılır.
  assert.equal(lifecycleCapabilities(FULL).canRestart, true)
})

test('a stop-only operator sees pause, resume and reset but never restart', () => {
  const managed = { [ROUTE_A]: RUN_A, [ROUTE_B]: RUN_B }

  const operator = activeSimulationManagement({
    byRoute: seed(),
    managedRuns: managed,
    capabilities: lifecycleCapabilities(OPERATOR),
  })

  assert.deepEqual(
    operator.actions.map((action) => action.operation),
    [LIFECYCLE_OPERATIONS.PAUSE, LIFECYCLE_OPERATIONS.RESUME, LIFECYCLE_OPERATIONS.RESET],
  )

  const full = activeSimulationManagement({
    byRoute: seed(),
    managedRuns: managed,
    capabilities: lifecycleCapabilities(FULL),
  })

  assert.deepEqual(
    full.actions.map((action) => action.operation),
    [
      LIFECYCLE_OPERATIONS.PAUSE,
      LIFECYCLE_OPERATIONS.RESUME,
      LIFECYCLE_OPERATIONS.RESET,
      LIFECYCLE_OPERATIONS.RESTART,
    ],
  )
})

test('no source in the management path reads a role name', () => {
  for (const [label, source] of [
    ['saf modül', read('../../src/map/activeSimulations.js')],
    ['liste', LIST],
    ['yönetim çubuğu', read('../../src/components/map/ActiveSimulationManagementBar.jsx')],
    ['kanca', HOOK],
  ]) {
    for (const forbidden of ['isAdmin', 'isOperator', 'roleName', 'userName', "'Admin'"]) {
      assert.ok(!source.includes(forbidden), `${label} rol adına dayanıyor: ${forbidden}`)
    }
  }
})

test('the rendered management surface matches the permission matrix exactly', () => {
  const byRoute = seed()
  // A çalışıyor, B duraklatılmış: hem Duraklat hem Devam Ettir uygun olur.
  const managedRuns = { [ROUTE_A]: RUN_A, [ROUTE_B]: RUN_B }

  const surfaceFor = (permissions) => {
    const presentation = activeSimulationsPresentation({
      byRoute, routes, managedRuns, loaded: true, ...permissions,
    })

    return {
      checkbox: presentation.rows[0].canManage,
      operations: presentation.management.actions.map((action) => action.operation),
    }
  }

  // SALT İZLEYİCİ: yönetim yüzeyi YOKTUR.
  assert.deepEqual(surfaceFor({ canStart: false, canStop: false }), {
    checkbox: false, operations: [],
  })

  /* YALNIZCA BAŞLATMA: yine yönetim yüzeyi YOKTUR. Başlatabilmek, başkalarının
     çalıştırmalarına dokunma yetkisi DEĞİLDİR. */
  assert.deepEqual(surfaceFor({ canStart: true, canStop: false }), {
    checkbox: false, operations: [],
  })

  // YALNIZCA DURDURMA: kutu + duraklat/sürdür/sıfırla, ama YENİDEN BAŞLAT YOK.
  assert.deepEqual(surfaceFor(OPERATOR), {
    checkbox: true,
    operations: [
      LIFECYCLE_OPERATIONS.PAUSE,
      LIFECYCLE_OPERATIONS.RESUME,
      LIFECYCLE_OPERATIONS.RESET,
    ],
  })

  // İKİSİ BİRDEN: yeniden başlatma da açılır.
  assert.deepEqual(surfaceFor(FULL), {
    checkbox: true,
    operations: [
      LIFECYCLE_OPERATIONS.PAUSE,
      LIFECYCLE_OPERATIONS.RESUME,
      LIFECYCLE_OPERATIONS.RESET,
      LIFECYCLE_OPERATIONS.RESTART,
    ],
  })
})

test('the watch toolbar stays separate from the management surface', () => {
  const byRoute = seed()

  const presentation = activeSimulationsPresentation({
    byRoute, routes, managedRuns: { [ROUTE_A]: RUN_A }, loaded: true, ...FULL,
  })

  /* İZLEME sayaçları ile YÖNETİM sayaçları AYRI dallardır: bir hattı yönetim
     için seçmek "Tümünü İzle"yi kapatmaz, "İzlemeyi Temizle"yi açmaz. */
  assert.equal(presentation.canWatchAll, true)
  assert.equal(presentation.canClearWatch, false)
  assert.equal(presentation.watchedCount, 0)
  assert.equal(presentation.management.managedCount, 1)

  // Ve arayüzde de iki ayrı bloktur.
  assert.match(LIST, /className="journey-active-bulk"/)
  assert.match(LIST, /<ActiveSimulationManagementBar/)
  assert.ok(!BAR.includes('Tümünü İzle'))
  assert.ok(!BAR.includes('İzlemeyi Temizle'))
})

/* --- 21-27. UYGUNLUK ----------------------------------------------------------- */

test('mixed selections send each command only where it applies', () => {
  const byRoute = seed()
  // A çalışıyor, B duraklatılmış, C çalışıyor.
  const managed = { [ROUTE_A]: RUN_A, [ROUTE_B]: RUN_B, [ROUTE_C]: RUN_C }

  const ids = (operation) =>
    eligibleLifecycleTargets(operation, { managedRuns: managed, byRoute }).map((t) => t.routeId)

  assert.deepEqual(ids(LIFECYCLE_OPERATIONS.PAUSE), [ROUTE_A, ROUTE_C])
  assert.deepEqual(ids(LIFECYCLE_OPERATIONS.RESUME), [ROUTE_B])
  assert.deepEqual(ids(LIFECYCLE_OPERATIONS.RESET), [ROUTE_A, ROUTE_B, ROUTE_C])
  assert.deepEqual(ids(LIFECYCLE_OPERATIONS.RESTART), [ROUTE_A, ROUTE_B, ROUTE_C])

  const management = activeSimulationManagement({
    byRoute,
    managedRuns: managed,
    capabilities: lifecycleCapabilities(FULL),
  })

  // Etiket UYGUN hedef sayısını taşır; seçimin büyüklüğünü değil.
  const action = (operation) => management.actions.find((item) => item.operation === operation)
  assert.equal(action(LIFECYCLE_OPERATIONS.PAUSE).label, 'Duraklat (2)')
  assert.equal(action(LIFECYCLE_OPERATIONS.RESUME).label, 'Devam Ettir (1)')
  assert.equal(action(LIFECYCLE_OPERATIONS.RESET).label, 'Sıfırla (3)')
  assert.equal(management.managedCount, 3)
  assert.equal(management.selectionLabel, 'Seçili: 3')
  assert.equal(management.hasSelection, true)
})

test('an action with zero eligible targets is not rendered at all', () => {
  const byRoute = { [ROUTE_B]: state(ROUTE_B, RUN_B, 'Paused') }
  const managed = { [ROUTE_B]: RUN_B }

  const management = activeSimulationManagement({
    byRoute,
    managedRuns: managed,
    capabilities: lifecycleCapabilities(FULL),
  })

  /* YOKLUK, KAPALILIKTAN daha sakin ve daha dürüsttür. Duraklatılmış tek bir
     seçimde "Duraklat (0)" taşıyan kapalı bir düğme, dar panelde gerçek
     komutlarla aynı yeri paylaşan ve asla basılamayacak bir gürültüydü. */
  const operations = management.actions.map((item) => item.operation)
  assert.ok(!operations.includes(LIFECYCLE_OPERATIONS.PAUSE))
  assert.deepEqual(operations, [
    LIFECYCLE_OPERATIONS.RESUME,
    LIFECYCLE_OPERATIONS.RESET,
    LIFECYCLE_OPERATIONS.RESTART,
  ])

  // Hiçbir etiket "(0)" taşımaz.
  for (const action of management.actions) {
    assert.ok(action.count > 0)
    assert.ok(!action.label.includes('(0)'), `sıfır sayaçlı komut çizildi: ${action.label}`)
  }

  // Uygun hedef yoksa niyet KURULAMAZ: kaçınılabilir bir hata istenmez.
  assert.equal(lifecycleIntent(LIFECYCLE_OPERATIONS.PAUSE, { managedRuns: managed, byRoute }), null)
  assert.notEqual(lifecycleIntent(LIFECYCLE_OPERATIONS.RESUME, { managedRuns: managed, byRoute }), null)
})

test('zero managed runs show no lifecycle command block at all', () => {
  const byRoute = seed()

  const management = activeSimulationManagement({
    byRoute,
    managedRuns: {},
    capabilities: lifecycleCapabilities(FULL),
    totalActiveCount: 4,
  })

  /* Seçim yokken panel dört yıkıcı düğme TAŞIMAZ. Gösterilecek tek anlamlı
     şey, seçim yapmanın kısa yoludur. */
  assert.equal(management.canManage, true)
  assert.equal(management.hasSelection, false)
  assert.equal(management.managedCount, 0)
  assert.deepEqual(management.actions, [])
  assert.equal(management.canSelectAllActive, true)
  assert.equal(management.canClearManaged, false)
})

test('the bar renders the idle shortcut when nothing is selected and the action bar when something is', () => {
  /* Bileşen İKİ HÂLLİDİR ve ayrım sunum modelinden okunur; ikinci bir kural
     kitabı tutulmaz. */
  assert.match(BAR, /if \(!management\.hasSelection\)/)
  assert.match(BAR, /is-idle/)
  assert.match(BAR, /\{management\.selectionLabel\}/)

  // Boş listede kısa yol bile çizilmez: olmayan bir işi vaat etmez.
  assert.match(BAR, /if \(!management\.canSelectAllActive\) return null/)

  // Komutlar YALNIZCA seçim varken ve yalnızca üretilmiş olanlar çizilir.
  assert.match(BAR, /management\.actions\.map\(/)
  assert.ok(!BAR.includes('action.disabled'))
})

/* --- 28-31. KİMLİK VE DONDURULMUŞ NİYET ---------------------------------------- */

test('the request payload carries exact routeId and simulationId pairs', () => {
  const byRoute = seed()
  const intent = lifecycleIntent(LIFECYCLE_OPERATIONS.RESET, {
    managedRuns: { [ROUTE_A]: RUN_A, [ROUTE_C]: RUN_C },
    byRoute,
  })

  assert.deepEqual(lifecycleRequestTargets(intent), [
    { routeId: ROUTE_A, simulationId: RUN_A },
    { routeId: ROUTE_C, simulationId: RUN_C },
  ])

  // Gövde yalnızca rota TAŞIMAZ: "şu hatta ne varsa" bir hedef değildir.
  for (const target of lifecycleRequestTargets(intent)) {
    assert.equal(typeof target.simulationId, 'string')
    assert.ok(target.simulationId.length > 0)
  }
})

test('a stale confirmation keeps targeting the frozen run and never the replacement', () => {
  const byRoute = seed()

  // 1-3. A yönetimde; onay açılır ve niyet DONDURULUR.
  const intent = lifecycleIntent(LIFECYCLE_OPERATIONS.RESET, {
    managedRuns: { [ROUTE_A]: RUN_A },
    byRoute,
  })
  assert.deepEqual(intent.targets, [{ routeId: ROUTE_A, simulationId: RUN_A }])

  // 4. Onay beklerken A biter ve AYNI hatta yeni bir çalıştırma başlar.
  const replaced = { ...byRoute, [ROUTE_A]: state(ROUTE_A, RUN_B2, 'Running', 0) }

  /* 5-6. Eski diyalog onaylanır: gövde HÂLÂ A'yı taşır. Hedefler onay anında
     yeniden hesaplansaydı, kullanıcının A için verdiği karar sessizce yeni
     çalıştırmaya uygulanırdı. */
  assert.deepEqual(lifecycleRequestTargets(intent), [{ routeId: ROUTE_A, simulationId: RUN_A }])

  /* 7. Yeni çalıştırma hedeflenmiş DEĞİLDİR ve o an yeniden hesaplansaydı
     hedeflenirdi — fark tam olarak budur. */
  const recomputed = lifecycleIntent(LIFECYCLE_OPERATIONS.RESET, {
    managedRuns: { [ROUTE_A]: RUN_A },
    byRoute: replaced,
  })
  assert.equal(recomputed, null)
  assert.notEqual(lifecycleRequestTargets(intent)[0].simulationId, RUN_B2)

  // Niyet DONMUŞTUR: değiştirilemez.
  assert.throws(() => {
    intent.targets.push({ routeId: ROUTE_D, simulationId: RUN_D })
  })
})

/* --- 32-35. UÇUŞ HALİ ---------------------------------------------------------- */

test('pending state is scoped to run and action, never a single global flag', () => {
  const target = { routeId: ROUTE_A, simulationId: RUN_A }
  const key = lifecyclePendingKey({ ...target, operation: LIFECYCLE_OPERATIONS.PAUSE })

  assert.equal(key, `${ROUTE_A}:${RUN_A}:pause`)
  assert.equal(lifecyclePendingKey({ routeId: ROUTE_A, simulationId: null, operation: 'pause' }), null)

  const pending = { [key]: true }

  // AYNI komut ikinci kez gönderilemez…
  assert.equal(isLifecyclePending(pending, target, LIFECYCLE_OPERATIONS.PAUSE), true)

  // …ama aynı çalıştırmanın BAŞKA komutu ve BAŞKA hatlar serbesttir.
  assert.equal(isLifecyclePending(pending, target, LIFECYCLE_OPERATIONS.RESET), false)
  assert.equal(
    isLifecyclePending(pending, { routeId: ROUTE_C, simulationId: RUN_C }, LIFECYCLE_OPERATIONS.PAUSE),
    false,
  )
})

test('a busy command marks only its own row and its own action', () => {
  const byRoute = seed()
  const pending = { [`${ROUTE_A}:${RUN_A}:pause`]: true }

  const rows = activeSimulationRows({
    byRoute,
    routes,
    managedRuns: { [ROUTE_A]: RUN_A, [ROUTE_C]: RUN_C },
    capabilities: lifecycleCapabilities(OPERATOR),
    pending,
  })

  const row = (routeId) => rows.find((item) => item.routeId === routeId)

  /* Satır KOMUT TAŞIMAZ; yalnızca bu çalıştırmaya ait bir komutun YOLDA
     olduğunu bildirir — onay kutusu o sırada kilitlenir. */
  assert.equal(row(ROUTE_A).isBusy, true)
  // İLGİSİZ hat kullanılabilir kalır: küresel bir kilit YOKTUR.
  assert.equal(row(ROUTE_C).isBusy, false)

  const management = activeSimulationManagement({
    byRoute,
    managedRuns: { [ROUTE_A]: RUN_A, [ROUTE_C]: RUN_C },
    capabilities: lifecycleCapabilities(OPERATOR),
    pending,
  })

  const pause = management.actions.find((item) => item.operation === LIFECYCLE_OPERATIONS.PAUSE)
  const reset = management.actions.find((item) => item.operation === LIFECYCLE_OPERATIONS.RESET)

  assert.equal(pause.busy, true)
  // Başka bir işlem AYNI seçim üzerinde hâlâ çalıştırılabilir.
  assert.equal(reset.busy, false)
})

test('the hook keeps pending state per run and action and guards double submits', () => {
  // Küresel bir mutasyon bayrağı YOKTUR.
  assert.ok(!HOOK.includes('isMutating'))
  assert.ok(!HOOK.includes('setBatching('))

  assert.match(HOOK, /lifecyclePendingRef/)
  assert.match(HOOK, /withLifecyclePending\(/)

  /* Çift gönderim REF ile kapatılır: state güncellemesini beklemek, hızlı iki
     tıklamada ikinci isteğin yola çıkmasına izin verirdi. */
  assert.match(HOOK, /isLifecyclePending\(\s*lifecyclePendingRef\.current/)
  assert.match(HOOK, /if \(fresh\.length === 0\) return null/)
})

/* --- 36-53. KOMUT SONUÇLARI VE KISMİ BAŞARI ------------------------------------ */

test('a partial batch is reported honestly and never as a full success', () => {
  const payload = {
    results: [
      { requestedRouteId: ROUTE_A, requestedSimulationId: RUN_A, succeeded: true, resultCode: 'Succeeded' },
      { requestedRouteId: ROUTE_B, requestedSimulationId: RUN_B, succeeded: false, resultCode: 'Stale' },
      { requestedRouteId: ROUTE_C, requestedSimulationId: RUN_C, succeeded: true, resultCode: 'Succeeded' },
    ],
  }

  const summary = batchResultSummary(LIFECYCLE_OPERATIONS.PAUSE, payload)

  assert.equal(summary.total, 3)
  assert.equal(summary.succeeded, 2)
  assert.equal(summary.failed, 1)
  assert.equal(summary.stale, 1)
  assert.equal(summary.isPartial, true)

  assert.match(summary.message, /3 işlemden 2'si tamamlandı\./)
  assert.match(summary.message, /1 işlem artık güncel olmadığı için uygulanmadı\./)

  // Başarısız hedef GÖRÜNÜR kalır ama yıkıcı bir şey ima etmez.
  assert.deepEqual(summary.failedTargets, [
    { routeId: ROUTE_B, simulationId: RUN_B, resultCode: 'Stale' },
  ])

  // Ham JSON, stack trace ya da iç istisna metni KULLANICIYA çıkmaz.
  assert.ok(!summary.message.includes('{'))
  assert.ok(!summary.message.includes(RUN_B))
})

test('a fully successful batch says so plainly', () => {
  const summary = batchResultSummary(LIFECYCLE_OPERATIONS.RESTART, {
    results: [
      { requestedRouteId: ROUTE_A, succeeded: true, resultCode: 'Succeeded' },
      { requestedRouteId: ROUTE_C, succeeded: true, resultCode: 'Succeeded' },
    ],
  })

  assert.equal(summary.isPartial, false)
  assert.equal(summary.failed, 0)
  assert.match(summary.message, /Yeniden başlatma tamamlandı \(2\)\./)
})

test('the hook applies only authoritative updates and applies the terminal one first', () => {
  const body = HOOK.slice(
    HOOK.indexOf('const runLifecycleBatch'),
    HOOK.indexOf('const managedRouteIds'),
  )

  /* Sıra kritiktir: yeniden başlatmada ÖNCE eski çalıştırmanın terminali,
     SONRA yeni çalıştırma. Ters sıra, biten çalıştırmanın yerine geçeni
     ezmesine kapı aralardı. */
  const updateIndex = body.indexOf('result.update')
  const simulationIndex = body.indexOf('result.simulation')
  assert.ok(updateIndex > -1 && simulationIndex > updateIndex)

  // Durum UYDURULMAZ: yerel bir "durdu"/"başladı" yazılmaz.
  assert.match(body, /normalizeLiveUpdate\(result\.update\)/)
  assert.match(body, /normalizeStatusSnapshot\(result\.simulation\)/)
  assert.ok(!body.includes("status: 'Cancelled'"))
  assert.ok(!body.includes("status: 'Running'"))

  // Hedefler onay anında YENİDEN HESAPLANMAZ.
  assert.match(body, /lifecycleRequestTargets\(intent\)/)
  assert.ok(!body.includes('eligibleLifecycleTargets'))
})

/* --- 44-50. YENİDEN BAŞLATMADAN SONRA ------------------------------------------ */

test('a new run inherits neither watch, follow nor management from the run it replaced', () => {
  const watched = { [ROUTE_A]: RUN_A }
  const managed = { [ROUTE_A]: RUN_A }

  // A yeniden başlatıldı: YENİ kimlik, %0.
  const byRoute = { ...seed(), [ROUTE_A]: state(ROUTE_A, RUN_B2, 'Running', 0) }

  const presentation = activeSimulationsPresentation({
    byRoute,
    routes,
    watchedRuns: watched,
    managedRuns: managed,
    // Seçili rota AYNI kalabilir: seçim bir ROTA bağlamıdır.
    selectedRouteId: ROUTE_A,
    followedRouteId: null,
    loaded: true,
    ...FULL,
  })

  const row = presentation.rows.find((item) => item.routeId === ROUTE_A)

  assert.equal(row.simulationId, RUN_B2)
  assert.equal(row.progressPercent, 0)
  assert.equal(row.progressLabel, '%0')

  // Hiçbir karar DEVRALINMADI.
  assert.equal(row.isWatched, false)
  assert.equal(row.isFollowed, false)
  assert.equal(row.isManaged, false)

  // Ama SEÇİM korunur: hat bağlamı kullanıcıdan alınmaz.
  assert.equal(row.isSelected, true)

  // Ve eski çalıştırma artık hiçbir yerde GÜNCEL değildir.
  assert.equal(presentation.rows.filter((item) => item.simulationId === RUN_A).length, 0)
})

/* --- 54-56. İZLEME / YÖNETİM BAĞIMSIZLIĞI -------------------------------------- */

test('watched A and B with managed B and C: the command touches only B and C', () => {
  const byRoute = seed()
  const watched = { [ROUTE_A]: RUN_A, [ROUTE_B]: RUN_B }
  const managed = { [ROUTE_B]: RUN_B, [ROUTE_C]: RUN_C }

  const intent = lifecycleIntent(LIFECYCLE_OPERATIONS.RESET, { managedRuns: managed, byRoute })

  // A hedeflenmez: izlemek yönetmek DEĞİLDİR.
  assert.deepEqual(lifecycleRequestTargets(intent), [
    { routeId: ROUTE_B, simulationId: RUN_B },
    { routeId: ROUTE_C, simulationId: RUN_C },
  ])

  const presentation = activeSimulationsPresentation({
    byRoute, routes, watchedRuns: watched, managedRuns: managed, loaded: true, ...OPERATOR,
  })

  const row = (routeId) => presentation.rows.find((item) => item.routeId === routeId)

  // B: hem işaretçi var hem yönetiliyor; duraklatılmış olduğu için donuk.
  assert.equal(row(ROUTE_B).isWatched, true)
  assert.equal(row(ROUTE_B).isManaged, true)
  assert.equal(row(ROUTE_B).isPaused, true)

  // C: HİÇ işaretçisi yok ama yaşam döngüsü komutu uygulanabilir.
  assert.equal(row(ROUTE_C).isWatched, false)
  assert.equal(row(ROUTE_C).isManaged, true)

  /* UYGUNLUK SATIRDA DEĞİL, SEÇİMDE hesaplanır: B duraklatılmış olduğu için
     yalnızca Devam Ettir'e, C çalıştığı için yalnızca Duraklat'a girer. */
  const management = activeSimulationManagement({
    byRoute, managedRuns: managed, capabilities: lifecycleCapabilities(OPERATOR),
  })
  const counts = Object.fromEntries(
    management.actions.map((action) => [action.operation, action.count]),
  )
  assert.deepEqual(counts, { pause: 1, resume: 1, reset: 2 })
})

/* --- 57-61. CANLI KANAL VE KEŞİF ----------------------------------------------- */

test('the batch surface adds no hub, no second connection and no polling', () => {
  // Komutlar HTTP'dir; canlı gerçek mevcut tek bağlantıdan gelir.
  assert.equal((HOOK.match(/createTransportSimulationHubClient\(\{/g) ?? []).length, 1)
  assert.ok(!HOOK.includes('HubConnectionBuilder'))
  assert.ok(!MAP_PAGE.includes('createTransportSimulationHubClient'))

  for (const forbidden of ['setInterval', 'setTimeout', 'requestAnimationFrame']) {
    assert.ok(!HOOK.includes(forbidden), `kancada yoklama izi: ${forbidden}`)
  }

  // Faz 4A keşif mimarisi AYNEN durur.
  assert.match(HOOK, /fetchActiveTransportSimulations\(\)/)
  assert.match(HOOK, /onActiveSetChanged: \(\) => requestActiveRefreshRef\.current\?\.\(\)/)

  /* MANTIKSAL sahiplik ile FİZİKSEL üyelik AYRI kalır: bu ayrım Faz 4A'da
     bilinçle kuruldu ve toplu komutlar ona hiç dokunmaz. */
  const CLIENT = stripComments(read('../../src/services/transportSimulationClient.js'))
  assert.match(CLIENT, /joinedRoutes/)
  assert.match(CLIENT, /subscribedRoutes/)
  assert.ok(!CLIENT.includes('managedRuns'))
  assert.ok(!CLIENT.includes('lifecyclePending'))
})

test('the api client reuses authFetch and sends both identities per target', () => {
  for (const action of ['pause', 'resume', 'reset', 'restart']) {
    assert.ok(
      API.includes(`/api/transport/simulations/batch/${action}`)
      || API.includes('/api/transport/simulations/batch/${action}'),
      `toplu uç eksik: ${action}`,
    )
  }

  assert.match(API, /authFetch\(`\/api\/transport\/simulations\/batch\/\$\{action\}`/)
  assert.match(API, /body: JSON\.stringify\(\{ targets \}\)/)

  // İkinci bir fetch sarmalayıcı ya da hata okuyucu AÇILMADI.
  assert.equal((API.match(/from '\.\/api\.js'/g) ?? []).length, 1)
  assert.ok(!API.includes('new Headers('))
  assert.ok(!API.includes('window.fetch'))
})

/* --- 62-64. ARAYÜZ VE DUYARLILIK ------------------------------------------------ */

test('the row carries exactly three independent controls and no lifecycle commands', () => {
  // Yönetim onay kutusu bir KUTUDUR ve İzle düğmesinden ayrılır.
  assert.match(LIST, /type="checkbox"/)
  assert.match(LIST, /className="journey-active-manage"/)
  assert.match(LIST, /className=\{`journey-active-watch/)
  assert.match(LIST, /className="journey-active-select"/)

  // Kutuya tıklamak satırı SEÇMEZ: olay yayılımı durdurulur.
  assert.match(LIST, /onClick=\{\(event\) => event\.stopPropagation\(\)\}/)

  // Üç eylem, üç ayrı geri çağırma.
  assert.match(LIST, /onSelectRoute\?\.\(row\.routeId\)/)
  assert.match(LIST, /onToggleWatch\?\.\(row\.routeId\)/)
  assert.match(LIST, /onToggleManaged\?\.\(row\.routeId\)/)

  /* SATIR ARTIK BİR ARAÇ ÇUBUĞU DEĞİLDİR. Her satıra üç yaşam döngüsü düğmesi
     koymak, dar harita panelinde ad/durum/ilerleme ile düğmeleri aynı
     genişlikte yarıştırıyor ve etiketleri üst üste bindiriyordu. */
  assert.ok(!LIST.includes('onRunRowAction'))
  for (const forbidden of ['row.showPause', 'row.showResume', 'row.showReset']) {
    assert.ok(!LIST.includes(forbidden), `satır yaşam döngüsü komutu taşıyor: ${forbidden}`)
  }

  // Sunum modeli de o alanları ARTIK ÜRETMEZ.
  const rows = activeSimulationRows({
    byRoute: seed(), routes, capabilities: lifecycleCapabilities(FULL),
  })
  const keys = Object.keys(rows[0])
  for (const forbidden of ['showPause', 'showResume', 'showReset', 'showRestart']) {
    assert.ok(!keys.includes(forbidden), `satır modeli komut taşıyor: ${forbidden}`)
  }

  // Uçuş hâli yine de satırda GÖRÜNÜR: meşgul bir hedefin kutusu kilitlenir.
  assert.ok(keys.includes('isBusy'))
  assert.match(LIST, /disabled=\{row\.isBusy\}/)
})

test('the management bar is visually and behaviourally distinct from the watch bar', () => {
  // Seçim eylemleri İZLEME eylemleriyle karıştırılmaz.
  assert.match(BAR, /Aktifleri Seç/)
  assert.match(BAR, /Seçimi Temizle/)
  assert.ok(!BAR.includes('Tümünü İzle'))
  assert.ok(!BAR.includes('İzlemeyi Temizle'))

  assert.ok(!LIST.includes('Aktifleri Seç'))
  assert.match(LIST, /Tümünü İzle/)

  // Kendi kutusu ve kendi araç çubuğu vardır.
  assert.match(CSS, /\.journey-manage \{/)
  assert.match(CSS, /\.journey-manage\.is-idle \{/)
  assert.match(CSS, /\.journey-active-manage \{/)

  /* Satırın yaşam döngüsü kümesi KALDIRILDI: ölü bir kural, geri gelmeye
     hazır bekleyen bir yerleşim demektir. */
  assert.ok(!CSS.includes('.journey-active-row-actions'))

  /* YIKICI GÖRSEL DİL yalnızca yıkıcı komutlara ayrılmıştır: seçim kısa
     yolları düğme bile değildir, duraklat/sürdür nötrdür. */
  assert.match(CSS, /\.journey-manage-action\.is-destructive \{/)
  assert.match(CSS, /\.journey-manage-action\.is-restart \{/)
  assert.match(CSS, /\.journey-manage-hint \{/)
})

test('the panel solves crowding by hierarchy, never by a fixed minimum width', () => {
  /* Eylem ızgarası dar alanda KENDİLİĞİNDEN sarılır; satır ise üç bölgeli tek
     bir karttır ve orta bölge taşmak yerine kısalır. */
  assert.match(CSS, /\.journey-manage-actions \{[^}]*display: grid;/s)
  assert.match(CSS, /grid-template-columns: repeat\(auto-fit, minmax\(7\.5rem, 1fr\)\);/)
  assert.match(CSS, /\.journey-active-select \{[^}]*min-width: 0;/s)
  assert.match(CSS, /\.journey-active-meta \{[^}]*text-overflow: ellipsis;/s)
  assert.match(CSS, /\.journey-active-watch \{[^}]*white-space: nowrap;/s)

  const narrow = CSS.slice(CSS.indexOf('@media (max-width: 640px)'))

  // <=640px: seçim eylem çubuğu İKİ SÜTUNLU ızgaraya iner.
  assert.match(narrow, /\.journey-manage-actions \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/)

  /* SORUN GENİŞLİK DEĞİL, BİLGİ HİYERARŞİSİYDİ. Paneli büyütmek ya da ona
     sabit bir minimum genişlik vermek, kalabalığı çözmez yalnızca saklardı. */
  assert.ok(!/\.journey-manage[^{]*\{[^}]*min-width:\s*\d/s.test(CSS))
  assert.ok(!/\.journey-active[^{]*\{[^}]*min-width:\s*[1-9]/s.test(CSS))
  assert.ok(!CSS.includes('overflow-x: scroll'))
})

/* --- 65. KİŞİSEL YOLCULUK ------------------------------------------------------- */

test('personal journey is untouched by shared batch management', () => {
  const journeyHook = read('../../src/hooks/useJourneySimulation.js')
  const journeyState = read('../../src/map/journeySimulationState.js')

  for (const source of [journeyHook, journeyState]) {
    assert.ok(!source.includes('managedRuns'))
    assert.ok(!source.includes('lifecycleIntent'))
    assert.ok(!source.includes('runLifecycleBatch'))
    assert.ok(!source.includes('batch/'))
  }

  // Ve paylaşılan saf modül kişisel yolculuğu hiç tanımaz.
  const active = read('../../src/map/activeSimulations.js')
  assert.ok(!active.includes('journey'))
  assert.ok(!active.includes('Journey'))
})

/* --- SAYFA BAĞLANTISI ----------------------------------------------------------- */

test('the page freezes the intent before confirming and rechecks capability on submit', () => {
  const body = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const runLifecycleOperation'),
    MAP_PAGE.indexOf('const toggleTransportRoute'),
  )

  // Bekleyen durum bir BAYRAK değil, bir NİYETTİR.
  assert.match(body, /setPendingBatchCommand\(intent\)/)
  assert.ok(!body.includes('setPendingBatchCommand(true)'))

  // Yıkıcı olmayan işlemler onay İSTEMEZ.
  assert.match(body, /simulation\.runLifecycleBatch\(intent\)/)

  /* KOMUT ANINDA yeniden denetim: görünürlük bir denetim değildir ve yetkiler
     oturum içinde tazelenebilir. */
  assert.match(body, /if \(!canStopSharedSimulation\) return/)
  assert.match(body, /RESTART && !canStartSharedSimulation/)

  // Onayda hedefler YENİDEN HESAPLANMAZ.
  const confirmBody = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const confirmBatchCommand'),
    MAP_PAGE.indexOf('const toggleTransportRoute'),
  )
  assert.match(confirmBody, /await simulation\.runLifecycleBatch\(intent\)/)
  assert.ok(!confirmBody.includes('lifecycleIntent('))

  // Satır seçimi HÂLÂ yalnızca seçimi değiştirir.
  const select = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const selectActiveSimulationRow'),
    MAP_PAGE.indexOf('const runLifecycleOperation'),
  )
  assert.match(select, /setSelectedTransportRouteId\(rowRouteId\)/)
  assert.ok(!select.includes('toggleManaged'))
  assert.ok(!select.includes('toggleWatch'))
})

test('the restart confirmation states plainly that a new run is created', () => {
  const dialog = MAP_PAGE.slice(
    MAP_PAGE.indexOf('open={pendingBatchCommand != null'),
    MAP_PAGE.indexOf('open={journeyStopPending}'),
  )

  // Yeniden başlatma: YENİ simülasyon, %0, hiçbir niyet devretmez.
  assert.match(dialog, /YENİ bir simülasyon oluşturulur/)
  assert.match(dialog, /otomatik olarak izlenmez, takip edilmez ve yönetim seçiminde yer almaz/)

  // Sıfırlama: yerine yenisi KONMAZ ve hat TANIMI silinmez.
  assert.match(dialog, /Yerlerine yeni bir simülasyon oluşturulmaz ve hat tanımları silinmez/)

  // GUID kullanıcıya gösterilmez.
  assert.ok(!dialog.includes('simulationId'))
})
