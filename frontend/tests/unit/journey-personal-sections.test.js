import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  JOURNEY_MODES,
  PANEL_STATES,
  PERSONAL_SECTIONS,
  initialJourneyPlannerState,
  journeyPlannerReducer,
  resolvePersonalSection,
} from '../../src/map/journeyPlanning.js'
import { journeyHistoryDraft } from '../../src/map/journeyHistory.js'
import { savedJourneyDraft } from '../../src/map/savedJourneys.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

const reduce = (state, ...actions) => actions.reduce(journeyPlannerReducer, state)

/** Serbest kipte açılan planlayıcı: hat yetkisi gerektirmez. */
const planner = () => initialJourneyPlannerState({ canUseTransport: false })

const historyRecord = {
  id: 9,
  mode: JOURNEY_MODES.WAYPOINTS,
  profile: 'driving',
  points: [
    { sequence: 0, source: 'transportStop', referenceId: 11, displayName: 'A' },
    { sequence: 1, source: 'poi', referenceId: 42, displayName: 'B' },
  ],
}

/* --- Gösterilecek bölümün kuralı ------------------------------------------------
   REGRESYON: bu kural daha önce panelin içinde, bölümleri TEK TEK sayan bir
   üçlü ifadeydi. Üçüncü bölüm eklendiğinde indirgeyici `history` yazıyor ama
   panel onu planlamaya düşürüyordu; kullanıcı Geçmiş'e basınca Planla açık
   kalıyordu. */

test('every declared personal section resolves to itself', () => {
  /* ASIL İDDİA: kural ÜYELİK üzerinedir. Bölümleri tek tek sayan bir ifade,
     eklenen her yeni bölümü sessizce düşürürdü — hata tam olarak buydu. */
  for (const section of Object.values(PERSONAL_SECTIONS)) {
    assert.equal(resolvePersonalSection(section), section)
  }

  // Üç bölümün üçü de gerçekten ayrı ayrı gösterilebilir.
  assert.equal(resolvePersonalSection(PERSONAL_SECTIONS.HISTORY), PERSONAL_SECTIONS.HISTORY)
  assert.equal(resolvePersonalSection(PERSONAL_SECTIONS.SAVED), PERSONAL_SECTIONS.SAVED)
  assert.equal(resolvePersonalSection(PERSONAL_SECTIONS.PLAN), PERSONAL_SECTIONS.PLAN)
})

test('an unknown section falls back to planning rather than drawing nothing', () => {
  for (const unknown of [undefined, null, '', 'archive', 0, {}]) {
    assert.equal(resolvePersonalSection(unknown), PERSONAL_SECTIONS.PLAN)
  }
})

test('the panel applies the shared rule instead of enumerating sections itself', () => {
  /* Dar kapsamlı yapısal denetim: hatanın SINIFI, panelin kendi kuralını
     yazmasıydı. Kuralın sahibi saf modüldür. */
  const panel = read('../../src/components/map/JourneyPlannerPanel.jsx')

  assert.match(panel, /const section = resolvePersonalSection\(state\.section\)/)
})

/* --- Bölüm seçimi KULLANICIYA aittir --------------------------------------------- */

test('the personal product opens on planning', () => {
  assert.equal(planner().section, PERSONAL_SECTIONS.PLAN)
})

test('choosing a section makes it the active one', () => {
  for (const section of Object.values(PERSONAL_SECTIONS)) {
    const state = journeyPlannerReducer(planner(), { type: 'setSection', section })

    assert.equal(state.section, section)
    // Panelin göstereceği bölüm de aynısıdır.
    assert.equal(resolvePersonalSection(state.section), section)
  }
})

test('history stays active while ordinary planner state keeps changing', () => {
  const opened = journeyPlannerReducer(planner(), {
    type: 'setSection', section: PERSONAL_SECTIONS.HISTORY,
  })

  /* Geçmiş açıkken gerçekten olabilecek eylemler: profil değişimi, kip
     değişimi, nokta ekleme, panelin katlanıp açılması ve temizleme. Hiçbiri
     bir GEZİNME değildir ve hiçbiri bölümü değiştirmemelidir. */
  const noise = [
    { type: 'setProfile', profile: 'walking' },
    { type: 'setMode', mode: JOURNEY_MODES.WAYPOINTS },
    { type: 'addWaypoint' },
    { type: 'setPanel', panel: PANEL_STATES.COLLAPSED },
    { type: 'setPanel', panel: PANEL_STATES.OPEN },
    { type: 'reset' },
  ]

  let state = opened
  for (const action of noise) {
    state = journeyPlannerReducer(state, action)
    assert.equal(
      state.section,
      PERSONAL_SECTIONS.HISTORY,
      `${action.type} bölümü değiştirmemeli`,
    )
  }

  // Ve yalnızca AÇIK bir gezinme onu bırakır.
  assert.equal(
    journeyPlannerReducer(state, { type: 'setSection', section: PERSONAL_SECTIONS.PLAN }).section,
    PERSONAL_SECTIONS.PLAN,
  )
})

