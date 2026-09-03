import assert from 'node:assert/strict'
import test from 'node:test'
import {
  HISTORY_FILTERS,
  HISTORY_STATUSES,
  JOURNEY_HISTORY_MESSAGES,
  historyFilterStatus,
  historyStatusLabel,
  historyStatusTone,
  journeyHistoryDetail,
  journeyHistoryDraft,
  journeyHistoryErrorMessage,
  journeyHistoryList,
  journeyHistoryPage,
  journeyHistorySummary,
} from '../../src/map/journeyHistory.js'
import {
  JOURNEY_MODES,
  JOURNEY_PROFILE_IDS,
  PERSONAL_SECTIONS,
  WAYPOINT_SOURCES,
  initialJourneyPlannerState,
  journeyDraftFromDefinition,
  journeyModeLabel,
  journeyPlannerReducer,
} from '../../src/map/journeyPlanning.js'
import { JOURNEY_SIMULATION_STATUS } from '../../src/map/journeySimulationState.js'
import { savedJourneyDraft, savedJourneyModeLabel } from '../../src/map/savedJourneys.js'
import { formatRouteDistance, formatRouteDuration } from '../../src/map/transportPathPresentation.js'

const row = (overrides = {}) => ({
  id: 12,
  simulationId: '2f7d1f3e-0000-4000-8000-000000000001',
  mode: JOURNEY_MODES.WAYPOINTS,
  profile: 'walking',
  terminalStatus: HISTORY_STATUSES.COMPLETED,
  startedAt: '2026-09-04T08:00:00Z',
  endedAt: '2026-09-04T08:00:11Z',
  durationSeconds: 100,
  distanceMeters: 4200,
  coveredDistanceMeters: 4200,
  routeDisplayName: null,
  originName: 'A Durağı',
  destinationName: 'Eski Kütüphane',
  pointCount: 2,
  ...overrides,
})

/* --- Durum sözleşmesi ---------------------------------------------------------- */

test('history reuses the live status vocabulary instead of inventing a second one', () => {
  /* Aynı olguyu iki kelimeyle anlatmak, bir gün "Completed" ile "Finished"in
     yan yana yaşaması demekti. */
  assert.equal(HISTORY_STATUSES.COMPLETED, JOURNEY_SIMULATION_STATUS.COMPLETED)
  assert.equal(HISTORY_STATUSES.CANCELLED, JOURNEY_SIMULATION_STATUS.CANCELLED)

  // Çalışan bir yolculuk GEÇMİŞ DEĞİLDİR ve bu kümede yeri yoktur.
  assert.equal(Object.values(HISTORY_STATUSES).includes(JOURNEY_SIMULATION_STATUS.RUNNING), false)
})

test('both terminal outcomes carry visible Turkish text', () => {
  assert.equal(historyStatusLabel(HISTORY_STATUSES.COMPLETED), 'Tamamlandı')
  assert.equal(historyStatusLabel(HISTORY_STATUSES.CANCELLED), 'İptal Edildi')

  // Bilinmeyen bir durum çökertmez ve boş da bırakmaz.
  assert.equal(historyStatusLabel('nonsense'), 'Sona erdi')
  assert.equal(historyStatusLabel(undefined), 'Sona erdi')
})

test('tone is only a scanning aid — the label never depends on it', () => {
  assert.equal(historyStatusTone(HISTORY_STATUSES.COMPLETED), 'done')
  assert.equal(historyStatusTone(HISTORY_STATUSES.CANCELLED), 'stopped')
  assert.equal(historyStatusTone('nonsense'), 'neutral')

  /* Renk tek başına bilgi taşımaz: her tonun karşılığında okunabilir bir metin
     vardır. */
  for (const status of [HISTORY_STATUSES.COMPLETED, HISTORY_STATUSES.CANCELLED, 'nonsense']) {
    assert.ok(historyStatusLabel(status).length > 0)
  }
})

