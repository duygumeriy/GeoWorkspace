import MapSheet from './MapSheet.jsx'
import './HeatmapPanel.css'

export default function HeatmapPanel({
  open,
  enabled,
  opacity,
  loading,
  error,
  hasImage,
  onClose,
  onToggle,
  onOpacityChange,
  onRetry,
}) {
  return (
    <MapSheet
      open={open}
      title="Isı Haritası Analizi"
      labelledById="heatmap-panel-title"
      onClose={onClose}
      className="heatmap-panel"
    >
      <p className="heatmap-panel-intro">
        Haritadaki nokta yoğunluğunu mevcut görünüm için renk geçişleriyle inceleyin.
      </p>

      <div className="heatmap-control-row">
        <div>
          <strong>Isı haritası</strong>
          <span>{enabled ? 'Harita üzerinde gösteriliyor' : 'Kapalı'}</span>
        </div>
        <button
          type="button"
          className={`heatmap-switch ${enabled ? 'is-on' : ''}`}
          role="switch"
          aria-checked={enabled}
          aria-label="Isı haritasını göster"
          onClick={onToggle}
        >
          <span aria-hidden="true" />
        </button>
      </div>

      <label className={`heatmap-opacity ${enabled ? '' : 'is-disabled'}`}>
        <span>
          <strong>Saydamlık</strong>
          <output>{Math.round(opacity * 100)}%</output>
        </span>
        <input
          type="range"
          min="20"
          max="100"
          step="5"
          value={Math.round(opacity * 100)}
          disabled={!enabled}
          aria-label="Isı haritası saydamlığı"
          onChange={(event) => onOpacityChange(Number(event.target.value) / 100)}
        />
      </label>

      <div className="heatmap-status" aria-live="polite">
        {enabled && loading && <span className="heatmap-loading">Görünüm güncelleniyor…</span>}
        {enabled && !loading && !error && hasImage && <span>Görünüm güncel.</span>}
        {enabled && error && (
          <div className="heatmap-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={onRetry}>Yeniden dene</button>
          </div>
        )}
      </div>

      <p className="heatmap-scope-note">
        Yoğunluk yalnızca erişebildiğiniz aktif noktalardan hesaplanır.
      </p>
    </MapSheet>
  )
}
