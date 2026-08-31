import assert from 'node:assert/strict'
import test from 'node:test'
import {
  JOIN_ROUTE_METHOD,
  LEAVE_ROUTE_METHOD,
  SIMULATION_UPDATED_EVENT,
  createTransportSimulationClient,
} from '../../src/services/transportSimulationClient.js'

const RUN_A = '11111111-1111-1111-1111-111111111111'

const snapshotFor = (routeId, progressPercent = 0) => ({
  simulationId: RUN_A,
  routeId,
  status: 'Running',
  longitude: 30,
  latitude: 40,
  progressPercent,
  updatedAtUtc: '2026-08-31T10:00:00Z',
})

/** Gerçek HubConnection'ın yalnızca kullanılan yüzeyini taklit eder. */
function fakeConnection({ joinResult = snapshotFor, failJoin = false } = {}) {
  const connection = {
    started: 0,
    stopped: 0,
    handlers: new Map(),
    calls: [],
    reconnected: null,
    on(event, handler) {
      const list = connection.handlers.get(event) ?? []
      list.push(handler)
      connection.handlers.set(event, list)
    },
    off(event, handler) {
      const list = (connection.handlers.get(event) ?? []).filter((item) => item !== handler)
      connection.handlers.set(event, list)
    },
    onreconnected(callback) {
      connection.reconnected = callback
    },
    async start() {
      connection.started += 1
    },
    async stop() {
      connection.stopped += 1
    },
    async invoke(method, ...args) {
      connection.calls.push([method, ...args])
      if (method === JOIN_ROUTE_METHOD) {
        if (failJoin) throw new Error('Ulaşım simülasyonunu görüntüleme yetkiniz bulunmuyor.')
        return joinResult(args[0])
      }
      return null
    },
    /** Sunucudan gelen bir yayını taklit eder. */
    push(payload) {
      for (const handler of connection.handlers.get(SIMULATION_UPDATED_EVENT) ?? []) handler(payload)
    },
  }
  return connection
}

function build(options = {}) {
  const connection = fakeConnection(options)
  const updates = []
  const errors = []
  const client = createTransportSimulationClient({
    createConnection: () => {
      connection.created = (connection.created ?? 0) + 1
      return connection
    },
    onUpdate: (payload) => updates.push(payload),
    onError: (error) => errors.push(error),
  })
  return { client, connection, updates, errors }
}

const methodsOf = (connection, method) => connection.calls.filter(([name]) => name === method)

test('a factory is required', () => {
  assert.throws(() => createTransportSimulationClient({}), /createConnection/)
})

/* --- Takip / bırakma --------------------------------------------------------- */

test('following a route starts one connection and joins its group', async () => {
  const { client, connection } = build()

  const snapshot = await client.follow(7)

  assert.equal(connection.created, 1)
  assert.equal(connection.started, 1)
  assert.deepEqual(methodsOf(connection, JOIN_ROUTE_METHOD), [[JOIN_ROUTE_METHOD, 7]])
  assert.equal(client.followingRouteId, 7)
  assert.equal(snapshot.routeId, 7)
})

test('the late-join snapshot is delivered immediately', async () => {
  /* Geç katılan kullanıcı bir sonraki tick'i BEKLEMEDEN aracın durumunu
     görmelidir; bu, katılım cevabının uygulanmasıyla sağlanır. */
  const { client, updates } = build({ joinResult: (routeId) => snapshotFor(routeId, 42) })

  await client.follow(7)

  assert.equal(updates.length, 1)
  assert.equal(updates[0].progressPercent, 42)
})

test('joining a route with no running simulation yields null without breaking follow', async () => {
  const { client, updates } = build({ joinResult: () => null })

  const snapshot = await client.follow(7)

  assert.equal(snapshot, null)
  assert.equal(client.followingRouteId, 7)
  assert.equal(updates.length, 0)
})

test('a second connection is not created when following again', async () => {
  const { client, connection } = build()

  await client.follow(7)
  await client.unfollow()
  await client.follow(7)

  assert.equal(connection.created, 1)
  assert.equal(connection.started, 1)
})

test('the update handler is registered exactly once for the connection lifetime', async () => {
  const { client, connection, updates } = build()

  await client.follow(7)
  await client.unfollow()
  await client.follow(7)

  assert.equal(connection.handlers.get(SIMULATION_UPDATED_EVENT).length, 1)

  connection.push(snapshotFor(7, 10))

  // Tek kayıt → tek işleme. İki kayıt olsaydı her olay iki kez uygulanırdı.
  assert.equal(updates.filter((update) => update.progressPercent === 10).length, 1)
})

