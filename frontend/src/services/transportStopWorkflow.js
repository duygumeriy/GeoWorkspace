import { readApiError } from './api.js'
import { generateTransportRoutePath } from './transportApi.js'

async function generateRouteSafely(routeId, generate) {
  try {
    const generationResponse = await generate(routeId)
    if (!generationResponse.ok) {
      throw new Error(await readApiError(generationResponse, 'Rota yeniden hesaplanamadı.'))
    }
    await generationResponse.json()
    return { generationAttempted: true, routeGenerated: true, generationError: null }
  } catch (error) {
    return {
      generationAttempted: true,
      routeGenerated: false,
      generationError: error?.message || 'Rota yeniden hesaplanamadı.',
    }
  }
}

async function generateAffectedRoutes({ routeIds, snapshot, permitted, generate }) {
  const routes = Array.isArray(snapshot?.routes) ? snapshot.routes : []
  const stops = Array.isArray(snapshot?.stops) ? snapshot.stops : []
  const uniqueRouteIds = [...new Set(routeIds.map(Number).filter(Number.isFinite))]
  const outcomes = []

  for (const routeId of uniqueRouteIds) {
    const activeStopCount = stops.filter((stop) =>
      stop.routeId === routeId
      && stop.isActive !== false
      && stop.isDeleted !== true).length
    const routeName = routes.find((route) => route.id === routeId)?.name ?? `Güzergah #${routeId}`

    if (!permitted) {
      outcomes.push({ routeId, routeName, activeStopCount, attempted: false, generated: false, skippedReason: 'permission', error: null })
      continue
    }
    if (activeStopCount < 2) {
      outcomes.push({ routeId, routeName, activeStopCount, attempted: false, generated: false, skippedReason: 'insufficient-stops', error: null })
      continue
    }

    const result = await generateRouteSafely(routeId, generate)
    outcomes.push({
      routeId,
      routeName,
      activeStopCount,
      attempted: true,
      generated: result.routeGenerated,
      skippedReason: null,
      error: result.generationError,
    })
  }

  return outcomes
}

/**
 * Persists a stop mutation first and, only after that succeeds, optionally asks
 * the backend to regenerate the selected route. A routing failure is returned
 * as a partial success: the already-persisted stop mutation is never rolled
 * back and callers can refresh stale/current state from the server.
 */
export async function persistStopThenMaybeGenerate({
  save,
  routeId,
  generatePath = false,
  sourceRouteId = null,
  generateTransferredRoutes = false,
  reloadTransport,
  generate = generateTransportRoutePath,
  saveFailureMessage,
}) {
  const response = await save()
  if (!response.ok) {
    throw new Error(await readApiError(response, saveFailureMessage))
  }

  const stop = await response.json()
  const hasSourceRouteId = sourceRouteId !== null
    && sourceRouteId !== undefined
    && String(sourceRouteId).trim() !== ''
  const canonicalSourceRouteId = hasSourceRouteId ? Number(sourceRouteId) : Number.NaN
  const destinationRouteId = Number(stop?.routeId)
  const transferred = Number.isFinite(canonicalSourceRouteId)
    && Number.isFinite(destinationRouteId)
    && canonicalSourceRouteId !== destinationRouteId

  if (transferred) {
    let snapshot = null
    try {
      snapshot = await reloadTransport?.()
    } catch {
      // The transfer is already durable. Never generate either route from an
      // unverified pre-transfer topology.
    }
    if (!Array.isArray(snapshot?.stops)) {
      return {
        stop,
        transferred: true,
        sourceRouteId: canonicalSourceRouteId,
        destinationRouteId,
        canonicalRefreshed: false,
        generationAttempted: false,
        routeGenerated: false,
        generationError: null,
        affectedRouteOutcomes: [],
        refreshError: 'Durak taşındı ancak güzergah durumu yenilenemedi.',
      }
    }

    const affectedRouteOutcomes = await generateAffectedRoutes({
      routeIds: [canonicalSourceRouteId, destinationRouteId],
      snapshot,
      permitted: generateTransferredRoutes,
      generate,
    })
    const attempted = affectedRouteOutcomes.filter((outcome) => outcome.attempted)
    const failed = attempted.filter((outcome) => !outcome.generated)
    return {
      stop,
      transferred: true,
      sourceRouteId: canonicalSourceRouteId,
      destinationRouteId,
      canonicalRefreshed: true,
      generationAttempted: attempted.length > 0,
      routeGenerated: attempted.length > 0 && failed.length === 0,
      generationError: failed[0]?.error ?? null,
      affectedRouteOutcomes,
      refreshError: null,
    }
  }

  if (!generatePath) return { stop, routeGenerated: false, generationError: null }

  return { stop, ...await generateRouteSafely(routeId, generate) }
}

