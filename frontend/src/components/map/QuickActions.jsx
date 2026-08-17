import { HomeIcon, CrosshairIcon, FocusIcon } from '../ui/icons/index.js'
import './QuickActions.css'

/**
 * Camera shortcuts, stacked at the top-left corner of the map viewport.
 *
 * `children` extends the same stack with controls that are more than a plain
 * button — the basemap picker owns a popover, so it renders itself here rather
 * than being flattened into the `actions` list. Sharing the stack is what keeps
 * every map control one column at one size.
 */
export default function QuickActions({ onGoTurkey, onGoMyLocation, onFocusAll, children }) {
  const actions = [
    { id: 'turkey', label: "Türkiye'ye Dön", Icon: HomeIcon, onClick: onGoTurkey },
    { id: 'location', label: 'Konumuma Git', Icon: CrosshairIcon, onClick: onGoMyLocation },
    { id: 'focus', label: 'Tüm Çizimlere Odaklan', Icon: FocusIcon, onClick: onFocusAll },
  ]

  return (
    <div className="quick-actions" role="group" aria-label="Harita kısayolları">
      {actions.map(({ id, label, Icon, onClick }) => (
        <button key={id} type="button" className="quick-action" aria-label={label} title={label} onClick={onClick}>
          <Icon size={18} />
        </button>
      ))}
      {children}
    </div>
  )
}