test('unfollowing leaves the group and stops applying its events', async () => {
  const { client, connection, updates } = build()
  await client.follow(7)

  await client.unfollow()

  assert.deepEqual(methodsOf(connection, LEAVE_ROUTE_METHOD), [[LEAVE_ROUTE_METHOD, 7]])
  assert.equal(client.followingRouteId, null)

  connection.push(snapshotFor(7, 80))
  assert.equal(updates.some((update) => update.progressPercent === 80), false)
})

test('unfollowing without following is a no-op', async () => {
  const { client, connection } = build()

  await client.unfollow()

  assert.equal(connection.created, undefined)
  assert.equal(client.followingRouteId, null)
})

/* --- Rota değiştirme --------------------------------------------------------- */

test('switching the followed route leaves the old group before joining the new one', async () => {
  const { client, connection } = build()
  await client.follow(7)

  await client.follow(8)

  assert.deepEqual(connection.calls, [
    [JOIN_ROUTE_METHOD, 7],
    [LEAVE_ROUTE_METHOD, 7],
    [JOIN_ROUTE_METHOD, 8],
  ])
  assert.equal(client.followingRouteId, 8)
})

test('after switching, events from the previous route are ignored', async () => {
  const { client, connection, updates } = build()
  await client.follow(7)
  await client.follow(8)
  updates.length = 0

  connection.push(snapshotFor(7, 99))
  connection.push(snapshotFor(8, 5))

  assert.deepEqual(updates.map((update) => update.routeId), [8])
})

test('a superseded follow does not win and does not leave a dangling group', async () => {
  /* Kullanıcı hızlıca 7 → 8 seçerse, yavaş dönen 7 cevabı takip edilen rotayı
     geri almamalı; ama 7 grubunda da asılı kalınmamalıdır. */
  const connection = fakeConnection()

  /* İki kapı da follow ÇAĞRILMADAN ÖNCE kurulur ve söz (promise) ile
     eşitlenir: `firstJoinIssued` "7'nin JoinRoute'u gerçekten yola çıktı",
     `firstJoinReleased` ise "şimdi cevap versin" demektir. Kapıyı patched
     invoke'un içinde kurmak, çözücünün henüz atanmadığı bir ana denk gelmeye
     açıktı — sıralamayı uyku/zaman aşımı ile değil, açık sinyallerle
     belirlemek testi deterministik yapar. */
  let markFirstJoinIssued
  const firstJoinIssued = new Promise((resolve) => { markFirstJoinIssued = resolve })
  let releaseFirstJoin
  const firstJoinReleased = new Promise((resolve) => { releaseFirstJoin = resolve })

  const original = connection.invoke
  connection.invoke = async (method, ...args) => {
    if (method === JOIN_ROUTE_METHOD && args[0] === 7) {
      connection.calls.push([method, ...args])
      markFirstJoinIssued()
      await firstJoinReleased
      return snapshotFor(7)
    }
    return original(method, ...args)
  }

  const client = createTransportSimulationClient({
    createConnection: () => connection,
    onUpdate: () => {},
  })

  const slow = client.follow(7)
  // 8, 7 UÇUŞTAYKEN devralmalı; test etmek istediğimiz yarış budur.
  await firstJoinIssued
  const fast = client.follow(8)
  await fast
  releaseFirstJoin()
  assert.equal(await slow, null)

  assert.equal(client.followingRouteId, 8)
  assert.deepEqual(methodsOf(connection, LEAVE_ROUTE_METHOD), [[LEAVE_ROUTE_METHOD, 7]])
})

/* --- Pasif izleme (kamerasız canlı abonelik) --------------------------------- */

test('observing a route joins its group without claiming follow', async () => {
  /* Başlatan kullanıcı aracı CANLI görmelidir; ama bu bir "Takip Et" değildir:
     kamera sahipliği doğmaz ve arayüz takip durumuna geçmez. */
  const { client, connection, updates } = build({ joinResult: (routeId) => snapshotFor(routeId, 0) })

  const snapshot = await client.observe(7)

  assert.deepEqual(methodsOf(connection, JOIN_ROUTE_METHOD), [[JOIN_ROUTE_METHOD, 7]])
  assert.equal(client.observedRouteId, 7)
  assert.equal(client.followingRouteId, null)
  assert.equal(snapshot.progressPercent, 0)
  assert.equal(updates.length, 1)
})

