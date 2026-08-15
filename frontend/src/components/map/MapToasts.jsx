import { AlertIcon, CheckIcon, InfoIcon, CloseIcon } from '../ui/icons/index.js'
import './MapToasts.css'

const TONE_ICONS = { success: CheckIcon, error: AlertIcon, info: InfoIcon }

/**
 * Stacked map feedback (save status, delete, undo/redo, connection).
 *
 * Errors use role="alert" so they interrupt; successes and info use
 * role="status" so they are announced politely without stealing focus.
 */
export default function MapToasts({ toasts, onDismiss }) {
  if (!toasts.length) return null

  return (
    <div className="map-toasts">
      {toasts.map((toast) => {
        const Icon = TONE_ICONS[toast.type] ?? InfoIcon
        const isError = toast.type === 'error'

        return (
          <div
            key={toast.id}
            className={`map-toast is-${toast.type}`}
            role={isError ? 'alert' : 'status'}
            aria-live={isError ? 'assertive' : 'polite'}
          >
            <Icon size={15} />
            <span className="map-toast-message">{toast.message}</span>
            <button
              type="button"
              className="map-toast-close"
              aria-label="Bildirimi kapat"
              onClick={() => onDismiss(toast.id)}
            >
              <CloseIcon size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
