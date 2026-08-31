import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_JOURNEY_PROFILE,
  JOURNEY_MESSAGES,
  JOURNEY_MODES,
  JOURNEY_PROFILES,
  JOURNEY_PROFILE_IDS,
  MAX_WAYPOINTS,
  PANEL_STATES,
  WAYPOINT_SOURCES,
  buildJourneyPreviewRequest,
  createWaypointSlot,
  filledWaypoints,
  initialJourneyPlannerState,
  journeyPlannerReducer,
  segmentSelectionIsValid,
  waypointReference,
  waypointRoleAt,
} from '../../src/map/journeyPlanning.js'

const read = (relative) => readFileSync(new URL(relative, import.meta.url), 'utf8')

/** Yorumlar ayıklanır: bir kavramı ANLATMAK onu uygulamak değildir. */
const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1')

const reduce = (state, ...actions) => actions.reduce(journeyPlannerReducer, state)

const stopRef = (id, label = `Durak ${id}`) =>
  waypointReference({ source: WAYPOINT_SOURCES.STOP, id, label })
const poiRef = (id, label = `POI ${id}`) =>
  waypointReference({ source: WAYPOINT_SOURCES.POI, id, label })

/* --- Varsayılan durum -------------------------------------------------------- */

test('the planner opens on the full-route mode with the driving profile', () => {
  const state = initialJourneyPlannerState()

  assert.equal(state.mode, JOURNEY_MODES.ROUTE_FULL)
  assert.equal(state.profile, DEFAULT_JOURNEY_PROFILE)
  assert.equal(state.panel, PANEL_STATES.OPEN)
  assert.equal(state.routeId, null)
  assert.equal(state.activeSlotKey, null)
  // Başlangıç ve varış her zaman vardır.
  assert.equal(state.waypoints.length, 2)
  assert.deepEqual(state.waypoints.map((slot) => slot.reference), [null, null])
})

test('waypoint slots carry stable keys rather than relying on array position', () => {
  const first = createWaypointSlot()
  const second = createWaypointSlot()
  assert.notEqual(first.key, second.key)
})

/* --- Kip / profil ------------------------------------------------------------ */

test('switching modes keeps the other modes selections and disarms map picking', () => {
  const state = reduce(
    initialJourneyPlannerState(),
    { type: 'setRoute', routeId: 7 },
    { type: 'setMode', mode: JOURNEY_MODES.WAYPOINTS },
  )
  const armed = journeyPlannerReducer(state, { type: 'armSlot', key: state.waypoints[0].key })
  assert.equal(armed.activeSlotKey, state.waypoints[0].key)

  const back = journeyPlannerReducer(armed, { type: 'setMode', mode: JOURNEY_MODES.ROUTE_SEGMENT })

  // Hat seçimi KAYBOLMAZ; kullanıcı sekmeler arasında emeğini yitirmemelidir.
  assert.equal(back.routeId, 7)
  // Silah bırakılır: görünmeyen bir yuvaya atama yapılmamalıdır.
  assert.equal(back.activeSlotKey, null)
})

test('an unknown mode or profile is rejected instead of being stored', () => {
  const state = initialJourneyPlannerState()
  assert.equal(journeyPlannerReducer(state, { type: 'setMode', mode: 'teleport' }), state)
  assert.equal(journeyPlannerReducer(state, { type: 'setProfile', profile: 'rocket' }), state)
})

test('bus can never enter the profile contract', () => {
  assert.deepEqual(JOURNEY_PROFILE_IDS, ['driving', 'walking', 'cycling'])
  assert.equal(JOURNEY_PROFILES.length, 3)

  // Reddedilir, saklanmaz.
  const state = initialJourneyPlannerState()
  assert.equal(journeyPlannerReducer(state, { type: 'setProfile', profile: 'bus' }).profile, 'driving')

  /* Ve hiçbir kaynak dosyada otobüs/transit KODU bulunmaz. Yorumlar
     ayıklanır: kapsam kararını ANLATAN bir açıklama, o kavramı uygulamakla
     aynı şey değildir ve belgelenmesi istenir. */
  for (const file of [
    '../../src/map/journeyPlanning.js',
    '../../src/map/journeyManeuvers.js',
    '../../src/map/journeyPresentation.js',
    '../../src/components/map/JourneyPlannerPanel.jsx',
  ]) {
    const code = stripComments(read(file))
    assert.ok(!/\bbus\b/i.test(code), `${file} otobüs kodu içeriyor`)
    assert.ok(!/\btransit\b|\bgtfs\b/i.test(code), `${file} transit kodu içeriyor`)
  }
})