test('an observed route receives later live updates on the same connection', async () => {
  const { client, connection, updates } = build()
  await client.observe(7)
  updates.length = 0

  connection.push(snapshotFor(7, 35))
  connection.push(snapshotFor(7, 70))

  assert.deepEqual(updates.map((update) => update.progressPercent), [35, 70])
  // Tek bağlantı, tek dinleyici: ikinci bir istemci ya da soket kurulmadı.
  assert.equal(connection.created, 1)
  assert.equal(connection.started, 1)
  assert.equal(connection.handlers.get(SIMULATION_UPDATED_EVENT).length, 1)
})

test('following a route that is already observed does not join it twice', async () => {
  const { client, connection } = build()
  await client.observe(7)

  await client.follow(7)

  // Aynı grup İKİ kez istenmez; üyelik tekildir.
  assert.deepEqual(methodsOf(connection, JOIN_ROUTE_METHOD), [[JOIN_ROUTE_METHOD, 7]])
  assert.deepEqual(methodsOf(connection, LEAVE_ROUTE_METHOD), [])
  assert.equal(client.followingRouteId, 7)
  assert.equal(client.observedRouteId, 7)
  assert.deepEqual(client.subscribedRouteIds, [7])
})

test('unfollowing a route that is still observed keeps the live stream', async () => {
  const { client, connection, updates } = build()
  await client.observe(7)
  await client.follow(7)

  await client.unfollow()

  // Kamera sahipliği düştü; abonelik DURUYOR, dolayısıyla gruptan çıkılmadı.
  assert.equal(client.followingRouteId, null)
  assert.equal(client.observedRouteId, 7)
  assert.deepEqual(methodsOf(connection, LEAVE_ROUTE_METHOD), [])

  updates.length = 0
  connection.push(snapshotFor(7, 80))
  assert.equal(updates.length, 1)
})

test('unfollowing leaves the group when nothing else observes it', async () => {
  const { client, connection } = build()
  await client.follow(7)

  await client.unfollow()

  assert.deepEqual(methodsOf(connection, LEAVE_ROUTE_METHOD), [[LEAVE_ROUTE_METHOD, 7]])
  assert.deepEqual(client.subscribedRouteIds, [])
})

test('stopping observation keeps an explicit follow untouched', async () => {
  const { client, connection, updates } = build()
  await client.observe(7)
  await client.follow(7)

  await client.stopObserving()

  assert.equal(client.observedRouteId, null)
  assert.equal(client.followingRouteId, 7)
  // Takip hâlâ istediği için grup BIRAKILMAZ.
  assert.deepEqual(methodsOf(connection, LEAVE_ROUTE_METHOD), [])

  updates.length = 0
  connection.push(snapshotFor(7, 55))
  assert.equal(updates.length, 1)
})

test('stopping observation of a route nobody follows leaves the group', async () => {
  const { client, connection, updates } = build()
  await client.observe(7)

  await client.stopObserving()

  assert.deepEqual(methodsOf(connection, LEAVE_ROUTE_METHOD), [[LEAVE_ROUTE_METHOD, 7]])

  updates.length = 0
  connection.push(snapshotFor(7, 90))
  assert.equal(updates.length, 0)
})

test('observing and following different routes keeps both subscriptions', async () => {
  const { client, connection, updates } = build()
  await client.observe(7)

  await client.follow(8)

  assert.deepEqual(methodsOf(connection, JOIN_ROUTE_METHOD), [
    [JOIN_ROUTE_METHOD, 7],
    [JOIN_ROUTE_METHOD, 8],
  ])
  assert.deepEqual(methodsOf(connection, LEAVE_ROUTE_METHOD), [])
  assert.deepEqual(client.subscribedRouteIds, [8, 7])

  updates.length = 0
  connection.push(snapshotFor(7, 20))
  connection.push(snapshotFor(8, 30))
  assert.deepEqual(updates.map((update) => update.routeId), [7, 8])
})

test('switching the observed route releases only the old observation', async () => {
  const { client, connection } = build()
  await client.observe(7)

  await client.observe(8)

  assert.deepEqual(connection.calls, [
    [JOIN_ROUTE_METHOD, 7],
    [LEAVE_ROUTE_METHOD, 7],
    [JOIN_ROUTE_METHOD, 8],
  ])
  assert.equal(client.observedRouteId, 8)
})

test('observing the same route again does not re-join it', async () => {
  const { client, connection } = build()
  await client.observe(7)

  await client.observe(7)

  assert.equal(methodsOf(connection, JOIN_ROUTE_METHOD).length, 1)
})

