import { useState } from 'react'
import { DRAWING_TYPE_LIST, DRAWING_TYPES, primaryColorOf } from '../../map/drawingTypes.js'
import { formatDateTime } from '../../map/datetime.js'
import { analysisItemKey } from '../../hooks/useInventoryAnalysis.js'
import { ChevronIcon, FocusIcon } from '../ui/icons/index.js'
import './AnalysisPanel.css'

/** How a match touches the analysis area. Explanation only — never the criterion. */
const INTERSECTION_LABELS = {
  fullyInside: 'Tamamen İçeride',
  partial: 'Kısmi Kesişim',
}

/**
 * The inventory analysis readout: totals, then the records behind them.
 *
 * ## Why the records are shown at all
 *
 * The old readout showed three numbers and nothing else, so "3 poligon" was
 * something the user had to take on faith — there was no way to ask *which*
 * three, or why. Every count is now expandable into the records it came from,
 * each of which can be located on the map.
 *
 * ## Scope
 *
 * Everything here belongs to the signed-in user. The backend applies the
 * ownership filter, so this panel cannot show — and its counts cannot hint at —
 * anyone else's inventory. The empty state says "size ait" for that reason:
 * "there is no inventory here" would be a claim about other people's data that
 * this user is not entitled to make.
 *
 * ## One selection
 *
 * `selectedKey` comes from the analysis hook and is shared with the map's
 * highlight layer, so an expanded row and a highlighted feature are the same
 * fact rather than two states that could drift.
 */
export default function AnalysisPanel({
  loading,
  result,
  error,
  selectedKey,
  onSelectItem,
  onShowOnMap,
  onOpenDrawing,
  /** Geometry-derived metrics for one match, read off the map feature. */
  metricsFor,
  onClear,
  onClose,
}) {
  if (!loading && !result && !error) return null

  return (
    <section className="analysis-panel" role="status" aria-live="polite" aria-label="Envanter analizi">
      <div className="analysis-head">
        <span className="analysis-title">Analiz Sonucu</span>
        <button type="button" className="analysis-close" aria-label="Analiz sonucunu kapat" onClick={onClose}>
          ×
        </button>
      </div>

      <div className="analysis-body">
        {loading && <p className="analysis-state">Analiz yapılıyor...</p>}

        {!loading && error && (
          <div className="analysis-state analysis-state--error" role="alert">
            <p className="analysis-error-title">Analiz tamamlanamadı.</p>
            <p className="analysis-error-detail">{error}</p>
            {/* The area stays on the map so the user can simply try again
                rather than redraw what they already drew. */}
            <p className="analysis-error-hint">Analiz alanı duruyor; tekrar deneyebilirsiniz.</p>
          </div>
        )}

        {!loading && !error && result && (
          <Results
            result={result}
            selectedKey={selectedKey}
            onSelectItem={onSelectItem}
            onShowOnMap={onShowOnMap}
            onOpenDrawing={onOpenDrawing}
            metricsFor={metricsFor}
          />
        )}
      </div>

      <div className="analysis-foot">
        {result?.temporary && (
          <button type="button" className="analysis-clear" onClick={onClear}>
            Analiz alanını temizle
          </button>
        )}
        <p className="analysis-note">Analiz alanı veritabanına kaydedilmez.</p>
      </div>
    </section>
  )
}

function Results({ result, selectedKey, onSelectItem, onShowOnMap, onOpenDrawing, metricsFor }) {
  return (
    <>
      <p className="analysis-total">
        {result.total > 0
          ? `Bu alan ${result.total} envanter ile kesişiyor.`
          : 'Bu alanda size ait kesişen envanter bulunamadı.'}
      </p>
      <p className="analysis-source">{result.label}</p>

      <dl className="analysis-summary">
        {DRAWING_TYPE_LIST.map((type) => (
          <div key={type.id} className="analysis-summary-item">
            <dt>{type.plural}</dt>
            <dd>{result[type.id]}</dd>
          </div>
        ))}
      </dl>

      {result.total > 0 && (
        <div className="analysis-sections">
          {DRAWING_TYPE_LIST.map((type) => (
            <TypeSection
              key={type.id}
              type={type}
              items={result.items?.[type.id] ?? []}
              selectedKey={selectedKey}
              onSelectItem={onSelectItem}
              onShowOnMap={onShowOnMap}
              onOpenDrawing={onOpenDrawing}
              metricsFor={metricsFor}
            />
          ))}
        </div>
      )}
    </>
  )
}