test('changing the route clears stops that belonged to the previous route', () => {
  const state = reduce(
    initialJourneyPlannerState(),
    { type: 'setRoute', routeId: 1 },
    { type: 'setSegmentStop', end: 'from', stopId: 10 },
    { type: 'setSegmentStop', end: 'to', stopId: 20 },
  )
  assert.ok(segmentSelectionIsValid(state))

  const switched = journeyPlannerReducer(state, { type: 'setRoute', routeId: 2 })
  assert.equal(switched.fromStopId, null)
  assert.equal(switched.toStopId, null)
})

test('a reverse segment selection is valid and swapping preserves the requested direction', () => {
  const state = reduce(
    initialJourneyPlannerState(),
    { type: 'setMode', mode: JOURNEY_MODES.ROUTE_SEGMENT },
    { type: 'setRoute', routeId: 1 },
    { type: 'setSegmentStop', end: 'from', stopId: 30 },
    { type: 'setSegmentStop', end: 'to', stopId: 10 },
  )

  // Tarayıcı sıra varsaymaz: ters seçim geçerlidir, yönü backend belirler.
  assert.ok(segmentSelectionIsValid(state))

  const swapped = journeyPlannerReducer(state, { type: 'swapSegmentStops' })
  assert.equal(swapped.fromStopId, 10)
  assert.equal(swapped.toStopId, 30)
})

test('identical segment stops are invalid', () => {
  const state = reduce(
    initialJourneyPlannerState(),
    { type: 'setRoute', routeId: 1 },
    { type: 'setSegmentStop', end: 'from', stopId: 10 },
    { type: 'setSegmentStop', end: 'to', stopId: 10 },
  )
  assert.equal(segmentSelectionIsValid(state), false)
})

/* --- Geçiş noktaları --------------------------------------------------------- */

test('a new waypoint is inserted as a via point, never before origin or after destination', () => {
  const state = journeyPlannerReducer(initialJourneyPlannerState(), { type: 'addWaypoint' })

  assert.equal(state.waypoints.length, 3)
  assert.equal(waypointRoleAt(0, 3), 'origin')
  assert.equal(waypointRoleAt(1, 3), 'via')
  assert.equal(waypointRoleAt(2, 3), 'destination')
  // Yeni yuva kendiliğinden silahlanır: kullanıcı hemen doldurabilir.
  assert.equal(state.activeSlotKey, state.waypoints[1].key)
})

test('origin and destination cannot be removed, only via points can', () => {
  const state = journeyPlannerReducer(initialJourneyPlannerState(), { type: 'addWaypoint' })
  const [origin, via, destination] = state.waypoints

  assert.equal(journeyPlannerReducer(state, { type: 'removeWaypoint', key: origin.key }), state)
  assert.equal(journeyPlannerReducer(state, { type: 'removeWaypoint', key: destination.key }), state)

  const removed = journeyPlannerReducer(state, { type: 'removeWaypoint', key: via.key })
  assert.equal(removed.waypoints.length, 2)
  assert.equal(removed.activeSlotKey, null)
})

test('reordering moves via points but never dislodges the endpoints', () => {
  let state = reduce(initialJourneyPlannerState(), { type: 'addWaypoint' }, { type: 'addWaypoint' })
  const keys = state.waypoints.map((slot) => slot.key)
  state = reduce(
    state,
    { type: 'assignWaypoint', key: keys[0], reference: stopRef(1, 'A') },
    { type: 'assignWaypoint', key: keys[1], reference: stopRef(2, 'B') },
    { type: 'assignWaypoint', key: keys[2], reference: stopRef(3, 'C') },
    { type: 'assignWaypoint', key: keys[3], reference: stopRef(4, 'D') },
  )
  assert.deepEqual(filledWaypoints(state).map((ref) => ref.label), ['A', 'B', 'C', 'D'])

  const moved = journeyPlannerReducer(state, { type: 'moveWaypoint', key: keys[2], direction: 'up' })
  assert.deepEqual(filledWaypoints(moved).map((ref) => ref.label), ['A', 'C', 'B', 'D'])

  // Uç noktalar hareket etmez.
  assert.equal(journeyPlannerReducer(state, { type: 'moveWaypoint', key: keys[0], direction: 'down' }), state)
  assert.equal(journeyPlannerReducer(state, { type: 'moveWaypoint', key: keys[3], direction: 'up' }), state)

  // Bir ara nokta uç konuma itilemez.
  const pinned = journeyPlannerReducer(state, { type: 'moveWaypoint', key: keys[1], direction: 'up' })
  assert.equal(pinned, state)
})

