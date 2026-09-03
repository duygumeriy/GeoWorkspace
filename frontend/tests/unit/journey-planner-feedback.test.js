import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  JOURNEY_MESSAGES,
  JOURNEY_MODES,
  buildJourneyPreviewRequest,
  initialJourneyPlannerState,
} from '../../src/map/journeyPlanning.js'

/**
 * Faz 5E-B · Dilim 3 — geri bildirim SEMANTİĞİ.
 *
 * Ölçülen ayrım şudur: eksik bir seçim kullanıcının yaptığı bir YANLIŞ
 * değildir. Rehberlik nötr bir nottur, hata ise gerçek bir başarısızlıktır ve
 * yalnızca ikincisi <code>role="alert"</code> ile duyurulur. Kuralın veri
 * tarafı saf modülde çalıştırılır; sunum tarafı, dosyanın tamamında kelime
 * aramak yerine ilgili JSX dalı ayıklanarak denetlenir.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const PANEL = stripComments(read('../../src/components/map/JourneyPlannerPanel.jsx'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const PLANNER_HOOK = stripComments(read('../../src/hooks/useJourneyPlanner.js'))
const CSS = read('../../src/components/map/JourneyPlanner.css')

/* --- Ayıklama yardımcıları ------------------------------------------------------ */

/** Bir JSX koşul dalını süslü parantezleri sayarak ayıklar. */
function conditionalBlocks(source, condition) {
  const blocks = []
  let from = source.indexOf(condition)

  while (from >= 0) {
    let depth = 0
    let index = from

    for (; index < source.length; index += 1) {
      if (source[index] === '{') depth += 1
      else if (source[index] === '}') {
        depth -= 1
        if (depth === 0) break
      }
    }

    blocks.push(source.slice(from, index + 1))
    from = source.indexOf(condition, index + 1)
  }

  return blocks
}

const branchWith = (condition, marker) => {
  const found = conditionalBlocks(PANEL, condition).find((block) => block.includes(marker))
  assert.ok(found, `${condition} dalı (${marker}) bulunamadı`)
  return found
}

/** Bir JSX bileşen çağrısı (öznitelik ifadelerinin içi atlanarak). */
function jsxElement(source, tag) {
  const from = source.indexOf(`<${tag}`)
  assert.ok(from > 0, `<${tag} … /> çağrısı bulunamadı`)

  let depth = 0
  for (let index = from; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') depth -= 1
    else if (depth === 0 && char === '/' && source[index + 1] === '>') {
      return source.slice(from, index + 2)
    }
  }

  return assert.fail(`<${tag} … /> kapanışı bulunamadı`)
}

const PANEL_USAGE = jsxElement(MAP_PAGE, 'JourneyPlannerPanel')

/* --- 1/3. Rehberlik bir hata değildir --------------------------------------------- */

test('an untouched planner already has guidance, which is why it must not be an alert', () => {
  /* Panel ilk açıldığında doğrulama ZATEN başarısızdır (hat seçilmemiştir).
     Eski davranışta bu, kullanıcı hiçbir şey yapmadan kırmızı bir uyarı
     olarak görünüyordu. */
  const fresh = buildJourneyPreviewRequest(initialJourneyPlannerState())

  assert.equal(fresh.ok, false)
  assert.equal(fresh.error, JOURNEY_MESSAGES.routeRequired)
})

test('the two concepts travel in two separate props', () => {
  assert.match(PANEL_USAGE, /error=\{journey\.error\}/)
  assert.match(PANEL_USAGE, /guidance=\{journey\.validationError\}/)

  // Eski birleştirme geri gelemez.
  assert.ok(!PANEL_USAGE.includes('journey.error || journey.validationError'))
  assert.ok(!MAP_PAGE.includes('journey.error || journey.validationError'))
})

