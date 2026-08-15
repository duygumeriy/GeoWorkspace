import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import AuthShell from './AuthShell.jsx'
import Button from '../components/ui/Button.jsx'
import TextField from '../components/ui/TextField.jsx'
import { confirmEmail, resendConfirmation, readAccountError } from '../services/api'
import { CheckIcon, AlertIcon, UserIcon } from '../components/ui/icons/index.js'

/**
 * Landing page for the link in the verification e-mail.
 *
 * The token travels in the query string, is never rendered on screen and is
 * never written to storage — it is read once, posted to the backend and
 * dropped. When it turns out to be invalid or expired the page falls back to
 * requesting a fresh one.
 */
export default function ConfirmEmailPage() {
  const [searchParams] = useSearchParams()
  // checking | success | error | resend
  // "resend" is the neutral entry point: /confirm-email with no token at all,
  // which is how the login screen hands off a user whose address is verified.
  const [status, setStatus] = useState('checking')
  const [message, setMessage] = useState('')
  const requestedRef = useRef(false)
  const navigate = useNavigate()

  const userId = Number(searchParams.get('userId'))
  const token = searchParams.get('token')

  useEffect(() => {
    // StrictMode mounts effects twice in development; the token is single-use
    // on the server side, so guard against firing it twice.
    if (requestedRef.current) return
    requestedRef.current = true

    if (!userId || !token) {
      setStatus('resend')
      return
    }

    confirmEmail({ userId, token })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(await readAccountError(res, 'Doğrulama başarısız.'))
        }
        const data = await res.json()
        setStatus('success')
        setMessage(data.message)
      })
      .catch((err) => {
        setStatus('error')
        setMessage(err.message)
      })
  }, [userId, token])

  return (
    <AuthShell eyebrow="E-posta doğrulama" title="Hesap doğrulaması">
      {status === 'checking' && (
        <div className="auth-status">
          <span className="auth-spinner" aria-hidden="true" />
          <p className="auth-status-text">Doğrulanıyor, lütfen bekleyin…</p>
        </div>
      )}

      {status === 'success' && (
        <>
          <div className="auth-status">
            <span className="auth-status-icon auth-status-icon--success">
              <CheckIcon size={26} />
            </span>
            <p className="auth-status-text" role="status">
              {message}
            </p>
          </div>
          <Button className="login-submit" onClick={() => navigate('/login')}>
            Giriş Yap
          </Button>
        </>
      )}

      {(status === 'error' || status === 'resend') && <ResendConfirmation message={message} />}
    </AuthShell>
  )
}

/**
 * Requests a fresh verification mail. Shown both when a token turned out to be
 * invalid/expired and when the page is opened with no token at all.
 */
function ResendConfirmation({ message }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleResend = async (event) => {
    event.preventDefault()
    setError('')
    setLoading(true)

    try {
      const res = await resendConfirmation(email)
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
      <>
        <div className="auth-success" role="status">
          <CheckIcon size={16} />
          <span>{sent}</span>
        </div>
        <p className="auth-footer">
          <Link className="auth-link" to="/login">
            Giriş ekranına dön
          </Link>
        </p>
      </>
    )
  }

  return (
    <>
      {message ? (
        <div className="auth-status">
          <span className="auth-status-icon auth-status-icon--error">
            <AlertIcon size={26} />
          </span>
          <p className="auth-status-text" role="alert">
            {message}
          </p>
        </div>
      ) : (
        <p className="auth-lead">
          Doğrulama bağlantınız yoksa veya süresi dolduysa, kayıt olduğunuz e-posta adresini girin;
          yeni bir bağlantı gönderelim.
        </p>
      )}

      <form onSubmit={handleResend} noValidate>
        <TextField
          id="confirm-resend-email"
          label="E-posta"
          icon={<UserIcon size={19} />}
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
          placeholder="Kayıt olduğunuz e-posta adresi"
          required
        />

        {error && (
          <div className="login-error" role="alert">
            <AlertIcon size={15} />
            <span>{error}</span>
          </div>
        )}

        <Button type="submit" loading={loading} className="login-submit">
          {loading ? 'Gönderiliyor' : 'Doğrulama e-postasını yeniden gönder'}
        </Button>
      </form>

      <p className="auth-footer">
        <Link className="auth-link" to="/login">
          Giriş ekranına dön
        </Link>
      </p>
    </>
  )
}
