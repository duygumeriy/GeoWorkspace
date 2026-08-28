import assert from 'node:assert/strict'
import test from 'node:test'
import { deleteStopThenMaybeGenerate, persistStopThenMaybeGenerate, restoreStopThenMaybeGenerate } from '../../src/services/transportStopWorkflow.js'

const jsonResponse = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
})

test('stop-only workflow never calls route generation', async () => {
  let generations = 0
  const result = await persistStopThenMaybeGenerate({
    save: async () => jsonResponse({ id: 9, routeId: 7 }, 201),
    routeId: 7,
    generatePath: false,
    generate: async () => { generations += 1; return jsonResponse({}) },
    saveFailureMessage: 'Durak eklenemedi.',
  })
  assert.equal(result.stop.id, 9)
  assert.equal(result.routeGenerated, false)
  assert.equal(generations, 0)
})

test('successful stop save is followed by backend route generation', async () => {
  const calls = []
  const result = await persistStopThenMaybeGenerate({
    save: async () => { calls.push('stop'); return jsonResponse({ id: 9, routeId: 7 }, 201) },
    routeId: 7,
    generatePath: true,
    generate: async (routeId) => { calls.push(`route:${routeId}`); return jsonResponse({ routeId, isStale: false }) },
    saveFailureMessage: 'Durak eklenemedi.',
  })
  assert.deepEqual(calls, ['stop', 'route:7'])
  assert.equal(result.routeGenerated, true)
  assert.equal(result.generationError, null)
})

test('route generation failure preserves the successful stop as a partial success', async () => {
  const result = await persistStopThenMaybeGenerate({
    save: async () => jsonResponse({ id: 9, routeId: 7 }, 201),
    routeId: 7,
    generatePath: true,
    generate: async () => jsonResponse({ message: 'Güvenli rota hatası.' }, 503),
    saveFailureMessage: 'Durak eklenemedi.',
  })
  assert.equal(result.stop.id, 9)
  assert.equal(result.routeGenerated, false)
  assert.equal(result.generationError, 'Güvenli rota hatası.')
})

test('failed stop save throws and never starts route generation', async () => {
  let generations = 0
  await assert.rejects(() => persistStopThenMaybeGenerate({
    save: async () => jsonResponse({ message: 'Durak reddedildi.' }, 403),
    routeId: 7,
    generatePath: true,
    generate: async () => { generations += 1; return jsonResponse({}) },
    saveFailureMessage: 'Durak eklenemedi.',
  }), /Durak reddedildi/)
  assert.equal(generations, 0)
})

const transferStops = (sourceCount, destinationCount) => ({
  routes: [{ id: 1, name: 'Kaynak Hat' }, { id: 2, name: 'Hedef Hat' }],
  stops: [
    ...Array.from({ length: sourceCount }, (_, index) => ({ id: 10 + index, routeId: 1, sequenceOrder: index + 1, isActive: true })),
    ...Array.from({ length: destinationCount }, (_, index) => ({ id: 20 + index, routeId: 2, sequenceOrder: index + 1, isActive: true })),
  ],
})

test('route transfer refreshes canonical topology and generates each eligible affected route exactly once', async () => {
  const calls = []
  const result = await persistStopThenMaybeGenerate({
    save: async () => {
      calls.push('save')
      return jsonResponse({ id: 9, routeId: 2, sequenceOrder: 3 }, 200)
    },
    routeId: 2,
    sourceRouteId: 1,
    generateTransferredRoutes: true,
    reloadTransport: async () => { calls.push('refresh'); return transferStops(2, 3) },
    generate: async (routeId) => { calls.push(`generate:${routeId}`); return jsonResponse({ routeId, isStale: false }) },
    saveFailureMessage: 'Durak güncellenemedi.',
  })

  assert.deepEqual(calls, ['save', 'refresh', 'generate:1', 'generate:2'])
  assert.equal(result.transferred, true)
  assert.equal(result.stop.sequenceOrder, 3)
  assert.deepEqual(result.affectedRouteOutcomes.map((outcome) => outcome.routeId), [1, 2])
  assert.equal(new Set(result.affectedRouteOutcomes.map((outcome) => outcome.routeId)).size, 2)
  assert.equal(result.affectedRouteOutcomes.every((outcome) => outcome.generated), true)
})

