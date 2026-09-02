import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  NAVIGATION_UNAVAILABLE_TEXT,
  applyNavigationSnapshot,
  findNextStep,
  findStepBySequence,
  normalizeNavigationSteps,
  reconcileNavigation,
  sharedNavigationPresentation,
} from '../../src/map/sharedNavigation.js'
import { normalizeLiveUpdate, normalizeStatusSnapshot } from '../../src/map/transportSimulationState.js'

/**
 * PAYLAŞILAN hattın SUNUCU OTORİTELİ navigasyonu (Faz 5).
 *
 * Sınanan asıl iddia OTORİTENİN NEREDE OLMADIĞIDIR: tarayıcı hangi manevrada
 * olunduğuna karar vermez, adımı kendi ilerletmez, geometriden dönüş çıkarmaz
 * ve mesafe tahmin etmez. Yalnızca sunucudan gelmiş bir SIRAYA göre adım arar
 * ve onu Türkçeye çevirir.
 *
 * İkinci iddia KİMLİK GÜVENLİĞİDİR: adım listesi çalıştırmaya bağlıdır;
 * yerine geçen bir çalıştırma eskisinin listesinde aranmaz.
 */

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const NAV = stripComments(read('../../src/map/sharedNavigation.js'))
const HOOK = stripComments(read('../../src/hooks/useTransportSimulation.js'))
const MAP_PAGE = stripComments(read('../../src/pages/MapPage.jsx'))
const SHARED = read('../../src/components/map/SharedTransportJourneyContent.jsx')
/* Bileşenin KODU: bir kuralı ANLATAN yorum, o kuralı ÇİĞNEMEK değildir.
   Yoklukta hangi sınıfın kullanıldığını ölçerken yorumlar ayıklanır — aksi
   hâlde "`journey-error` DEĞİL" diye açıklayan bir yorum, kaba bir metin
   aramasında ihlal gibi görünürdü. */
const SHARED_CODE = stripComments(SHARED)
const STATE = stripComments(read('../../src/map/transportSimulationState.js'))

const ROUTE_A = 1
const ROUTE_B = 2
const ROUTE_C = 3

const RUN_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
const RUN_A2 = 'a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2'
const RUN_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
const RUN_C2 = 'c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2'

/** Sunucunun gönderdiği adım listesi. Sıra BOŞLUKLU verilir bilinçle. */
const serverSteps = () => ([
  { sequence: 0, maneuverType: 'depart', maneuverModifier: null, name: 'Atatürk Bulvarı', distanceMeters: 100, durationSeconds: 100 },
  { sequence: 5, maneuverType: 'turn', maneuverModifier: 'right', name: 'İnönü Caddesi', distanceMeters: 100, durationSeconds: 100 },
  { sequence: 9, maneuverType: 'arrive', maneuverModifier: null, name: null, distanceMeters: 100, durationSeconds: 100 },
])

const live = (overrides = {}) => normalizeLiveUpdate({
  simulationId: RUN_A,
  routeId: ROUTE_A,
  status: 'Running',
  longitude: 30,
  latitude: 40,
  progressPercent: 40,
  updatedAtUtc: '2026-09-02T10:00:00Z',
  currentStepSequence: 5,
  distanceToNextManeuverMeters: 280,
  ...overrides,
})

const navigationFor = (simulationId = RUN_A, steps = serverSteps()) =>
  applyNavigationSnapshot({}, {
    routeId: ROUTE_A,
    simulationId,
    hasNavigationSteps: steps.length > 0,
    navigationSteps: steps,
  })[ROUTE_A]

/* --- 1-3. OTORİTER TALİMAT VE SIRA ÇÖZÜMÜ -------------------------------------- */

