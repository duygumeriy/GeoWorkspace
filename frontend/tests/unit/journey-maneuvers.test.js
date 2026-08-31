import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FALLBACK_MANEUVER_TEXT,
  journeyStepList,
  maneuverDirection,
  maneuverInstruction,
} from '../../src/map/journeyManeuvers.js'
import {
  JOURNEY_ERROR_MESSAGES,
  journeyErrorMessage,
  journeyPreviewSummary,
  journeyProfileLabel,
  unavailableProfileMessage,
} from '../../src/map/journeyPresentation.js'

const step = (overrides = {}) => ({
  sequence: 0,
  maneuverType: 'turn',
  maneuverModifier: null,
  name: null,
  distanceMeters: 100,
  durationSeconds: 20,
  displayText: null,
  ...overrides,
})

/* --- Manevra metni ----------------------------------------------------------- */

test('turn modifiers map onto Turkish instructions', () => {
  assert.equal(maneuverInstruction(step({ maneuverModifier: 'left' })), 'Sola dönün')
  assert.equal(maneuverInstruction(step({ maneuverModifier: 'right' })), 'Sağa dönün')
  assert.equal(maneuverInstruction(step({ maneuverModifier: 'slight left' })), 'Hafif sola dönün')
  assert.equal(maneuverInstruction(step({ maneuverModifier: 'slight right' })), 'Hafif sağa dönün')
  assert.equal(maneuverInstruction(step({ maneuverModifier: 'uturn' })), 'Geri dönüş yapın')
})

test('depart, arrive and continue have their own wording', () => {
  assert.equal(maneuverInstruction(step({ maneuverType: 'depart' })), 'Yolculuğa başlayın')
  assert.equal(maneuverInstruction(step({ maneuverType: 'arrive' })), 'Varış noktasına ulaştınız')
  assert.equal(maneuverInstruction(step({ maneuverType: 'continue' })), 'Devam edin')
})

test('a null displayText is normal and never crashes the mapper', () => {
  // Faz 5B `displayText` alanını null döndürür: OSRM hazır metin üretmez.
  assert.equal(maneuverInstruction(step({ displayText: null, maneuverModifier: 'left' })), 'Sola dönün')
  assert.equal(maneuverInstruction(step({ displayText: '   ' })), FALLBACK_MANEUVER_TEXT)
})

test('a provided displayText wins over the local mapping', () => {
  assert.equal(
    maneuverInstruction(step({ displayText: 'Cumhuriyet Caddesi’ne sapın', maneuverModifier: 'left' })),
    'Cumhuriyet Caddesi’ne sapın',
  )
})

test('unknown maneuver metadata degrades safely instead of throwing', () => {
  assert.equal(maneuverInstruction(step({ maneuverType: 'teleport', maneuverModifier: 'sideways' })), FALLBACK_MANEUVER_TEXT)
  assert.equal(maneuverInstruction(undefined), FALLBACK_MANEUVER_TEXT)
  assert.equal(maneuverInstruction({}), FALLBACK_MANEUVER_TEXT)
  assert.equal(maneuverInstruction(step({ maneuverType: null, maneuverModifier: null })), FALLBACK_MANEUVER_TEXT)
})

test('direction hints stay usable for icon selection', () => {
  assert.equal(maneuverDirection(step({ maneuverModifier: 'slight left' })), 'left')
  assert.equal(maneuverDirection(step({ maneuverModifier: 'sharp right' })), 'right')
  assert.equal(maneuverDirection(step({ maneuverType: 'depart' })), 'depart')
  assert.equal(maneuverDirection(step({ maneuverType: 'arrive' })), 'arrive')
  assert.equal(maneuverDirection({}), 'straight')
})

test('the step list normalises empty names and keeps the backend sequence', () => {
  const list = journeyStepList([
    step({ sequence: 0, maneuverType: 'depart', name: 'Atatürk Bulvarı' }),
    step({ sequence: 1, maneuverModifier: 'right', name: '' }),
    step({ sequence: 2, maneuverType: 'arrive', name: null, distanceMeters: 0 }),
  ])

  assert.deepEqual(list.map((item) => item.sequence), [0, 1, 2])
  assert.equal(list[0].name, 'Atatürk Bulvarı')
  // Boş sokak adı bir bilgi değildir.
  assert.equal(list[1].name, null)
  assert.equal(list[1].instruction, 'Sağa dönün')
  assert.equal(list[2].instruction, 'Varış noktasına ulaştınız')
})

test('an empty or missing step list is valid, not an error', () => {
  assert.deepEqual(journeyStepList([]), [])
  assert.deepEqual(journeyStepList(null), [])
  assert.deepEqual(journeyStepList(undefined), [])
})

/* --- Özet -------------------------------------------------------------------- */