test('disposing releases both slots exactly once', async () => {
  const { client, connection } = build()
  await client.observe(7)
  await client.follow(8)

  await client.dispose()

  assert.equal(methodsOf(connection, LEAVE_ROUTE_METHOD).length, 2)
  assert.equal(connection.stopped, 1)
  assert.equal(client.followingRouteId, null)
  assert.equal(client.observedRouteId, null)
})

/* --- Yeniden bağlanma -------------------------------------------------------- */

test('reconnecting rejoins the followed route and recovers the snapshot', async () => {
  /* Yeniden bağlanma grup üyeliğini korumaz: bağlantı sunucuda YENİ bir
     kimliktir. Yeniden katılmayan bir istemci sessizce donmuş görünürdü. */
  const { client, connection, updates } = build({ joinResult: (routeId) => snapshotFor(routeId, 61) })
  await client.follow(7)
  updates.length = 0

  await connection.reconnected()

  assert.equal(methodsOf(connection, JOIN_ROUTE_METHOD).length, 2)
  assert.equal(updates.length, 1)
  assert.equal(updates[0].progressPercent, 61)
})

test('reconnecting restores every subscription that is still required', async () => {
  const { client, connection, updates } = build({ joinResult: (routeId) => snapshotFor(routeId, 15) })
  await client.observe(7)
  await client.follow(8)
  updates.length = 0

  await connection.reconnected()

  // Her iki grup da yeniden kurulur; kamera sahipliği değişmez.
  const rejoined = methodsOf(connection, JOIN_ROUTE_METHOD).slice(2)
  assert.deepEqual(rejoined.map(([, routeId]) => routeId).sort(), [7, 8])
  assert.deepEqual(updates.map((update) => update.routeId).sort(), [7, 8])
  assert.equal(client.followingRouteId, 8)
  assert.equal(client.observedRouteId, 7)
})

test('reconnecting rejoins a route held by both slots only once', async () => {
  const { client, connection } = build()
  await client.observe(7)
  await client.follow(7)
  const before = methodsOf(connection, JOIN_ROUTE_METHOD).length

  await connection.reconnected()

  assert.equal(methodsOf(connection, JOIN_ROUTE_METHOD).length - before, 1)
})

test('reconnecting without a followed route rejoins nothing', async () => {
  const { client, connection } = build()
  await client.follow(7)
  await client.unfollow()

  await connection.reconnected()

  assert.equal(methodsOf(connection, JOIN_ROUTE_METHOD).length, 1)
  assert.deepEqual(client.subscribedRouteIds, [])
})

test('a failing rejoin is reported and does not throw into the reconnect pipeline', async () => {
  const connection = fakeConnection()
  const errors = []
  const client = createTransportSimulationClient({
    createConnection: () => connection,
    onUpdate: () => {},
    onError: (error) => errors.push(error),
  })
  await client.follow(7)
  connection.invoke = async () => { throw new Error('bağlantı reddedildi') }

  await connection.reconnected()

  assert.equal(errors.length, 1)
  assert.equal(client.followingRouteId, 7)
})

/* --- Hatalar ve temizlik ------------------------------------------------------ */

test('a rejected join leaves the client unfollowed and surfaces the error', async () => {
  const { client } = build({ failJoin: true })

  await assert.rejects(() => client.follow(7), /yetkiniz bulunmuyor/)
  assert.equal(client.followingRouteId, null)
})

test('disposing leaves the group, removes the handler and stops the connection', async () => {
  const { client, connection, updates } = build()
  await client.follow(7)

  await client.dispose()

  assert.deepEqual(methodsOf(connection, LEAVE_ROUTE_METHOD), [[LEAVE_ROUTE_METHOD, 7]])
  assert.equal(connection.handlers.get(SIMULATION_UPDATED_EVENT).length, 0)
  assert.equal(connection.stopped, 1)
  assert.equal(client.followingRouteId, null)

  connection.push(snapshotFor(7, 90))
  assert.equal(updates.some((update) => update.progressPercent === 90), false)
})

test('disposing twice stops the connection only once', async () => {
  const { client, connection } = build()
  await client.follow(7)

  await client.dispose()
  await client.dispose()

  assert.equal(connection.stopped, 1)
})

test('following after disposal is refused instead of reviving a dead client', async () => {
  const { client } = build()
  await client.follow(7)
  await client.dispose()

  await assert.rejects(() => client.follow(7), /kapatıldı/)
})