test('the selected route renders the authoritative current and next instruction', () => {
  const presentation = sharedNavigationPresentation({
    routeId: ROUTE_A,
    simulation: live(),
    navigation: navigationFor(),
  })

  assert.equal(presentation.available, true)

  // ŞİMDİ: sunucunun verdiği sıra (5) → "turn + right".
  assert.equal(presentation.current.sequence, 5)
  assert.equal(presentation.current.instruction, 'Sağa dönün')
  assert.equal(presentation.current.name, 'İnönü Caddesi')

  /* SONRAKİ: mesafe de SUNUCUDAN gelir ve burada yalnızca biçimlendirilir.
     "280 m sonra …" cümlesindeki sayı istemcide üretilmez. */
  assert.equal(presentation.next.sequence, 9)
  assert.match(presentation.next.text, /^280 m sonra /)
})

test('a step is resolved by its sequence value and never by array position', () => {
  const steps = normalizeNavigationSteps(serverSteps())

  // 5 numaralı adım dizinin 1. elemanıdır; ikisi karıştırılmaz.
  assert.equal(findStepBySequence(steps, 5).maneuverType, 'turn')
  assert.equal(steps[5], undefined)

  // Var olmayan sıra sessizce yanlış bir adıma düşmez.
  assert.equal(findStepBySequence(steps, 1), null)
  assert.equal(findStepBySequence(steps, null), null)

  /* SONRAKİ "sequence + 1" DEĞİLDİR: sunucu numaralarda boşluk bırakabilir. */
  assert.equal(findNextStep(steps, 0).sequence, 5)
  assert.equal(findNextStep(steps, 5).sequence, 9)
  assert.equal(findNextStep(steps, 9), null)
})

test('the presentation module never indexes a step list by sequence', () => {
  // Kısayolun kendisi bir SÖZLEŞME hatasıdır ve kaynakta bulunmamalıdır.
  assert.ok(!/steps\[\s*(sequence|currentStepSequence)\s*\]/.test(NAV))
  assert.match(NAV, /step\.sequence === target/)
})

/* --- 4-5. YOKLUK VE HAM DEĞER SIZINTISI ---------------------------------------- */