test('the filter set stays to the one cheap axis', () => {
  assert.deepEqual(HISTORY_FILTERS.map((filter) => filter.id), ['all', 'completed', 'cancelled'])

  // "Tümü" sunucuya süzgeç GÖNDERMEZ.
  assert.equal(historyFilterStatus('all'), null)
  assert.equal(historyFilterStatus('completed'), HISTORY_STATUSES.COMPLETED)
  assert.equal(historyFilterStatus('cancelled'), HISTORY_STATUSES.CANCELLED)

  // Bilinmeyen bir süzgeç sessizce "hepsi"dir; istek yine geçerli kalır.
  assert.equal(historyFilterStatus('nonsense'), null)
})

/* --- Liste satırı --------------------------------------------------------------- */

test('a row shows the profile as text and summarises the endpoints', () => {
  const summary = journeyHistorySummary(row())

  // Profil METİNDİR: yalnız ikon, ekran okuyucuya hiçbir şey söylemez.
  assert.equal(summary.profileLabel, 'Yürüyüş')
  assert.equal(summary.profileId, 'walking')
  assert.equal(summary.modeLabel, 'Serbest')
  assert.equal(summary.endpointsLabel, 'A Durağı → Eski Kütüphane')
  assert.equal(summary.statusLabel, 'Tamamlandı')
})

test('the shown duration is the engines travel time, not the playback wall clock', () => {
  /* ASIL İDDİA: kişisel simülasyon bir demo çarpanıyla oynatılır. Damgalar
     arasındaki fark (11 sn) gösterimin ne kadar sürdüğünü söyler; yolculuğun
     ne kadar sürdüğünü motorun ölçtüğü süre (100 sn) söyler. */
  const summary = journeyHistorySummary(row())

  assert.equal(summary.durationLabel, formatRouteDuration(100))
  assert.notEqual(summary.durationLabel, formatRouteDuration(11))

  // Damgalar da kaybolmaz: "ne zaman" ayrı bir sorudur ve ayrı gösterilir.
  assert.ok(summary.startedLabel.length > 1)
  assert.ok(summary.endedLabel.length > 1)
  assert.notEqual(summary.startedLabel, '—')
})

test('distance and duration reuse the shared formatters rather than a second dialect', () => {
  const summary = journeyHistorySummary(row({ distanceMeters: 4200, durationSeconds: 480 }))

  assert.equal(summary.distanceLabel, formatRouteDistance(4200))
  assert.equal(summary.durationLabel, formatRouteDuration(480))

  // Kısa mesafe metre, uzun mesafe kilometre okur.
  assert.equal(journeyHistorySummary(row({ distanceMeters: 850 })).distanceLabel, '850 m')
})

test('the covered distance is shown only where it says something new', () => {
  /* Tamamlanan yolculukta kat edilen mesafe toplamla aynıdır; iki eşit sayıyı
     yan yana yazmak gürültü olurdu. */
  assert.equal(journeyHistorySummary(row()).coveredLabel, null)

  const cancelled = journeyHistorySummary(row({
    terminalStatus: HISTORY_STATUSES.CANCELLED,
    coveredDistanceMeters: 1200,
  }))

  // Yarıda durdurulan yolculukta "ne kadarını yaptım" ayrı bir olgudur.
  assert.equal(cancelled.coveredLabel, formatRouteDistance(1200))
  assert.equal(cancelled.isCompleted, false)
})

test('a row never invents an endpoint summary it was not given', () => {
  const full = journeyHistorySummary(row({
    mode: JOURNEY_MODES.ROUTE_FULL,
    originName: null,
    destinationName: null,
    routeDisplayName: '11A',
  }))

  assert.equal(full.modeLabel, 'Hat')
  assert.equal(full.endpointsLabel, '11A')

  const bare = journeyHistorySummary(row({
    originName: null, destinationName: null, routeDisplayName: null,
  }))
  assert.equal(bare.endpointsLabel, '')
})

test('an unknown profile is not passed off as a supported one', () => {
  const summary = journeyHistorySummary(row({ profile: 'bus' }))

  assert.equal(summary.profileId, null)
  assert.equal(summary.profileLabel, '—')

  // Üç profil KORUNUR ve dördüncüsü yoktur.
  assert.deepEqual([...JOURNEY_PROFILE_IDS], ['driving', 'walking', 'cycling'])
})

