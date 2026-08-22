import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ImageLayer from 'ol/layer/Image.js'
import ImageStatic from 'ol/source/ImageStatic.js'
import { fetchMapPresentationImage } from '../services/api.js'
import { DRAWING_TYPE_IDS } from '../map/drawingTypes.js'
import {
  PRESENTATION_REQUEST_DEBOUNCE_MS,
  PRESENTATION_Z_INDEX,
  presentationBbox,
  presentationImageSize,
} from '../map/mapPresentation.js'

const IDLE = Object.freeze({ point: false, line: false, polygon: false })

/**
 * The WMS half of the map: one authenticated raster per geometry type,
 * refreshed for the current viewport.
 *
 * ## One request per type, on purpose
 *
 * The three layers are NOT combined into a single multi-layer WMS request.
 * How a single `CQL_FILTER` is distributed across several layers is a
 * server-version detail, and a version that quietly applied it to the first
 * layer only would return the other two **unfiltered** — other people's
 * drawings in the image. One request, one layer, one filter removes that
 * question entirely; the stacking order is then a plain z-index here.
 *
 * ## Three independent reasons a raster may be off screen
 *
 * They are deliberately separate, because collapsing them would make one of
 * them silently override another:
 *
 *   1. **The user hid the layer** (`visibility`). Nothing is requested and
 *      nothing is drawn — vector and raster alike. Unchanged since Phase 5.
 *   2. **The raster is out of date** (`version`). Every successful write bumps
 *      a version; an image installed under an older version is stale and is
 *      hidden until its replacement arrives. Without this, a moved shape would
 *      keep a ghost of itself at the persisted position.
 *   3. **The raster is suspended** (`suspendedTypes`). There are *unsaved local
 *      changes* to that geometry type — a Modify/Translate session, or a live
 *      style preview. The persisted image is still correct for the database,
 *      but it no longer matches what the user is looking at, so it steps aside
 *      until the edit is saved or cancelled.
 *
 * In all three cases the type's WFS features simply go back to drawing their
 * own normal style, so nothing ever disappears. That is what `activeRef`
 * carries: "is the raster currently drawing this type for me?".
 *
 * The image itself is kept across a suspension. Cancelling an edit therefore
 * costs no request — the persisted picture was valid the whole time and only
 * had to be shown again.
 *
 * The request lifecycle mirrors the proven heatmap one: debounced on
 * `moveend`/resize, superseded requests aborted, latest-request-wins, and every
 * Blob URL revoked when it is replaced or the layer goes away.
 *
 * @param {import('ol/Map').default | null} map
 * @param {{ permitted: boolean,
 *           visibility: Record<string, boolean>,
 *           version: number,
 *           suspendedTypes?: string[],
 *           activeRef: { current: Record<string, boolean> },
 *           onChange?: ((typeId: string, isActive: boolean) => void)|null }} options
 *   `version` is bumped by the drawing workspace after every successful
 *   mutation, which is what makes a create/update/delete/restore refresh the
 *   raster — never before the write has actually landed.
 */
