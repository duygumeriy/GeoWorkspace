import { useCallback, useEffect, useRef, useState } from 'react'
import { BASEMAPS, DEFAULT_BASEMAP_ID, createBasemapLayers, isBasemapId } from '../map/basemaps.js'

const STORAGE_KEY = 'staj-map-basemap'

/**
 * Reads the remembered basemap, rejecting anything that is not a basemap this
 * build actually offers.
 *
 * Stale values are expected rather than exceptional: an option can be renamed or
 * withdrawn between deploys while a browser still holds the old id. Validating
 * against the live catalogue means such a value falls back to the standard map
 * instead of leaving the user on a blank background.
 */
function readStoredBasemap() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return isBasemapId(stored) ? stored : DEFAULT_BASEMAP_ID
  } catch {
    // Storage can throw (private mode, blocked cookies). A basemap preference is
    // not worth failing the map over.
    return DEFAULT_BASEMAP_ID
  }
}

/**
 * THE owner of the selected basemap.
 *
 * Every surface that shows or changes the basemap reads this one hook — the
 * selector renders from it and writes through it — so there is no second copy
 * of the selection to drift out of sync.
 *
 * Deliberately separate from the UI theme: this hook never reads the theme and
 * `ThemeProvider` never reads this. Dark chrome with satellite imagery, or
 * light chrome with the street map, are all valid and none of them is implied
 * by the other. They are also persisted under different keys
 * (`staj-map-basemap` here, `staj-map-theme` there).
 *
 * @param {import('ol/Map').default | null} map
 */
export default function useBasemap(map) {
  const [basemapId, setBasemapId] = useState(readStoredBasemap)
  /** Layers are built once per Map instance and then only toggled. */
  const entriesRef = useRef(null)

  /* Attach every basemap's layers to the map, all hidden; the visibility effect
     below immediately reveals the selected one. Tearing down only happens when
     the Map itself goes away. */
  useEffect(() => {
    if (!map) return undefined

    const entries = createBasemapLayers()
    entriesRef.current = entries

    for (const entry of entries) {
      for (const layer of entry.layers) map.addLayer(layer)
    }

    return () => {
      for (const entry of entries) {
        for (const layer of entry.layers) map.removeLayer(layer)
      }
      entriesRef.current = null
    }
  }, [map])

  /* The switch itself: visibility only.
     No layer is created or destroyed, the View is never touched, and no overlay
     source is cleared — so drawings, selection, measurements and analysis
     results survive a basemap change untouched, and centre/zoom stay put. */
  useEffect(() => {
    const entries = entriesRef.current
    if (!entries) return

    for (const entry of entries) {
      const active = entry.id === basemapId
      for (const layer of entry.layers) layer.setVisible(active)
    }
  }, [basemapId, map])

  const selectBasemap = useCallback((id) => {
    if (!isBasemapId(id)) return

    setBasemapId(id)
    try {
      localStorage.setItem(STORAGE_KEY, id)
    } catch {
      // A preference that cannot be stored still applies for this session.
    }
  }, [])

  return { basemapId, basemaps: BASEMAPS, selectBasemap }
}