test('rows without an identity are dropped instead of rendered blank', () => {
  assert.equal(journeyHistoryList([null, {}, row()]).length, 1)
  assert.deepEqual(journeyHistoryList(undefined), [])
  assert.equal(journeyHistorySummary(null), null)
})

test('the list keeps the order the server sent', () => {
  /* Sıra SUNUCUNUNDUR (en son biten en üstte). Tarayıcıda yeniden sıralamak,
     sayfalar arasında satır tekrarı ya da kaybı demekti. */
  const items = journeyHistoryList([row({ id: 3 }), row({ id: 1 }), row({ id: 2 })])

  assert.deepEqual(items.map((item) => item.id), [3, 1, 2])
})

/* --- Sayfa -------------------------------------------------------------------- */

test('whether more pages exist is answered by the server, not guessed', () => {
  const middle = journeyHistoryPage({
    items: [row()], page: 1, pageSize: 20, totalCount: 45, totalPages: 3,
  })

  assert.equal(middle.hasMore, true)
  assert.equal(middle.totalCount, 45)

  /* Son sayfada "daha fazla" YOKTUR: sayfayı doldurup "belki vardır" demek,
     boş bir düğme bırakırdı. */
  const last = journeyHistoryPage({
    items: [row()], page: 3, pageSize: 20, totalCount: 45, totalPages: 3,
  })
  assert.equal(last.hasMore, false)

  const empty = journeyHistoryPage({ items: [], page: 1, pageSize: 20, totalCount: 0, totalPages: 0 })
  assert.equal(empty.hasMore, false)
  assert.deepEqual(empty.items, [])
})

test('a malformed page body degrades to an empty first page', () => {
  const page = journeyHistoryPage(null)

  assert.deepEqual(page.items, [])
  assert.equal(page.page, 1)
  assert.equal(page.hasMore, false)
})

/* --- Ayrıntı ------------------------------------------------------------------ */

const detailRecord = (overrides = {}) => ({
  ...row(),
  routeId: null,
  points: [
    { sequence: 1, source: WAYPOINT_SOURCES.POI, referenceId: 42, displayName: 'Eski Kütüphane', role: 'destination' },
    { sequence: 0, source: WAYPOINT_SOURCES.STOP, referenceId: 11, displayName: 'A Durağı', role: 'origin' },
  ],
  ...overrides,
})

test('the detail renders historical names without consulting any live record', () => {
  const detail = journeyHistoryDetail(detailRecord())

  /* ASIL İDDİA: gösterim TUTANAĞIN kendi kopyalarındandır. Girdide POI'nin
     güncel adı, konumu ya da varlığı YOKTUR — yine de ekran doludur. */
  assert.deepEqual(detail.points.map((point) => point.name), ['A Durağı', 'Eski Kütüphane'])
  assert.deepEqual(detail.points.map((point) => point.roleLabel), ['Başlangıç', 'Varış'])
})

test('points are ordered by their recorded sequence, not by the array they arrived in', () => {
  const detail = journeyHistoryDetail(detailRecord())

  assert.deepEqual(detail.points.map((point) => point.sequence), [0, 1])
})

test('the detail model does not carry canonical ids into the view', () => {
  const detail = journeyHistoryDetail(detailRecord())

  /* Kanonik kimliklerin EKRANDA işi yoktur; onları yalnızca sunucu, yeniden
     yapma yolunda okur. */
  for (const point of detail.points) {
    assert.equal('referenceId' in point, false)
    assert.equal('source' in point, false)
  }
})

test('a detail without an identity produces no model', () => {
  assert.equal(journeyHistoryDetail(null), null)
  assert.equal(journeyHistoryDetail({}), null)
})

/* --- Planlayıcıya yükleme ------------------------------------------------------- */

test('loading a historical journey rebuilds the draft from canonical ids', () => {
  const draft = journeyHistoryDraft(detailRecord())

  assert.equal(draft.mode, JOURNEY_MODES.WAYPOINTS)
  assert.equal(draft.profile, 'walking')
  assert.deepEqual(
    draft.waypoints.map((slot) => [slot.reference.source, slot.reference.id]),
    [[WAYPOINT_SOURCES.STOP, 11], [WAYPOINT_SOURCES.POI, 42]],
  )

  /* Tarihsel ad yalnızca ETİKETTİR ve isteğe hiç girmez; sunucu noktayı
     kimliğinden çözer. */
  assert.equal(draft.waypoints[0].reference.label, 'A Durağı')
})