test('guidance renders as a neutral note, never as an alert', () => {
  const guidance = branchWith('{!error && guidance && !loading && (', 'journey-guidance')

  assert.ok(guidance.includes('className="journey-note journey-guidance"'))
  assert.ok(!guidance.includes('role="alert"'))
  // Ve gerçek bir hata varken tekrar etmez.
  assert.ok(guidance.startsWith('{!error &&'))

  // Nötr sunum: uyarı zemini/rengi yoktur.
  const style = CSS.slice(CSS.indexOf('.journey-guidance {'), CSS.indexOf('}', CSS.indexOf('.journey-guidance {')))
  assert.ok(!style.includes('--danger'))
  assert.ok(!style.includes('background'))
})

test('an explicit invalid attempt is answered locally, with no backend request', () => {
  /* Geçersiz her kip için doğrulama bir MESAJ üretir ve istek gövdesi hiç
     kurulmaz — yani gönderilecek bir şey yoktur. */
  const cases = [
    [{ mode: JOURNEY_MODES.ROUTE_FULL, profile: 'driving', routeId: null, waypoints: [] },
      JOURNEY_MESSAGES.routeRequired],
    [{ mode: JOURNEY_MODES.ROUTE_SEGMENT, profile: 'driving', routeId: 7, fromStopId: null, toStopId: null, waypoints: [] },
      JOURNEY_MESSAGES.segmentStopsRequired],
    [{ mode: JOURNEY_MODES.ROUTE_SEGMENT, profile: 'driving', routeId: 7, fromStopId: 71, toStopId: 71, waypoints: [] },
      JOURNEY_MESSAGES.segmentStopsIdentical],
    [{ mode: JOURNEY_MODES.WAYPOINTS, profile: 'driving', routeId: null, waypoints: [{ key: 'wp-1', reference: null }, { key: 'wp-2', reference: null }] },
      JOURNEY_MESSAGES.waypointsRequired],
  ]

  for (const [state, message] of cases) {
    const validation = buildJourneyPreviewRequest(state)
    assert.equal(validation.ok, false)
    assert.equal(validation.error, message)
    assert.equal(validation.request, undefined)
  }

  /* Kancada da kapı vardır: geçersiz seçimde `previewJourney` HİÇ çağrılmaz,
     mesaj hata alanına yazılır ve fonksiyon geri döner. */
  const requestPreview = PLANNER_HOOK.slice(
    PLANNER_HOOK.indexOf('const requestPreview = useCallback('),
    PLANNER_HOOK.indexOf('const clear = useCallback('),
  )
  const guard = requestPreview.indexOf('if (!validation.ok)')
  assert.ok(guard > 0)
  assert.ok(guard < requestPreview.indexOf('previewJourney('), 'geçersiz seçimde istek kurulmadan dönülmeli')
  assert.match(requestPreview.slice(guard, guard + 120), /setError\(validation\.error \?\? ''\)\s*return/)

  // Düğme de kapalıdır: geçersiz plan için tıklama zaten sunulmaz.
  assert.ok(PANEL.includes('disabled={!canRequest}'))
})

const PERSONAL_FEEDBACK = "{!collapsed && showingPersonal && (error || live?.error) && ("

test('a real failure keeps error semantics', () => {
  const feedback = branchWith(PERSONAL_FEEDBACK, 'journey-feedback')

  assert.match(feedback, /\{error && <p className="journey-error" role="alert">\{error\}<\/p>\}/)
})

/* --- 2/4/5. Canlı hata her evrede görünür ------------------------------------------ */