test('assigning a reference disarms the slot and re-arming toggles', () => {
  const base = initialJourneyPlannerState()
  const key = base.waypoints[0].key

  const armed = journeyPlannerReducer(base, { type: 'armSlot', key })
  assert.equal(armed.activeSlotKey, key)

  // Aynı yuvaya tekrar basmak silahı bırakır.
  assert.equal(journeyPlannerReducer(armed, { type: 'armSlot', key }).activeSlotKey, null)

  const assigned = journeyPlannerReducer(armed, { type: 'assignWaypoint', key, reference: poiRef(5) })
  assert.equal(assigned.activeSlotKey, null)
  assert.equal(assigned.waypoints[0].reference.source, WAYPOINT_SOURCES.POI)
})

test('the waypoint count is capped at the backend limit', () => {
  let state = initialJourneyPlannerState()
  for (let index = 0; index < MAX_WAYPOINTS + 5; index += 1) {
    state = journeyPlannerReducer(state, { type: 'addWaypoint' })
  }
  assert.equal(state.waypoints.length, MAX_WAYPOINTS)
})

/* --- Panel ------------------------------------------------------------------- */

test('the panel has three distinct states and collapsing is not closing', () => {
  assert.deepEqual(Object.values(PANEL_STATES), ['open', 'collapsed', 'closed'])

  const open = initialJourneyPlannerState()
  const collapsed = journeyPlannerReducer(open, { type: 'setPanel', panel: PANEL_STATES.COLLAPSED })
  const closed = journeyPlannerReducer(collapsed, { type: 'setPanel', panel: PANEL_STATES.CLOSED })

  assert.equal(collapsed.panel, PANEL_STATES.COLLAPSED)
  assert.equal(closed.panel, PANEL_STATES.CLOSED)
  assert.notEqual(collapsed.panel, closed.panel)
})

test('reopening the panel preserves the planner selections', () => {
  const state = reduce(
    initialJourneyPlannerState(),
    { type: 'setMode', mode: JOURNEY_MODES.ROUTE_SEGMENT },
    { type: 'setProfile', profile: 'cycling' },
    { type: 'setRoute', routeId: 9 },
    { type: 'setSegmentStop', end: 'from', stopId: 1 },
    { type: 'setSegmentStop', end: 'to', stopId: 2 },
    { type: 'setPanel', panel: PANEL_STATES.CLOSED },
    { type: 'setPanel', panel: PANEL_STATES.OPEN },
  )

  assert.equal(state.mode, JOURNEY_MODES.ROUTE_SEGMENT)
  assert.equal(state.profile, 'cycling')
  assert.equal(state.routeId, 9)
  assert.equal(state.fromStopId, 1)
  assert.equal(state.toStopId, 2)
})

test('leaving the open panel disarms map picking', () => {
  const base = initialJourneyPlannerState()
  const armed = journeyPlannerReducer(base, { type: 'armSlot', key: base.waypoints[0].key })

  for (const panel of [PANEL_STATES.COLLAPSED, PANEL_STATES.CLOSED]) {
    assert.equal(journeyPlannerReducer(armed, { type: 'setPanel', panel }).activeSlotKey, null)
  }
})

test('clear resets selections while keeping the panel and travel choices', () => {
  const state = reduce(
    initialJourneyPlannerState(),
    { type: 'setProfile', profile: 'walking' },
    { type: 'setRoute', routeId: 4 },
    { type: 'setPanel', panel: PANEL_STATES.COLLAPSED },
  )

  const cleared = journeyPlannerReducer(state, { type: 'reset' })

  assert.equal(cleared.routeId, null)
  // "Temizle" kullanıcının açtığı/kapattığı paneli değiştirmez.
  assert.equal(cleared.panel, PANEL_STATES.COLLAPSED)
  assert.equal(cleared.profile, 'walking')
})

/* --- İstek eşlemesi ---------------------------------------------------------- */

test('a full-route request carries only the mode, profile and route id', () => {
  const state = reduce(initialJourneyPlannerState(), { type: 'setRoute', routeId: 12 })
  const result = buildJourneyPreviewRequest(state)

  assert.ok(result.ok)
  assert.deepEqual(result.request, { mode: 'routeFull', profile: 'driving', routeId: 12 })
})