test('the draft never resurrects the historical run', () => {
  const draft = journeyHistoryDraft(detailRecord())

  /* ASIL İDDİA: taslakta bir çalıştırma kimliği YOKTUR. Yüklemek, eski
     yolculuğu diriltmek değildir. */
  for (const forbidden of ['simulationId', 'terminalStatus', 'startedAt', 'endedAt', 'distanceMeters']) {
    assert.equal(forbidden in draft, false)
  }

  // Koordinat da taşınmaz: konum sunucuda çözülür.
  for (const slot of draft.waypoints) {
    assert.equal('longitude' in slot.reference, false)
    assert.equal('latitude' in slot.reference, false)
  }
})

test('a full-route history is rebuilt from the line, not from its recorded endpoints', () => {
  /* Kayıttaki iki uç TARİHSEL gösterim içindir. Hatta o günden beri durak
     eklenmişse yeniden kurulan yolculuk onları da içermelidir. */
  const draft = journeyHistoryDraft(detailRecord({
    mode: JOURNEY_MODES.ROUTE_FULL,
    routeId: 7,
  }))

  assert.equal(draft.mode, JOURNEY_MODES.ROUTE_FULL)
  assert.equal(draft.routeId, 7)
  assert.equal(draft.waypoints, null)
})

test('a segment history is rebuilt from its two recorded stops', () => {
  const draft = journeyHistoryDraft(detailRecord({
    mode: JOURNEY_MODES.ROUTE_SEGMENT,
    routeId: 7,
    points: [
      { sequence: 0, source: WAYPOINT_SOURCES.STOP, referenceId: 11, displayName: 'A' },
      { sequence: 1, source: WAYPOINT_SOURCES.STOP, referenceId: 12, displayName: 'B' },
    ],
  }))

  assert.equal(draft.fromStopId, 11)
  assert.equal(draft.toStopId, 12)
  assert.equal(draft.waypoints, null)
})

test('a record that cannot be rebuilt produces no draft rather than a half one', () => {
  assert.equal(journeyHistoryDraft(null), null)
  assert.equal(journeyHistoryDraft(detailRecord({ mode: 'nonsense' })), null)
  assert.equal(journeyHistoryDraft(detailRecord({ points: [] })), null)
  assert.equal(journeyHistoryDraft(detailRecord({ mode: JOURNEY_MODES.ROUTE_FULL, routeId: null })), null)
})

/* --- Paylaşılan taslak kuralı ---------------------------------------------------- */

test('saved journeys and history rebuild drafts through the same rule', () => {
  /* İki kavram AYRI kalır ama "bir tanım nasıl taslağa döner" sorusunun tek
     bir cevabı vardır; iki kopya, zamanla iki farklı yükleme davranışına
     dönüşürdü. */
  const definition = {
    id: 5,
    mode: JOURNEY_MODES.WAYPOINTS,
    profile: 'cycling',
    points: [
      { sequence: 0, source: WAYPOINT_SOURCES.STOP, referenceId: 11, displayName: 'A' },
      { sequence: 1, source: WAYPOINT_SOURCES.POI, referenceId: 42, displayName: 'B' },
    ],
  }

  const fromHistory = journeyHistoryDraft(definition)
  const fromSaved = savedJourneyDraft(definition)
  const shared = journeyDraftFromDefinition(definition)

  for (const draft of [fromHistory, fromSaved]) {
    assert.equal(draft.mode, shared.mode)
    assert.equal(draft.profile, shared.profile)
    assert.deepEqual(
      draft.waypoints.map((slot) => slot.reference.id),
      shared.waypoints.map((slot) => slot.reference.id),
    )
  }

  /* Yuvalar YENİ anahtarlarla kurulur: iki yükleme aynı anahtarı paylaşmaz,
     yoksa silahlı bir yuva kazara yeni listede yaşamaya devam ederdi. */
  assert.notEqual(fromHistory.waypoints[0].key, fromSaved.waypoints[0].key)
})