for (const scenario of [
  { name: 'source route with fewer than two stops is skipped', sourceCount: 1, destinationCount: 2, expected: [2] },
  { name: 'destination route with fewer than two stops is skipped', sourceCount: 2, destinationCount: 1, expected: [1] },
  { name: 'both affected routes with fewer than two stops are skipped', sourceCount: 1, destinationCount: 1, expected: [] },
]) {
  test(scenario.name, async () => {
    const generations = []
    const result = await persistStopThenMaybeGenerate({
      save: async () => jsonResponse({ id: 9, routeId: 2, sequenceOrder: scenario.destinationCount }),
      routeId: 2,
      sourceRouteId: 1,
      generateTransferredRoutes: true,
      reloadTransport: async () => transferStops(scenario.sourceCount, scenario.destinationCount),
      generate: async (routeId) => { generations.push(routeId); return jsonResponse({ routeId }) },
      saveFailureMessage: 'Durak güncellenemedi.',
    })
    assert.deepEqual(generations, scenario.expected)
    assert.equal(result.generationAttempted, scenario.expected.length > 0)
  })
}

test('route transfer routability ignores inactive and deleted canonical stops', async () => {
  const snapshot = transferStops(1, 2)
  snapshot.stops.push(
    { id: 98, routeId: 1, sequenceOrder: 2, isActive: false },
    { id: 99, routeId: 1, sequenceOrder: 3, isActive: true, isDeleted: true },
  )
  const generations = []
  const result = await persistStopThenMaybeGenerate({
    save: async () => jsonResponse({ id: 9, routeId: 2, sequenceOrder: 2 }),
    routeId: 2,
    sourceRouteId: 1,
    generateTransferredRoutes: true,
    reloadTransport: async () => snapshot,
    generate: async (routeId) => { generations.push(routeId); return jsonResponse({ routeId }) },
    saveFailureMessage: 'Durak güncellenemedi.',
  })
  assert.deepEqual(generations, [2])
  assert.equal(result.affectedRouteOutcomes.find((outcome) => outcome.routeId === 1)?.activeStopCount, 1)
})

test('route transfer without route.update permission refreshes but generates neither route', async () => {
  let refreshes = 0
  const generations = []
  const result = await persistStopThenMaybeGenerate({
    save: async () => jsonResponse({ id: 9, routeId: 2, sequenceOrder: 3 }),
    routeId: 2,
    sourceRouteId: 1,
    generateTransferredRoutes: false,
    reloadTransport: async () => { refreshes += 1; return transferStops(2, 3) },
    generate: async (routeId) => { generations.push(routeId); return jsonResponse({ routeId }) },
    saveFailureMessage: 'Durak güncellenemedi.',
  })
  assert.equal(result.transferred, true)
  assert.equal(refreshes, 1)
  assert.deepEqual(generations, [])
  assert.equal(result.affectedRouteOutcomes.every((outcome) => outcome.skippedReason === 'permission'), true)
})

test('affected route generation failures are independent and preserve per-route outcomes', async () => {
  for (const failures of [[1], [2], [1, 2]]) {
    const calls = []
    const result = await persistStopThenMaybeGenerate({
      save: async () => jsonResponse({ id: 9, routeId: 2, sequenceOrder: 3 }),
      routeId: 2,
      sourceRouteId: 1,
      generateTransferredRoutes: true,
      reloadTransport: async () => transferStops(2, 3),
      generate: async (routeId) => {
        calls.push(routeId)
        return failures.includes(routeId)
          ? jsonResponse({ message: `Güvenli hata ${routeId}.` }, 503)
          : jsonResponse({ routeId, isStale: false })
      },
      saveFailureMessage: 'Durak güncellenemedi.',
    })
    assert.deepEqual(calls, [1, 2])
    assert.equal(result.stop.routeId, 2)
    for (const outcome of result.affectedRouteOutcomes) {
      assert.equal(outcome.generated, !failures.includes(outcome.routeId))
      assert.equal(outcome.error, failures.includes(outcome.routeId) ? `Güvenli hata ${outcome.routeId}.` : null)
    }
  }
})

