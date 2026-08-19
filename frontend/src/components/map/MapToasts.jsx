import { AlertIcon, CheckIcon, InfoIcon, CloseIcon } from '../ui/icons/index.js'
import './MapToasts.css'

const TONE_ICONS = { success: CheckIcon, error: AlertIcon, info: InfoIcon }

/**
 * Stacked map feedback (save status, delete, undo/redo, connection).
 *
 * Errors use role="alert" so they interrupt; successes and info use
 * role="status" so they are announced politely without stealing focus.
 *
 * <b>İki yığın vardır ve bu bilinçlidir.</b> Varsayılan yığın haritanın
 * altındadır — araç çubuğunun hemen üstünde. Ama çizim talimatı da (`.map-hint`)
 * tam orada durur: coğrafi uyarı oraya düştüğünde talimatın üstünü kapatıyor ve
 * kullanıcı, ne yapması gerektiğini söyleyen cümleyi göremiyordu. Kalıcı olarak
 * okunan bir kural ile geçici bir uyarı aynı noktada yarışmamalıdır, bu yüzden
 * `placement: 'top'` verilen bildirimler haritanın üstünde ayrı bir yığına
 * çıkar. İkinci bir bildirim sistemi DEĞİLDİR: aynı kuyruk, aynı yaşam döngüsü,
 * yalnızca ayrı bir kap.
 */
export default function MapToasts({ toasts, onDismiss }) {
  if (!toasts.length) return null

  const stacks = [
    { placement: 'top', items: toasts.filter((toast) => toast.placement === 'top') },
    { placement: 'bottom', items: toasts.filter((toast) => toast.placement !== 'top') },
  ]

  return (
    <>
      {stacks.map(({ placement, items }) =>
        items.length === 0 ? null : (
          <div key={placement} className={`map-toasts map-toasts--${placement}`}>
            {items.map((toast) => {
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
        ),
      )}
    </>
  )
}