test('the mode label has a single owner shared by both products', () => {
  for (const mode of Object.values(JOURNEY_MODES)) {
    assert.equal(savedJourneyModeLabel(mode), journeyModeLabel(mode))
    assert.equal(journeyHistorySummary(row({ mode })).modeLabel, journeyModeLabel(mode))
  }

  assert.equal(journeyModeLabel('nonsense'), '—')
})

/* --- Hata metinleri --------------------------------------------------------------- */

test('server text is shown for the classes that describe the users own record', () => {
  assert.equal(
    journeyHistoryErrorMessage(404, '“Eski Kütüphane” adlı POI artık mevcut değil.'),
    '“Eski Kütüphane” adlı POI artık mevcut değil.',
  )
  assert.equal(journeyHistoryErrorMessage(404, ''), JOURNEY_HISTORY_MESSAGES.notFound)
  assert.equal(journeyHistoryErrorMessage(403, 'her neyse'), JOURNEY_HISTORY_MESSAGES.forbidden)
})

test('unknown failures fall back to safe text instead of leaking the raw body', () => {
  for (const status of [0, 500, 502, 504]) {
    assert.equal(
      journeyHistoryErrorMessage(status, 'Npgsql.PostgresException: connection refused 5432'),
      JOURNEY_HISTORY_MESSAGES.loadFailed,
    )
  }

  assert.equal(
    journeyHistoryErrorMessage(500, 'stack trace', JOURNEY_HISTORY_MESSAGES.reuseFailed),
    JOURNEY_HISTORY_MESSAGES.reuseFailed,
  )
})

test('the empty state distinguishes an empty history from an empty filter', () => {
  assert.notEqual(JOURNEY_HISTORY_MESSAGES.empty, JOURNEY_HISTORY_MESSAGES.emptyFiltered)
  assert.match(JOURNEY_HISTORY_MESSAGES.empty, /tamamlanmış|iptal/i)
})

/* --- Kişisel bölümler -------------------------------------------------------------- */

test('the personal product now has three sections and still opens on planning', () => {
  assert.deepEqual(
    Object.values(PERSONAL_SECTIONS),
    ['plan', 'saved', 'history'],
  )

  assert.equal(initialJourneyPlannerState().section, PERSONAL_SECTIONS.PLAN)
})

test('switching to history keeps the draft and disarms map picking', () => {
  const armed = journeyPlannerReducer(
    initialJourneyPlannerState({ canUseTransport: false }),
    { type: 'setRoute', routeId: 4 },
  )
  const withSlot = journeyPlannerReducer(armed, { type: 'armSlot', key: armed.waypoints[0].key })

  const history = journeyPlannerReducer(withSlot, {
    type: 'setSection', section: PERSONAL_SECTIONS.HISTORY,
  })

  assert.equal(history.section, PERSONAL_SECTIONS.HISTORY)
  // Taslak DURUR: bölüm değiştirmek seçimleri silmez.
  assert.equal(history.routeId, 4)
  /* Silah BIRAKILIR: kişisel yuva ekranda değilken silahlı kalmak, haritadaki
     bir tıklamanın görünmeyen bir yuvaya yazması demekti. */
  assert.equal(history.activeSlotKey, null)
})

test('loading a historical journey returns the user to planning without starting anything', () => {
  const viewing = journeyPlannerReducer(
    initialJourneyPlannerState({ canUseTransport: false }),
    { type: 'setSection', section: PERSONAL_SECTIONS.HISTORY },
  )

  const loaded = journeyPlannerReducer(viewing, {
    type: 'loadSaved',
    draft: journeyHistoryDraft(detailRecord()),
  })

  assert.equal(loaded.section, PERSONAL_SECTIONS.PLAN)
  assert.deepEqual(loaded.waypoints.map((slot) => slot.reference.id), [11, 42])

  /* Durumda çalıştırmaya ait HİÇBİR ŞEY yoktur: yükleme bir simülasyon
     kurmaz. */
  for (const forbidden of ['simulationId', 'snapshot', 'following', 'starting']) {
    assert.equal(forbidden in loaded, false)
  }
})
