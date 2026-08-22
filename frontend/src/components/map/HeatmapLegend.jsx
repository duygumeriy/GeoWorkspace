import { HEATMAP_STOPS } from '../../map/heatmap.js'
import './HeatmapLegend.css'

/**
 * The density scale, rendered as a section OF the heatmap analysis panel.
 *
 * It used to float over the map near the bottom-right, where it collided with
 * the zoom controls, the attribution and the drawing toolbar depending on the
 * viewport. It is now part of the surface it explains: the reading and the
 * controls that produce it live together, and nothing can cover a map control
 * because nothing is positioned over the map any more.
 *
 * A draggable legend was considered and rejected — it would add drag state,
 * touch conflicts, position persistence and a keyboard story, all to solve a
 * problem that goes away by putting the legend where it belongs.
 *
 * The scale itself is unchanged: a NORMALIZED relative density from 0 to 1 for
 * the current view, not an absolute point count, with the colour stops matching
 * the server style exactly.
 */
export default function HeatmapLegend({ visible }) {
  // No density scale for a heatmap that is not drawing anything.
  if (!visible) return null

  return (
    <section className="heatmap-legend" aria-label="Isı haritası yoğunluk açıklaması">
      <strong>Göreli Nokta Yoğunluğu</strong>
      <span className="heatmap-legend-context">Mevcut görünüm ve erişim yetkinize göre</span>
      <div className="heatmap-legend-gradient" aria-hidden="true" />
      <div className="heatmap-legend-labels">
        {HEATMAP_STOPS.map((stop) => <span key={stop.value}>{stop.label}</span>)}
      </div>
      <span className="heatmap-legend-caption">0 = düşük / yok · 1 = görünümde en yüksek</span>
    </section>
  )
}
