import { getArea, getLength } from 'ol/sphere'
import { MAP_PROJECTION } from './drawing.js'

/**
 * Projection-aware length/area measurement and human formatting.
 *
 * `ol/sphere` computes real geodesic values on the WGS84 ellipsoid; passing the
 * map projection makes it reproject internally instead of measuring Web
 * Mercator's distorted metres, which would be badly wrong away from the equator
 * (~28% too large at Turkey's latitude).
 */

const OPTIONS = { projection: MAP_PROJECTION }

/** Geodesic length in metres. */
export function measureLength(geometry) {
  return geometry ? getLength(geometry, OPTIONS) : 0
}

/** Geodesic area in square metres. */
export function measureArea(geometry) {
  return geometry ? Math.abs(getArea(geometry, OPTIONS)) : 0
}

/** Turkish number formatting: 1.42 -> "1,42". */
function number(value, digits) {
  return value.toLocaleString('tr-TR', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

/** 850 -> "850 m", 1420 -> "1,42 km". */
export function formatLength(metres) {
  if (!Number.isFinite(metres) || metres <= 0) return '0 m'
  return metres >= 1000 ? `${number(metres / 1000, 2)} km` : `${number(Math.round(metres), 0)} m`
}

/** 850 -> "850 m²", 2_810_000 -> "2,81 km²". */
export function formatArea(squareMetres) {
  if (!Number.isFinite(squareMetres) || squareMetres <= 0) return '0 m²'
  return squareMetres >= 1_000_000
    ? `${number(squareMetres / 1_000_000, 2)} km²`
    : `${number(Math.round(squareMetres), 0)} m²`
}

/** "32,850000° D" style longitude/latitude readout for the selected panel. */
export function formatLonLat([lon, lat]) {
  const fmt = (value, positive, negative) =>
    `${Math.abs(value).toLocaleString('tr-TR', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}° ${value >= 0 ? positive : negative}`

  return { lon: fmt(lon, 'D', 'B'), lat: fmt(lat, 'K', 'G') }
}

/** Polygon outline length (perimeter) in metres. */
export function measurePerimeter(polygonGeometry) {
  if (!polygonGeometry?.getLinearRing) return 0
  const ring = polygonGeometry.getLinearRing(0)
  return ring ? getLength(ring, OPTIONS) : 0
}

/** Live measurement label for a geometry being drawn or measured. */
export function measurementLabel(geometry) {
  if (!geometry) return ''
  const type = geometry.getType()
  if (type === 'Polygon') return formatArea(measureArea(geometry))
  if (type === 'LineString') return formatLength(measureLength(geometry))
  return ''
}
