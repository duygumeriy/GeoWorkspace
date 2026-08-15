import GalaxyPinScene from './GalaxyPinScene.jsx'
import './TransitionOverlay.css'

// The galaxy/particle/pin scene is mounted for the overlay's entire visible
// lifetime, starting the instant it begins covering the login page. That's
// what lets the galaxy image crossfade directly against the exiting login
// card instead of appearing only after a blank hold frame — and it means
// the scene's own internal timeline (see galaxyPinTiming.js) starts at the
// same instant TransitionContext starts counting toward reveal-eligibility.
const SCENE_VISIBLE_PHASES = new Set(['covering', 'holding', 'revealing'])

/**
 * The single full-screen surface that carries the user across the login ->
 * map route swap. Always mounted (opacity 0 at rest) so the opacity
 * transition — and its transitionend — is available the moment a phase
 * change requests it; nothing about visibility is toggled via mount/unmount.
 */
export default function TransitionOverlay({ phase, overlayRef, onOverlayTransitionEnd, reducedMotion }) {
  return (
    <div
      ref={overlayRef}
      className="app-transition-overlay"
      data-phase={phase}
      aria-hidden="true"
      onTransitionEnd={onOverlayTransitionEnd}
    >
      {SCENE_VISIBLE_PHASES.has(phase) && <GalaxyPinScene reducedMotion={reducedMotion} phase={phase} />}
    </div>
  )
}
