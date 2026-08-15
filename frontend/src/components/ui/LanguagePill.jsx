import { GlobeIcon, ChevronIcon } from './icons/index.js'
import './LanguagePill.css'

/**
 * Visual-only — the app has no i18n system yet, so this doesn't switch
 * anything. A non-interactive element rather than a button that would fake
 * having a function.
 */
export default function LanguagePill() {
  return (
    <div className="language-pill" aria-hidden="true">
      <GlobeIcon size={15} />
      <span>Türkçe</span>
      <ChevronIcon size={13} className="language-pill-chevron" />
    </div>
  )
}
