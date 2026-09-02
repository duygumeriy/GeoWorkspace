import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import VectorSource from 'ol/source/Vector.js'
import { fromLonLat } from 'ol/proj.js'
import {
  JOURNEY_SIMULATION_STATUS,
  applyJourneySnapshot,
  journeyLiveModel,
  journeyStatusIndicator,
  journeyVehiclePopupModel,
  shouldApplyJourneySnapshot,
} from '../../src/map/journeySimulationState.js'
import { JOURNEY_STEP_STATES, journeyNavigationModel } from '../../src/map/journeyNavigation.js'
import { syncJourneyVehicleFeature } from '../../src/map/journeyVehicle.js'

/**
 * Manuel kabul testinin ORTAYA ÇIKARDIĞI arıza: kişisel yolculuk panelinde,
 * balonunda ve işaretçisinde her şey %0'da ve ilk talimatta DONUYORDU; oysa
 * paylaşılan hat simülasyonu aynı ekranda ilerliyordu.
 *
 * <b>Bu dosya tek bir anlık görüntüyü değil, DİZİYİ sınar.</b> Tek bir
 * anlık görüntünün doğru okunması, ardışık anlık görüntülerin gerçekten
 * BİRBİRİNİ İZLEDİĞİNİ kanıtlamaz — kırılan tam olarak buydu. Her senaryo
 * bu yüzden 0 → 15 → 30 gibi bir geçiş üzerinden yürür ve DEĞİŞEN her sunum
 * yüzeyinin AYNI son anlık görüntüden türediğini gösterir.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const SIM_HOOK = stripComments(read('../../src/hooks/useJourneySimulation.js'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const PANEL = stripComments(read('../../src/components/map/JourneyPlannerPanel.jsx'))
const POPUP = stripComments(read('../../src/components/map/JourneyVehiclePopup.jsx'))

/**
 * Bir bileşen düzeyi bildiriminin GÖVDESİ: bildirimden bir sonraki bileşen
 * düzeyi `const`a kadar.
 *
 * Gövdenin tek satır mı yoksa bloklu mu yazıldığına BAĞLI DEĞİLDİR. `}, [])`
 * gibi bir kapanışı aramak tam olarak buna bağlı kalırdı ve geri çağrı tek
 * satıra döndüğü anda iddiayı sessizce anlamsız kılardı.
 */
const declarationOf = (source, name) => {
  const start = source.indexOf(`const ${name} =`)
  assert.ok(start >= 0, `${name} bildirimi bulunamadı`)
  const rest = source.slice(start + 1)
  const end = rest.indexOf('\n  const ')
  return rest.slice(0, end < 0 ? undefined : end)
}

const SIMULATION_ID = '11111111-1111-1111-1111-111111111111'
const OTHER_SIMULATION_ID = '22222222-2222-2222-2222-222222222222'

/** DEĞİŞMEZ taraf: başlatma yanıtından bir kez alınır ve bir daha değişmez. */
const SIMULATION = Object.freeze({
  simulationId: SIMULATION_ID,
  requestedProfile: 'driving',
  effectiveProfile: 'driving',
  totalDistanceMeters: 1000,
  totalDurationSeconds: 600,
  geometryWkt: 'LINESTRING(30 40, 31 41)',
  steps: [
    { sequence: 0, maneuverType: 'depart', name: 'Başlangıç Caddesi', distanceMeters: 120 },
    { sequence: 1, maneuverType: 'turn', maneuverModifier: 'left', name: 'Orta Sokak', distanceMeters: 340 },
    { sequence: 2, maneuverType: 'arrive', name: null, distanceMeters: 0 },
  ],
})

/** DEĞİŞEN taraf: sunucunun yayınladığı anlık görüntüler, sırasıyla. */
const snapshotAt = (progressPercent, currentStepSequence, seconds) => ({
  simulationId: SIMULATION_ID,
  status: JOURNEY_SIMULATION_STATUS.RUNNING,
  longitude: 30 + (progressPercent / 100),
  latitude: 40 + (progressPercent / 100),
  progressPercent,
  distanceCoveredMeters: progressPercent * 10,
  currentStepSequence,
  updatedAtUtc: new Date(Date.UTC(2026, 8, 1, 12, 0, seconds)).toISOString(),
})

const SEQUENCE = [
  snapshotAt(0, 0, 0),
  snapshotAt(15, 1, 10),
  snapshotAt(30, 2, 20),
]