export default function useMapPresentationLayer(
  map,
  { permitted, visibility, version = 0, suspendedTypes = [], activeRef, onChange = null },
) {
  const [active, setActive] = useState(IDLE)
  const [error, setError] = useState(null)

  /* Read at load time so changing the handler never rebuilds the raster
     layers — doing that mid-flight would cancel a request that is about to
     land and make the map flicker. */
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const visibilityRef = useRef(visibility)
  visibilityRef.current = visibility

  const versionRef = useRef(version)
  versionRef.current = version

  /* Array identity changes on every render; the sorted key does not, so the
     effects below run when the suspension actually changes and not before. */
  const suspendedKey = [...suspendedTypes].sort().join(',')
  const suspendedRef = useRef(suspendedTypes)
  suspendedRef.current = suspendedTypes

  /** Live per-type raster state, reachable from the effects that react to it. */
  const entriesRef = useRef(new Map())

  /**
   * What the current view would ask GeoServer for: extent plus pixel size.
   *
   * An image is only a valid answer for the viewport it was requested for. A
   * type that was hidden while the user panned still holds a perfectly current
   * image — for somewhere else. Comparing this signature is what tells the two
   * cases apart when a layer is switched back on: same view, reuse and ask for
   * nothing; different view, fetch before it can be trusted.
   */
  const viewportKey = useCallback(() => {
    if (!map) return null
    const size = map.getSize()
    const view = map.getView()
    if (!size || size[0] <= 0 || size[1] <= 0 || view.getProjection().getCode() !== 'EPSG:3857') return null

    const bbox = presentationBbox(view.calculateExtent(size))
    if (!bbox) return null

    const { width, height } = presentationImageSize(size, window.devicePixelRatio)
    return `${bbox}|${width}x${height}`
  }, [map])

  /* Refreshing the image after a mutation is NOT rebuilding the layers:
     removing and re-adding a layer also throws away the image it is holding
     and leaves the map blank for the length of one request. The loader is
     therefore published through a ref, and a refresh only starts a request. */
  const scheduleLoadRef = useRef(null)

  const setTypeActive = useCallback(
    (typeId, value) => {
      /* Değer aynı olsa bile HABER VERİLİR. Aynı sürümde yeniden yüklenen bir
         görüntüde `active` değişmez, ama çağıran yine de haberdar olmalıdır:
         yeni yazılmış bir kaydı geçici olarak vektör hâlinde tutan işaret
         ancak bu bildirimle kaldırılır — aksi hâlde o kayıt hem raster hem
         vektör olarak iki kez çizilirdi. */
      if (activeRef) activeRef.current = { ...activeRef.current, [typeId]: value }
      setActive((current) => (current[typeId] === value ? current : { ...current, [typeId]: value }))
      /* The vector layer's style function reads `activeRef` outside React, so
         it has to be told the answer changed. */
      onChangeRef.current?.(typeId, value)
    },
    [activeRef],
  )

  /**
   * The single place that decides whether a type's raster is on screen.
   *
   * Keeping it as one predicate is what stops the three reasons above from
   * fighting: a layer the user hid cannot be un-hidden by a fresh image, and a
   * stale image cannot come back just because an edit was cancelled.
   */
  const syncLayers = useCallback(() => {
    for (const [typeId, entry] of entriesRef.current) {
      const shown =
        visibilityRef.current?.[typeId] !== false &&
        !suspendedRef.current.includes(typeId) &&
        !entry.failed &&
        entry.imageVersion !== null &&
        entry.imageVersion === versionRef.current

      entry.layer.setVisible(shown)
      setTypeActive(typeId, shown)
    }
  }, [setTypeActive])

  /** Everything off: the WFS features go back to drawing their normal style. */
  const deactivateAll = useCallback(() => {
    if (activeRef) activeRef.current = { ...IDLE }
    setActive(IDLE)
    for (const typeId of DRAWING_TYPE_IDS) onChangeRef.current?.(typeId, false)
  }, [activeRef])

  useEffect(() => {
    if (!map || !permitted) {
      entriesRef.current = new Map()
      deactivateAll()
      setError(null)
      return undefined
    }

    let disposed = false
    let timer = null
    const entries = new Map()

    for (const typeId of DRAWING_TYPE_IDS) {
      const layer = new ImageLayer({
        className: 'drawing-presentation-layer',
        zIndex: PRESENTATION_Z_INDEX[typeId],
        // Nothing is drawn until a valid image for the current version lands.
        visible: false,
      })
      layer.set('name', `drawing-presentation-${typeId}`)
      map.addLayer(layer)
      entries.set(typeId, {
        layer,
        controller: null,
        requestNumber: 0,
        blobUrl: null,
        /** `version` the installed image was produced for; null = no image. */
        imageVersion: null,
        /** Viewport signature the installed image was produced for. */
        imageKey: null,
        failed: false,
      })
    }
    entriesRef.current = entries

    const loadOne = async (typeId, extent, bbox, size, requestedVersion, requestedKey) => {
      const entry = entries.get(typeId)
      if (!entry) return

      entry.controller?.abort()
      entry.controller = new AbortController()
      const thisRequest = ++entry.requestNumber

      try {
        const blob = await fetchMapPresentationImage(typeId, {
          bbox,
          ...size,
          signal: entry.controller.signal,
        })
        if (disposed || entry.controller.signal.aborted || thisRequest !== entry.requestNumber) return

        const nextBlobUrl = URL.createObjectURL(blob)
        entry.layer.setSource(
          new ImageStatic({
            url: nextBlobUrl,
            imageExtent: [...extent],
            projection: map.getView().getProjection(),
            interpolate: true,
          }),
        )

        const previousBlobUrl = entry.blobUrl
        entry.blobUrl = nextBlobUrl
        map.render()
        if (previousBlobUrl) URL.revokeObjectURL(previousBlobUrl)

        /* The raster now shows everything written up to the version this
           request was issued for. If another write landed meanwhile, the
           version has already moved on and `syncLayers` keeps it hidden until
           the newer image arrives — no stale frame is ever shown. */
        entry.imageVersion = requestedVersion
        entry.imageKey = requestedKey
        entry.failed = false
        syncLayers()
      } catch (loadError) {
        if (loadError?.name === 'AbortError' || disposed || thisRequest !== entry.requestNumber) return
        /* Fail visible, not blank: the type is marked failed so its WFS
           features keep drawing their normal style, and the previous image is
           taken off screen rather than left to double-render under them. */
        entry.failed = true
        syncLayers()
        setError('Çizim görünümü şu anda yenilenemedi.')
      }
    }

    const load = () => {
      const size = map.getSize()
      const view = map.getView()
      if (!size || size[0] <= 0 || size[1] <= 0 || view.getProjection().getCode() !== 'EPSG:3857') return

      const extent = view.calculateExtent(size)
      const bbox = presentationBbox(extent)
      if (!bbox) return

      setError(null)
      const requestSize = presentationImageSize(size, window.devicePixelRatio)
      const requestedVersion = versionRef.current
      const requestedKey = `${bbox}|${requestSize.width}x${requestSize.height}`

      for (const typeId of DRAWING_TYPE_IDS) {
        // A hidden layer costs no request; it is not drawn and not clickable.
        if (visibilityRef.current?.[typeId] === false) continue
        /* A suspended type is not requested either. The user is still editing,
           so a fresh image would be obsolete before it arrived — and asking for
           one on every vertex drag is exactly what must not happen. */
        if (suspendedRef.current.includes(typeId)) continue
        loadOne(typeId, extent, bbox, requestSize, requestedVersion, requestedKey)
      }
    }

    const scheduleLoad = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(load, PRESENTATION_REQUEST_DEBOUNCE_MS)
    }

    scheduleLoadRef.current = scheduleLoad
    map.on('moveend', scheduleLoad)
    map.on('change:size', scheduleLoad)
    scheduleLoad()

    return () => {
      disposed = true
      window.clearTimeout(timer)
      map.un('moveend', scheduleLoad)
      map.un('change:size', scheduleLoad)
      if (scheduleLoadRef.current === scheduleLoad) scheduleLoadRef.current = null

      for (const [typeId, entry] of entries) {
        entry.requestNumber += 1
        entry.controller?.abort()
        map.removeLayer(entry.layer)
        entry.layer.setSource(null)
        entry.layer.dispose()
        if (entry.blobUrl) URL.revokeObjectURL(entry.blobUrl)
        entry.blobUrl = null
        if (activeRef) activeRef.current = { ...activeRef.current, [typeId]: false }
        onChangeRef.current?.(typeId, false)
      }
      entries.clear()
      if (entriesRef.current === entries) entriesRef.current = new Map()
    }
  }, [map, permitted, activeRef, setTypeActive, deactivateAll, syncLayers])

  /* Two independent reasons a raster comes back on screen, one effect.

     Layer toggle: a type that is switched back on keeps whatever image it
     already had and asks for a fresh one only if that image is out of date.

     Unsaved local editing: suspending hides the persisted raster and hands the
     type back to its vectors; NO request is made, and the existing image is
     kept because it is still the truth about the database.

     Releasing a suspension is deliberately not symmetrical, and `syncLayers`
     is what makes the difference automatic:
       - cancelled -> version unchanged -> the kept image is still current and
                      comes straight back, with no request at all;
       - saved     -> version bumped by the write -> the kept image is stale,
                      stays hidden, and the refresh below fetches its
                      replacement while the vectors carry the map. */
  useEffect(() => {
    syncLayers()

    const currentKey = viewportKey()

    const needsLoad = DRAWING_TYPE_IDS.some((typeId) => {
      const entry = entriesRef.current.get(typeId)
      if (!entry) return false
      if (visibilityRef.current?.[typeId] === false) return false
      if (suspendedRef.current.includes(typeId)) return false

      // Written since this image was made.
      if (entry.imageVersion !== versionRef.current) return true

      /* Made for a different view. A hidden type is not requested on
         `moveend`, so its image can be current and still describe where the
         map used to be; showing it again without this check would leave a
         picture of the wrong place on screen. A re-show in the SAME view asks
         for nothing — the cached image is already the right answer. */
      return currentKey !== null && entry.imageKey !== currentKey
    })

    if (needsLoad) scheduleLoadRef.current?.()
  }, [visibility, suspendedKey, syncLayers, viewportKey])

  /* Every successful map-visible mutation invalidates the image. Hiding happens
     at once so a stale shape can never linger; the replacement is requested
     right after. The first version is not a trigger — setting the layers up
     already loads once. */
  const lastVersionRef = useRef(version)
  useEffect(() => {
    if (lastVersionRef.current === version) return
    lastVersionRef.current = version
    syncLayers()
    scheduleLoadRef.current?.()
  }, [version, syncLayers])

  return useMemo(() => ({ active, error }), [active, error])
}