/**
 * Deletes first, then reloads the canonical transport snapshot before deciding
 * whether the affected route is still routable. Regeneration is therefore
 * based on active server-backed stops, never on an optimistic local count.
 */
export async function deleteStopThenMaybeGenerate({
  remove,
  routeId,
  generatePath = false,
  reloadTransport,
  generate = generateTransportRoutePath,
  deleteFailureMessage = 'Durak silinemedi.',
}) {
  const response = await remove()
  if (!response.ok) {
    throw new Error(await readApiError(response, deleteFailureMessage))
  }

  let snapshot = null
  try {
    snapshot = await reloadTransport?.()
  } catch {
    // The deletion is already durable. A reload failure must not be reported
    // as a failed delete or trigger generation from an unverified local count.
  }
  const stops = Array.isArray(snapshot) ? snapshot : snapshot?.stops
  if (!Array.isArray(stops)) {
    return {
      deleted: true,
      remainingStopCount: null,
      generationAttempted: false,
      routeGenerated: false,
      generationError: null,
      refreshError: 'Durak silindi ancak güzergah durumu yenilenemedi.',
    }
  }

  const remainingStopCount = stops.filter((stop) =>
    stop.routeId === Number(routeId)
    && stop.isActive !== false
    && stop.isDeleted !== true).length

  if (!generatePath || remainingStopCount < 2) {
    return {
      deleted: true,
      remainingStopCount,
      generationAttempted: false,
      routeGenerated: false,
      generationError: null,
      refreshError: null,
    }
  }

  return {
    deleted: true,
    remainingStopCount,
    refreshError: null,
    ...await generateRouteSafely(routeId, generate),
  }
}

/**
 * Restores a stop first, then uses the canonical refreshed transport snapshot
 * to decide whether its route can be regenerated. The backend response owns
 * both the route id and the appended sequence order; neither is reconstructed
 * in the browser.
 */
export async function restoreStopThenMaybeGenerate({
  restore,
  generatePath = false,
  reloadTransport,
  generate = generateTransportRoutePath,
  restoreFailureMessage = 'Durak geri yüklenemedi.',
}) {
  const response = await restore()
  if (!response.ok) {
    throw new Error(await readApiError(response, restoreFailureMessage))
  }

  const stop = await response.json()
  const routeId = Number(stop?.routeId)
  let snapshot = null
  try {
    snapshot = await reloadTransport?.()
  } catch {
    // Restore is already durable. Never report it as failed or generate from
    // an unverified local stop count when the canonical reload fails.
  }
  const stops = Array.isArray(snapshot) ? snapshot : snapshot?.stops
  if (!Number.isFinite(routeId) || !Array.isArray(stops)) {
    return {
      restored: true,
      stop,
      routeId: Number.isFinite(routeId) ? routeId : null,
      activeStopCount: null,
      generationAttempted: false,
      routeGenerated: false,
      generationError: null,
      refreshError: 'Durak geri yüklendi ancak güzergah durumu yenilenemedi.',
    }
  }

  const activeStopCount = stops.filter((item) =>
    item.routeId === routeId
    && item.isActive !== false
    && item.isDeleted !== true).length

  if (!generatePath || activeStopCount < 2) {
    return {
      restored: true,
      stop,
      routeId,
      activeStopCount,
      generationAttempted: false,
      routeGenerated: false,
      generationError: null,
      refreshError: null,
    }
  }

  return {
    restored: true,
    stop,
    routeId,
    activeStopCount,
    refreshError: null,
    ...await generateRouteSafely(routeId, generate),
  }
}
