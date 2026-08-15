import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import TextField from '../ui/TextField.jsx'
import Button from '../ui/Button.jsx'
import { ShieldIcon, AlertIcon } from '../ui/icons/index.js'
import './TwoFactor.css'

/**
 * The QR + confirmation step, shared by both places 2FA can be set up: the
 * mandatory admin flow on the login screen and the optional flow in
 * Ayarlar → Güvenlik.
 *
 * The QR is rendered here, in the browser, from the `otpauth://` URI the
 * backend produced — the secret never travels through an image service and is
 * not written anywhere but this component's props. It is deliberately not
 * logged, not stored, and not shown unless the user asks for the manual key.
 */
export default function AuthenticatorSetup({
  setup,
  onVerify,
  loading,
  error,
  submitLabel = 'Doğrula ve Etkinleştir',
  lead,
}) {
  const [code, setCode] = useState('')
  const [showKey, setShowKey] = useState(false)

  const handleSubmit = (event) => {
    event.preventDefault()
    onVerify(code)
  }

  return (
    <div className="two-factor-setup">
      {lead && <p className="two-factor-lead">{lead}</p>}

      <ol className="two-factor-steps">
        <li>Authenticator uygulamanızı açın.</li>
        <li>QR kodunu tarayın.</li>
        <li>Uygulamadaki 6 haneli kodu girin.</li>
      </ol>

      <div className="two-factor-qr">
        {/* White quiet zone is part of the spec, not decoration: scanners need
            the contrast, so it stays white in both themes. */}
        <QRCodeSVG
          value={setup.authenticatorUri}
          size={168}
          level="M"
          marginSize={2}
          bgColor="#ffffff"
          fgColor="#000000"
          title="İki faktörlü doğrulama QR kodu"
        />
      </div>

      <div className="two-factor-manual">
        <button type="button" className="auth-link" onClick={() => setShowKey((v) => !v)}>
          {showKey ? 'Kurulum anahtarını gizle' : 'QR kodunu tarayamıyor musunuz?'}
        </button>
        {showKey && (
          <>
            <code className="two-factor-key">{setup.sharedKey}</code>
            <p className="two-factor-hint">
              Bu anahtarı uygulamanıza elle girebilirsiniz. Kimseyle paylaşmayın.
            </p>
          </>
        )}
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <TextField
          id="two-factor-code"
          label="Doğrulama kodu"
          icon={<ShieldIcon size={17} />}
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
          <p className="login-error" role="alert">
            <AlertIcon size={15} />
            <span>{error}</span>
          </p>
        )}

        <Button type="submit" loading={loading} className="login-submit">
          {loading ? 'Doğrulanıyor' : submitLabel}
        </Button>
      </form>
    </div>
  )
}
