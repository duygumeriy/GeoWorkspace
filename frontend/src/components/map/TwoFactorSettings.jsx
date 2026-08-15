import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../../auth/AuthContext'
import TextField from '../ui/TextField.jsx'
import Button from '../ui/Button.jsx'
import AuthenticatorSetup from '../security/AuthenticatorSetup.jsx'
import RecoveryCodes from '../security/RecoveryCodes.jsx'
import {
  fetchTwoFactorStatus,
  startTwoFactorSetup,
  enableTwoFactor,
  disableTwoFactor,
  regenerateRecoveryCodes,
  readAccountError,
} from '../../services/api'
import { LockIcon, ShieldIcon } from '../ui/icons/index.js'
import '../security/TwoFactor.css'

/**
 * Ayarlar → Güvenlik → İki Faktörlü Doğrulama.
 *
 * Every state transition here is a sensitive one, so each asks for proof
 * again rather than trusting the open session: enabling re-checks the
 * password, disabling and regenerating re-check the password *and* a live
 * second factor. The `required` flag comes from the server (Admin ⇒ mandatory)
 * and is what removes the disable action — but hiding a button is not the
 * control; the backend answers 409 regardless of what this component renders.
 */
export default function TwoFactorSettings() {
  const { refreshUser } = useAuth()

  const [status, setStatus] = useState(null)
  // null | 'enable-password' | 'enable-verify' | 'codes' | 'disable' | 'regenerate'
  const [mode, setMode] = useState(null)
  const [setup, setSetup] = useState(null)
  const [codes, setCodes] = useState(null)
  const [form, setForm] = useState({ currentPassword: '', code: '' })
  const [feedback, setFeedback] = useState(null)
  const [loading, setLoading] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchTwoFactorStatus()
      if (res.ok) setStatus(await res.json())
    } catch {
      // Leaves the section in its loading state; the sheet can be reopened.
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  const reset = () => {
    setMode(null)
    setSetup(null)
    setCodes(null)
    setForm({ currentPassword: '', code: '' })
  }

  const setField = (name) => (event) =>
    setForm((prev) => ({ ...prev, [name]: event.target.value }))

  const run = async (request, onSuccess, fallback) => {
    setFeedback(null)
    setLoading(true)
    try {
      const res = await request()
      if (!res.ok) {
        throw new Error(await readAccountError(res, fallback))
      }
      await onSuccess(await res.json())
    } catch (err) {
      setFeedback({ tone: 'error', text: err.message })
    } finally {
      setLoading(false)
    }
  }

  const handleStartSetup = (event) => {
    event.preventDefault()
    run(
      () => startTwoFactorSetup(form.currentPassword),
      (data) => {
        setSetup({ sharedKey: data.sharedKey, authenticatorUri: data.authenticatorUri })
        setForm({ currentPassword: '', code: '' })
        setMode('enable-verify')
      },
      'Kurulum başlatılamadı.',
    )
  }

  const handleEnable = (code) =>
    run(
      () => enableTwoFactor(code),
      async (data) => {
        setCodes(data.recoveryCodes)
        setSetup(null)
        setMode('codes')
        await loadStatus()
        await refreshUser()
      },
      'Doğrulama başarısız.',
    )

  const handleDisable = (event) => {
    event.preventDefault()
    run(
      () => disableTwoFactor({ currentPassword: form.currentPassword, code: form.code }),
      async (data) => {
        reset()
        setFeedback({ tone: 'success', text: data.message })
        await loadStatus()
        await refreshUser()
      },
      'İki faktörlü doğrulama kapatılamadı.',
    )
  }

  const handleRegenerate = (event) => {
    event.preventDefault()
    run(
      () => regenerateRecoveryCodes({ currentPassword: form.currentPassword, code: form.code }),
      async (data) => {
        setCodes(data.recoveryCodes)
        setForm({ currentPassword: '', code: '' })
        setMode('codes')
        await loadStatus()
      },
      'Kurtarma kodları yenilenemedi.',
    )
  }

  if (!status) {
    return <p className="info-note">İki faktörlü doğrulama durumu yükleniyor…</p>
  }

  const badge = status.required
    ? { className: 'two-factor-badge--required', label: 'Zorunlu' }
    : status.enabled
      ? { className: 'two-factor-badge--on', label: 'Etkin' }
      : { className: 'two-factor-badge--off', label: 'Kapalı' }

  return (
    <div className="two-factor-settings">
      <div className="two-factor-status">
        <span>Durum:</span>
        <span className={`two-factor-badge ${badge.className}`}>
          <ShieldIcon size={13} />
          {badge.label}
        </span>
        {status.enabled && (
          <span className="two-factor-hint">{status.recoveryCodesLeft} kurtarma kodu kaldı</span>
        )}
      </div>

      {status.required && (
        <p className="info-note">
          Yönetici hesaplarında iki faktörlü doğrulama zorunludur ve kapatılamaz.
        </p>
      )}

      {feedback && (
        <p
          className={`two-factor-feedback two-factor-feedback--${feedback.tone}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
        >
          {feedback.text}
        </p>
      )}

      {/* --- Idle: which actions are offered ------------------------------- */}
      {mode === null && (
        <div className="two-factor-actions">
          {!status.enabled && (
            <Button type="button" onClick={() => setMode('enable-password')}>
              2FA'yı Etkinleştir
            </Button>
          )}
          {status.enabled && (
            <Button type="button" variant="ghost" onClick={() => setMode('regenerate')}>
              Recovery Kodlarını Yenile
            </Button>
          )}
          {status.enabled && !status.required && (
            <Button type="button" variant="ghost" onClick={() => setMode('disable')}>
              2FA'yı Devre Dışı Bırak
            </Button>
          )}
        </div>
      )}

      {/* --- Enable: password, then QR + code ------------------------------ */}
      {mode === 'enable-password' && (
        <form className="two-factor-form" onSubmit={handleStartSetup} noValidate>
          <p className="info-note">
            Devam etmek için şifrenizi tekrar girin. Bu, açık bırakılmış bir oturumun
            hesabınıza kendi authenticator'ını bağlamasını engeller.
          </p>
          <TextField
            id="two-factor-enable-password"
            label="Mevcut şifre"
            icon={<LockIcon size={17} />}
            type="password"
            value={form.currentPassword}
            onChange={setField('currentPassword')}
            autoComplete="current-password"
            required
          />
          <div className="two-factor-actions">
            <Button type="submit" loading={loading}>
              {loading ? 'Hazırlanıyor' : 'Devam Et'}
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              Vazgeç
            </Button>
          </div>
        </form>
      )}

      {mode === 'enable-verify' && setup && (
        <div className="two-factor-form">
          <AuthenticatorSetup
            setup={setup}
            onVerify={handleEnable}
            loading={loading}
            error={feedback?.tone === 'error' ? feedback.text : ''}
          />
          <Button type="button" variant="ghost" onClick={reset}>
            Vazgeç
          </Button>
        </div>
      )}

      {/* --- The codes, shown exactly once --------------------------------- */}
      {mode === 'codes' && codes && (
        <div className="two-factor-form">
          <h4 className="info-heading">Kurtarma Kodlarınız</h4>
          <RecoveryCodes codes={codes} onDone={reset} doneLabel="Kaydettim" />
        </div>
      )}

      {/* --- Disable / regenerate: password + a live second factor --------- */}
      {(mode === 'disable' || mode === 'regenerate') && (
        <form
          className="two-factor-form"
          onSubmit={mode === 'disable' ? handleDisable : handleRegenerate}
          noValidate
        >
          <p className="info-note">
            {mode === 'disable'
              ? 'Korumayı kaldırmak hassas bir işlemdir: şifreniz ve geçerli bir authenticator kodu gerekir.'
              : 'Yeni kodlar oluşturulduğunda eski kurtarma kodlarınız geçersiz olur.'}
          </p>
          <TextField
            id={`two-factor-${mode}-password`}
            label="Mevcut şifre"
            icon={<LockIcon size={17} />}
            type="password"
            value={form.currentPassword}
            onChange={setField('currentPassword')}
            autoComplete="current-password"
            required
          />
          <TextField
            id={`two-factor-${mode}-code`}
            label="Doğrulama kodu"
            icon={<ShieldIcon size={17} />}
            value={form.code}
            onChange={setField('code')}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            placeholder="000000"
            className="two-factor-code-field"
            required
          />
          <div className="two-factor-actions">
            <Button type="submit" loading={loading}>
              {mode === 'disable' ? 'Devre Dışı Bırak' : 'Kodları Yenile'}
            </Button>
            <Button type="button" variant="ghost" onClick={reset}>
              Vazgeç
            </Button>
          </div>
        </form>
      )}
    </div>
  )
}
