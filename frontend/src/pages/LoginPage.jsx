import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useTransition } from '../transition/TransitionContext.jsx'
import { login as loginRequest } from '../services/api'
import LoginVisualPane from './LoginVisualPane.jsx'
import GlassPanel from '../components/ui/GlassPanel.jsx'
import TextField from '../components/ui/TextField.jsx'
import Button from '../components/ui/Button.jsx'
import IconButton from '../components/ui/IconButton.jsx'
import { useFixedThemePresentation } from '../styles/theme.jsx'
import {
  UserIcon,
  LockIcon,
  EyeIcon,
  EyeOffIcon,
  AlertIcon,
  CheckIcon,
  ArrowRightIcon,
} from '../components/ui/icons/index.js'
import './LoginPage.css'
import './AuthShell.css'

export default function LoginPage() {
  /* The login screen has one fixed look — the dark hero this file's CSS paints.
     It is deliberately NOT themeable, so the map's light/dark preference never
     reaches it. The preference itself is left untouched and the map restores it
     on the next sign-in. */
  useFixedThemePresentation('dark')

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(true)
  const [error, setError] = useState('')
  const [errorKey, setErrorKey] = useState(0)
  const [loading, setLoading] = useState(false)
  // Set when the password was right but the address is still unverified.
  const [needsConfirmation, setNeedsConfirmation] = useState(false)
  // Drives only the local exit motion (card/branding/earth) — the actual
  // route hand-off is owned by TransitionProvider so it survives navigation.
  const [exiting, setExiting] = useState(false)
  const { login, beginTwoFactor } = useAuth()
  const { beginLoginToMapTransition } = useTransition()
  const navigate = useNavigate()

  const handleSubmit = async (event) => {
    event.preventDefault()
    setError('')
    setNeedsConfirmation(false)
    setLoading(true)

    try {
      const res = await loginRequest(username, password)

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        // The backend only sets this flag once the password itself checked
        // out, so offering "resend" here does not reveal anything about
        // accounts the visitor does not already have the password for.
        setNeedsConfirmation(Boolean(body?.requiresEmailConfirmation))
        throw new Error(body?.message ?? 'Giriş başarısız.')
      }

      const data = await res.json()

      /* AUTH-5: a correct password is not, on its own, a session. When the
         account needs a second factor the server answers with a challenge
         instead of a token — there is nothing to store here and nothing to
         transition into yet. The challenge is handed to AuthContext (memory
         only, never the `token` key) and the flow continues on /login/2fa. */
      if (data.requiresTwoFactor || data.requiresTwoFactorSetup) {
        beginTwoFactor({
          challengeToken: data.challengeToken,
          mode: data.requiresTwoFactorSetup ? 'setup' : 'verify',
          username,
        })
        navigate('/login/2fa')
        return
      }

      // Persist the token before any transition UI, so a reload mid-transition
      // still lands the user authenticated (ProtectedRoute reads storage directly).
      login(data.token, data.expiresAt)
      setExiting(true)
      beginLoginToMapTransition()
    } catch (err) {
      setError(err.message)
      setErrorKey((k) => k + 1)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`login-page ${exiting ? 'is-exiting' : ''}`}>
      <div className="login-page-stars" aria-hidden="true" />

      <LoginVisualPane />

      {/* Bu ekranda ne tema denetimi ne de dil seçici vardır: tema kimliği
          doğrulanmış harita çalışma alanına aittir, dil değiştirme ise henüz
          bir işlev taşımıyordu. */}
      <div className="login-form-wrap">
        <GlassPanel className="login-card" as="div">
          <p className="login-eyebrow">Hoş geldiniz</p>
          <h1>Hesabınıza giriş yapın</h1>
          <span className="login-title-accent" aria-hidden="true" />

          <form onSubmit={handleSubmit} noValidate>
            <TextField
              id="login-username"
              label="Kullanıcı adı"
              icon={<UserIcon size={19} />}
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoComplete="username"
              placeholder="Kullanıcı adınızı girin"
              autoFocus
              required
            />

            <TextField
              id="login-password"
              label="Şifre"
              icon={<LockIcon size={19} />}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="Şifrenizi girin"
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

            <div className="login-row">
              <label className="login-remember">
                <input
                  type="checkbox"
                  className="login-remember-input"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                />
                <span className="login-remember-box">
                  <CheckIcon size={12} />
                </span>
                Beni hatırla
              </label>
              <Link className="login-forgot auth-link" to="/forgot-password">
                Şifremi unuttum?
              </Link>
            </div>

            {error && (
              <div key={errorKey} className="login-error" role="alert">
                <AlertIcon size={15} />
                <span>{error}</span>
              </div>
            )}

            {needsConfirmation && (
              <Link className="auth-link login-resend" to="/confirm-email">
                Doğrulama e-postasını yeniden gönder
              </Link>
            )}

            <Button type="submit" loading={loading} className="login-submit">
              {loading ? 'Giriş yapılıyor' : 'Giriş Yap'}
              {!loading && (
                <span className="login-submit-arrow" aria-hidden="true">
                  <ArrowRightIcon size={18} />
                </span>
              )}
            </Button>
          </form>

          <p className="auth-footer">
            Hesabınız yok mu?{' '}
            <Link className="auth-link" to="/register">
              Kayıt Ol
            </Link>
          </p>
        </GlassPanel>
      </div>
    </div>
  )
}
