import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useReducedMotion from '../hooks/useReducedMotion.js'
import TransitionOverlay from './TransitionOverlay.jsx'
import galaxyBg from '../assets/transition/galaxy-bg.jpg'
import { REVEAL_ELIGIBLE_MS } from './galaxyPinTiming.js'

const TransitionContext = createContext(null)

/**
 * Owns the one full-screen surface that carries the user from /login to
 * /map. Rendered above <Routes> (a sibling of the routed pages, not inside
 * one of them), so it keeps existing across the route swap instead of
 * unmounting with whichever page triggered it. That's what turns
 * login -> map into a single continuous handoff instead of a page swap
 * followed by a separate loading screen.
 *
 * Phases: idle -> covering -> holding -> revealing -> idle.
 *  - covering: overlay fades in over the still-visible login page.
 *  - holding: overlay fully opaque; /map has been mounted underneath and
 *    is loading. Never visible to the user.
 *  - revealing: overlay fades out once the map is actually ready, uncovering
 *    the finished map instead of a blank/loading one.
 */
export function TransitionProvider({ children }) {
  const [phase, setPhase] = useState('idle')
  const navigate = useNavigate()
  const reducedMotion = useReducedMotion()
  const overlayRef = useRef(null)
  const mapReadyRef = useRef(false)
  const minHoldElapsedRef = useRef(false)
  // Set the instant covering begins — GalaxyPinScene mounts (and starts its
  // own internal clock) at that same moment, so this is what lets the hold
  // timer below fire at exactly REVEAL_ELIGIBLE_MS after the scene's actual
  // start regardless of how long the covering CSS transition itself took.
  const transitionStartRef = useRef(0)

  // The galaxy image is a real asset fetched over the network the first
  // time it's needed — warm the cache as soon as the app boots so it's
  // already decoded by the time a real transition starts, instead of
  // fetching it mid-transition and risking a blank frame.
  useEffect(() => {
    const img = new Image()
    img.src = galaxyBg
  }, [])

  const tryLeaveHold = useCallback(() => {
    if (mapReadyRef.current && minHoldElapsedRef.current) {
      setPhase('revealing')
    }
  }, [])

  const beginLoginToMapTransition = useCallback(() => {
    mapReadyRef.current = false
    minHoldElapsedRef.current = false
    transitionStartRef.current = performance.now()
    setPhase('covering')
  }, [])

  const reportMapReady = useCallback(() => {
    mapReadyRef.current = true
    tryLeaveHold()
  }, [tryLeaveHold])

  useEffect(() => {
    if (phase !== 'holding') return undefined
    const elapsedSinceStart = performance.now() - transitionStartRef.current
    const remaining = reducedMotion ? 0 : Math.max(0, REVEAL_ELIGIBLE_MS - elapsedSinceStart)
    const t = setTimeout(() => {
      minHoldElapsedRef.current = true
      tryLeaveHold()
    }, remaining)
    return () => clearTimeout(t)
  }, [phase, reducedMotion, tryLeaveHold])

  // Route swap happens only once the overlay is fully opaque (transitionend
  // on its own opacity change), so the login page is never uncovered before
  // /map has taken its place underneath.
  const handleOverlayTransitionEnd = useCallback(
    (event) => {
      if (reducedMotion || event.target !== overlayRef.current || event.propertyName !== 'opacity') return
      if (phase === 'covering') {
        navigate('/map', { replace: true })
        setPhase('holding')
      } else if (phase === 'revealing') {
        setPhase('idle')
      }
    },
    [phase, navigate, reducedMotion]
  )

  // Reduced motion: the CSS opacity fade all but disappears (see
  // reduced-motion.css), so its transitionend isn't a reliable signal —
  // drive these two phase edges directly instead of waiting on it.
  useEffect(() => {
    if (!reducedMotion || phase !== 'covering') return undefined
    navigate('/map', { replace: true })
    setPhase('holding')
    return undefined
  }, [reducedMotion, phase, navigate])

  useEffect(() => {
    if (!reducedMotion || phase !== 'revealing') return undefined
    setPhase('idle')
    return undefined
  }, [reducedMotion, phase])

  // `isIdle` is presentation-timing infrastructure: any future blocking UI
  // (e.g. a forced password-change modal) that must not appear until the
  // map is fully revealed should gate on `isIdle`, not invent its own
  // timing — `phase` only reaches back to 'idle' once the map is actually
  // visible and the overlay has finished fading out.
  const value = { beginLoginToMapTransition, reportMapReady, phase, isIdle: phase === 'idle' }

  return (
    <TransitionContext.Provider value={value}>
      {children}
      <TransitionOverlay
        phase={phase}
        overlayRef={overlayRef}
        onOverlayTransitionEnd={handleOverlayTransitionEnd}
        reducedMotion={reducedMotion}
      />
    </TransitionContext.Provider>
  )
}

export function useTransition() {
  const ctx = useContext(TransitionContext)
  if (!ctx) {
    throw new Error('useTransition must be used within a TransitionProvider')
  }
  return ctx
}