/**
 * Kancanın yaptığı işin SAF karşılığı: gelen her olayı kabul kuralından
 * geçirip "en son kabul edilen anlık görüntüyü" biriktirir.
 */
const reduceSnapshots = (incoming, initial = null) =>
  incoming.reduce((current, next) => applyJourneySnapshot(current, next), initial)

/* --- KABUL KURALI (canlı otoritenin kendisi) --------------------------------- */

test('yeni anlık görüntü öncekinin YERİNE geçer ve son otorite olur', () => {
  let latest = null

  for (const incoming of SEQUENCE) {
    latest = applyJourneySnapshot(latest, incoming)
  }

  assert.equal(latest.progressPercent, 30)
  assert.equal(latest.currentStepSequence, 2)
  assert.equal(latest.simulationId, SIMULATION_ID)
})

test('BAŞKA bir çalıştırmanın güncellemesi reddedilir; benimsenmiş olan korunur', () => {
  const current = SEQUENCE[1]

  const stale = {
    ...snapshotAt(99, 2, 30),
    simulationId: OTHER_SIMULATION_ID,
  }

  assert.equal(shouldApplyJourneySnapshot(current, stale), false)
  // Aynı referans döner: React yeniden çizmez, düşürülen olay yan etki üretmez.
  assert.equal(applyJourneySnapshot(current, stale), current)
})

test('AYNI kimlikli daha yeni güncelleme reddedilmez', () => {
  assert.equal(shouldApplyJourneySnapshot(SEQUENCE[0], SEQUENCE[1]), true)
  assert.equal(shouldApplyJourneySnapshot(SEQUENCE[1], SEQUENCE[2]), true)
  assert.equal(applyJourneySnapshot(SEQUENCE[1], SEQUENCE[2]), SEQUENCE[2])
})

test('geriye giden bir olay işaretçiyi geri SIÇRATMAZ', () => {
  const latest = reduceSnapshots([SEQUENCE[0], SEQUENCE[2], SEQUENCE[1]])
  assert.equal(latest.progressPercent, 30)
  assert.equal(latest.currentStepSequence, 2)
})

test('terminal olay kabul edilir ve ondan sonra Running geri dönemez', () => {
  const cancelled = { ...snapshotAt(30, 2, 25), status: JOURNEY_SIMULATION_STATUS.CANCELLED }
  const latest = reduceSnapshots([...SEQUENCE, cancelled, snapshotAt(60, 2, 40)])

  assert.equal(latest.status, JOURNEY_SIMULATION_STATUS.CANCELLED)
  assert.equal(latest.progressPercent, 30)
})

/* --- PANEL: ilerleme SON anlık görüntüden okunur ----------------------------- */

test('panel ilerlemesi başlatma yanıtından DEĞİL, son anlık görüntüden gelir', () => {
  const progress = SEQUENCE.map((snapshot) =>
    journeyLiveModel({ simulation: SIMULATION, snapshot }).progressPercent)

  assert.deepEqual(progress, [0, 15, 30])

  // Kalan mesafe de aynı otoriteden türetilir; ikinci bir formül yoktur.
  const remaining = SEQUENCE.map((snapshot) =>
    journeyLiveModel({ simulation: SIMULATION, snapshot }).remainingDistanceMeters)

  assert.deepEqual(remaining, [1000, 850, 700])

  // Panel kapalıyken görünen özet de aynı değeri söyler.
  assert.equal(
    journeyStatusIndicator({ simulation: SIMULATION, snapshot: SEQUENCE[2] }).label,
    'Yolculuk sürüyor · %30',
  )
})

/* --- NAVİGASYON: güncel adım SUNUCUNUN sırasından --------------------------- */

test('güncel/sıradaki talimat sunucunun currentStepSequence değeriyle ilerler', () => {
  const models = SEQUENCE.map((snapshot) => journeyNavigationModel({
    steps: SIMULATION.steps,
    currentStepSequence: journeyLiveModel({ simulation: SIMULATION, snapshot }).currentStepSequence,
  }))

  // 0 → ilk adım güncel, ikinci adım sıradaki.
  assert.equal(models[0].current.sequence, 0)
  assert.equal(models[0].next.sequence, 1)
  assert.deepEqual(models[0].steps.map((step) => step.state), [
    JOURNEY_STEP_STATES.CURRENT,
    JOURNEY_STEP_STATES.UPCOMING,
    JOURNEY_STEP_STATES.UPCOMING,
  ])

  // 1 → ilk adım BİTTİ, ikinci adım güncel.
  assert.equal(models[1].current.sequence, 1)
  assert.equal(models[1].next.sequence, 2)
  assert.deepEqual(models[1].steps.map((step) => step.state), [
    JOURNEY_STEP_STATES.DONE,
    JOURNEY_STEP_STATES.CURRENT,
    JOURNEY_STEP_STATES.UPCOMING,
  ])

  // 2 → son adım: SIRADAKİ YOKTUR, varış sonrası talimat uydurulmaz.
  assert.equal(models[2].current.sequence, 2)
  assert.equal(models[2].next, null)
  assert.deepEqual(models[2].steps.map((step) => step.state), [
    JOURNEY_STEP_STATES.DONE,
    JOURNEY_STEP_STATES.DONE,
    JOURNEY_STEP_STATES.CURRENT,
  ])
})