test('saved journeys have the same stability guarantee', () => {
  let state = journeyPlannerReducer(planner(), {
    type: 'setSection', section: PERSONAL_SECTIONS.SAVED,
  })

  state = reduce(
    state,
    { type: 'setProfile', profile: 'cycling' },
    { type: 'addWaypoint' },
    { type: 'setPanel', panel: PANEL_STATES.COLLAPSED },
    { type: 'reset' },
  )

  assert.equal(state.section, PERSONAL_SECTIONS.SAVED)
})

test('switching product does not move the personal section', () => {
  /* Paylaşılan hatta bakıp geri dönmek, kullanıcının bıraktığı bölümü
     kaybettirmemelidir. */
  const state = reduce(
    planner(),
    { type: 'setSection', section: PERSONAL_SECTIONS.HISTORY },
    { type: 'setProduct', product: 'shared' },
    { type: 'setProduct', product: 'personal' },
  )

  assert.equal(state.section, PERSONAL_SECTIONS.HISTORY)
})

test('an unknown section request is ignored instead of dropping the user elsewhere', () => {
  const opened = journeyPlannerReducer(planner(), {
    type: 'setSection', section: PERSONAL_SECTIONS.HISTORY,
  })

  // Aynı bölümü tekrar istemek de durumu DEĞİŞTİRMEZ (aynı nesne döner).
  assert.equal(
    journeyPlannerReducer(opened, { type: 'setSection', section: PERSONAL_SECTIONS.HISTORY }),
    opened,
  )
  assert.equal(journeyPlannerReducer(opened, { type: 'setSection', section: 'archive' }), opened)
})

/* --- AÇIK gezinme: taslağa yükleme ------------------------------------------------ */

test('loading a history definition intentionally returns to planning', () => {
  /* Bu bir GEZİNMEDİR ve bilinçlidir: kullanıcı yolculuğu düzenlemek istedi,
     dolayısıyla formun kendisine götürülür. */
  const state = reduce(
    planner(),
    { type: 'setSection', section: PERSONAL_SECTIONS.HISTORY },
    { type: 'loadSaved', draft: journeyHistoryDraft(historyRecord) },
  )

  assert.equal(state.section, PERSONAL_SECTIONS.PLAN)
  assert.deepEqual(state.waypoints.map((slot) => slot.reference.id), [11, 42])
})

test('loading a saved definition intentionally returns to planning', () => {
  const state = reduce(
    planner(),
    { type: 'setSection', section: PERSONAL_SECTIONS.SAVED },
    { type: 'loadSaved', draft: savedJourneyDraft(historyRecord) },
  )

  assert.equal(state.section, PERSONAL_SECTIONS.PLAN)
})

test('a refused draft leaves the user exactly where they were', () => {
  /* Yüklenemeyen bir tanım GEZİNME üretmez: kullanıcı hâlâ geçmişe bakıyordur
     ve boş bir planlama formuna atılmamalıdır. */
  const opened = journeyPlannerReducer(planner(), {
    type: 'setSection', section: PERSONAL_SECTIONS.HISTORY,
  })

  for (const draft of [null, undefined, { mode: 'nonsense', profile: 'driving' }]) {
    assert.equal(journeyPlannerReducer(opened, { type: 'loadSaved', draft }).section,
      PERSONAL_SECTIONS.HISTORY)
  }
})

/* --- Bölüm açmak bir yolculuk BAŞLATMAZ -------------------------------------------- */

test('opening a section touches no simulation state at all', () => {
  const before = planner()
  const after = journeyPlannerReducer(before, {
    type: 'setSection', section: PERSONAL_SECTIONS.HISTORY,
  })

  /* Planlayıcı durumu zaten çalıştırma taşımaz; bölüm değişimi de yeni bir
     alan üretmez. Canlı durumun sahibi ayrı bir kancadır. */
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort())

  for (const forbidden of ['simulationId', 'snapshot', 'following', 'starting']) {
    assert.equal(forbidden in after, false)
  }

  // Taslak da olduğu gibi kalır: bölüm açmak seçimleri silmez.
  assert.equal(after.mode, before.mode)
  assert.equal(after.profile, before.profile)
  assert.equal(after.waypoints.length, before.waypoints.length)
})

test('opening history disarms map picking so a click cannot land on a hidden slot', () => {
  const initial = planner()
  // Yuva anahtarı AYNI durumdan okunur; her `planner()` çağrısı yeni anahtar üretir.
  const armed = journeyPlannerReducer(initial, { type: 'armSlot', key: initial.waypoints[0].key })
  assert.equal(armed.activeSlotKey, initial.waypoints[0].key)

  const state = journeyPlannerReducer(armed, {
    type: 'setSection', section: PERSONAL_SECTIONS.HISTORY,
  })

  assert.equal(state.section, PERSONAL_SECTIONS.HISTORY)
  assert.equal(state.activeSlotKey, null)
})