const preview = (overrides = {}) => ({
  planId: 'plan-1',
  geometryWkt: 'LINESTRING(30 40,31 41)',
  summary: {
    mode: 'waypoints',
    requestedProfile: 'walking',
    effectiveProfile: 'walking',
    profileSupport: 'routed',
    geometrySource: 'liveRouting',
    routeId: null,
    routeName: null,
    waypointCount: 3,
    stepCount: 2,
    distanceMeters: 1500,
    durationSeconds: 900,
    assumptions: [],
    ...overrides.summary,
  },
  waypoints: overrides.waypoints ?? [
    { position: 0, name: 'Başlangıç' },
    { position: 1, name: 'Ara' },
    { position: 2, name: 'Varış' },
  ],
  steps: [],
})

test('the summary formats backend metrics and never recomputes them', () => {
  const summary = journeyPreviewSummary(preview())

  assert.equal(summary.distance, '1.5 km')
  assert.equal(summary.duration, '15 dk')
  assert.equal(summary.profileLabel, 'Yürüyüş')
  assert.equal(summary.originName, 'Başlangıç')
  assert.equal(summary.destinationName, 'Varış')
  assert.equal(summary.viaCount, 1)
})

test('short distances stay in metres and long journeys report hours', () => {
  const short = journeyPreviewSummary(preview({ summary: { distanceMeters: 420, durationSeconds: 4500 } }))
  assert.equal(short.distance, '420 m')
  assert.equal(short.duration, '1 sa 15 dk')
})

test('a persisted full route without maneuvers is expected rather than an error', () => {
  const summary = journeyPreviewSummary(preview({
    summary: { mode: 'routeFull', geometrySource: 'persistedRoutePath', stepCount: 0, routeName: 'Hat 1' },
  }))

  assert.equal(summary.stepsUnavailableIsExpected, true)
  assert.equal(summary.routeName, 'Hat 1')

  // Canlı hesaplanan bir yolculukta adım yokluğu beklenen bir durum DEĞİLDİR.
  assert.equal(journeyPreviewSummary(preview()).stepsUnavailableIsExpected, false)
})

test('a missing preview yields no summary instead of throwing', () => {
  assert.equal(journeyPreviewSummary(null), null)
  assert.equal(journeyPreviewSummary({}), null)
})

/* --- Profil kullanılamıyor --------------------------------------------------- */

test('an unavailable profile is explained in plain language without infrastructure terms', () => {
  for (const profile of ['walking', 'cycling']) {
    const message = unavailableProfileMessage(profile)
    assert.ok(message.includes(journeyProfileLabel(profile)))
    for (const leak of ['OSRM', 'osrm', 'localhost', 'port', 'docker', 'endpoint', 'profil motoru']) {
      assert.ok(!message.includes(leak), `${leak} sızdı`)
    }
  }
})

/* --- Hata metinleri ---------------------------------------------------------- */

test('backend failures map onto distinct, safe user messages', () => {
  assert.equal(journeyErrorMessage(404), JOURNEY_ERROR_MESSAGES.unavailableEntity)
  assert.equal(journeyErrorMessage(502), JOURNEY_ERROR_MESSAGES.engineUnavailable)
  assert.equal(journeyErrorMessage(504), JOURNEY_ERROR_MESSAGES.timeout)
  assert.equal(journeyErrorMessage(0), JOURNEY_ERROR_MESSAGES.unknown)

  // 400 kullanıcının SEÇİMİYLE ilgilidir; sunucunun güvenli metni en yararlısıdır.
  assert.equal(journeyErrorMessage(400, 'Başlangıç ve bitiş durağı aynı olamaz.'), 'Başlangıç ve bitiş durağı aynı olamaz.')
  assert.equal(journeyErrorMessage(400, ''), JOURNEY_ERROR_MESSAGES.invalidSelection)
})

test('an invalid selection reads differently from a temporarily unavailable engine', () => {
  // Kullanıcı "seçimim mi bozuk, servis mi kapalı" sorusunu ayırt edebilmelidir.
  assert.notEqual(journeyErrorMessage(400, ''), journeyErrorMessage(502))
  assert.notEqual(journeyErrorMessage(404), journeyErrorMessage(502))
})

test('upstream failures never leak infrastructure detail into the UI', () => {
  const leaky = 'HttpRequestException at http://localhost:5000/route/v1/driving docker 172.17.0.2'
  for (const status of [500, 502, 504, 404]) {
    const message = journeyErrorMessage(status, leaky)
    for (const leak of ['http', 'localhost', '5000', 'docker', '172.17', 'Exception', 'route/v1']) {
      assert.ok(!message.toLowerCase().includes(leak.toLowerCase()), `${leak} sızdı (${status})`)
    }
  }
})
