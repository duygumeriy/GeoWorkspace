import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useTransition } from '../transition/TransitionContext.jsx'
import {
  loginTwoFactor,
  loginTwoFactorRecovery,
  startMandatoryTwoFactorSetup,
  verifyMandatoryTwoFactorSetup,
  readAccountError,
} from '../services/api'
import LoginVisualPane from './LoginVisualPane.jsx'
import GlassPanel from '../components/ui/GlassPanel.jsx'
import TextField from '../components/ui/TextField.jsx'
import Button from '../components/ui/Button.jsx'
import LanguagePill from '../components/ui/LanguagePill.jsx'
import { useFixedThemePresentation } from '../styles/theme.jsx'
import AuthenticatorSetup from '../components/security/AuthenticatorSetup.jsx'
import RecoveryCodes from '../components/security/RecoveryCodes.jsx'
import { ShieldIcon, AlertIcon, KeyIcon } from '../components/ui/icons/index.js'
import './LoginPage.css'
import './AuthShell.css'
import '../components/security/TwoFactor.css'

/**
 * The second step of login.
 *
 * Reached only with a pending challenge in AuthContext — there is no route
 * into it otherwise, and a reload (which drops the in-memory challenge) sends
 * the visitor back to /login rather than leaving a half-authenticated screen
 * standing. The session itself begins at exactly one place in this file: the
 * `login(...)` call, which happens only after the server returned a token for
 * a completed second factor.
 */
