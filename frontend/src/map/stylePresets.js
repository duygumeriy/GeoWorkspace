import { DEFAULT_STYLE, normalizeStyle } from './drawingTypes.js'

/**
 * Built-in style presets.
 *
 * Frontend configuration only — presets deliberately have no database table:
 * they are shortcuts that write into the ordinary style fields, and the user
 * stays free to adjust every value afterwards.
 */
export const STYLE_PRESETS = Object.freeze([
  {
    id: 'standard',
    label: 'Standart',
    style: { strokeColor: '#6D4AFF', strokeWidth: 3, fillColor: '#7C5CFF', fillOpacity: 0.25, pointRadius: 7, lineStyle: 'solid' },
  },
  {
    id: 'highlight',
    label: 'Vurgu',
    style: { strokeColor: '#2563EB', strokeWidth: 4, fillColor: '#3B82F6', fillOpacity: 0.25, pointRadius: 9, lineStyle: 'solid' },
  },
  {
    id: 'warning',
    label: 'Uyarı',
    style: { strokeColor: '#DC2626', strokeWidth: 4, fillColor: '#EF4444', fillOpacity: 0.25, pointRadius: 9, lineStyle: 'dashed' },
  },
  {
    id: 'area',
    label: 'Alan',
    style: { strokeColor: '#6D4AFF', strokeWidth: 3, fillColor: '#7C5CFF', fillOpacity: 0.3, pointRadius: 7, lineStyle: 'solid' },
  },
])

/** Applies a preset to one drawing type, dropping fields that do not apply. */
export function presetStyleFor(presetId, typeId) {
  const preset = STYLE_PRESETS.find((item) => item.id === presetId)
  return normalizeStyle(typeId, preset?.style ?? DEFAULT_STYLE)
}
