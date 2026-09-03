import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_SAVED_JOURNEY_NAME_LENGTH,
  SAVED_JOURNEY_MESSAGES,
  savedJourneyDraft,
  savedJourneyErrorMessage,
  savedJourneyList,
  savedJourneyModeLabel,
  savedJourneySummary,
  savedJourneyTarget,
  validateSavedJourneyName,
} from '../../src/map/savedJourneys.js'
import {
  JOURNEY_MODES,
  JOURNEY_PROFILE_IDS,
  PERSONAL_SECTIONS,
  WAYPOINT_SOURCES,
  initialJourneyPlannerState,
  journeyPlannerReducer,
} from '../../src/map/journeyPlanning.js'

const reduce = (state, ...actions) => actions.reduce(journeyPlannerReducer, state)

const row = (overrides = {}) => ({
  id: 7,
  name: 'Ev → İş',
  mode: JOURNEY_MODES.WAYPOINTS,
  profile: 'walking',
  isFavorite: false,
  routeDisplayName: null,
  pointCount: 2,
  originName: 'Ev',
  destinationName: 'Ofis',
  createdDate: '2026-09-01T08:00:00Z',
  modifiedDate: '2026-09-02T09:30:00Z',
  ...overrides,
})

/* --- Ad doğrulaması ----------------------------------------------------------- */

test('a saved journey needs a name and the name is trimmed', () => {
  assert.equal(validateSavedJourneyName('  Ev → İş  ').name, 'Ev → İş')

  for (const blank of [undefined, null, '', '   ', 42]) {
    const result = validateSavedJourneyName(blank)
    assert.equal(result.ok, false)
    assert.equal(result.error, SAVED_JOURNEY_MESSAGES.nameRequired)
  }
})

test('the name limit matches the backend column rather than being invented here', () => {
  assert.equal(MAX_SAVED_JOURNEY_NAME_LENGTH, 120)

  assert.equal(validateSavedJourneyName('a'.repeat(MAX_SAVED_JOURNEY_NAME_LENGTH)).ok, true)

  const tooLong = validateSavedJourneyName('a'.repeat(MAX_SAVED_JOURNEY_NAME_LENGTH + 1))
  assert.equal(tooLong.ok, false)
  assert.equal(tooLong.error, SAVED_JOURNEY_MESSAGES.nameTooLong)
})

test('names are not forced to be unique — the same trip may be saved twice', () => {
  /* "Ev → İş" yolculuğunu farklı profillerle ya da farklı ara noktalarla
     birden fazla kez saklamak meşru bir kullanımdır; doğrulama bunu
     engellemez. */
  assert.equal(validateSavedJourneyName('Ev → İş').ok, true)
  assert.equal(validateSavedJourneyName('Ev → İş').ok, true)
})

/* --- Liste sunumu -------------------------------------------------------------- */

test('a list row shows the profile as text and summarises the endpoints', () => {
  const summary = savedJourneySummary(row())

  // Profil METİNDİR: yalnız ikon, ekran okuyucuya hiçbir şey söylemez.
  assert.equal(summary.profileLabel, 'Yürüyüş')
  assert.equal(summary.profileId, 'walking')
  assert.equal(summary.modeLabel, 'Serbest')
  assert.equal(summary.endpointsLabel, 'Ev → Ofis')
  assert.equal(summary.isFavorite, false)
})

test('a row never invents an endpoint summary it was not given', () => {
  /* Tam-hat kaydında nokta SAKLANMAZ: özet hattın kendisidir ve uydurma bir
     "başlangıç → varış" satırı üretilmez. */
  const full = savedJourneySummary(row({
    mode: JOURNEY_MODES.ROUTE_FULL,
    pointCount: 0,
    originName: null,
    destinationName: null,
    routeDisplayName: '11A',
  }))

  assert.equal(full.modeLabel, 'Hat')
  assert.equal(full.endpointsLabel, '11A')
  assert.equal(full.originName, null)

  const bare = savedJourneySummary(row({
    mode: JOURNEY_MODES.ROUTE_FULL,
    pointCount: 0,
    originName: null,
    destinationName: null,
    routeDisplayName: null,
  }))
  assert.equal(bare.endpointsLabel, '')
})

