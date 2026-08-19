import MapSheet from './MapSheet.jsx'
import Button from '../ui/Button.jsx'
import { DRAWING_TYPE_LIST } from '../../map/drawingTypes.js'
import { FocusIcon, PaletteIcon, TrashIcon, CloseIcon, PointIcon, LineIcon, PolygonIcon } from '../ui/icons/index.js'
import './MultiSelectionPanel.css'

const TYPE_ICONS = { point: PointIcon, line: LineIcon, polygon: PolygonIcon }

/**
 * Summary and bulk actions for a selection of two or more drawings.
 *
 * A selection of exactly one keeps the existing "Seçili Çizim" detail panel —
 * this one deliberately shows no per-record detail, because with four features
 * selected the useful information is the shape of the *set*, not any one item.
 *
 * Uses the same MapSheet primitive as every other surface, so it is a docked
 * card on desktop and a bottom sheet on phones without a second layout.
 */
export default function MultiSelectionPanel({
  open,
  count,
  counts,
  onClose,
  onFocus,
  onEditStyle,
  onDelete,
  onClear,
  // Bulk style/delete are all-or-nothing on the backend, so a selection that
  // contains even one drawing owned by someone else offers neither.
  canManageAll = true,
  /* Toplu stil ve toplu silme AYRI uçlardır ve ayrı yetkiler ister
     (drawings.style.update / drawings.delete); tek bayrakla göstermek,
     birine sahip olmayan için garanti 403 alan bir düğme bırakırdı. */
  canRestyle = true,
  canDelete = true,
  foreignCount = 0,
}) {
  if (!open) return null

  // Only types actually present are listed; a zero row would be noise.
  const rows = DRAWING_TYPE_LIST.filter((type) => counts[type.id] > 0)

  return (
    <MapSheet open={open} title="Çoklu Seçim" onClose={onClose} className="multi-panel">
      {/* aria-live so the count is announced as the selection grows or shrinks. */}
      <p className="multi-panel-count" role="status" aria-live="polite">
        <strong>{count}</strong> Çizim Seçildi
      </p>

      <dl className="multi-panel-summary">
        {rows.map((type) => {
          const Icon = TYPE_ICONS[type.id]
          return (
            <div className="multi-panel-row" key={type.id}>
              <dt>
                <Icon size={15} aria-hidden="true" />
                {type.label}
              </dt>
              <dd>{counts[type.id]}</dd>
            </div>
          )
        })}
      </dl>

      <div className="multi-panel-actions">
        <Button variant="ghost" className="multi-panel-action" onClick={onFocus}>
          <FocusIcon size={16} />
          Seçime Odaklan
        </Button>
        {canManageAll && (
          <>
            {canRestyle && (
              <Button variant="ghost" className="multi-panel-action" onClick={onEditStyle}>
                <PaletteIcon size={16} />
                Stil Uygula
              </Button>
            )}
            {canDelete && (
              <Button variant="ghost" className="multi-panel-action multi-panel-action--danger" onClick={onDelete}>
                <TrashIcon size={16} />
                Seçilenleri Sil
              </Button>
            )}
          </>
        )}
        <Button variant="ghost" className="multi-panel-action" onClick={onClear}>
          <CloseIcon size={16} />
          Seçimi Temizle
        </Button>
      </div>

      {!canManageAll && (
        <p className="multi-panel-readonly" role="note">
          Seçimde size ait olmayan {foreignCount} çizim var. Toplu stil ve silme işlemleri tümü size
          ait olduğunda kullanılabilir.
        </p>
      )}
    </MapSheet>
  )
}