test('güncel adım SIRA NUMARASIYLA eşleşir, dizi konumuyla değil', () => {
  /* Listenin başı kırpılmış: dizin 0 artık sıra 0 DEĞİLDİR. Dizine güvenen
     bir eşleşme burada yanlış talimatı "şu an" diye gösterirdi. */
  const trimmed = SIMULATION.steps.slice(1)

  const model = journeyNavigationModel({ steps: trimmed, currentStepSequence: 2 })

  assert.equal(model.current.sequence, 2)
  assert.equal(model.current.name, null)
  assert.equal(model.next, null)
  assert.deepEqual(model.steps.map((step) => step.state), [
    JOURNEY_STEP_STATES.DONE,
    JOURNEY_STEP_STATES.CURRENT,
  ])
})

test('adımsız bir yolculukta talimat UYDURULMAZ', () => {
  const model = journeyNavigationModel({
    steps: [],
    currentStepSequence: journeyLiveModel({
      simulation: { ...SIMULATION, steps: [] },
      snapshot: { ...SEQUENCE[1], currentStepSequence: null },
    }).currentStepSequence,
  })

  assert.equal(model.hasSteps, false)
  assert.equal(model.current, null)
  assert.equal(model.next, null)
})

/* --- BALON: aynı otorite, ikinci bir hesap yok ------------------------------ */

test('balon yüzdesi ve talimatları son anlık görüntüyle birlikte ilerler', () => {
  const models = SEQUENCE.map((snapshot) =>
    journeyVehiclePopupModel({ simulation: SIMULATION, snapshot }))

  assert.deepEqual(models.map((model) => model.progressLabel), ['%0', '%15', '%30'])
  assert.deepEqual(models.map((model) => model.currentStep.sequence), [0, 1, 2])
  assert.deepEqual(models.map((model) => model.nextStep?.sequence ?? null), [1, 2, null])

  // Çapa koordinatı da her anlık görüntüde taşınır.
  assert.deepEqual(models.map((model) => model.longitude), [30, 30.15, 30.3])

  // Durum ve başlık benimsenmiş çalıştırmadan gelir; planlayıcı seçiminden değil.
  assert.equal(models[2].statusLabel, 'Sürüyor')
  assert.equal(models[2].title, 'Araç Yolculuğu')
  assert.equal(models[2].simulationId, SIMULATION_ID)
})

test('balon ile panel AYNI gezinme modelini okur; iki farklı talimat imkânsızdır', () => {
  for (const snapshot of SEQUENCE) {
    const live = journeyLiveModel({ simulation: SIMULATION, snapshot })
    const panel = journeyNavigationModel({
      steps: SIMULATION.steps,
      currentStepSequence: live.currentStepSequence,
    })
    const popup = journeyVehiclePopupModel({ simulation: SIMULATION, snapshot })

    assert.deepEqual(popup.currentStep, panel.current)
    assert.deepEqual(popup.nextStep, panel.next)
    assert.equal(popup.progressPercent, live.progressPercent)
  }
})

/* --- İŞARETÇİ: aynı feature taşınır, her tick'te yeniden yaratılmaz --------- */

test('işaretçi son anlık görüntüye taşınır ve AYNI feature kalır', () => {
  const source = new VectorSource()

  const features = SEQUENCE.map((snapshot) => {
    const live = journeyLiveModel({ simulation: SIMULATION, snapshot })
    return syncJourneyVehicleFeature(source, {
      simulationId: live.simulationId,
      profileId: SIMULATION.requestedProfile,
      longitude: live.longitude,
      latitude: live.latitude,
    })
  })

  // Tek araç, tek feature: balonun çapası da bu yüzden kopmaz.
  assert.equal(source.getFeatures().length, 1)
  assert.equal(features[0], features[1])
  assert.equal(features[1], features[2])

  assert.deepEqual(
    features[2].getGeometry().getCoordinates(),
    fromLonLat([30.3, 40.3]),
  )
})