test('live error has exactly one home, outside the phase branches', () => {
  const renders = PANEL.match(/live\?\.error &&/g) ?? []
  assert.equal(renders.length, 1, 'canlı hata üç kez değil, bir kez çizilmeli')

  const feedback = branchWith(PERSONAL_FEEDBACK, 'journey-feedback')
  assert.match(feedback, /\{live\?\.error && <p className="journey-error" role="alert">\{live\.error\}<\/p>\}/)

  /* Ortak bölge, KİŞİSEL evre dallarından ÖNCE gelir: planlayıcı, ACTIVE ve
     TERMINAL hepsi onu paylaşır — hiçbir dalın içinde yaşamaz.

     Faz 2 bölgeyi bir ürün koşuluyla daralttı (`showingPersonal`) ve bu
     bilinçlidir: kişisel yolculuğun hatası, kullanıcı PAYLAŞILAN hatta
     bakarken çizilirse başka bir ürünün başarısızlığı gibi okunurdu. Hata
     KAYBOLMAZ — kanca durumu tutar ve kişisel ürüne dönüldüğünde yine
     görünür. */
  const feedbackAt = PANEL.indexOf(PERSONAL_FEEDBACK)
  assert.ok(feedbackAt > 0, 'kişisel hata bölgesi bulunamadı')
  for (const branchStart of [
    '{collapsed && (',
    '{!collapsed && showingPersonal && isLive && (',
    '{!collapsed && showingPersonal && !isLive && (',
  ]) {
    assert.ok(feedbackAt < PANEL.indexOf(branchStart), `${branchStart} hata bölgesinden önce geliyor`)
  }

  // Ve hata hiçbir şeyi durdurmaz/bırakmaz: bölgede eylem yoktur.
  for (const forbidden of ['onStopSimulation', 'onNewJourney', 'onReturnToPlanning', 'dismiss']) {
    assert.ok(!feedback.includes(forbidden))
  }
})

test('personal and shared failures never bleed into each other', () => {
  /* İKİ ÜRÜN, İKİ HATA SAHİBİ. Kişisel hata kişisel bölgede, paylaşılan hata
     paylaşılan bileşende yaşar; hiçbiri diğerinin yüzeyinde çizilmez ve
     hiçbiri ikinci kez çizilmez. */
  const shared = stripComments(read('../../src/components/map/SharedTransportJourneyContent.jsx'))

  // Kişisel panel paylaşılan hatayı HİÇ okumaz.
  assert.ok(!PANEL.includes('shared.error'))
  assert.ok(!PANEL.includes('shared?.error'))

  // Paylaşılan bölüm de kişisel hatayı okumaz.
  assert.ok(!shared.includes('live?.error'))
  assert.ok(!shared.includes('live.error'))

  /* Paylaşılan hata GERÇEK bir başarısızlıktır ve nötr rehberliğe
     dönüştürülmez: uyarı olarak duyurulur ve tam olarak bir kez çizilir. */
  assert.match(shared, /\{shared\.error && <p className="journey-error" role="alert">\{shared\.error\}<\/p>\}/)
  assert.equal((shared.match(/shared\.error &&/g) ?? []).length, 1)

  // Ve o bölge de hiçbir yaşam döngüsü komutu taşımaz.
  const sharedErrorAt = shared.indexOf('{shared.error &&')
  const line = shared.slice(sharedErrorAt, shared.indexOf('\n', sharedErrorAt))
  for (const forbidden of ['onStart', 'onFollow', 'onUnfollow']) {
    assert.ok(!line.includes(forbidden))
  }
})

/* --- 6. İlerleme semantiği --------------------------------------------------------- */

test('active progress exposes real progressbar semantics from the server value', () => {
  const metrics = branchWith('{isActive && (', 'journey-live-bar')

  assert.ok(metrics.includes('role="progressbar"'))
  assert.ok(metrics.includes('aria-valuemin={0}'))
  assert.ok(metrics.includes('aria-valuemax={100}'))
  assert.ok(metrics.includes('aria-valuenow={Math.round(liveModel.progressPercent)}'))
  assert.ok(metrics.includes('aria-valuetext={`%${Math.round(liveModel.progressPercent)} tamamlandı`}'))
  assert.ok(metrics.includes('aria-label="Yolculuk ilerlemesi"'))

  // Değer SUNUCUNUN kırpılmış modelinden gelir; ikinci bir yüzde yoktur.
  assert.ok(!metrics.includes('/ 100'))
  assert.ok(!metrics.includes('distanceCoveredMeters'))

  // Terminal sonuç bir ilerleme çubuğu taklidi yapmaz.
  assert.ok(!branchWith('{isTerminal && (', 'journey-terminal').includes('progressbar'))
})

/* --- 7/11/12. Takip ve terminal --------------------------------------------------- */

