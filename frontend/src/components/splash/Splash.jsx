import { useEffect, useRef } from 'react'
import useReducedMotion from '../../hooks/useReducedMotion.js'
import PinIcon from '../ui/icons/PinIcon.jsx'
import './Splash.css'

// Shown once, above the router, for the lifetime of a single app bootstrap —
// never re-mounted by route navigation (login -> map, logout, etc).
export default function Splash({ onComplete }) {
  const reducedMotion = useReducedMotion()
  const firedRef = useRef(false)

  const finish = () => {
    if (firedRef.current) return
    firedRef.current = true
    onComplete?.()
  }

  // Reduced motion strips the staggered keyframes (see Splash.css), so there
  // is no animationend to hook into — just hold briefly then hand off.
  useEffect(() => {
    if (!reducedMotion) return undefined
    const t = setTimeout(finish, 200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  const handleAnimationEnd = (event) => {
    if (reducedMotion || event.target !== event.currentTarget) return
    if (event.animationName === 'splash-exit') finish()
  }

  return (
    <div className={`splash ${reducedMotion ? 'splash--reduced' : ''}`} aria-hidden="true" onAnimationEnd={handleAnimationEnd}>
      <span className="splash-mark">
        <PinIcon size={56} />
      </span>
      <h1 className="splash-title">Harita Uygulaması</h1>
      <div className="splash-rule" />
    </div>
  )
}
