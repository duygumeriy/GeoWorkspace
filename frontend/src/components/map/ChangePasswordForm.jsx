import { useState } from 'react'
import TextField from '../ui/TextField.jsx'
import Button from '../ui/Button.jsx'
import IconButton from '../ui/IconButton.jsx'
import PasswordChecklist from '../ui/PasswordChecklist.jsx'
import { changePassword, readAccountError } from '../../services/api'
import { isPasswordValid } from '../../auth/passwordRules.js'
import { LockIcon, EyeIcon, EyeOffIcon, AlertIcon, CheckIcon } from '../ui/icons/index.js'
import './ChangePasswordForm.css'

const EMPTY = { currentPassword: '', newPassword: '', confirmPassword: '' }

/**
 * Password change for the signed-in user, inside Ayarlar → Güvenlik.
 *
 * The account being changed is never sent from here — the backend derives it
 * from the verified JWT, so this form only carries the passwords themselves.
 * Nothing is persisted client-side: on success the fields are cleared
 * immediately.
 *
 * The client-side checks are a UX layer only. They mirror the server's Identity
 * policy so the user is not told "invalid" after a round trip, but the server
 * re-validates every submission and remains the authority — this form cannot
 * weaken the policy.
 */
export default function ChangePasswordForm() {
  const [form, setForm] = useState(EMPTY)
  // One toggle per field rather than a single shared one: revealing the new
  // password while checking it against the requirements should not also expose
  // the current one on screen.
  const [visible, setVisible] = useState({ currentPassword: false, newPassword: false, confirmPassword: false })
  const [feedback, setFeedback] = useState(null) // { tone: 'error'|'success', text }
  const [loading, setLoading] = useState(false)

  const setField = (name) => (event) => {
    const { value } = event.target
    setForm((prev) => ({ ...prev, [name]: value }))
    // A stale "wrong password" banner sitting above a field the user is busy
    // correcting is noise; it clears the moment they act on it.
    setFeedback(null)
  }

  const toggle = (name) => () => setVisible((prev) => ({ ...prev, [name]: !prev[name] }))

  const newPasswordOk = isPasswordValid(form.newPassword)
  // Only complain about the match once there is something to compare against,
  // so the error does not appear on the first keystroke of the confirmation.
  const mismatch = form.confirmPassword.length > 0 && form.newPassword !== form.confirmPassword
  const canSubmit =
    form.currentPassword.length > 0 && newPasswordOk && form.confirmPassword.length > 0 && !mismatch

  const visibilityToggle = (name, label) => (
    <IconButton label={visible[name] ? `${label} gizle` : `${label} göster`} onClick={toggle(name)}>
      {visible[name] ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
    </IconButton>
  )

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
      setVisible({ currentPassword: false, newPassword: false, confirmPassword: false })
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
        type={visible.currentPassword ? 'text' : 'password'}
        value={form.currentPassword}
        onChange={setField('currentPassword')}
        autoComplete="current-password"
        required
        trailing={visibilityToggle('currentPassword', 'Mevcut şifreyi')}
      />

      <TextField
        id="security-new-password"
        label="Yeni şifre"
        icon={<LockIcon size={17} />}
        type={visible.newPassword ? 'text' : 'password'}
        value={form.newPassword}
        onChange={setField('newPassword')}
        autoComplete="new-password"
        required
        trailing={visibilityToggle('newPassword', 'Yeni şifreyi')}
        // The checklist rides along as the field's description, so the rules are
        // announced with the field instead of floating beneath the form.
        hint={<PasswordChecklist value={form.newPassword} />}
      />

      <TextField
        id="security-confirm-password"
        label="Yeni şifre tekrar"
        icon={<LockIcon size={17} />}
        type={visible.confirmPassword ? 'text' : 'password'}
        value={form.confirmPassword}
        onChange={setField('confirmPassword')}
        autoComplete="new-password"
        required
        trailing={visibilityToggle('confirmPassword', 'Yeni şifre tekrarını')}
        // Reported on the field it belongs to rather than as a banner at the
        // bottom of the form.
        error={mismatch ? 'Yeni şifreler eşleşmiyor.' : undefined}
      />

      {feedback && (
        <p
          className={`security-feedback security-feedback--${feedback.tone}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.tone === 'error' ? <AlertIcon size={15} /> : <CheckIcon size={15} />}
          <span>{feedback.text}</span>
        </p>
      )}

      <Button type="submit" loading={loading} disabled={!canSubmit}>
        {loading ? 'Kaydediliyor' : 'Şifreyi Değiştir'}
      </Button>
    </form>
  )
}
