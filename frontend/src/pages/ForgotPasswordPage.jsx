import { useState } from 'react'
import { Link } from 'react-router-dom'
import AuthShell from './AuthShell.jsx'
import TextField from '../components/ui/TextField.jsx'
import Button from '../components/ui/Button.jsx'
import { forgotPassword, readAccountError } from '../services/api'
import { UserIcon, AlertIcon, CheckIcon, ArrowRightIcon } from '../components/ui/icons/index.js'

/**
 * Password recovery request.
 *
 * The backend answers identically whether or not the address exists, and this
 * screen shows that answer verbatim — deliberately. Rendering anything more
 * specific here (e.g. "no such account") would re-introduce the user
 * enumeration the API is designed to avoid.
 */
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await forgotPassword(email)
      if (!res.ok) {
        throw new Error(await readAccountError(res, 'İşlem tamamlanamadı.'))
      }
      const data = await res.json()
      setSent(data.message)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <AuthShell eyebrow="Şifre sıfırlama" title="E-postanızı kontrol edin">
        <div className="auth-success" role="status">
          <CheckIcon size={16} />
          <span>{sent}</span>
        </div>
        <p className="auth-footer">
          <Link className="auth-link" to="/login">
            Giriş ekranına dön
          </Link>
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell eyebrow="Şifre sıfırlama" title="Şifrenizi mi unuttunuz?">
      <p className="auth-lead">
        Hesabınızın e-posta adresini girin; sıfırlama bağlantısını size gönderelim.
      </p>

      <form onSubmit={handleSubmit} noValidate>
        <TextField
          id="forgot-email"
          label="E-posta"
          icon={<UserIcon size={19} />}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          placeholder="ornek@eposta.com"
          autoFocus
          required
        />

        {error && (
          <div className="login-error" role="alert">
            <AlertIcon size={15} />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" loading={loading} className="login-submit">
          {loading ? 'Gönderiliyor' : 'Sıfırlama bağlantısı gönder'}
          {!loading && (
            <span className="login-submit-arrow" aria-hidden="true">
              <ArrowRightIcon size={18} />
            </span>
          )}
        </Button>
      </form>

      <p className="auth-footer">
        Şifrenizi hatırladınız mı?{' '}
        <Link className="auth-link" to="/login">
          Giriş yapın
        </Link>
      </p>
    </AuthShell>
  )
}
