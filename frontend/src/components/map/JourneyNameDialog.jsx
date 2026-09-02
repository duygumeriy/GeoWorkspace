import { useEffect, useId, useState } from 'react'
import Button from '../ui/Button.jsx'
import TextField from '../ui/TextField.jsx'
import './ConfirmDialog.css'
import { validateSavedJourneyName } from '../../map/savedJourneys.js'

/**
 * Kaydedilmiş yolculuğa AD veren modal — hem kaydetme hem yeniden adlandırma.
 *
 * <b>Tarayıcının <code>prompt()</code>'u KULLANILMAZ.</b> Proje zaten kendi
 * onay diyaloğunu kullanıyor (<code>ConfirmDialog</code>); ad soran ikinci bir
 * yer için tarayıcı kutusuna dönmek, aynı üründe iki farklı modal davranışı
 * (farklı odak, farklı Esc, erişilebilirlik yok) demekti. Bu bileşen o
 * diyaloğun kabuğunu ve stilini paylaşır, yalnızca gövdesinde bir alan taşır.
 *
 * <b>Kimlik ÇAĞIRANIN elindedir.</b> Diyalog hangi kayda ait olduğunu bilmez
 * ve seçili satırı okumaz; yalnızca girilen adı geri verir. Bayat niyete karşı
 * koruma (A açıldı, B seçildi, onaylandı) çağıranın dondurduğu kimlikle
 * sağlanır.
 *
 * <b>Doğrulama SAF modüldedir</b> (`validateSavedJourneyName`) ve backend ile
 * aynı kuralı uygular; bağlayıcı denetim yine sunucudadır.
 */
export default function JourneyNameDialog({
  open,
  title,
  description,
  confirmLabel = 'Kaydet',
  cancelLabel = 'Vazgeç',
  /** Açılışta alanı dolduran değer (yeniden adlandırmada mevcut ad). */
  initialName = '',
  busy = false,
  /** Sunucudan gelen hata; alanın altında gösterilir. */
  error = '',
  onConfirm,
  onCancel,
}) {
  const fieldId = useId()
  const [name, setName] = useState(initialName)
  const [localError, setLocalError] = useState('')

  /* Her açılışta alan BAŞTAN kurulur: bir önceki kaydın adı yeni diyalogda
     durursa, kullanıcı yanlış kaydı adlandırdığını fark etmeyebilirdi. */
  useEffect(() => {
    if (!open) return
    setName(initialName)
    setLocalError('')
  }, [open, initialName])

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

  const submit = (event) => {
    event.preventDefault()
    const validated = validateSavedJourneyName(name)

    if (!validated.ok) {
      setLocalError(validated.error)
      return
    }

    setLocalError('')
    onConfirm?.(validated.name)
  }

  return (
    <div className="confirm-scrim" role="presentation" onClick={onCancel}>
      <form
        className="confirm-dialog confirm-dialog--primary"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-title`}
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <h2 className="confirm-title" id={`${fieldId}-title`}>{title}</h2>
        {description && <p className="confirm-description">{description}</p>}

        <TextField
          id={`${fieldId}-name`}
          label="Yolculuk adı"
          value={name}
          autoFocus
          maxLength={200}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          error={localError || error}
          hint="Örneğin: Ev → İş"
        />

        <div className="confirm-actions">
          <Button type="button" variant="ghost" onClick={onCancel} className="confirm-button">
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            disabled={busy}
            aria-busy={busy}
            className="confirm-button confirm-button--primary"
          >
            {confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