test('failed transfer update never refreshes topology or generates routes', async () => {
  let refreshes = 0
  let generations = 0
  await assert.rejects(() => persistStopThenMaybeGenerate({
    save: async () => jsonResponse({ message: 'Taşıma reddedildi.' }, 400),
    routeId: 2,
    sourceRouteId: 1,
    generateTransferredRoutes: true,
    reloadTransport: async () => { refreshes += 1; return transferStops(2, 3) },
    generate: async () => { generations += 1; return jsonResponse({}) },
    saveFailureMessage: 'Durak güncellenemedi.',
  }), /Taşıma reddedildi/)
  assert.equal(refreshes, 0)
  assert.equal(generations, 0)
})

test('same-route edit keeps optional single-route generation and never enters transfer processing', async () => {
  let refreshes = 0
  const generations = []
  const result = await persistStopThenMaybeGenerate({
    save: async () => jsonResponse({ id: 9, routeId: 7, sequenceOrder: 2 }),
    routeId: 7,
    sourceRouteId: '7',
    generatePath: true,
    generateTransferredRoutes: true,
    reloadTransport: async () => { refreshes += 1; return transferStops(2, 2) },
    generate: async (routeId) => { generations.push(routeId); return jsonResponse({ routeId }) },
    saveFailureMessage: 'Durak güncellenemedi.',
  })
  assert.equal(result.transferred, undefined)
  assert.equal(refreshes, 0)
  assert.deepEqual(generations, [7])
})

test('delete reloads compacted stops and generates when at least two remain', async () => {
  const calls = []
  const compacted = [
    { id: 1, routeId: 7, sequenceOrder: 1, isActive: true },
    { id: 3, routeId: 7, sequenceOrder: 2, isActive: true },
  ]
  const result = await deleteStopThenMaybeGenerate({
    remove: async () => { calls.push('delete'); return new Response(null, { status: 204 }) },
    routeId: 7,
    generatePath: true,
    reloadTransport: async () => { calls.push('reload'); return { stops: compacted } },
    generate: async () => { calls.push('generate'); return jsonResponse({ routeId: 7, isStale: false }) },
  })
  assert.deepEqual(calls, ['delete', 'reload', 'generate'])
  assert.deepEqual(compacted.map((stop) => stop.sequenceOrder), [1, 2])
  assert.equal(result.remainingStopCount, 2)
  assert.equal(result.routeGenerated, true)
})

test('delete generation failure remains a successful deletion with a safe reason', async () => {
  const result = await deleteStopThenMaybeGenerate({
    remove: async () => new Response(null, { status: 204 }),
    routeId: 7,
    generatePath: true,
    reloadTransport: async () => ({ stops: [{ routeId: 7 }, { routeId: 7 }] }),
    generate: async () => jsonResponse({ message: 'Güvenli rota hatası.' }, 503),
  })
  assert.equal(result.deleted, true)
  assert.equal(result.routeGenerated, false)
  assert.equal(result.generationError, 'Güvenli rota hatası.')
})

test('delete failure stops before reload and generation', async () => {
  let reloads = 0
  let generations = 0
  await assert.rejects(() => deleteStopThenMaybeGenerate({
    remove: async () => jsonResponse({ message: 'Silme reddedildi.' }, 403),
    routeId: 7,
    generatePath: true,
    reloadTransport: async () => { reloads += 1; return { stops: [] } },
    generate: async () => { generations += 1; return jsonResponse({}) },
  }), /Silme reddedildi/)
  assert.equal(reloads, 0)
  assert.equal(generations, 0)
})

test('delete leaving one active stop does not generate', async () => {
  let generations = 0
  const result = await deleteStopThenMaybeGenerate({
    remove: async () => new Response(null, { status: 204 }),
    routeId: 7,
    generatePath: true,
    reloadTransport: async () => ({ stops: [{ routeId: 7, isActive: true }] }),
    generate: async () => { generations += 1; return jsonResponse({}) },
  })
  assert.equal(result.remainingStopCount, 1)
  assert.equal(result.generationAttempted, false)
  assert.equal(generations, 0)
})

