import { CheckIcon } from './icons/index.js'
import { evaluatePassword } from '../../auth/passwordRules.js'
import './PasswordChecklist.css'

/**
 * Live view of the password policy while the user types.
 *
 * Replaces a single line of static helper text, which could only ever say what
 * was required — never how far along the user was, and never which of four
 * conditions was the one still failing.
 *
 * Each row states its own status in words (`aria-label`) rather than relying on
 * the tick alone, and the list is a polite live region so a screen-reader user
 * hears rules being satisfied instead of watching silence. The rules come from
 * `passwordRules.js`, which mirrors the backend's Identity configuration.
 *
 * @param {string} value the password being typed
 */
export default function PasswordChecklist({ value, id }) {
  const rules = evaluatePassword(value)
  const started = (value ?? '').length > 0

  return (
    <div className="password-checklist" id={id}>
      <p className="password-checklist-title">Şifre gereksinimleri</p>
      <ul className="password-checklist-items" aria-live="polite">
        {rules.map((rule) => (
          <li
            key={rule.id}
            /* Before the user types anything every rule is simply "not yet
               met", not "failed" — colouring them all red on an empty field
               would scold someone who has not started. */
            className={`password-rule ${rule.met ? 'is-met' : ''} ${started ? '' : 'is-idle'}`}
            aria-label={`${rule.label}: ${rule.met ? 'tamam' : 'eksik'}`}
          >
            <span className="password-rule-marker" aria-hidden="true">
              {rule.met && <CheckIcon size={11} />}
            </span>
            <span>{rule.label}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