/* --- TEK OTORİTE: bir anlık görüntü DÖRT yüzeyi birden ilerletir ------------ */

test('tek bir anlık görüntü panel, balon, navigasyon ve işaretçiyi TUTARLI ilerletir', () => {
  const source = new VectorSource()
  let latest = null

  const observed = SEQUENCE.map((incoming) => {
    // Kancanın yaptığı tek yazma: kabul edilen son anlık görüntü.
    latest = applyJourneySnapshot(latest, incoming)

    const live = journeyLiveModel({ simulation: SIMULATION, snapshot: latest })
    const navigation = journeyNavigationModel({
      steps: SIMULATION.steps,
      currentStepSequence: live.currentStepSequence,
    })
    const popup = journeyVehiclePopupModel({ simulation: SIMULATION, snapshot: latest })
    const feature = syncJourneyVehicleFeature(source, {
      simulationId: live.simulationId,
      profileId: SIMULATION.requestedProfile,
      longitude: live.longitude,
      latitude: live.latitude,
    })

    return {
      panelPercent: live.progressPercent,
      popupPercent: popup.progressPercent,
      currentSequence: navigation.current.sequence,
      popupCurrentSequence: popup.currentStep.sequence,
      markerLongitude: feature.getGeometry().getCoordinates()[0],
    }
  })

  assert.deepEqual(observed.map((entry) => entry.panelPercent), [0, 15, 30])
  assert.deepEqual(observed.map((entry) => entry.popupPercent), [0, 15, 30])
  assert.deepEqual(observed.map((entry) => entry.currentSequence), [0, 1, 2])
  assert.deepEqual(observed.map((entry) => entry.popupCurrentSequence), [0, 1, 2])

  // İşaretçi de her adımda gerçekten YER DEĞİŞTİRDİ.
  assert.ok(observed[0].markerLongitude < observed[1].markerLongitude)
  assert.ok(observed[1].markerLongitude < observed[2].markerLongitude)
})

test('bir sonraki anlık görüntü gelene kadar hiçbir yüzey KENDİ BAŞINA ilerlemez', () => {
  /* Tarayıcı ilerleme HESAPLAMAZ: aynı anlık görüntüden iki kez türetilen
     sunum birebir aynıdır. Bir zamanlayıcı ya da tahmin devreye girseydi bu
     iddia tutmazdı. */
  const first = journeyVehiclePopupModel({ simulation: SIMULATION, snapshot: SEQUENCE[1] })
  const second = journeyVehiclePopupModel({ simulation: SIMULATION, snapshot: SEQUENCE[1] })

  assert.deepEqual(first, second)
})

/* --- CANLI KANALIN YAŞAM DÖNGÜSÜ -------------------------------------------- */

test('sökülme bayrağı MONTAJA aittir: yeniden montajda sıfırlanır', () => {
  /* GERÇEK ARIZA BUYDU. `disposedRef` yalnızca temizlikte `true` yazılıp bir
     daha hiç sıfırlanmadığı için, React'in aynı örneği söküp yeniden monte
     ettiği her durumda (geliştirmede `StrictMode` bunu HER montajda yapar;
     `useRef` kutuları bu sırada korunur) bayrak kalıcı olarak `true`
     kalıyordu. Sonuç: `ensureConnection` `null` dönüyor, `JoinSimulation` hiç
     çağrılmıyor ve gelen her anlık görüntü `applyUpdate`'in ilk satırında
     düşüyordu — panel, balon ve işaretçi %0'da donuyordu. */
  const effect = SIM_HOOK.slice(SIM_HOOK.indexOf('disposedRef.current = false'))

  assert.ok(
    SIM_HOOK.includes('disposedRef.current = false'),
    'sökülme bayrağı hiçbir yerde sıfırlanmıyor: yeniden montaj kanalı kalıcı olarak öldürür',
  )

  // Sıfırlama, temizliği KURAN etkinin gövdesinde olmalıdır.
  const cleanupIndex = effect.indexOf('disposedRef.current = true')
  assert.ok(cleanupIndex > 0, 'sıfırlama ile temizlik aynı etkide değil')
  assert.ok(
    effect.slice(0, cleanupIndex).includes('return () =>'),
    'sıfırlama kurulumda değil temizlikte yapılıyor',
  )
})