test('an unknown profile is not passed off as a supported one', () => {
  const summary = savedJourneySummary(row({ profile: 'bus' }))

  assert.equal(summary.profileId, null)
  assert.equal(summary.profileLabel, '—')

  // Üç profil KORUNUR ve dördüncüsü yoktur.
  assert.deepEqual([...JOURNEY_PROFILE_IDS], ['driving', 'walking', 'cycling'])
})

test('the list keeps the order the server sent', () => {
  /* Sıra SUNUCUNUNDUR (önce favoriler, sonra en son değişen). Tarayıcıda
     yeniden sıralamak, aynı listenin iki farklı görünümü demekti. */
  const items = savedJourneyList([
    row({ id: 3, isFavorite: true }),
    row({ id: 1 }),
    row({ id: 2 }),
  ])

  assert.deepEqual(items.map((item) => item.id), [3, 1, 2])
})

test('the list drops rows that carry no identity instead of rendering blanks', () => {
  assert.equal(savedJourneyList([null, {}, row()]).length, 1)
  assert.deepEqual(savedJourneyList(undefined), [])
})

test('every supported mode has a readable label', () => {
  assert.equal(savedJourneyModeLabel(JOURNEY_MODES.ROUTE_FULL), 'Hat')
  assert.equal(savedJourneyModeLabel(JOURNEY_MODES.ROUTE_SEGMENT), 'Hat Bölümü')
  assert.equal(savedJourneyModeLabel(JOURNEY_MODES.WAYPOINTS), 'Serbest')
  assert.equal(savedJourneyModeLabel('nonsense'), '—')
})

/* --- Hata metinleri ------------------------------------------------------------ */

test('server validation text is shown for the classes that describe the users own record', () => {
  /* 400/404/409 kullanıcının KENDİ kaydıyla ilgilidir ve sunucunun metni
     hangi noktanın çözülemediğini söyler — en yararlı olan odur. */
  assert.equal(
    savedJourneyErrorMessage(404, '“Kütüphane” adlı POI artık mevcut değil.'),
    '“Kütüphane” adlı POI artık mevcut değil.',
  )
  assert.equal(savedJourneyErrorMessage(404, ''), SAVED_JOURNEY_MESSAGES.notFound)
  assert.equal(savedJourneyErrorMessage(403, 'her neyse'), SAVED_JOURNEY_MESSAGES.forbidden)
})

test('unknown failures fall back to safe text instead of leaking the raw body', () => {
  for (const status of [0, 500, 502, 504]) {
    assert.equal(
      savedJourneyErrorMessage(status, 'Npgsql.PostgresException: connection refused 5432'),
      SAVED_JOURNEY_MESSAGES.reuseFailed,
    )
  }

  assert.equal(
    savedJourneyErrorMessage(500, 'stack trace', SAVED_JOURNEY_MESSAGES.loadFailed),
    SAVED_JOURNEY_MESSAGES.loadFailed,
  )
})

/* --- Bayat niyete karşı koruma -------------------------------------------------- */

test('an action target is frozen from the list at the moment it is requested', () => {
  const items = savedJourneyList([row({ id: 1, name: 'A' }), row({ id: 2, name: 'B' })])

  const target = savedJourneyTarget(items, 1)
  assert.deepEqual({ ...target }, { id: 1, name: 'A' })

  /* ASIL İDDİA: A için açılan onay, sonradan B seçilse — hatta liste tümüyle
     değişse — bile hâlâ A'yı hedefler. */
  const later = savedJourneyList([row({ id: 2, name: 'B' })])
  assert.equal(target.id, 1)
  assert.equal(savedJourneyTarget(later, 2).id, 2)

  // Hedef değişmez: kaza eseri güncellenemez.
  assert.throws(() => { target.id = 2 })
})

test('an unknown id produces no target at all', () => {
  const items = savedJourneyList([row({ id: 1 })])

  assert.equal(savedJourneyTarget(items, 99), null)
  assert.equal(savedJourneyTarget(items, null), null)
  assert.equal(savedJourneyTarget(undefined, 1), null)
})

/* --- Planlayıcıya yükleme ------------------------------------------------------- */