test('a route without maneuvers gets a calm unavailable message, not an error', () => {
  const presentation = sharedNavigationPresentation({
    routeId: ROUTE_A,
    simulation: live({ currentStepSequence: null, distanceToNextManeuverMeters: null }),
    navigation: navigationFor(RUN_A, []),
  })

  assert.equal(presentation.available, false)
  assert.equal(presentation.message, NAVIGATION_UNAVAILABLE_TEXT)
  assert.equal(presentation.current, null)
  assert.equal(presentation.next, null)

  /* Bu NORMAL bir durumdur, altyapı arızası değildir. Ölçü, YOKLUK DALININ
     KENDİSİNE daraltılır: koca bir bileşen bloğunda yasak sınıf aramak, o
     bileşendeki MEŞRU hata arayüzünü de yakalar ve testi kırılgan kılar. */
  const unavailableBranch = SHARED_CODE.slice(
    SHARED_CODE.indexOf('!navigation.available'),
    SHARED_CODE.indexOf('navigation.available && navigation.current'),
  )

  // Yokluk NÖTR bir bilgidir: not sınıfı ve `status` rolü.
  assert.match(
    unavailableBranch,
    /<p className="journey-note" role="status">\{navigation\.message\}<\/p>/,
  )

  // Ve dalın KENDİSİ hata anlambilimi TAŞIMAZ.
  assert.ok(!unavailableBranch.includes('journey-error'))
  assert.ok(!unavailableBranch.includes('role="alert"'))

  /* GERÇEK hata arayüzü AYRI ve YERİNDE durur: yokluğu nötrleştirmek,
     bileşenin hata yolunu kaldırmak DEĞİLDİR. */
  assert.match(SHARED_CODE, /\{shared\.error && <p className="journey-error" role="alert">/)

  // Ve o hata yolu navigasyon bloğunun İÇİNDE değildir.
  const navigationBlock = SHARED_CODE.slice(
    SHARED_CODE.indexOf('className="journey-nav"'),
    SHARED_CODE.indexOf('journey-actions'),
  )
  assert.ok(!navigationBlock.includes('shared.error'))
  assert.ok(!navigationBlock.includes('journey-error'))
})

test('no raw maneuver enum ever reaches the user', () => {
  const presentation = sharedNavigationPresentation({
    routeId: ROUTE_A,
    simulation: live(),
    navigation: navigationFor(),
  })

  for (const text of [presentation.current.instruction, presentation.next.text]) {
    for (const raw of ['turn', 'slight', 'roundabout', 'depart', 'arrive', 'uturn', '_']) {
      assert.ok(!text.includes(raw), `ham manevra değeri sızdı: ${raw}`)
    }
  }

  // Bileşen de ham alanı DOĞRUDAN basmaz.
  assert.ok(!SHARED.includes('maneuverType'))
  assert.ok(!SHARED.includes('maneuverModifier'))
})

/* --- 6-7. İSTEMCİ OTORİTESİ YOKTUR --------------------------------------------- */

test('the client performs no geometry analysis and no local step advancement', () => {
  /* Geometriden talimat çıkarmanın izleri: açı, yön vektörü, koordinat
     farkı. Hiçbiri bulunmamalıdır. */
  for (const forbidden of [
    'Math.atan', 'Math.atan2', 'bearing', 'heading', 'angle',
    'getCoordinates', 'fromLonLat', 'toLonLat', 'LineString',
  ]) {
    assert.ok(!NAV.includes(forbidden), `istemci geometriden çıkarım yapıyor: ${forbidden}`)
  }

  /* Adımı istemcide İLERLETMENİN izleri: sıra artırma, ilerlemeden adım
     türetme, yerel sayaç. */
  for (const forbidden of ['sequence + 1', 'sequence++', 'progressPercent *', 'setCurrentStep']) {
    assert.ok(!NAV.includes(forbidden), `istemci adımı kendi ilerletiyor: ${forbidden}`)
  }

  // Kanca da bir navigasyon kararı vermez: yalnızca taşır ve uzlaştırır.
  assert.ok(!HOOK.includes('currentStepSequence:'))
  assert.ok(!HOOK.includes('SequenceAt'))
})

test('the canonical state only carries the server navigation facts', () => {
  const snapshot = normalizeStatusSnapshot({
    simulationId: RUN_A,
    routeId: ROUTE_A,
    status: 'Running',
    longitude: 30,
    latitude: 40,
    progressRatio: 0.4,
    capturedAt: '2026-09-02T10:00:00Z',
    currentStepSequence: 5,
    distanceToNextManeuverMeters: 280,
  })

  assert.equal(snapshot.currentStepSequence, 5)
  assert.equal(snapshot.distanceToNextManeuverMeters, 280)

  /* YOKLUK sıfıra düşürülmez: manevrası olmayan hat ile "sonraki manevra yok"
     hâli, sıfır metre uzaklıktaki bir manevradan farklıdır. */
  const arriving = normalizeLiveUpdate({
    simulationId: RUN_A,
    routeId: ROUTE_A,
    status: 'Running',
    longitude: 30,
    latitude: 40,
    progressPercent: 100,
    updatedAtUtc: '2026-09-02T10:05:00Z',
    currentStepSequence: 9,
    distanceToNextManeuverMeters: null,
  })

  assert.equal(arriving.currentStepSequence, 9)
  assert.equal(arriving.distanceToNextManeuverMeters, null)

  // İkinci bir ilerleme motoru yoktur: durum modeli adım HESAPLAMAZ.
  assert.ok(!STATE.includes('startDistanceMeters'))
  assert.ok(!STATE.includes('navigationSteps'))
})

/* --- 8-10. YAŞAM DÖNGÜSÜ ------------------------------------------------------- */

test('pause changes nothing about the rendered navigation', () => {
  const navigation = navigationFor()

  const running = sharedNavigationPresentation({
    routeId: ROUTE_A, simulation: live(), navigation,
  })

  /* Sunucu duraklatmada AYNI sırayı ve AYNI mesafeyi yayınlar; istemci de
     bu yüzden aynı şeyi çizer. */
  const paused = sharedNavigationPresentation({
    routeId: ROUTE_A,
    simulation: live({ status: 'Paused' }),
    navigation,
  })

  assert.deepEqual(paused.current, running.current)
  assert.deepEqual(paused.next, running.next)
  assert.equal(paused.simulationId, running.simulationId)
})

test('resume continues from the server update and never jumps locally', () => {
  const navigation = navigationFor()

  const resumed = sharedNavigationPresentation({
    routeId: ROUTE_A,
    simulation: live({ status: 'Running', currentStepSequence: 5, distanceToNextManeuverMeters: 120 }),
    navigation,
  })

  // Adım DEĞİŞMEZ; yalnızca sunucunun bildirdiği mesafe azalır.
  assert.equal(resumed.current.sequence, 5)
  assert.match(resumed.next.text, /^120 m sonra /)
})

test('a replacement run never inherits the navigation of the run it replaced', () => {
  const navigation = navigationFor(RUN_A)

  // A yeniden başlatıldı: YENİ kimlik, %0, baştaki adım.
  const replacement = live({
    simulationId: RUN_A2,
    progressPercent: 0,
    currentStepSequence: 0,
    distanceToNextManeuverMeters: 100,
  })

  /* Eski liste KULLANILMAZ: kimlik tutmuyorsa navigasyon "mevcut değil"
     hâline düşer ve yerine geçen çalıştırmanın kendi listesi okunana kadar
     hiçbir talimat uydurulmaz. */
  const presentation = sharedNavigationPresentation({
    routeId: ROUTE_A,
    simulation: replacement,
    navigation,
  })

  assert.equal(presentation.available, false)
  assert.equal(presentation.simulationId, RUN_A2)

  // Ve uzlaştırma bayat kaydı düşürür.
  const byRoute = { [ROUTE_A]: replacement }
  assert.deepEqual(reconcileNavigation({ [ROUTE_A]: navigation }, byRoute), {})
})

/* --- YENİDEN BAŞLATMA HİDRATLAMASI (tarayıcı regresyonu) ----------------------
   Gerçek bir kabul hatasının testi: adımlar canlı akışta taşınmaz, bu yüzden
   YENİ bir çalıştırma kimliği doğuran her yol navigasyonu KENDİ otoriter
   yanıtından almak zorundadır. Hidratlama yalnızca OKUMA yoluna bağlıydı;
   Yeniden Başlat'tan sonra uzlaştırma eski kaydı (haklı olarak) düşürüyor ve
   panel adımları olan bir hatta "navigasyon mevcut değil" diyordu. */

/** Sunucunun tek-çalıştırma yanıtı (camelCase, sözleşmeyle birebir). */
const serverRunResponse = (simulationId, routeId = ROUTE_A, currentStepSequence = 0) => ({
  simulationId,
  routeId,
  status: 'Running',
  progressRatio: 0,
  capturedAt: '2026-09-02T10:10:00Z',
  longitude: 30,
  latitude: 40,
  hasNavigationSteps: true,
  navigationSteps: serverSteps(),
  currentStepSequence,
  distanceToNextManeuverMeters: 100,
})

test('the restart replacement is hydrated from its own authoritative response', () => {
  // 1. A'nın navigasyonu vardır ve 5 numaralı adımdadır.
  let store = applyNavigationSnapshot({}, {
    routeId: ROUTE_A, simulationId: RUN_A, hasNavigationSteps: true, navigationSteps: serverSteps(),
  })

  assert.equal(sharedNavigationPresentation({
    routeId: ROUTE_A, simulation: live(), navigation: store[ROUTE_A],
  }).current.sequence, 5)

  /* 2-3. Yeniden Başlat: sunucu ESKİ çalıştırmanın terminalini VE yeni
     çalıştırmayı kendi adım listesiyle döndürür. Terminal A, kaydı düşürür. */
  const replacementPayload = serverRunResponse(RUN_A2)
  const byRoute = { [ROUTE_A]: normalizeStatusSnapshot(replacementPayload) }

  assert.deepEqual(reconcileNavigation(store, byRoute), {})

  // 4. Yanıt HİDRATLANIR: kayıt B'nin kimliğiyle damgalanır.
  store = applyNavigationSnapshot(store, replacementPayload)
  assert.equal(store[ROUTE_A].simulationId, RUN_A2)

  const presentation = sharedNavigationPresentation({
    routeId: ROUTE_A, simulation: byRoute[ROUTE_A], navigation: store[ROUTE_A],
  })

  // 7. "Mevcut değil" GÖSTERİLMEZ; adımlar oradadır.
  assert.equal(presentation.available, true)

  // 5. B KENDİ ilk otoriter adımında başlar…
  assert.equal(presentation.current.sequence, 0)

  // 6. …ve A'nın eski sırasını DEVRALMAZ.
  assert.notEqual(presentation.current.sequence, 5)
  assert.equal(presentation.simulationId, RUN_A2)
})

test('a stale restart result can never hydrate the wrong identity', () => {
  const store = applyNavigationSnapshot({}, {
    routeId: ROUTE_A, simulationId: RUN_A2, hasNavigationSteps: true, navigationSteps: serverSteps(),
  })

  /* Bayat bir sonuç ESKİ kimlikle gelirse, kayıt onun adına yazılsa bile
     uzlaştırma onu düşürür: bağlayıcı gerçek `byRoute`tur. */
  const stale = applyNavigationSnapshot(store, serverRunResponse(RUN_A))
  assert.equal(stale[ROUTE_A].simulationId, RUN_A)

  const byRoute = { [ROUTE_A]: normalizeStatusSnapshot(serverRunResponse(RUN_A2)) }
  assert.deepEqual(reconcileNavigation(stale, byRoute), {})

  /* Ve sunum katmanı da kimliği DOĞRULAR: yanlış damgalı bir liste, yerine
     geçen çalıştırmanın talimatı olarak GÖSTERİLMEZ. */
  assert.equal(sharedNavigationPresentation({
    routeId: ROUTE_A,
    simulation: byRoute[ROUTE_A],
    navigation: stale[ROUTE_A],
  }).available, false)
})

test('batch restart hydrates each replacement independently and skips failures', () => {
  /* Kısmi yığın: 1 başarılı, 2 bayat, 3 başarılı. Sunucu yalnızca BAŞARILI
     sonuçlarda `simulation` doldurur. */
  const results = [
    { requestedRouteId: ROUTE_A, succeeded: true, resultCode: 'Succeeded', simulation: serverRunResponse(RUN_A2, ROUTE_A) },
    { requestedRouteId: ROUTE_B, succeeded: false, resultCode: 'Stale', simulation: null },
    { requestedRouteId: ROUTE_C, succeeded: true, resultCode: 'Succeeded', simulation: serverRunResponse(RUN_C2, ROUTE_C) },
  ]

  // B hattının MEVCUT kaydı; bayat sonuç ona DOKUNMAMALIDIR.
  let store = applyNavigationSnapshot({}, {
    routeId: ROUTE_B, simulationId: RUN_B, hasNavigationSteps: true, navigationSteps: serverSteps(),
  })
  const untouched = store[ROUTE_B]

  for (const result of results) {
    if (result.simulation) store = applyNavigationSnapshot(store, result.simulation)
  }

  // Her başarılı hat KENDİ yerine geçenini alır.
  assert.equal(store[ROUTE_A].simulationId, RUN_A2)
  assert.equal(store[ROUTE_C].simulationId, RUN_C2)

  // Başarısız hat AYNEN kalır: ilgisiz rotalar temizlenmez.
  assert.equal(store[ROUTE_B], untouched)
  assert.equal(store[ROUTE_B].simulationId, RUN_B)
})

test('reset clears navigation and creates no replacement to hydrate', () => {
  const store = applyNavigationSnapshot({}, {
    routeId: ROUTE_A, simulationId: RUN_A, hasNavigationSteps: true, navigationSteps: serverSteps(),
  })

  /* Sıfırlama sonucu `simulation` TAŞIMAZ (yerine yenisi konmaz), dolayısıyla
     hidratlanacak bir şey yoktur; terminal durum kaydı düşürür. */
  const resetResult = { requestedRouteId: ROUTE_A, succeeded: true, resultCode: 'Succeeded', simulation: null }
  assert.equal(resetResult.simulation, null)

  const byRoute = { [ROUTE_A]: live({ status: 'Cancelled' }) }
  assert.deepEqual(reconcileNavigation(store, byRoute), {})
})

test('pause and resume keep the same navigation identity', () => {
  const store = applyNavigationSnapshot({}, {
    routeId: ROUTE_A, simulationId: RUN_A, hasNavigationSteps: true, navigationSteps: serverSteps(),
  })

  /* Duraklat/Sürdür AYNI çalıştırmayı sürdürür: kimlik değişmez, dolayısıyla
     kayıt uzlaştırmayı geçer ve hidratlama onu aynı damgayla yeniden yazar. */
  for (const status of ['Paused', 'Running']) {
    const byRoute = { [ROUTE_A]: live({ status }) }
    assert.equal(reconcileNavigation(store, byRoute), store)

    const rehydrated = applyNavigationSnapshot(store, serverRunResponse(RUN_A, ROUTE_A, 5))
    assert.equal(rehydrated[ROUTE_A].simulationId, RUN_A)
  }
})

test('every path that creates a run identity hydrates navigation from its response', () => {
  /* ASIL REGRESYON BUDUR. Adım listesi canlı akışta taşınmaz; bu yüzden YENİ
     bir kimlik doğuran her yol onu kendi otoriter yanıtından almalıdır. Tek
     bir yola bağlamak (yalnızca okuma) tam olarak bu hatayı üretmişti. */
  assert.match(HOOK, /const hydrateNavigation = useCallback\(/)

  // ÜÇ çağrı yeri: okuma, başlatma ve toplu sonuç. Bildirim `useCallback(`
  // taşıdığı için bu sayıma girmez.
  assert.equal((HOOK.match(/hydrateNavigation\(/g) ?? []).length, 3)

  const startBody = HOOK.slice(HOOK.indexOf('const start = useCallback'), HOOK.indexOf('const stop = useCallback'))
  assert.match(startBody, /hydrateNavigation\(payload\)/)

  const batchBody = HOOK.slice(
    HOOK.indexOf('const runLifecycleBatch'),
    HOOK.indexOf('const managedRouteIds'),
  )
  assert.match(batchBody, /hydrateNavigation\(result\.simulation\)/)

  /* Ve hidratlama YALNIZCA başarılı sonuçlar için çağrılır: bayat hedefler
     `simulation` taşımaz. */
  assert.match(batchBody, /if \(result\?\.simulation\) \{/)

  // İKİNCİ bir uygulama yoktur: saf yazma tek yerden geçer.
  assert.equal((HOOK.match(/applyNavigationSnapshot\(/g) ?? []).length, 1)
})

/* --- 11, 15. KİMLİK VE ÇOK HATLI YALITIM --------------------------------------- */

test('navigation is stored per route and tagged with the exact run', () => {
  let store = applyNavigationSnapshot({}, {
    routeId: ROUTE_A, simulationId: RUN_A, hasNavigationSteps: true, navigationSteps: serverSteps(),
  })
  store = applyNavigationSnapshot(store, {
    routeId: ROUTE_B, simulationId: RUN_B, hasNavigationSteps: true, navigationSteps: [serverSteps()[0]],
  })

  assert.equal(store[ROUTE_A].simulationId, RUN_A)
  assert.equal(store[ROUTE_B].simulationId, RUN_B)
  assert.equal(store[ROUTE_A].steps.length, 3)
  assert.equal(store[ROUTE_B].steps.length, 1)

  /* Kimliksiz bir kayıt KURULAMAZ: "şu hatta ne varsa" bir navigasyon
     değildir ve mevcut kayıt da bozulmaz. */
  assert.deepEqual(applyNavigationSnapshot({}, { routeId: ROUTE_A, simulationId: null }), {})
  assert.equal(applyNavigationSnapshot(store, { routeId: null, simulationId: RUN_A }), store)
})

test('two active routes never contaminate each other', () => {
  const store = applyNavigationSnapshot(
    applyNavigationSnapshot({}, {
      routeId: ROUTE_A, simulationId: RUN_A, hasNavigationSteps: true, navigationSteps: serverSteps(),
    }),
    { routeId: ROUTE_B, simulationId: RUN_B, hasNavigationSteps: true, navigationSteps: serverSteps() },
  )

  const onA = sharedNavigationPresentation({
    routeId: ROUTE_A, simulation: live({ currentStepSequence: 0 }), navigation: store[ROUTE_A],
  })

  /* B hattının çalıştırması BAŞKA bir adımdadır ve A'nınkini etkilemez. */
  const onB = sharedNavigationPresentation({
    routeId: ROUTE_B,
    simulation: normalizeLiveUpdate({
      simulationId: RUN_B,
      routeId: ROUTE_B,
      status: 'Running',
      longitude: 30,
      latitude: 40,
      progressPercent: 90,
      updatedAtUtc: '2026-09-02T10:00:00Z',
      currentStepSequence: 9,
    }),
    navigation: store[ROUTE_B],
  })

  assert.equal(onA.current.sequence, 0)
  assert.equal(onB.current.sequence, 9)
  assert.notEqual(onA.simulationId, onB.simulationId)

  // Başka bir hattın çalıştırması seçili hattın bölümünü hiç açmaz.
  assert.equal(sharedNavigationPresentation({
    routeId: ROUTE_A, simulation: live({ routeId: ROUTE_B }), navigation: store[ROUTE_A],
  }), null)
})

/* --- 12-14. DURUM AYRIMLARI KORUNUR -------------------------------------------- */

test('navigation belongs to the selected context and owns none of the other concepts', () => {
  const body = MAP_PAGE.slice(
    MAP_PAGE.indexOf('const sharedNavigation = useMemo'),
    MAP_PAGE.indexOf('const selectActiveSimulationRow'),
  )

  // Girdi YALNIZCA seçili hat + kanonik durum + o hattın adım listesidir.
  assert.match(body, /routeId: selectedTransportRouteId/)
  assert.match(body, /simulation: simulation\.simulation/)
  assert.match(body, /simulation\.navigationByRoute\[selectedTransportRouteId\]/)

  /* İZLEME, TAKİP ve YÖNETİM navigasyona hiç girmez: hiçbiri bu bölümü açar
     ya da kapatır. */
  for (const forbidden of ['watchedRuns', 'followingRouteId', 'managedRuns']) {
    assert.ok(!body.includes(forbidden), `navigasyon başka bir kavrama bağlanmış: ${forbidden}`)
  }

  // Ve navigasyon hiçbir izleme/seçim/takip yazmaz.
  assert.ok(!NAV.includes('watched'))
  assert.ok(!NAV.includes('followed'))
  assert.ok(!NAV.includes('managed'))
})

/* --- 16-19. FAZ 4A/4B MİMARİSİ KORUNUR ----------------------------------------- */

test('one shared connection, the joinedRoutes ledger and no polling all remain', () => {
  assert.equal((HOOK.match(/createTransportSimulationHubClient\(\{/g) ?? []).length, 1)
  assert.ok(!HOOK.includes('HubConnectionBuilder'))
  assert.ok(!MAP_PAGE.includes('createTransportSimulationHubClient'))

  for (const forbidden of ['setInterval', 'setTimeout', 'requestAnimationFrame']) {
    assert.ok(!HOOK.includes(forbidden), `yoklama izi: ${forbidden}`)
    assert.ok(!NAV.includes(forbidden), `navigasyonda yoklama izi: ${forbidden}`)
  }

  /* MANTIKSAL sahiplik ile FİZİKSEL üyelik AYRI kalır; Faz 5 ona hiç
     dokunmaz. */
  const CLIENT = stripComments(read('../../src/services/transportSimulationClient.js'))
  assert.match(CLIENT, /joinedRoutes/)
  assert.match(CLIENT, /subscribedRoutes/)
  assert.ok(!CLIENT.includes('navigation'))
  assert.ok(!CLIENT.includes('currentStepSequence'))

  /* Adım listesi CANLI akıştan değil, OTORİTER OKUMA yanıtlarından gelir.

     ÖLÇÜ SÖZDİZİMİ DEĞİL, YAPIDIR. Eski hâli inline bir nesne edebiyatını
     (`applyNavigationSnapshot(current, {`) çivilemişti ve o gün doğruydu:
     hidratlama tek bir yerde, elle kurulmuş bir nesneyle yapılıyordu.
     Yeniden Başlat hatası hidratlamayı adlandırılmış TEK bir ilkelde
     topladı ve çağrı `applyNavigationSnapshot(current, payload)` oldu —
     iddia o anda korumak istediği şeyi bırakıp yazım biçimini korur hâle
     geldi. Korunan asıl şey üç parçadır ve üçü de aşağıda ölçülür. */

  // 1) TEK yazma yeri: ikinci bir hidratlama uygulaması YOKTUR.
  assert.equal((HOOK.match(/applyNavigationSnapshot\(/g) ?? []).length, 1)

  // 2) O tek yer, adlandırılmış ilkelin GÖVDESİDİR.
  const hydrationPrimitive = HOOK.slice(
    HOOK.indexOf('const hydrateNavigation = useCallback'),
    HOOK.indexOf('const client = useCallback'),
  )
  assert.match(hydrationPrimitive, /applyNavigationSnapshot\(current, payload\)/)

  /* 3) CANLI TICK HİDRATLAMAZ. Manevra listesi sabittir ve saniyede bir
     yeniden gönderilmez; canlı akış yalnızca DEĞİŞEN sırayı taşır. */
  const liveHandler = HOOK.slice(HOOK.indexOf('onUpdate:'), HOOK.indexOf('onActiveSetChanged:'))
  assert.ok(!liveHandler.includes('navigationSteps'))
  assert.ok(!liveHandler.includes('applyNavigationSnapshot'))
  assert.ok(!liveHandler.includes('hydrateNavigation'))
})

test('active discovery, watch and manage behaviour are untouched by navigation', () => {
  // Faz 4A/4B davranışı yerinde durur.
  assert.match(HOOK, /fetchActiveTransportSimulations\(\)/)
  assert.match(HOOK, /reconcileWatchedRuns\(current, byRoute\)/)
  assert.match(HOOK, /reconcileManagedRuns\(current, byRoute\)/)

  // Ve navigasyon da AYNI uzlaştırma ilkesini izler; ikinci bir tanım yok.
  assert.match(HOOK, /reconcileNavigation\(current, byRoute\)/)
})

/* --- 20. KİŞİSEL YOLCULUK ------------------------------------------------------ */

test('personal journey is unaffected and only its pure maneuver wording is reused', () => {
  const journeyHook = read('../../src/hooks/useJourneySimulation.js')

  for (const forbidden of ['sharedNavigation', 'navigationByRoute', 'currentStepSequence']) {
    assert.ok(!journeyHook.includes(forbidden), `kişisel yolculuk paylaşılana bağlanmış: ${forbidden}`)
  }

  /* Ortak olan TEK şey saf ve durumsuz manevra sözlüğüdür: girdi manevra meta
     verisi, çıktı Türkçe metin. Yaşam döngüsü, durum ve yetki AYRI kalır. */
  assert.match(NAV, /from '\.\/journeyManeuvers\.js'/)

  const maneuvers = stripComments(read('../../src/map/journeyManeuvers.js'))
  for (const forbidden of ['useState', 'useEffect', 'fetch(', 'authFetch', 'simulationId']) {
    assert.ok(!maneuvers.includes(forbidden), `paylaşılan sözlük durum taşıyor: ${forbidden}`)
  }
})