test('canlı durumun TEK sahibi vardır: gölge bir kopya tutulmaz', () => {
  /* Değişen tek şey `snapshot` state'idir. Aynı değeri ikinci bir ref'te
     aynalamak — hele render sırasında yazarak — ikinci bir gerçek kaynağı
     üretirdi: hangi kopyanın güncel olduğu artık okunarak anlaşılamazdı.
     Karşılaştırmanın doğru yeri İŞLEVSEL güncelleyicidir. */
  assert.ok(
    SIM_HOOK.includes('setSnapshot((current) => applyJourneySnapshot(current, incoming))'),
    'gelen olay işlevsel güncelleyiciyle uygulanmıyor: bayat bir closure okunabilir',
  )

  assert.ok(!SIM_HOOK.includes('snapshotRef'), 'anlık görüntünün gölge bir ref kopyası var')

  /* Yazma noktaları SAYILIDIR: bir işlevsel güncelleme, iki benimseme tohumu
     (taze başlatma + kurtarma) ve bir bırakma sıfırlaması. */
  assert.equal(SIM_HOOK.split('setSnapshot(').length - 1, 4)
  assert.equal(SIM_HOOK.split('setSnapshot(body.snapshot ?? null)').length - 1, 2)

  // Tarayıcı tarafında hiçbir hareket/ilerleme zamanlayıcısı yoktur.
  for (const timer of ['setInterval(', 'setTimeout(', 'requestAnimationFrame(']) {
    assert.ok(!SIM_HOOK.includes(timer), `kancada tarayıcı zamanlayıcısı var: ${timer}`)
  }
})

test('anlık görüntü güncellemesi canlı bağlantıyı SÖKMEZ', () => {
  /* Bağlantı ve dinleyici ref'lerde yaşar; hiçbir efekt `snapshot`a ya da
     `simulation`a bağlı olarak bağlantıyı kapatmaz. Aksi hâlde ilk anlık
     görüntü kendi kanalını öldürürdü. */
  const teardownEffects = SIM_HOOK
    .split('useEffect(')
    .slice(1)
    .filter((body) => body.includes('connectionRef.current?.stop'))

  assert.equal(teardownEffects.length, 1, 'bağlantıyı kapatan birden fazla efekt var')

  const deps = teardownEffects[0].match(/\}\s*,\s*\[([^\]]*)\]\s*\)/)
  assert.ok(deps, 'sökülme efektinin bağımlılık dizisi okunamadı')
  assert.equal(deps[1].trim(), '', 'sökülme efekti bir duruma bağlı: her güncellemede kanalı kapatır')

  // Dinleyici ömür boyu TEK kez kaydedilir; kayıt bir efektin içinde değildir.
  assert.ok(SIM_HOOK.includes('connection.on(JOURNEY_UPDATED_EVENT, applyUpdate)'))
  assert.equal(SIM_HOOK.split('connection.on(JOURNEY_UPDATED_EVENT').length - 1, 1)
})

test('yeniden bağlanma GÜNCEL çalıştırmaya yeniden katılır', () => {
  const reconnected = SIM_HOOK.slice(SIM_HOOK.indexOf('connection.onreconnected'))

  assert.ok(reconnected.includes('joinedRef.current'), 'yeniden katılım hangi çalıştırmaya olacağını bilmiyor')
  assert.ok(
    reconnected.slice(0, reconnected.indexOf('})')).includes(
      'connection.invoke(JOIN_SIMULATION_METHOD, active)'),
    'yeniden bağlandıktan sonra JoinSimulation çağrılmıyor',
  )
})

test('JoinSimulation BENİMSENEN çalıştırma kimliğiyle çağrılır', () => {
  const join = SIM_HOOK.slice(SIM_HOOK.indexOf('const join = useCallback'))

  assert.ok(join.includes('joinedRef.current = simulationId'))
  assert.ok(join.includes('connection.invoke(JOIN_SIMULATION_METHOD, simulationId)'))

  // Hem taze başlatma hem kurtarma AYNI kimliği benimser.
  assert.ok(SIM_HOOK.includes('await join(body.simulationId)'))
  assert.equal(SIM_HOOK.split('await join(body.simulationId)').length - 1, 2)
})

/* --- DURDURMA ZİNCİRİ ------------------------------------------------------- */

