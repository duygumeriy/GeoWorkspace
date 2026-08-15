// Shared choreography for the login -> map "the galaxy becomes the pin"
// transition. Both the state machine (TransitionContext) and the visual scene
// (GalaxyPinScene) read from here so the overlay never reveals mid-animation.
//
// All values are milestones in ms measured from the moment the scene mounts
// (i.e. the instant the overlay enters 'covering'), not durations to sum by
// hand — this is what lets each phase be reasoned about independently.
//
//   0 ─────────────── DECOMP_START_MS
//   Real galaxy raster fills the screen and settles (scale 1.012 -> 1).
//
//   DECOMP_START_MS ─── (+ DECOMP_SPAN_MS)
//   Decomposition. Every region of the galaxy has its own start time, ordered
//   by radius, dimness and noise: faint dust goes first, luminous spiral
//   strands persist, the core is last. As a region begins to dim, the stars
//   inside it brighten into standalone particles, hold, then fly to the pin —
//   so an arm visibly turns into star clusters, then isolated stars, then
//   moving light, rather than being wiped away.
//
//   CORE_BURST_MS ─── GALAXY_GONE_MS
//   The surviving core breaks into a dense burst of particles and streams
//   toward the pin. The galaxy canvas is hard-cleared at GALAXY_GONE_MS.
//
//   GALAXY_GONE_MS ─── PIN_SVG_START_MS
//   PARTICLE-ONLY HOLD. A large, dense, readable particle pin on clean dark
//   space, with no galaxy left anywhere. This is the climax and it owns the
//   frame alone for the full window.
//
//   PIN_SVG_START_MS ─── PIN_SVG_END_MS
//   Only now does the crisp SVG resolve up through the particle field.

export const GALAXY_SETTLE_MS = 240

export const DECOMP_START_MS = 240
// Per-region depletion start times are spread across this window.
export const DECOMP_SPAN_MS = 820

// The core is the last thing standing; this is when it gives way.
export const CORE_BURST_MS = 1100

// Hard deadline: the galaxy canvas is cleared outright, so not one galaxy
// pixel can survive into the particle-pin hold.
export const GALAXY_GONE_MS = 1500

// The dotted pin is fully readable from here.
export const PARTICLE_PIN_MS = 1520

// 500ms of particle-only pin before the SVG contributes anything.
export const PIN_SVG_START_MS = 2020
export const PIN_SVG_END_MS = 2300

export const PIN_SETTLE_END_MS = 2480

// Earliest the overlay may leave 'holding': the pin must have finished
// forming even if the map underneath was ready long before that.
export const REVEAL_ELIGIBLE_MS = PIN_SETTLE_END_MS

// Loading copy is suppressed for the entire decomposition; it only appears if
// the map is still not ready a beat after the pin has settled. The scene also
// requires the overlay to still be in 'holding' before showing it, so a map
// that resolves right around this moment never flashes copy over the reveal.
export const LOADING_TEXT_DELAY_MS = PIN_SETTLE_END_MS + 300