export default function TwoFactorPage() {
  // Second login step: still an auth screen, so the same fixed presentation.
  useFixedThemePresentation('dark')

  const { challenge, login, updateChallengeToken, cancelTwoFactor } = useAuth()
  const { beginLoginToMapTransition } = useTransition()
  const navigate = useNavigate()

  // 'code' | 'recovery' | 'setup' | 'codes'
  const [step, setStep] = useState(challenge?.mode === 'setup' ? 'setup' : 'code')
  const [setup, setSetup] = useState(null)
  const [code, setCode] = useState('')
  const [recoveryCode, setRecoveryCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState(null)
  const [pendingSession, setPendingSession] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const setupRequestRef = useRef(null)

  // The mandatory-setup flow needs the QR before it can ask for anything.
  useEffect(() => {
    if (challenge?.mode !== 'setup' || setup) return

    let cancelled = false
    setLoading(true)

    /* Resetting an authenticator key is a destructive initialization, so the
       StrictMode effect replay must observe the same in-flight request rather
       than rotate the key twice and race Identity's concurrency stamp. */
    setupRequestRef.current ??= startMandatoryTwoFactorSetup(challenge.challengeToken)

    setupRequestRef.current
      .then(async (res) => {
        if (cancelled) return
        if (!res.ok) {
          setError(await readAccountError(res, 'Kurulum başlatılamadı.'))
          return
        }
        const data = await res.json()
        setSetup({ sharedKey: data.sharedKey, authenticatorUri: data.authenticatorUri })
        // Preparing a new key rotates the ticket; keep the fresh one.
        if (data.challengeToken) updateChallengeToken(data.challengeToken)
      })
      .catch(() => {
        if (!cancelled) setError('Sunucuya ulaşılamadı.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [challenge, setup, updateChallengeToken])

  if (!challenge) {
    return <Navigate to="/login" replace />
  }

  /** The only path from "verified" to "signed in". */
  const completeSession = (token, expiresAt) => {
    login(token, expiresAt)
    beginLoginToMapTransition()
    navigate('/map', { replace: true })
  }

  const run = async (request, onSuccess, fallbackMessage) => {
    setError('')
    setLoading(true)
    try {
      const res = await request()
      if (!res.ok) {
        throw new Error(await readAccountError(res, fallbackMessage))
      }
      await onSuccess(await res.json())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handleCode = (event) => {
    event.preventDefault()
    run(
      () => loginTwoFactor({ challengeToken: challenge.challengeToken, code }),
      (data) => completeSession(data.token, data.expiresAt),
      'Doğrulama başarısız.',
    )
  }

  const handleRecovery = (event) => {
    event.preventDefault()
    run(
      () => loginTwoFactorRecovery({ challengeToken: challenge.challengeToken, recoveryCode }),
      (data) => completeSession(data.token, data.expiresAt),
      'Kurtarma kodu doğrulanamadı.',
    )
  }

  const handleSetupVerify = (enteredCode) =>
    run(
      () => verifyMandatoryTwoFactorSetup({ challengeToken: challenge.challengeToken, code: enteredCode }),
      (data) => {
        // The session is held back deliberately: the recovery codes are shown
        // once, and navigating away immediately would lose them.
        setPendingSession({ token: data.token, expiresAt: data.expiresAt })
        setRecoveryCodes(data.recoveryCodes)
        setStep('codes')
      },
      'Kurulum doğrulanamadı.',
    )

  const backToLogin = () => {
    cancelTwoFactor()
    navigate('/login', { replace: true })
  }

  return (
    <div className="login-page">
      <div className="login-page-stars" aria-hidden="true" />

      <LoginVisualPane />

      <div className="login-page-top-controls">
        <LanguagePill />
      </div>

      <div className="login-form-wrap">
        <GlassPanel className="login-card" as="div">
          <p className="login-eyebrow">Güvenlik doğrulaması</p>

          {step === 'code' && (
            <>
              <h1>İki faktörlü doğrulama</h1>
              <span className="login-title-accent" aria-hidden="true" />
              <p className="auth-lead">
                Authenticator uygulamanızdaki 6 haneli kodu girin.
              </p>

              <form onSubmit={handleCode} noValidate>
                <TextField
                  id="two-factor-login-code"
                  label="Doğrulama kodu"
                  icon={<ShieldIcon size={19} />}
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="000000"
                  className="two-factor-code-field"
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
                  {loading ? 'Doğrulanıyor' : 'Doğrula'}
                </Button>
              </form>

              <p className="auth-footer">
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => {
                    setError('')
                    setStep('recovery')
                  }}
                >
                  Kurtarma kodu kullan
                </button>
              </p>
            </>
          )}

          {step === 'recovery' && (
            <>
              <h1>Kurtarma kodu</h1>
              <span className="login-title-accent" aria-hidden="true" />
              <p className="auth-lead">
                Authenticator uygulamanıza erişemiyorsanız, kaydettiğiniz kurtarma
                kodlarından birini girin. Her kod yalnızca bir kez kullanılabilir.
              </p>

              <form onSubmit={handleRecovery} noValidate>
                <TextField
                  id="two-factor-recovery-code"
                  label="Kurtarma kodu"
                  icon={<KeyIcon size={19} />}
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  autoComplete="one-time-code"
                  placeholder="xxxxx-xxxxx"
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
                  {loading ? 'Doğrulanıyor' : 'Giriş Yap'}
                </Button>
              </form>

              <p className="auth-footer">
                <button
                  type="button"
                  className="auth-link"
                  onClick={() => {
                    setError('')
                    setStep('code')
                  }}
                >
                  Authenticator kodunu kullan
                </button>
              </p>
            </>
          )}

          {step === 'setup' && (
            <>
              <h1>İki faktörlü doğrulama kurulumu</h1>
              <span className="login-title-accent" aria-hidden="true" />

              {setup ? (
                <AuthenticatorSetup
                  setup={setup}
                  onVerify={handleSetupVerify}
                  loading={loading}
                  error={error}
                  lead="Yönetici hesabınız için iki faktörlü doğrulama zorunludur. Devam etmek için authenticator uygulamanızı bağlayın."
                />
              ) : (
                <p className="auth-lead">
                  {error || 'Kurulum hazırlanıyor…'}
                </p>
              )}

              <p className="auth-footer">
                <button type="button" className="auth-link" onClick={backToLogin}>
                  Girişe dön
                </button>
              </p>
            </>
          )}

          {step === 'codes' && recoveryCodes && (
            <>
              <h1>Kurtarma kodlarınız</h1>
              <span className="login-title-accent" aria-hidden="true" />
              <RecoveryCodes
                codes={recoveryCodes}
                doneLabel="Kaydettim, devam et"
                onDone={() => completeSession(pendingSession.token, pendingSession.expiresAt)}
              />
            </>
          )}
        </GlassPanel>
      </div>
    </div>
  )
}
