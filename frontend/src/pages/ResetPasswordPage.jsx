import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell from './AuthShell.jsx'
import TextField from '../components/ui/TextField.jsx'
import Button from '../components/ui/Button.jsx'
import IconButton from '../components/ui/IconButton.jsx'
import { resetPassword, readAccountError } from '../services/api'
import {
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  AlertIcon,
  CheckIcon,
  ArrowRightIcon,
} from '../components/ui/icons/index.js'

/**
 * Sets a new password from the link in the reset e-mail.
 *
 * The token and address are read from the query string and posted straight
 * back; neither is stored, and the token is never displayed. A used or
 * tampered token is rejected server-side, so this screen only has to relay
 * that outcome.
 */
export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams()
  const email = searchParams.get('email') ?? ''
  const token = searchParams.get('token') ?? ''

  const [passwords, setPasswords] = useState({ newPassword: '', confirmPassword: '' })
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState(0)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState('')
  const navigate = useNavigate()

  const setField = (name) => (event) =>
    setPasswords((prev) => ({ ...prev, [name]: event.target.value }))

  const showError = (message) => {
    setError(message)
    setErrorKey((k) => k + 1)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')

    if (passwords.newPassword !== passwords.confirmPassword) {
      showError('Şifreler eşleşmiyor.')
      return
    }

    setLoading(true)

    try {
      const res = await resetPassword({ email, token, ...passwords })
      if (!res.ok) {
        throw new Error(await readAccountError(res, 'Şifre sıfırlanamadı.'))
      }
      const data = await res.json()
      setDone(data.message)
    } catch (err) {
      showError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (!email || !token) {
    return (
      <AuthShell eyebrow="Şifre sıfırlama" title="Bağlantı geçersiz">
        <div className="auth-status">
          <span className="auth-status-icon auth-status-icon--error">
            <AlertIcon size={26} />
          </span>
          <p className="auth-status-text" role="alert">
            Sıfırlama bağlantısı eksik veya hatalı. Lütfen yeni bir sıfırlama isteği oluşturun.
          </p>
        </div>
        <Button className="login-submit" onClick={() => navigate('/forgot-password')}>
          Yeni bağlantı iste
        </Button>
      </AuthShell>
    )
  }

  if (done) {
    return (
      <AuthShell eyebrow="Şifre sıfırlama" title="Şifreniz değiştirildi">
        <div className="auth-success" role="status">
          <CheckIcon size={16} />
          <span>{done}</span>
        </div>
        <Button className="login-submit" onClick={() => navigate('/login')}>
          Giriş Yap
        </Button>
      </AuthShell>
    )
  }

  return (
    <AuthShell eyebrow="Şifre sıfırlama" title="Yeni şifre belirleyin">
      <p className="auth-lead">
        <strong>{email}</strong> hesabı için yeni bir şifre oluşturun.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <TextField
          id="reset-password"
          label="Yeni şifre"
          icon={<LockIcon size={19} />}
          type={showPassword ? 'text' : 'password'}
          value={passwords.newPassword}
          onChange={setField('newPassword')}
          autoComplete="new-password"
          placeholder="En az 8 karakter"
          autoFocus
          required
          trailing={
            <IconButton
              label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
              onClick={() => setShowPassword((v) => !v)}
              className="login-eye-toggle"
            >
              {showPassword ? <EyeOffIcon size={18} /> : <EyeIcon size={18} />}
            </IconButton>
          }
        />

        <TextField
          id="reset-confirm"
          label="Yeni şifre tekrar"
          icon={<LockIcon size={19} />}
          type={showPassword ? 'text' : 'password'}
          value={passwords.confirmPassword}
          onChange={setField('confirmPassword')}
          autoComplete="new-password"
          placeholder="Yeni şifrenizi tekrar girin"
          required
        />

        <p className="auth-note">
          Şifreniz en az 8 karakter olmalı; büyük harf, küçük harf ve rakam içermelidir.
        </p>

        {error && (
          <div key={errorKey} className="login-error" role="alert">
            <AlertIcon size={15} />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" loading={loading} className="login-submit">
          {loading ? 'Kaydediliyor' : 'Şifreyi Değiştir'}
          {!loading && (
            <span className="login-submit-arrow" aria-hidden="true">
              <ArrowRightIcon size={18} />
            </span>
          )}
        </Button>
      </form>

      <p className="auth-footer">
        <Link className="auth-link" to="/login">
          Giriş ekranına dön
        </Link>
      </p>
    </AuthShell>
  )
}
