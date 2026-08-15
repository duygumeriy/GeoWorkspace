import { useState } from 'react'
import Button from '../ui/Button.jsx'
import { AlertIcon, CheckIcon } from '../ui/icons/index.js'
import './TwoFactor.css'

/**
 * The one and only time these codes are visible.
 *
 * The server hashes them the moment it hands them over, so there is no
 * "show them again" endpoint to build — which is exactly why this screen
 * insists on an explicit acknowledgement before it lets the user move on.
 * Nothing here is written to storage or logged.
 */
export default function RecoveryCodes({ codes, onDone, doneLabel = 'Devam Et' }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      // Clipboard can be blocked (permissions, insecure context). The codes
      // are on screen either way, so this is not worth an error state.
      setCopied(false)
    }
  }

  return (
    <div className="recovery-codes">
      <p className="two-factor-warning" role="alert">
        <AlertIcon size={16} />
        <span>
          Bu kodlar telefonunuza erişemediğinizde hesabınıza girmenizi sağlar.
          Her kod yalnızca bir kez kullanılabilir. Kodları güvenli bir yerde saklayın —
          bu ekrandan sonra bir daha gösterilmeyecekler.
        </span>
      </p>

      <ul className="recovery-codes-grid">
        {codes.map((code) => (
          <li key={code}>
            <code>{code}</code>
          </li>
        ))}
      </ul>

      <div className="recovery-codes-actions">
        <Button type="button" variant="ghost" onClick={handleCopy}>
          {copied ? (
            <>
              <CheckIcon size={15} /> Kopyalandı
            </>
          ) : (
            'Kopyala'
          )}
        </Button>
        {onDone && (
          <Button type="button" onClick={onDone}>
            {doneLabel}
          </Button>
        )}
      </div>
    </div>
  )
}