test('durdurma düğmesi MapPage geri çağrısını uyandırır', () => {
  assert.ok(
    PANEL.includes('onClick={onStopSimulation}'),
    'durdurma düğmesi geri çağrıyı çağırmıyor',
  )

  // Düğme bir formun içinde değildir ve gönderim yapmaz.
  assert.ok(!PANEL.includes('<form'), 'panel bir form içeriyor: tıklama gönderime dönüşebilir')
  const button = PANEL.slice(PANEL.indexOf('journey-danger'))
  assert.ok(button.slice(0, button.indexOf('</button>')).includes('Simülasyonu Durdur'))

  // Sayfa bunu durdurma İSTEĞİNE bağlar; doğrudan `stop`a değil.
  assert.ok(MAP_PAGE.includes('onStopSimulation={requestJourneyStop}'))
})

test('requestJourneyStop yalnızca bekleyen onayı açar', () => {
  const body = declarationOf(MAP_PAGE, 'requestJourneyStop')

  assert.ok(body.includes('setJourneyStopPending(true)'))
  // Onay sorulmadan sunucuya istek GİTMEZ.
  assert.ok(!body.includes('journeySimulation.stop'))
})

test('ConfirmDialog açık bayrağını bekleyen durumdan alır', () => {
  const dialog = MAP_PAGE.slice(MAP_PAGE.indexOf('open={journeyStopPending}'))
  const block = dialog.slice(0, dialog.indexOf('/>'))

  assert.ok(dialog.startsWith('open={journeyStopPending}'), 'diyalog bekleyen duruma bağlı değil')
  assert.ok(block.includes('onConfirm={confirmJourneyStop}'))
  assert.ok(block.includes('setJourneyStopPending(false)'), 'vazgeçmek bekleyen durumu temizlemiyor')
  assert.ok(block.includes('busy={journeyStopping}'))
})

test('vazgeçmek YALNIZCA bekleyen durumu temizler; sunucuya gitmez', () => {
  const dialog = MAP_PAGE.slice(MAP_PAGE.indexOf('open={journeyStopPending}'))
  const cancel = dialog.slice(dialog.indexOf('onCancel='), dialog.indexOf('/>'))

  assert.ok(cancel.includes('setJourneyStopPending(false)'))
  assert.ok(!cancel.includes('stop('))
})

test('onaylamak durdurmayı TAM BİR KEZ çağırır', () => {
  const body = declarationOf(MAP_PAGE, 'confirmJourneyStop')

  // Çift gönderim hem ref hem de `busy` ile kapatılır.
  assert.ok(body.includes('if (journeyStopInFlight.current) return'))
  assert.ok(body.includes('journeyStopInFlight.current = true'))
  assert.equal(body.split('journeySimulation.stop()').length - 1, 1)
  // Sonuç ne olursa olsun onay penceresi kapanır.
  assert.ok(body.includes('setJourneyStopPending(false)'))
})

test('başarılı durdurma TERMİNAL yaşam döngüsüne geçirir', () => {
  const cancelled = {
    ...snapshotAt(30, 2, 25),
    status: JOURNEY_SIMULATION_STATUS.CANCELLED,
  }

  const latest = applyJourneySnapshot(SEQUENCE[2], cancelled)
  const live = journeyLiveModel({ simulation: SIMULATION, snapshot: latest })

  assert.equal(live.isTerminal, true)
  assert.equal(
    journeyStatusIndicator({ simulation: SIMULATION, snapshot: latest }).label,
    'Yolculuk iptal edildi',
  )

  // Terminal balonu da aynı otoriteyi okur; ayrı bir metin üretmez.
  assert.equal(
    journeyVehiclePopupModel({ simulation: SIMULATION, snapshot: latest }).statusLabel,
    'İptal Edildi',
  )
})

/* --- BALON ÖMRÜ: her tick'te yeniden yaratılmaz ----------------------------- */

test('balon overlay ömrü AÇIKLIĞA bağlıdır, anlık görüntüye değil', () => {
  /* Overlay'i her yeni anlık görüntüde kurup sökmek, balonu her saniye
     kapatıp yeniden açmak demekti: canlı içerik hiç okunamazdı. */
  const overlayEffect = POPUP.split('useEffect(')[1]
  const deps = overlayEffect.match(/\}\s*,\s*\[([^\]]*)\]\s*\)/)

  assert.ok(deps, 'overlay efektinin bağımlılıkları okunamadı')
  assert.deepEqual(
    deps[1].split(',').map((name) => name.trim()).filter(Boolean),
    ['map', 'active'],
    'overlay ömrü canlı modele bağlanmış: her tick yeni overlay üretir',
  )

  // Çapa AYRI bir efektte, son modelden taşınır.
  assert.ok(POPUP.includes('overlay.setPosition('))
})