const savedRecord = (overrides = {}) => ({
  id: 5,
  name: 'Kayıt',
  mode: JOURNEY_MODES.WAYPOINTS,
  profile: 'cycling',
  isFavorite: false,
  routeId: null,
  points: [
    { sequence: 0, source: WAYPOINT_SOURCES.STOP, referenceId: 11, displayName: 'A Durağı', role: 'origin' },
    { sequence: 1, source: WAYPOINT_SOURCES.POI, referenceId: 22, displayName: 'Kütüphane', role: 'destination' },
  ],
  ...overrides,
})

test('loading a saved free journey rebuilds the planner draft from canonical ids', () => {
  const draft = savedJourneyDraft(savedRecord())

  assert.equal(draft.mode, JOURNEY_MODES.WAYPOINTS)
  assert.equal(draft.profile, 'cycling')
  assert.equal(draft.routeId, null)
  assert.deepEqual(
    draft.waypoints.map((slot) => [slot.reference.source, slot.reference.id, slot.reference.label]),
    [[WAYPOINT_SOURCES.STOP, 11, 'A Durağı'], [WAYPOINT_SOURCES.POI, 22, 'Kütüphane']],
  )

  // Yuvalar YENİ anahtarlarla kurulur: eski taslağın anahtarı devralınmaz.
  const keys = draft.waypoints.map((slot) => slot.key)
  assert.equal(new Set(keys).size, keys.length)
})

test('points are ordered by their saved sequence, not by the array they arrived in', () => {
  const draft = savedJourneyDraft(savedRecord({
    points: [
      { sequence: 1, source: WAYPOINT_SOURCES.POI, referenceId: 22, displayName: 'İkinci' },
      { sequence: 0, source: WAYPOINT_SOURCES.STOP, referenceId: 11, displayName: 'Birinci' },
    ],
  }))

  assert.deepEqual(draft.waypoints.map((slot) => slot.reference.id), [11, 22])
})

test('the draft carries no runtime state and no coordinates', () => {
  const draft = savedJourneyDraft(savedRecord())

  /* Yükleme bir BAŞLATMA değildir: taslakta ne çalıştırma kimliği, ne
     geometri, ne de koordinat vardır. */
  for (const forbidden of ['simulationId', 'geometryWkt', 'snapshot', 'steps', 'progressPercent']) {
    assert.equal(forbidden in draft, false)
  }

  for (const slot of draft.waypoints) {
    assert.equal('longitude' in slot.reference, false)
    assert.equal('latitude' in slot.reference, false)
  }
})

test('a route journey restores the line and the two chosen stops', () => {
  const full = savedJourneyDraft(savedRecord({
    mode: JOURNEY_MODES.ROUTE_FULL, routeId: 3, points: [],
  }))
  assert.equal(full.routeId, 3)
  assert.equal(full.waypoints, null)

  const segment = savedJourneyDraft(savedRecord({
    mode: JOURNEY_MODES.ROUTE_SEGMENT,
    routeId: 3,
    points: [
      { sequence: 0, source: WAYPOINT_SOURCES.STOP, referenceId: 11 },
      { sequence: 1, source: WAYPOINT_SOURCES.STOP, referenceId: 12 },
    ],
  }))
  assert.equal(segment.fromStopId, 11)
  assert.equal(segment.toStopId, 12)
})

test('a definition that cannot be rebuilt produces no draft rather than a half one', () => {
  assert.equal(savedJourneyDraft(null), null)
  assert.equal(savedJourneyDraft(savedRecord({ mode: 'nonsense' })), null)
  assert.equal(savedJourneyDraft(savedRecord({ points: [] })), null)
  assert.equal(
    savedJourneyDraft(savedRecord({ mode: JOURNEY_MODES.ROUTE_SEGMENT, routeId: 3, points: [] })),
    null,
  )
})

/* --- Planlayıcı durumu ---------------------------------------------------------- */

test('the personal workspace opens on the planning section', () => {
  assert.equal(initialJourneyPlannerState().section, PERSONAL_SECTIONS.PLAN)
})

