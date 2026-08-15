import { useEffect } from 'react'
import Button from '../ui/Button.jsx'
import './ConfirmDialog.css'

/**
 * Modal confirmation, used before destructive actions such as deleting a
 * drawing. Focus moves to the confirm button on open and Escape cancels, so a
 * mis-tap can always be backed out of.
 */
export default function ConfirmDialog({
  open,
  title,
  message,
  /** Optional second line spelling out exactly what will be removed. */
  description,
  confirmLabel = 'Sil',
  cancelLabel = 'Vazgeç',
  tone = 'danger',
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return undefined

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onCancel?.()
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onCancel])

  if (!open) return null

  return (
    <div className="confirm-scrim" role="presentation" onClick={onCancel}>
      <div
        className={`confirm-dialog confirm-dialog--${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="confirm-title" id="confirm-title">
          {title}
        </h2>
        <p className="confirm-message" id="confirm-message">
          {message}
        </p>
        {description && <p className="confirm-description">{description}</p>}
        <div className="confirm-actions">
          <Button variant="ghost" onClick={onCancel} className="confirm-button">
            {cancelLabel}
          </Button>
          {/* Focus lands on the confirm button so the dialog is operable from
              the keyboard the moment it opens. */}
          <Button autoFocus onClick={onConfirm} className="confirm-button confirm-button--danger">
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
