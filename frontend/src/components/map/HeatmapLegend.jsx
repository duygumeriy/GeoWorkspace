import { HEATMAP_STOPS } from '../../map/heatmap.js'
import './HeatmapLegend.css'

export default function HeatmapLegend({ visible, panelOpen }) {
  if (!visible) return null

  return (
    <aside
      className={`heatmap-legend ${panelOpen ? 'is-panel-open' : ''}`}
      aria-label="Isı haritası yoğunluk açıklaması"
    >
      <strong>Göreli Nokta Yoğunluğu</strong>
      <span className="heatmap-legend-context">Mevcut görünüm ve erişim yetkinize göre</span>
      <div className="heatmap-legend-gradient" aria-hidden="true" />
      <div className="heatmap-legend-labels">
        {HEATMAP_STOPS.map((stop) => <span key={stop.value}>{stop.label}</span>)}
      </div>
      <span className="heatmap-legend-caption">0 = düşük / yok · 1 = görünümde en yüksek</span>
    </aside>
  )
}