test('switching sections keeps the draft and disarms map picking', () => {
  const armed = reduce(
    initialJourneyPlannerState({ canUseTransport: false }),
    { type: 'setRoute', routeId: 4 },
  )
  const withSlot = journeyPlannerReducer(armed, { type: 'armSlot', key: armed.waypoints[0].key })
  assert.notEqual(withSlot.activeSlotKey, null)

  const saved = journeyPlannerReducer(withSlot, { type: 'setSection', section: PERSONAL_SECTIONS.SAVED })

  assert.equal(saved.section, PERSONAL_SECTIONS.SAVED)
  // Taslak DURUR: bölüm değiştirmek seçimleri silmez.
  assert.equal(saved.routeId, 4)
  assert.equal(saved.waypoints.length, withSlot.waypoints.length)
  /* Silah BIRAKILIR: kişisel yuva ekranda değilken silahlı kalmak, haritadaki
     bir tıklamanın görünmeyen bir yuvaya yazması demekti. */
  assert.equal(saved.activeSlotKey, null)

  const back = journeyPlannerReducer(saved, { type: 'setSection', section: PERSONAL_SECTIONS.PLAN })
  assert.equal(back.section, PERSONAL_SECTIONS.PLAN)
})

test('an unknown section is ignored instead of blanking the panel', () => {
  const state = initialJourneyPlannerState()
  assert.equal(journeyPlannerReducer(state, { type: 'setSection', section: 'archive' }), state)
})

test('loading a saved journey replaces the draft and returns to planning without starting anything', () => {
  const before = reduce(
    initialJourneyPlannerState({ canUseTransport: false }),
    { type: 'setSection', section: PERSONAL_SECTIONS.SAVED },
  )

  const after = journeyPlannerReducer(before, {
    type: 'loadSaved',
    draft: savedJourneyDraft(savedRecord()),
  })

  assert.equal(after.mode, JOURNEY_MODES.WAYPOINTS)
  assert.equal(after.profile, 'cycling')
  assert.deepEqual(after.waypoints.map((slot) => slot.reference.id), [11, 22])

  // Yüklenen yolculuk PLANLAMA bölümünde incelenir; başlatma ayrı karardır.
  assert.equal(after.section, PERSONAL_SECTIONS.PLAN)
  assert.equal(after.activeSlotKey, null)

  /* Durumda çalıştırmaya ait HİÇBİR ŞEY yoktur: yükleme bir simülasyon
     kurmaz. */
  for (const forbidden of ['simulationId', 'snapshot', 'following', 'starting']) {
    assert.equal(forbidden in after, false)
  }
})

test('loading a route journey clears the free-mode leftovers and vice versa', () => {
  const free = journeyPlannerReducer(initialJourneyPlannerState(), {
    type: 'loadSaved', draft: savedJourneyDraft(savedRecord()),
  })
  assert.equal(free.routeId, null)
  assert.equal(free.fromStopId, null)

  const segment = journeyPlannerReducer(free, {
    type: 'loadSaved',
    draft: savedJourneyDraft(savedRecord({
      mode: JOURNEY_MODES.ROUTE_SEGMENT,
      routeId: 9,
      points: [
        { sequence: 0, source: WAYPOINT_SOURCES.STOP, referenceId: 11 },
        { sequence: 1, source: WAYPOINT_SOURCES.STOP, referenceId: 12 },
      ],
    })),
  })

  assert.equal(segment.mode, JOURNEY_MODES.ROUTE_SEGMENT)
  assert.equal(segment.routeId, 9)
  // Serbest kipin yuvaları hayalet gibi yaşamaz: taslak yeniden kurulur.
  assert.equal(segment.waypoints.length, 2)
  assert.deepEqual(segment.waypoints.map((slot) => slot.reference), [null, null])
})

test('a malformed draft is refused by the reducer as well', () => {
  const state = initialJourneyPlannerState()

  for (const draft of [null, undefined, { mode: 'nonsense', profile: 'driving' }, { mode: JOURNEY_MODES.WAYPOINTS, profile: 'bus' }]) {
    assert.equal(journeyPlannerReducer(state, { type: 'loadSaved', draft }), state)
  }
})

test('clearing the planner keeps the section the user is looking at', () => {
  const saved = reduce(
    initialJourneyPlannerState(),
    { type: 'setSection', section: PERSONAL_SECTIONS.SAVED },
  )

  assert.equal(journeyPlannerReducer(saved, { type: 'reset' }).section, PERSONAL_SECTIONS.SAVED)
})