test('a segment request carries both stop ids in the requested direction', () => {
  const state = reduce(
    initialJourneyPlannerState(),
    { type: 'setMode', mode: JOURNEY_MODES.ROUTE_SEGMENT },
    { type: 'setRoute', routeId: 3 },
    { type: 'setSegmentStop', end: 'from', stopId: 33 },
    { type: 'setSegmentStop', end: 'to', stopId: 11 },
  )
  const result = buildJourneyPreviewRequest(state)

  assert.ok(result.ok)
  assert.deepEqual(result.request, {
    mode: 'routeSegment',
    profile: 'driving',
    routeId: 3,
    // Ters seçim OLDUĞU GİBİ gönderilir; tarayıcı yönü düzeltmeye çalışmaz.
    fromStopId: 33,
    toStopId: 11,
  })
})

test('a custom request preserves waypoint order and POI references', () => {
  let state = reduce(
    initialJourneyPlannerState(),
    { type: 'setMode', mode: JOURNEY_MODES.WAYPOINTS },
    { type: 'addWaypoint' },
  )
  const keys = state.waypoints.map((slot) => slot.key)
  state = reduce(
    state,
    { type: 'assignWaypoint', key: keys[0], reference: poiRef(101) },
    { type: 'assignWaypoint', key: keys[1], reference: stopRef(202) },
    { type: 'assignWaypoint', key: keys[2], reference: poiRef(303) },
  )

  const result = buildJourneyPreviewRequest(state)

  assert.ok(result.ok)
  assert.deepEqual(result.request.waypoints, [
    { source: 'poi', referenceId: 101 },
    { source: 'transportStop', referenceId: 202 },
    { source: 'poi', referenceId: 303 },
  ])

  // Sıra `order` alanıyla değil, dizinin kendi sırasıyla taşınır.
  assert.ok(!('order' in result.request.waypoints[0]))
})

test('the request never carries coordinates, geometry or a plan id', () => {
  let state = reduce(initialJourneyPlannerState(), { type: 'setMode', mode: JOURNEY_MODES.WAYPOINTS })
  const keys = state.waypoints.map((slot) => slot.key)
  state = reduce(
    state,
    { type: 'assignWaypoint', key: keys[0], reference: stopRef(1) },
    { type: 'assignWaypoint', key: keys[1], reference: stopRef(2) },
  )

  const serialized = JSON.stringify(buildJourneyPreviewRequest(state).request)

  for (const forbidden of ['longitude', 'latitude', 'geometry', 'wkt', 'planId', 'coordinate']) {
    assert.ok(!serialized.toLowerCase().includes(forbidden.toLowerCase()), `${forbidden} gönderiliyor`)
  }
})

test('incomplete or duplicated custom journeys are refused before any request', () => {
  const base = reduce(initialJourneyPlannerState(), { type: 'setMode', mode: JOURNEY_MODES.WAYPOINTS })
  const keys = base.waypoints.map((slot) => slot.key)

  assert.deepEqual(buildJourneyPreviewRequest(base), {
    ok: false,
    error: JOURNEY_MESSAGES.waypointsRequired,
  })

  // Yarı dolu liste sessizce sıkıştırılmaz.
  const withGap = reduce(
    base,
    { type: 'addWaypoint' },
  )
  const gapKeys = withGap.waypoints.map((slot) => slot.key)
  const partial = reduce(
    withGap,
    { type: 'assignWaypoint', key: gapKeys[0], reference: stopRef(1) },
    { type: 'assignWaypoint', key: gapKeys[2], reference: stopRef(2) },
  )
  assert.equal(buildJourneyPreviewRequest(partial).error, JOURNEY_MESSAGES.waypointsIncomplete)

  const duplicated = reduce(
    base,
    { type: 'assignWaypoint', key: keys[0], reference: stopRef(5) },
    { type: 'assignWaypoint', key: keys[1], reference: stopRef(5) },
  )
  assert.equal(buildJourneyPreviewRequest(duplicated).error, JOURNEY_MESSAGES.consecutiveDuplicate)
})

test('route based modes refuse to build a request without a route', () => {
  const full = buildJourneyPreviewRequest(initialJourneyPlannerState())
  assert.equal(full.ok, false)
  assert.equal(full.error, JOURNEY_MESSAGES.routeRequired)

  const segment = buildJourneyPreviewRequest(
    reduce(
      initialJourneyPlannerState(),
      { type: 'setMode', mode: JOURNEY_MODES.ROUTE_SEGMENT },
      { type: 'setRoute', routeId: 2 },
    ),
  )
  assert.equal(segment.error, JOURNEY_MESSAGES.segmentStopsRequired)
})