test('delete without route update permission does not generate', async () => {
  let generations = 0
  const result = await deleteStopThenMaybeGenerate({
    remove: async () => new Response(null, { status: 204 }),
    routeId: 7,
    generatePath: false,
    reloadTransport: async () => ({ stops: [{ routeId: 7 }, { routeId: 7 }] }),
    generate: async () => { generations += 1; return jsonResponse({}) },
  })
  assert.equal(result.deleted, true)
  assert.equal(result.remainingStopCount, 2)
  assert.equal(result.generationAttempted, false)
  assert.equal(generations, 0)
})

test('restore reloads canonical stops and generates a routable route when permitted', async () => {
  const calls = []
  const result = await restoreStopThenMaybeGenerate({
    restore: async () => {
      calls.push('restore')
      return jsonResponse({ id: 9, routeId: 7, sequenceOrder: 3, isActive: true })
    },
    generatePath: true,
    reloadTransport: async () => {
      calls.push('reload')
      return { stops: [{ routeId: 7, sequenceOrder: 1 }, { routeId: 7, sequenceOrder: 2 }, { routeId: 7, sequenceOrder: 3 }] }
    },
    generate: async (routeId) => {
      calls.push(`generate:${routeId}`)
      return jsonResponse({ routeId, isStale: false })
    },
  })
  assert.deepEqual(calls, ['restore', 'reload', 'generate:7'])
  assert.equal(result.routeGenerated, true)
  assert.equal(result.activeStopCount, 3)
  assert.equal(result.stop.sequenceOrder, 3)
})

test('restore generation failure remains a successful restore with the backend order and safe reason', async () => {
  const result = await restoreStopThenMaybeGenerate({
    restore: async () => jsonResponse({ id: 9, routeId: 7, sequenceOrder: 4, isActive: true }),
    generatePath: true,
    reloadTransport: async () => ({ stops: [{ routeId: 7 }, { routeId: 7 }] }),
    generate: async () => jsonResponse({ message: 'Güvenli rota hatası.' }, 503),
  })
  assert.equal(result.restored, true)
  assert.equal(result.stop.sequenceOrder, 4)
  assert.equal(result.routeGenerated, false)
  assert.equal(result.generationError, 'Güvenli rota hatası.')
})

test('restore failure stops before reload and generation', async () => {
  let reloads = 0
  let generations = 0
  await assert.rejects(() => restoreStopThenMaybeGenerate({
    restore: async () => jsonResponse({ message: 'Geri yükleme reddedildi.' }, 403),
    generatePath: true,
    reloadTransport: async () => { reloads += 1; return { stops: [] } },
    generate: async () => { generations += 1; return jsonResponse({}) },
  }), /Geri yükleme reddedildi/)
  assert.equal(reloads, 0)
  assert.equal(generations, 0)
})

test('restore leaving one active stop does not generate', async () => {
  let generations = 0
  const result = await restoreStopThenMaybeGenerate({
    restore: async () => jsonResponse({ id: 9, routeId: 7, sequenceOrder: 1, isActive: true }),
    generatePath: true,
    reloadTransport: async () => ({ stops: [{ routeId: 7, isActive: true }] }),
    generate: async () => { generations += 1; return jsonResponse({}) },
  })
  assert.equal(result.activeStopCount, 1)
  assert.equal(result.generationAttempted, false)
  assert.equal(generations, 0)
})

test('restore without route update permission succeeds without generation', async () => {
  let generations = 0
  const result = await restoreStopThenMaybeGenerate({
    restore: async () => jsonResponse({ id: 9, routeId: 7, sequenceOrder: 2, isActive: true }),
    generatePath: false,
    reloadTransport: async () => ({ stops: [{ routeId: 7 }, { routeId: 7 }] }),
    generate: async () => { generations += 1; return jsonResponse({}) },
  })
  assert.equal(result.restored, true)
  assert.equal(result.activeStopCount, 2)
  assert.equal(result.generationAttempted, false)
  assert.equal(generations, 0)
})
