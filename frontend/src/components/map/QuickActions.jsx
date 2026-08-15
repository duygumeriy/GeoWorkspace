import { HomeIcon, CrosshairIcon, FocusIcon } from '../ui/icons/index.js'
import './QuickActions.css'

/** Camera shortcuts, stacked at the top-right corner of the map viewport. */
export default function QuickActions({ onGoTurkey, onGoMyLocation, onFocusAll }) {
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
    </div>
  )
}