/**
 * One collapsible group per geometry type.
 *
 * An empty group stays visible but cannot be opened: "Noktalar 0" is an answer
 * the user asked for, and hiding it would make the panel's shape change from one
 * analysis to the next.
 */
function TypeSection({ type, items, selectedKey, onSelectItem, onShowOnMap, onOpenDrawing, metricsFor }) {
  const [open, setOpen] = useState(false)
  const isEmpty = items.length === 0

  return (
    <div className={`analysis-section ${isEmpty ? 'is-empty' : ''}`}>
      <button
        type="button"
        className="analysis-section-head"
        aria-expanded={!isEmpty && open}
        disabled={isEmpty}
        onClick={() => setOpen((value) => !value)}
      >
        <ChevronIcon size={13} className={`analysis-section-chevron ${!isEmpty && open ? 'is-open' : ''}`} />
        <span className="analysis-section-title">
          {type.plural} ({items.length})
        </span>
      </button>

      {!isEmpty && open && (
        <ul className="analysis-items">
          {items.map((item) => (
            <ResultItem
              key={analysisItemKey(item)}
              item={item}
              selected={analysisItemKey(item) === selectedKey}
              onSelect={onSelectItem}
              onShowOnMap={onShowOnMap}
              onOpenDrawing={onOpenDrawing}
              metricsFor={metricsFor}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** One matched record: a summary row that opens into read-only detail. */
function ResultItem({ item, selected, onSelect, onShowOnMap, onOpenDrawing, metricsFor }) {
  const color = primaryColorOf(item.style)
  const config = DRAWING_TYPES[item.drawingType]
  const intersection = INTERSECTION_LABELS[item.intersectionType] ?? INTERSECTION_LABELS.partial

  return (
    <li className={`analysis-item ${selected ? 'is-selected' : ''}`}>
      <button
        type="button"
        className="analysis-item-head"
        aria-expanded={selected}
        onClick={() => onSelect?.(analysisItemKey(item))}
      >
        <span className="analysis-item-dot" style={{ '--dot': color }} aria-hidden="true" />
        <span className="analysis-item-text">
          <span className="analysis-item-name">{item.name || `${config?.label ?? ''} #${item.id}`}</span>
          <span className="analysis-item-meta">
            {[item.category, intersection].filter(Boolean).join(' · ')}
          </span>
        </span>
      </button>

      {selected && (
        <div className="analysis-detail">
          {/* Read-only: editing lives in the drawing panel, reached through
              "Çizimi Aç", rather than being reimplemented here. */}
          <dl className="analysis-detail-rows">
            <DetailRow label="Ad" value={item.name || '—'} />
            <DetailRow label="ID" value={item.id} />
            <DetailRow label="Tür" value={config?.label ?? item.drawingType} />
            <DetailRow label="Kategori" value={item.category || 'Kategori Yok'} />
            {item.description && <DetailRow label="Açıklama" value={item.description} />}
            {item.tags?.length > 0 && (
              <DetailRow
                label="Etiketler"
                value={
                  <span className="analysis-tags">
                    {item.tags.map((tag) => (
                      <span key={tag} className="analysis-tag">
                        {tag}
                      </span>
                    ))}
                  </span>
                }
              />
            )}
            <DetailRow
              label="Renk"
              value={
                <span className="analysis-color">
                  <span className="analysis-item-dot" style={{ '--dot': color }} aria-hidden="true" />
                  {color}
                </span>
              }
            />
            {/* Measured from the geometry on the map with the app's own
                helpers, so a length here matches the one in the drawing panel. */}
            {(metricsFor?.(item) ?? []).map((metric) => (
              <DetailRow key={metric.label} label={metric.label} value={metric.value} />
            ))}
            <DetailRow label="Kesişim Tipi" value={intersection} />
            <DetailRow label="Oluşturulma" value={formatDateTime(item.createdDate)} />
            <DetailRow label="Son Güncelleme" value={formatDateTime(item.modifiedDate)} />
          </dl>

          <div className="analysis-item-actions">
            <button type="button" className="analysis-action" onClick={() => onShowOnMap?.(item)}>
              <FocusIcon size={14} />
              Haritada Göster
            </button>
            <button type="button" className="analysis-action" onClick={() => onOpenDrawing?.(item)}>
              Çizimi Aç
            </button>
          </div>
        </div>
      )}
    </li>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="analysis-detail-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}
