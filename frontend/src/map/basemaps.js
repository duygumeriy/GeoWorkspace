import TileLayer from 'ol/layer/Tile'
import OSM from 'ol/source/OSM'
import XYZ from 'ol/source/XYZ'

/**
 * Every basemap the application offers, defined in ONE place.
 *
 * A basemap is the background imagery the map is drawn on. It is not a data
 * layer: the point/line/polygon features, the inventory analysis results, the
 * measurement sketch and the selection highlight are overlays and are managed
 * by their own hooks, always above whatever basemap is active (see Z_IMAGERY /
 * Z_LABELS below).
 *
 * The basemap is also independent of the UI theme. Light or dark chrome may be
 * combined with any basemap here; nothing in this file reads the theme, and
 * nothing in the theme picks a basemap.
 *
 * ## Sources
 *
 * All three options use public, documented tile services that need no API key,
 * so there is no credential in this repository and nothing to leak. Each source
 * carries the attribution its provider requires — OpenLayers renders those in
 * the map's attribution control, which is how the requirement is met.
 *
 * A provider that DID need a key would belong behind an environment variable
 * with the option hidden when the key is absent; no such provider is used here,
 * so no key handling exists to get wrong.
 */

/* Render order. Overlay layers in this app declare zIndex 10 and above
   (drawings 10, pending 12, inventory 15, highlight 18, measurement/vertices 20,
   location 30), so the basemap composition sits below all of them and the
   hybrid label layer can never cover a drawing. */
const Z_IMAGERY = 0
const Z_LABELS = 1

/* The dark theme fakes a dark map by CSS-inverting the tile canvas
   (see MapPage.css). That is right for the OSM street map and very wrong for
   photography — an inverted satellite image is a colour negative. Each layer
   therefore declares which treatment it wants, and the CSS keys off it. */
const CLASS_RESKINNABLE = 'basemap-layer basemap-layer--reskin'
const CLASS_VERBATIM = 'basemap-layer basemap-layer--verbatim'

const ESRI_ATTRIBUTION =
  'Tiles © <a href="https://www.esri.com/" target="_blank" rel="noreferrer">Esri</a> — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'

/** ArcGIS REST tile endpoints address tiles as /tile/{z}/{y}/{x}. */
const ESRI_IMAGERY_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

const ESRI_REFERENCE_URL =
  'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'

/**
 * The catalogue. `swatch` names a CSS class that draws an abstract preview —
 * deliberately not a real tile request, so opening the picker costs nothing and
 * borrows no imagery.
 */
export const BASEMAPS = Object.freeze([
  {
    id: 'standard',
    label: 'Standart',
    description: 'OpenStreetMap sokak haritası',
    swatch: 'standard',
    build: () => [
      new TileLayer({
        className: CLASS_RESKINNABLE,
        zIndex: Z_IMAGERY,
        source: new OSM(),
      }),
    ],
  },
  {
    id: 'satellite',
    label: 'Uydu',
    description: 'Esri World Imagery uydu görüntüsü',
    swatch: 'satellite',
    build: () => [
      new TileLayer({
        className: CLASS_VERBATIM,
        zIndex: Z_IMAGERY,
        source: new XYZ({
          url: ESRI_IMAGERY_URL,
          attributions: ESRI_ATTRIBUTION,
          maxZoom: 19,
          crossOrigin: 'anonymous',
        }),
      }),
    ],
  },
  {
    id: 'hybrid',
    label: 'Uydu + Etiket',
    description: 'Uydu görüntüsü üzerinde yer adları ve sınırlar',
    swatch: 'hybrid',
    /* ONE logical basemap made of two tile layers: the imagery and the
       reference labels drawn over it. They are switched together and never
       offered separately. */
    build: () => [
      new TileLayer({
        className: CLASS_VERBATIM,
        zIndex: Z_IMAGERY,
        source: new XYZ({
          url: ESRI_IMAGERY_URL,
          attributions: ESRI_ATTRIBUTION,
          maxZoom: 19,
          crossOrigin: 'anonymous',
        }),
      }),
      new TileLayer({
        className: CLASS_VERBATIM,
        zIndex: Z_LABELS,
        source: new XYZ({
          url: ESRI_REFERENCE_URL,
          attributions: ESRI_ATTRIBUTION,
          maxZoom: 19,
          crossOrigin: 'anonymous',
        }),
      }),
    ],
  },
])

export const DEFAULT_BASEMAP_ID = 'standard'

export function isBasemapId(value) {
  return BASEMAPS.some((basemap) => basemap.id === value)
}

/** The definition for an id, falling back to the default for anything unknown. */
export function basemapById(id) {
  return BASEMAPS.find((basemap) => basemap.id === id) ?? BASEMAPS[0]
}

/**
 * Builds every basemap's layers once.
 *
 * All of them are created up front and kept on the map with only one visible.
 * Switching then flips `visible`, which is what makes a change a pure
 * background swap: the Map instance, the View (centre and zoom), every overlay
 * source and every interaction are untouched, and returning to a basemap reuses
 * its already-warm tile cache instead of refetching.
 *
 * @returns {Array<{ id: string, layers: import('ol/layer/Tile').default[] }>}
 */
export function createBasemapLayers() {
  return BASEMAPS.map((basemap) => {
    const layers = basemap.build()
    for (const layer of layers) layer.setVisible(false)
    return { id: basemap.id, layers }
  })
}