test('the follow toggle reports its state', () => {
  const actions = branchWith('{isActive && (', 'journey-actions')

  assert.match(actions, /aria-pressed=\{Boolean\(live\?\.following\)\}/)
  assert.ok(actions.includes('onClick={onToggleFollow}'))
  // Kameranın kendisi bu dilimde değişmez: panel yalnızca durumu bildirir.
  assert.ok(!actions.includes('setFollowing'))
})

test('the terminal card still has no follow control and keeps both exits', () => {
  const terminal = branchWith('{isTerminal && (', 'journey-actions')

  assert.ok(!terminal.includes('onToggleFollow'))
  assert.ok(!terminal.includes('aria-pressed'))
  assert.ok(terminal.includes('Planlamaya Dön'))
  assert.ok(terminal.includes('onReturnToPlanning'))
  assert.ok(terminal.includes('Yeni Yolculuk'))
  assert.ok(terminal.includes('onNewJourney'))
})

/* --- 8/9. Seçim kipi geri bildirimi ------------------------------------------------ */

test('an armed picking mode says so in plain, visible text', () => {
  const status = branchWith('{picking && (', 'journey-picking-status')

  /* Görünür cümle: imleç ya da ipucu balonu tek başına yeterli değildir.

     Cümlenin ADI artık sabit değil, YETKİDEN türetilmiş bir değerdir
     (`pickableLabel`) — çünkü durak seçemeyen birine "bir durak seçin" demek,
     seçemeyeceği bir şeye davet etmektir. Cümlenin İSKELETİ burada, adın
     yetkiye göre nasıl kurulduğu ise aşağıdaki testte sabitlenir. */
  assert.ok(status.includes('Haritadan bir {pickableLabel} seçin · Vazgeçmek için Esc'))
  assert.ok(!status.includes('title='))

  // Ad SABİT yazılmaz: yetkiyi atlayan bir metin regresyonu burada düşer.
  assert.ok(!/Haritadan bir (durak|yer|nokta)\b/.test(status))

  // Nazik canlı bölge — bir hata değil, sürmekte olan bir kip.
  assert.ok(status.includes('role="status"'))
  assert.ok(!status.includes('role="alert"'))
})

test('stop-picking guidance can only be produced for a user who may read the transport network', () => {
  /* Faz 1 ayrımının SUNUM tarafı. Kullanıcı yetenekleri panele iki AYRI
     bayrak olarak gelir ve ürün kapısıyla (`journey.use`) karıştırılmaz:

         canUseTransport  ← transport.view
         canUsePois       ← poi.view

     Rehberlik cümlesindeki ad bu ikisinden türetilir. */
  assert.match(
    PANEL,
    /const pickableLabel = pickableLabelOf\(\{ canUseStops: canUseTransport, canUsePois \}\)/,
  )

  const table = PANEL.slice(
    PANEL.indexOf('function pickableLabelOf('),
    PANEL.indexOf('function formatStepMetric('),
  )
  assert.ok(table.includes('function pickableLabelOf('), 'karar tablosu bulunamadı')

  // Karar tablosunun TAMAMI — dört durumun dördü de sabitlenir.
  assert.match(table, /if \(canUseStops && canUsePois\) return 'durak ya da yer'/)
  assert.match(table, /if \(canUseStops\) return 'durak'/)
  assert.match(table, /if \(canUsePois\) return 'yer'/)
  assert.match(table, /\n\s*return 'nokta'/)

  /* Ve asıl GÜVENLİK iddiası: "durak" sözü veren HER dal `canUseStops`
     ardındadır. Yetkisiz bir kullanıcıya durak seçtiren bir rehberlik cümlesi
     üretilemez — yeni bir dal eklenirse bu iddia düşer. */
  const stopPromising = table
    .split('\n')
    .filter((line) => line.includes('return') && line.includes('durak'))

  assert.equal(stopPromising.length, 2)
  for (const line of stopPromising) {
    assert.ok(line.includes('canUseStops'), `durak vaat eden korumasız dal: ${line.trim()}`)
  }

  /* Nokta seçici AYNI kuralı okur: iki yüzeyin metni ayrışamaz ve durak
     listesi yetkisi olmayana boş geçilir (bkz. journey-center-permissions). */
  assert.match(PANEL, /Haritadan bir \{pickableLabelOf\(\{ canUseStops, canUsePois \}\)\} seçebilirsiniz\./)
  assert.ok(PANEL.includes('routeStops={canUseTransport ? stops : []}'))
})

