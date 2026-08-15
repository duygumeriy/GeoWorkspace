import { useState } from 'react'
import TextField from '../ui/TextField.jsx'
import Button from '../ui/Button.jsx'
import IconButton from '../ui/IconButton.jsx'
import { changePassword, readAccountError } from '../../services/api'
import { LockIcon, EyeIcon, EyeOffIcon } from '../ui/icons/index.js'

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' }

/**
 * Password change for the signed-in user, inside Ayarlar → Güvenlik.
 *
 * The account being changed is never sent from here — the backend derives it
 * from the verified JWT, so this form only carries the passwords themselves.
 * Nothing is persisted client-side: on success the fields are cleared
 * immediately.
 */
export default function ChangePasswordForm() {
  const [form, setForm] = useState(EMPTY)
  const [showPassword, setShowPassword] = useState(false)
  const [feedback, setFeedback] = useState(null) // { tone: 'error'|'success', text }
  const [loading, setLoading] = useState(false)

  const setField = (name) => (event) => setForm((prev) => ({ ...prev, [name]: event.target.value }))

  const handleSubmit = async (event) => {
    event.preventDefault()
    setFeedback(null)

    if (form.newPassword !== form.confirmPassword) {
      setFeedback({ tone: 'error', text: 'Yeni şifreler eşleşmiyor.' })
      return
    }

    setLoading(true)

    try {
      const res = await changePassword(form)

      if (!res.ok) {
        throw new Error(await readAccountError(res, 'Şifre değiştirilemedi.'))
      }

      const data = await res.json()
      setFeedback({ tone: 'success', text: data.message })
      setForm(EMPTY)
    } catch (err) {
      setFeedback({ tone: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="security-form" onSubmit={handleSubmit} noValidate>
      <TextField
        id="security-current-password"
        label="Mevcut şifre"
        icon={<LockIcon size={17} />}
        type={showPassword ? 'text' : 'password'}
        value={form.currentPassword}
        onChange={setField('currentPassword')}
        autoComplete="current-password"
        required
        trailing={
          <IconButton
            label={showPassword ? 'Şifreleri gizle' : 'Şifreleri göster'}
            onClick={() => setShowPassword((v) => !v)}
          >
            {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
          </IconButton>
        }
      />

      <TextField
        id="security-new-password"
        label="Yeni şifre"
        icon={<LockIcon size={17} />}
        type={showPassword ? 'text' : 'password'}
        value={form.newPassword}
        onChange={setField('newPassword')}
        autoComplete="new-password"
        required
      />

      <TextField
        id="security-confirm-password"
        label="Yeni şifre tekrar"
        icon={<LockIcon size={17} />}
        type={showPassword ? 'text' : 'password'}
        value={form.confirmPassword}
        onChange={setField('confirmPassword')}
        autoComplete="new-password"
        required
      />

      <p className="info-note">
        En az 8 karakter; büyük harf, küçük harf ve rakam içermelidir.
      </p>

      {feedback && (
        <p
          className={`security-feedback security-feedback--${feedback.tone}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </p>
      )}

      <Button type="submit" loading={loading}>
        {loading ? 'Kaydediliyor' : 'Şifreyi Değiştir'}
      </Button>
    </form>
  )
}