test('the panel is told the EFFECTIVE picking state, and the slot keeps aria-pressed', () => {
  // Dilim 1'in kuralı: yalnızca çalışma alanı dinlenirken doğrudur.
  assert.match(PANEL_USAGE, /picking=\{journey\.isPicking\}/)

  const slot = PANEL.slice(PANEL.indexOf('journey-waypoint-slot'), PANEL.indexOf('journey-waypoint-actions'))
  assert.ok(slot.includes('aria-pressed={armed}'))
})

/* --- 10. Meşgul semantiği ---------------------------------------------------------- */

test('busy state is derived from existing flags only', () => {
  assert.match(PANEL, /const busy = Boolean\(loading \|\| live\?\.starting\)/)
  assert.match(PANEL, /aria-busy=\{busy\}/)

  // Düğmeler bugünkü gibi kapalı kalır ve kendi meşguliyetlerini bildirir.
  assert.ok(PANEL.includes('disabled={!canRequest}'))
  assert.ok(PANEL.includes('aria-busy={loading}'))
  assert.ok(PANEL.includes('disabled={!canRequest || live?.starting}'))
  assert.ok(PANEL.includes('aria-busy={Boolean(live?.starting)}'))

  // Görünür Türkçe metinler değişmedi.
  assert.ok(PANEL.includes("{loading ? 'Hesaplanıyor…' : 'Rotayı Hesapla'}"))
  assert.ok(PANEL.includes("{live?.starting ? 'Başlatılıyor…' : 'Simülasyonu Başlat'}"))
})

/* --- 7. Sekme/profil semantiği ------------------------------------------------------ */

test('mode and profile controls use semantics the component can actually honour', () => {
  /* Yarım bir sekme/radyo kalıbı (tabpanel ilişkisi ve ok tuşlarıyla dolaşan
     odak olmadan) hiç olmamasından daha yanıltıcıdır. Sıradan düğmeler
     klavyeyle zaten çalışır; bildirilen tek şey hangisinin AÇIK olduğudur. */
  assert.ok(!PANEL.includes('role="tablist"'))
  assert.ok(!PANEL.includes('role="tab"'))
  assert.ok(!PANEL.includes('role="radiogroup"'))
  assert.ok(!PANEL.includes('role="radio"'))
  assert.ok(!PANEL.includes('aria-selected'))
  assert.ok(!PANEL.includes('aria-checked'))

  assert.match(PANEL, /<div className="journey-tabs" role="group" aria-label="Planlama türü">/)
  assert.match(PANEL, /<div className="journey-profiles" role="group" aria-label="Seyahat türü">/)
  assert.match(PANEL, /aria-pressed=\{state\.mode === tab\.id\}/)
  assert.match(PANEL, /aria-pressed=\{state\.profile === profile\.id\}/)

  // Hâlâ tam olarak üç profil; otobüs/transit yoktur.
  assert.ok(PANEL.includes('JOURNEY_PROFILES.map'))
  assert.ok(!PANEL.includes('BusFront'))
})

/* --- 13. Uydurma yok ---------------------------------------------------------------- */

test('no fake timers, client-side progress or routing arrive with the feedback work', () => {
  for (const forbidden of [
    'setTimeout',
    'setInterval',
    'requestAnimationFrame',
    'Date.now(',
    'speedKph',
    'multiplier',
    'estimateDuration',
  ]) {
    assert.ok(!PANEL.includes(forbidden), `panel ${forbidden} kullanıyor`)
  }

  // Ölçümler hâlâ sunucunun modelinden okunur.
  assert.ok(PANEL.includes('formatRouteDistance(liveModel.totalDistanceMeters)'))
  assert.ok(PANEL.includes('journeyLiveModel({ simulation: live?.simulation, snapshot: live?.snapshot })'))
})
