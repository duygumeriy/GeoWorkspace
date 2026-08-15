import { useLayoutEffect, useRef, useState } from 'react'
import { PIN_FILLED_PATH_D } from '../components/ui/icons/PinIcon.jsx'
import galaxyBg from '../assets/transition/galaxy-bg.jpg'
import {
  DECOMP_START_MS,
  DECOMP_SPAN_MS,
  CORE_BURST_MS,
  GALAXY_GONE_MS,
  PARTICLE_PIN_MS,
  PIN_SVG_START_MS,
  PIN_SVG_END_MS,
  PIN_SETTLE_END_MS,
  LOADING_TEXT_DELAY_MS,
} from './galaxyPinTiming.js'

const TRANSITION_TITLE = 'Harita hazırlanıyor'
const TAU = Math.PI * 2

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const lerp = (a, b, t) => a + (b - a) * t
const smoothstep = (t) => t * t * (3 - 2 * t)
/** Normalized progress of `v` through the [a, b] window, clamped to 0..1. */
const segment = (v, a, b) => clamp((v - a) / (b - a || 1), 0, 1)

/* ---------------------------------------------------------------------- *
 * Noise
 * ---------------------------------------------------------------------- */

function hash2(x, y, seed) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 1442695041)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}

/** Smooth value noise — used to make every depletion boundary irregular. */
function valueNoise(x, y, seed) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = smoothstep(x - x0)
  const fy = smoothstep(y - y0)
  const a = lerp(hash2(x0, y0, seed), hash2(x0 + 1, y0, seed), fx)
  const b = lerp(hash2(x0, y0 + 1, seed), hash2(x0 + 1, y0 + 1, seed), fx)
  return lerp(a, b, fy)
}

function fbm(x, y, seed) {
  return valueNoise(x, y, seed) * 0.6 + valueNoise(x * 2.7, y * 2.7, seed + 91) * 0.4
}

/* ---------------------------------------------------------------------- *
 * Pin silhouette targets
 * ---------------------------------------------------------------------- */

// The pin glyph only occupies part of the stock 24x24 viewBox (x 5..19,
// y 2..22), so a 24-unit box renders a shape barely half its own width. The
// hero pin is cropped to the path's own bounds instead — PIN_VIEWBOX is used
// verbatim by both the SVG and this mask, so "box size" means "glyph size"
// and the two stay pixel-aligned through the crossfade.
const PIN_VIEWBOX = { x: 4.6, y: 2.1, w: 14.8, h: 20.4 }

const MASK_H = 260
const MASK_W = Math.round((MASK_H * PIN_VIEWBOX.w) / PIN_VIEWBOX.h)
let maskCache = null

function getPinMask() {
  if (maskCache) return maskCache

  const canvas = document.createElement('canvas')
  canvas.width = MASK_W
  canvas.height = MASK_H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const s = MASK_H / PIN_VIEWBOX.h
  ctx.scale(s, s)
  ctx.translate(-PIN_VIEWBOX.x, -PIN_VIEWBOX.y)
  ctx.fillStyle = '#fff'
  ctx.fill(new Path2D(PIN_FILLED_PATH_D), 'evenodd')

  const { data } = ctx.getImageData(0, 0, MASK_W, MASK_H)
  const inside = (x, y) => {
    if (x < 0 || y < 0 || x >= MASK_W || y >= MASK_H) return false
    return data[(y * MASK_W + x) * 4 + 3] > 128
  }

  // A rim band rather than a 1px outline: the reference reads as a bright,
  // dense edge with a sparser interior, which needs real thickness.
  const rim = []
  const fill = []
  const RIM = 7
  for (let y = 0; y < MASK_H; y++) {
    for (let x = 0; x < MASK_W; x++) {
      if (!inside(x, y)) continue
      const edge =
        !inside(x + RIM, y) ||
        !inside(x - RIM, y) ||
        !inside(x, y + RIM) ||
        !inside(x, y - RIM) ||
        !inside(x + RIM, y + RIM) ||
        !inside(x - RIM, y - RIM)
      ;(edge ? rim : fill).push({ x, y })
    }
  }
  maskCache = { rim, fill }
  return maskCache
}

/** Grid-stratified pick so points spread evenly instead of clumping. */
function stratified(points, count, weight) {
  if (count <= 0 || points.length === 0) return []
  const gridDim = Math.max(6, Math.round(Math.sqrt(count * 1.4)))
  const cell = MASK_H / gridDim
  const cols = Math.max(1, Math.ceil(MASK_W / cell))
  const buckets = new Map()
  for (const p of points) {
    const key = Math.min(gridDim - 1, Math.floor(p.y / cell)) * cols + Math.min(cols - 1, Math.floor(p.x / cell))
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(p)
  }
  const keys = Array.from(buckets.keys())
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[keys[i], keys[j]] = [keys[j], keys[i]]
  }
  const out = []
  let ki = 0
  let dry = 0
  while (out.length < count && dry < keys.length * 2) {
    const bucket = buckets.get(keys[ki % keys.length])
    ki += 1
    if (!bucket || bucket.length === 0) {
      dry += 1
      continue
    }
    dry = 0
    const p = bucket[Math.floor(Math.random() * bucket.length)]
    // Rejection-sample against a positional weight so density can be biased
    // (the reference concentrates particles toward the tapered lower tip).
    if (weight && Math.random() > weight(p)) continue
    bucket.splice(bucket.indexOf(p), 1)
    out.push(p)
  }
  return out
}

function buildPinTargets(count, cx, cy, boxPx) {
  const { rim, fill } = getPinMask()
  // boxPx is the rendered glyph height, matching the SVG's CSS box.
  const scale = boxPx / MASK_H
  const jitter = () => (Math.random() - 0.5) * 2.4
  const toScreen = (p) => ({
    x: cx + (p.x - MASK_W / 2) * scale + jitter(),
    y: cy + (p.y - MASK_H / 2) * scale + jitter(),
  })

  const rimCount = Math.round(count * 0.46)
  const haloCount = Math.round(count * 0.06)
  const fillCount = count - rimCount - haloCount

  // Denser toward the bottom tip, matching the reference's weighting.
  const tipBias = (p) => 0.45 + 0.55 * (p.y / MASK_H) ** 1.5

  const halo = []
  for (let i = 0; i < haloCount; i++) {
    const a = Math.random() * TAU
    const r = boxPx * (0.36 + Math.random() * 0.3)
    halo.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r * 0.95 })
  }

  return {
    rim: stratified(rim, rimCount).map(toScreen),
    fill: stratified(fill, fillCount, tipBias).map(toScreen),
    halo,
  }
}

/* ---------------------------------------------------------------------- *
 * Galaxy sampling
 * ---------------------------------------------------------------------- */

function coverFit(nw, nh, vw, vh) {
  const scale = Math.max(vw / nw, vh / nh)
  return { scale, offsetX: (vw - nw * scale) / 2, offsetY: (vh - nh * scale) / 2 }
}

const FIELD_COLS = 112

/**
 * Reads the galaxy once and produces everything downstream needs:
 *  - a per-cell depletion schedule over a low-resolution field
 *  - particle origins at real bright pixels, each bound to its field cell
 *
 * Depletion order deliberately weights dimness and noise almost as heavily as
 * radius. If radius dominated, the surviving material would collapse into a
 * circular miniature of the source image; blending in luminance instead keeps
 * bright spiral strands alive out at the edges while the faint dust between
 * them clears, so the galaxy thins along its own geometry.
 */
function analyseGalaxy(img, vw, vh, originCount, coreCount) {
  const nw = img.naturalWidth
  const nh = img.naturalHeight
  if (!nw || !nh) return null

  const sw = 320
  const sh = Math.max(1, Math.round(sw * (nh / nw)))
  const c = document.createElement('canvas')
  c.width = sw
  c.height = sh
  const cx2 = c.getContext('2d', { willReadFrequently: true })
  cx2.drawImage(img, 0, 0, sw, sh)
  const { data } = cx2.getImageData(0, 0, sw, sh)

  const { scale, offsetX, offsetY } = coverFit(nw, nh, vw, vh)
  const pxX = (nw / sw) * scale
  const pxY = (nh / sh) * scale

  const rows = Math.max(8, Math.round((FIELD_COLS * vh) / vw))
  const cellW = vw / FIELD_COLS
  const cellH = vh / rows
  const sumLum = new Float32Array(FIELD_COLS * rows)
  const cnt = new Float32Array(FIELD_COLS * rows)

  const bright = []
  let coreWx = 0
  let coreWy = 0
  let coreW = 0

  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = (y * sw + x) * 4
      const r = data[i]
      const g = data[i + 1]
      const b = data[i + 2]
      const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
      const sx = offsetX + x * pxX
      const sy = offsetY + y * pxY
      if (sx < 0 || sy < 0 || sx >= vw || sy >= vh) continue

      const ci = clamp(Math.floor(sy / cellH), 0, rows - 1) * FIELD_COLS + clamp(Math.floor(sx / cellW), 0, FIELD_COLS - 1)
      sumLum[ci] += lum
      cnt[ci] += 1

      if (lum > 0.2) {
        bright.push({ x: sx, y: sy, lum, r, g, b, ci })
        const w = lum ** 4
        coreWx += sx * w
        coreWy += sy * w
        coreW += w
      }
    }
  }
  if (bright.length === 0) return null

  const core = coreW > 0 ? { x: coreWx / coreW, y: coreWy / coreW } : { x: vw / 2, y: vh / 2 }
  const maxR = Math.max(
    Math.hypot(core.x, core.y),
    Math.hypot(vw - core.x, core.y),
    Math.hypot(core.x, vh - core.y),
    Math.hypot(vw - core.x, vh - core.y)
  )

  let maxMean = 1e-6
  const mean = new Float32Array(FIELD_COLS * rows)
  for (let i = 0; i < mean.length; i++) {
    mean[i] = cnt[i] > 0 ? sumLum[i] / cnt[i] : 0
    if (mean[i] > maxMean) maxMean = mean[i]
  }

  const start = new Float32Array(FIELD_COLS * rows)
  const dur = new Float32Array(FIELD_COLS * rows)
  const seed = (Math.random() * 1e6) | 0
  for (let ry = 0; ry < rows; ry++) {
    for (let rx = 0; rx < FIELD_COLS; rx++) {
      const i = ry * FIELD_COLS + rx
      const px = (rx + 0.5) * cellW
      const py = (ry + 0.5) * cellH
      const radiusNorm = Math.hypot(px - core.x, py - core.y) / maxR
      const lumNorm = clamp(mean[i] / maxMean, 0, 1)
      const n = fbm(rx / 9, ry / 9, seed)

      // Luminance RAISES the order, i.e. delays depletion: faint inter-arm
      // dust clears first and the bright spiral strands are what survive
      // longest, so an arm thins into strands and then into isolated stars.
      // (Inverting this makes the bright arms vanish while the dim wisps
      // linger, which reads as the image being wiped rather than consumed.)
      let order = 0.4 * radiusNorm + 0.38 * lumNorm + 0.22 * n
      // The luminous core is the finale — force it to the very end no matter
      // what the blend above produced. Its target time carries a high-
      // frequency noise term so the core comes apart in fragments instead of
      // shrinking uniformly, which would just read as a small blurry copy of
      // the source image sitting in the middle of the screen.
      const grain = fbm(rx / 2.2, ry / 2.2, seed + 313)
      const coreness = (1 - smoothstep(clamp(radiusNorm / 0.16, 0, 1))) * smoothstep(clamp(lumNorm / 0.55, 0, 1))
      order = lerp(clamp(order, 0, 1), 0.84 + 0.26 * grain, coreness)

      start[i] = DECOMP_START_MS + clamp(order, 0, 1.06) * DECOMP_SPAN_MS
      dur[i] = 300 + fbm(rx / 5 + 40, ry / 5, seed + 7) * 320
    }
  }

  // Origins: stratified over the screen so dust, arms and core all contribute,
  // preferring the brighter candidate within each cell.
  const pick = (pool, n) => {
    if (pool.length === 0) return []
    const buckets = new Map()
    for (const p of pool) {
      if (!buckets.has(p.ci)) buckets.set(p.ci, [])
      buckets.get(p.ci).push(p)
    }
    const keys = Array.from(buckets.keys())
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[keys[i], keys[j]] = [keys[j], keys[i]]
    }
    const out = []
    let ki = 0
    let guard = 0
    while (out.length < n && guard < n * 8) {
      const bucket = buckets.get(keys[ki % keys.length])
      ki += 1
      guard += 1
      if (!bucket || bucket.length === 0) continue
      let best = null
      for (let k = 0; k < 3; k++) {
        const cand = bucket[Math.floor(Math.random() * bucket.length)]
        if (!best || cand.lum > best.lum) best = cand
      }
      out.push(best)
    }
    return out
  }

  const coreRadius = maxR * 0.2
  const corePool = bright.filter((p) => Math.hypot(p.x - core.x, p.y - core.y) < coreRadius)
  const origins = pick(bright, originCount).concat(pick(corePool.length > 40 ? corePool : bright, coreCount))

  return { origins, core, maxR, rows, cellW, cellH, start, dur }
}

function fallbackAnalysis(vw, vh, originCount, coreCount) {
  const core = { x: vw / 2, y: vh / 2 }
  const rows = Math.max(8, Math.round((FIELD_COLS * vh) / vw))
  const n = FIELD_COLS * rows
  const origins = []
  for (let i = 0; i < originCount + coreCount; i++) {
    const a = Math.random() * TAU
    const rr = Math.sqrt(Math.random()) * Math.min(vw, vh) * 0.45
    origins.push({
      x: core.x + Math.cos(a) * rr,
      y: core.y + Math.sin(a) * rr * 0.62,
      lum: 0.4 + Math.random() * 0.5,
      r: 170,
      g: 150,
      b: 240,
      ci: 0,
    })
  }
  return {
    origins,
    core,
    maxR: Math.hypot(vw, vh) / 2,
    rows,
    cellW: vw / FIELD_COLS,
    cellH: vh / rows,
    start: new Float32Array(n).fill(DECOMP_START_MS),
    dur: new Float32Array(n).fill(400),
  }
}

/* ---------------------------------------------------------------------- *
 * Particles
 * ---------------------------------------------------------------------- */

/** Quantize to a 16-step channel so particles collapse into few fillStyles. */
const qc = (v) => Math.min(255, Math.round(v / 16) * 16)

// Trails are low-opacity motion accents, so three fixed tints are enough to
// batch every segment into three stroke() calls.
const TRAIL_STYLES = ['rgba(150,130,235,0.10)', 'rgba(178,158,248,0.17)', 'rgba(205,190,255,0.24)']

function buildParticles(analysis, targets) {
  const { origins, core, start, dur } = analysis
  const all = targets.rim.concat(targets.fill, targets.halo)

  const built = origins.map((o) => {
    const cellStart = start[o.ci] ?? DECOMP_START_MS
    const cellDur = dur[o.ci] ?? 400
    // The star brightens just before its patch of galaxy starts to dim, holds
    // as a visible point while the material around it thins, and only then
    // flies. That ordering is what makes an arm read as turning into stars.
    const emergeAt = cellStart - 70
    const launchAt = cellStart + cellDur * 0.45 + Math.random() * 150
    // Heavily weighted to micro dust: the reference's density comes from a
    // mass of ~1px white specks, and a large medium class turns the
    // silhouette into soft violet bubbles instead.
    const roll = Math.random()
    const cls = roll > 0.975 ? 2 : roll > 0.79 ? 1 : 0

    return {
      o,
      emergeAt,
      launchAt,
      cls,
      sortKey: launchAt,
    }
  })

  built.sort((a, b) => a.sortKey - b.sortKey)

  // Earliest arrivals build the bright rim, so the silhouette is legible long
  // before the interior finishes packing in.
  const rimN = targets.rim.length
  const rest = built.length - rimN
  const restTargets = targets.fill.concat(targets.halo)
  for (let i = restTargets.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[restTargets[i], restTargets[j]] = [restTargets[j], restTargets[i]]
  }

  const particles = built.map((b, i) => {
    const onRim = i < rimN
    const target = onRim ? targets.rim[i] : (restTargets[(i - rimN) % Math.max(1, rest)] ?? all[all.length - 1])
    const o = b.o
    const flight = 340 + Math.random() * 220

    const dx = target.x - o.x
    const dy = target.y - o.y
    const len = Math.hypot(dx, dy) || 1
    const perpX = -dy / len
    const perpY = dx / len
    const curl = (Math.random() - 0.5) * len * 0.3
    const outLen = Math.hypot(o.x - core.x, o.y - core.y) || 1
    const lift = 10 + Math.random() * 26
    const midX = o.x + dx * 0.5
    const midY = o.y + dy * 0.5

    const size =
      b.cls === 2 ? 2.2 + Math.random() * 0.8 : b.cls === 1 ? 1.2 + Math.random() * 1 : 0.7 + Math.random() * 0.45
    // Micro dust is pushed almost to white so a thousand ~1px points read as
    // the reference's bright speckle; the larger classes keep more of the
    // sampled galaxy hue so the field never flattens to one colour.
    const toWhite = b.cls === 2 ? 0.4 : b.cls === 1 ? 0.56 : 0.74

    return {
      originX: o.x,
      originY: o.y,
      targetX: target.x,
      targetY: target.y,
      c1x: lerp(o.x, midX, 0.55) + ((o.x - core.x) / outLen) * lift + perpX * curl * 0.5,
      c1y: lerp(o.y, midY, 0.55) + ((o.y - core.y) / outLen) * lift + perpY * curl * 0.5,
      c2x: lerp(midX, target.x, 0.55) + perpX * curl,
      c2y: lerp(midY, target.y, 0.55) + perpY * curl,
      emergeAt: b.emergeAt,
      launchAt: b.launchAt,
      flight,
      cls: b.cls,
      size: onRim ? size * 1.12 : size,
      // Sampled hue pushed toward white, so the dot reads against the violet
      // galaxy it came out of while still carrying that galaxy's colour.
      // Quantized to a small palette and baked into a solid colour string at
      // build time: with ~1500 points on screen, composing an rgba() string
      // per particle per frame is the single most expensive thing the render
      // loop can do. Per-frame alpha rides on globalAlpha instead.
      fill: `rgb(${qc(lerp(o.r, 255, toWhite))},${qc(lerp(o.g, 255, toWhite - 0.04))},${qc(lerp(o.b, 255, toWhite - 0.16))})`,
      // The reference's silhouette is legible because its edge is brighter
      // and denser than its interior, not because the whole shape is bright.
      restAlpha: (onRim ? 0.9 : 0.62) + Math.random() * 0.1,
      keepAfterSvg: Math.random() < 0.4,
      x: o.x,
      y: o.y,
      px: o.x,
      py: o.y,
      alpha: 0,
    }
  })

  // Draw order groups identical fillStyles together (micro dust first, since
  // it shares the fewest colours), so the core pass sets fillStyle once per
  // palette entry rather than once per particle.
  particles.sort((a, b) => a.cls - b.cls || (a.fill < b.fill ? -1 : a.fill > b.fill ? 1 : 0))
  return particles
}

// Standard Newton-Raphson cubic-bezier solve, matching the CSS easing model.
// A hand-rolled piecewise ease is not worth the risk: any discontinuity
// between the pieces teleports every particle mid-flight.
function makeCubicBezier(x1, y1, x2, y2) {
  const A = (p1, p2) => 1 - 3 * p2 + 3 * p1
  const B = (p1, p2) => 3 * p2 - 6 * p1
  const C = (p1) => 3 * p1
  const bez = (t, p1, p2) => ((A(p1, p2) * t + B(p1, p2)) * t + C(p1)) * t
  const slope = (t, p1, p2) => 3 * A(p1, p2) * t * t + 2 * B(p1, p2) * t + C(p1)
  return (x) => {
    let t = clamp(x, 0, 1)
    for (let i = 0; i < 8; i++) {
      const s = slope(t, x1, x2)
      if (Math.abs(s) < 1e-6) break
      t -= (bez(t, x1, x2) - x) / s
    }
    return bez(clamp(t, 0, 1), y1, y2)
  }
}
const easeFlight = makeCubicBezier(0.3, 0, 0.16, 1)

// Reaching the reference's "very dense particle distribution" needs more
// points than a readable flow alone would: the silhouette is the climax and
// at ~700 total it reads as a sparse dot outline. These counts are what the
// measured frame rate supports; see the perf check in the verification run.
function countsForViewport(vw, vh) {
  const density = Math.sqrt((vw * vh) / (1920 * 1080))
  let main
  if (vw <= 640) main = clamp(620 * density * 1.5, 460, 720)
  else if (vw <= 1024) main = clamp(950 * density * 1.2, 700, 1050)
  else main = clamp(1400 * density, 1050, 1600)
  return { main: Math.round(main), core: Math.round(main * 0.34) }
}

// Rendered glyph HEIGHT. Must stay in lockstep with the .gp-pin svg height in
// TransitionOverlay.css, or the particle silhouette and the SVG that resolves
// through it will not line up.
function pinBoxPxForViewport(vw, vh) {
  if (vw <= 640) return clamp(vh * 0.26, 180, 240)
  if (vw <= 1024) return clamp(vh * 0.3, 220, 300)
  return clamp(vh * 0.34, 260, 380)
}

/**
 * The galaxy raster is drawn into a canvas and dissolved by a smooth,
 * low-resolution depletion field rather than by erase brushes: the field is
 * bilinearly upscaled and blurred before it is applied, so there is no such
 * thing as a visible stamp edge. Each field cell dims in step with the stars
 * that detach from it, and those stars fly to the pin — so the galaxy really
 * does turn into the particles that build the silhouette.
 */
export default function GalaxyPinScene({ reducedMotion, phase }) {
  const galaxyRef = useRef(null)
  const particleRef = useRef(null)
  const rafRef = useRef(null)
  const timersRef = useRef([])
  const [stage, setStage] = useState(reducedMotion ? 'settled' : 'galaxy')
  const [textVisible, setTextVisible] = useState(false)

  useLayoutEffect(() => {
    if (reducedMotion) return undefined

    const galaxyCanvas = galaxyRef.current
    const particleCanvas = particleRef.current
    const gctx = galaxyCanvas?.getContext('2d')
    const pctx = particleCanvas?.getContext('2d')
    if (!gctx || !pctx) return undefined

    const scene = { ready: false, cleared: false }
    let disposed = false
    const startTime = performance.now()

    const layout = (img) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      // The galaxy layer is a soft photo being dissolved by a blurred mask —
      // it carries no fine detail worth a 2x backing store, and rebuilding it
      // every frame at full DPR is pure cost. Particles stay at full DPR
      // because their 1px cores are exactly what must stay crisp.
      const gdpr = Math.min(dpr, 1.25)
      const vw = window.innerWidth
      const vh = window.innerHeight

      for (const [canvas, ctx, scale] of [
        [galaxyCanvas, gctx, gdpr],
        [particleCanvas, pctx, dpr],
      ]) {
        canvas.width = Math.round(vw * scale)
        canvas.height = Math.round(vh * scale)
        canvas.style.width = `${vw}px`
        canvas.style.height = `${vh}px`
        ctx.setTransform(scale, 0, 0, scale, 0, 0)
      }

      const box = pinBoxPxForViewport(vw, vh)
      const pin = { x: vw / 2, y: vh * 0.5 - vh * 0.04, box }
      const { main, core: coreN } = countsForViewport(vw, vh)

      const analysis = (img && analyseGalaxy(img, vw, vh, main, coreN)) || fallbackAnalysis(vw, vh, main, coreN)
      const targets = buildPinTargets(analysis.origins.length, pin.x, pin.y, box)
      const particles = buildParticles(analysis, targets)

      // Pre-scaled copy of the galaxy at viewport size: re-blitting this each
      // frame is far cheaper than rescaling the full-resolution JPEG, and the
      // frame must be rebuilt every time because the mask is reapplied whole.
      let src = null
      if (img) {
        src = document.createElement('canvas')
        src.width = Math.round(vw * gdpr)
        src.height = Math.round(vh * gdpr)
        const sctx = src.getContext('2d')
        sctx.setTransform(gdpr, 0, 0, gdpr, 0, 0)
        const { scale, offsetX, offsetY } = coverFit(img.naturalWidth, img.naturalHeight, vw, vh)
        sctx.drawImage(img, offsetX, offsetY, img.naturalWidth * scale, img.naturalHeight * scale)
      }

      // Depletion field, at one pixel per cell. Upscaling this tiny bitmap is
      // what produces smooth luminance falloff instead of brush marks.
      const field = document.createElement('canvas')
      field.width = FIELD_COLS
      field.height = analysis.rows
      const fctx = field.getContext('2d')
      const fieldData = fctx.createImageData(FIELD_COLS, analysis.rows)
      for (let i = 0; i < FIELD_COLS * analysis.rows; i++) fieldData.data[i * 4 + 3] = 0

      // Intermediate blur stage: cheap at this size, and it guarantees the
      // upscale can never show cell boundaries.
      const soft = document.createElement('canvas')
      soft.width = 600
      soft.height = Math.round((600 * vh) / vw)
      const softCtx = soft.getContext('2d')

      Object.assign(scene, {
        ready: true,
        cleared: false,
        vw,
        vh,
        pin,
        analysis,
        particles,
        src,
        field,
        fctx,
        fieldData,
        soft,
        softCtx,
        trailBuckets: [[], [], []],
      })
    }

    const drawGalaxy = (t) => {
      if (!scene.ready || scene.cleared) return
      const { vw, vh, src, analysis, field, fctx, fieldData, soft, softCtx } = scene

      if (t >= GALAXY_GONE_MS || !src) {
        gctx.clearRect(0, 0, vw, vh)
        scene.cleared = true
        return
      }

      const { start, dur, rows } = analysis
      const d = fieldData.data
      for (let i = 0; i < FIELD_COLS * rows; i++) {
        const k = (t - start[i]) / dur[i]
        d[i * 4 + 3] = k <= 0 ? 0 : k >= 1 ? 255 : (smoothstep(k) * 255) | 0
      }
      fctx.putImageData(fieldData, 0, 0)

      softCtx.clearRect(0, 0, soft.width, soft.height)
      softCtx.filter = 'blur(2.5px)'
      softCtx.drawImage(field, 0, 0, soft.width, soft.height)
      softCtx.filter = 'none'

      gctx.clearRect(0, 0, vw, vh)
      gctx.globalCompositeOperation = 'source-over'
      gctx.globalAlpha = 1
      gctx.drawImage(src, 0, 0, vw, vh)
      gctx.globalCompositeOperation = 'destination-out'
      // Plain bilinear: the mask was already blurred at the soft stage, so
      // high-quality resampling buys nothing and costs a lot at this size.
      gctx.imageSmoothingQuality = 'low'
      gctx.drawImage(soft, 0, 0, vw, vh)
      gctx.globalCompositeOperation = 'source-over'
    }

    const drawParticles = (t) => {
      const { vw, vh, particles, pin, analysis } = scene
      pctx.clearRect(0, 0, vw, vh)

      const svgK = segment(t, PIN_SVG_START_MS, PIN_SVG_END_MS)

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        p.px = p.x
        p.py = p.y

        if (t < p.emergeAt) {
          p.alpha = 0
          continue
        }

        if (t < p.launchAt) {
          // Emerged but not yet moving: a star standing where the galaxy used
          // to be, brightening as its surroundings dim.
          p.x = p.originX
          p.y = p.originY
          p.alpha = segment(t, p.emergeAt, p.emergeAt + 190) * p.restAlpha
          continue
        }

        const k = clamp((t - p.launchAt) / p.flight, 0, 1)
        const e = easeFlight(k)
        const mt = 1 - e
        const a3 = mt * mt * mt
        const b3 = 3 * mt * mt * e
        const c3 = 3 * mt * e * e
        const d3 = e * e * e
        p.x = a3 * p.originX + b3 * p.c1x + c3 * p.c2x + d3 * p.targetX
        p.y = a3 * p.originY + b3 * p.c1y + c3 * p.c2y + d3 * p.targetY

        let alpha = Math.max(p.restAlpha, 0.75)
        if (k >= 1) {
          // Settled into the silhouette: this is the climax, so the field
          // stays at full strength right through the particle-only hold.
          alpha = 0.85 + p.restAlpha * 0.15
          if (svgK > 0) alpha *= p.keepAfterSvg ? 1 - svgK * 0.55 : 1 - svgK
        }
        p.alpha = alpha
      }

      // Ambient violet bed behind the silhouette — the reference's glow.
      const bedK = segment(t, PARTICLE_PIN_MS - 420, PARTICLE_PIN_MS)
      if (bedK > 0) {
        // Hugs the silhouette rather than washing the frame: the reference's
        // glow is a tight violet bed, and a wide one greys out the clean
        // background the pin is supposed to sit on.
        const gr = pin.box * 0.58
        const grad = pctx.createRadialGradient(pin.x, pin.y, 0, pin.x, pin.y, gr)
        const ga = 0.26 * bedK * (1 - svgK * 0.35)
        grad.addColorStop(0, `rgba(150,105,250,${ga})`)
        grad.addColorStop(0.5, `rgba(109,64,220,${ga * 0.4})`)
        grad.addColorStop(1, 'rgba(70,40,180,0)')
        pctx.fillStyle = grad
        pctx.fillRect(pin.x - gr, pin.y - gr, gr * 2, gr * 2)
      }

      // Core giving way: its light stretches toward the pin instead of just
      // fading out where it stands.
      const streamK = segment(t, CORE_BURST_MS, GALAXY_GONE_MS + 60)
      if (streamK > 0 && streamK < 1) {
        pctx.globalCompositeOperation = 'lighter'
        const fade = 1 - smoothstep(segment(streamK, 0.45, 1))
        for (let s = 0; s < 5; s++) {
          const u = smoothstep(clamp(streamK * 1.25 - s * 0.08, 0, 1))
          const gx = lerp(analysis.core.x, pin.x, u)
          const gy = lerp(analysis.core.y, pin.y, u)
          const gr = Math.max(2, lerp(analysis.maxR * 0.13, pin.box * 0.2, u)) * (1 - s * 0.13)
          const ga = 0.16 * fade * (1 - s * 0.15)
          const grad = pctx.createRadialGradient(gx, gy, 0, gx, gy, gr)
          grad.addColorStop(0, `rgba(232,220,255,${ga})`)
          grad.addColorStop(0.45, `rgba(150,110,246,${ga * 0.5})`)
          grad.addColorStop(1, 'rgba(90,60,200,0)')
          pctx.fillStyle = grad
          pctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2)
        }
        pctx.globalCompositeOperation = 'source-over'
      }

      // Trails: short, velocity-aligned, moving particles only. Collected into
      // three alpha buckets and stroked as three paths — one stroke() per
      // particle is what pushed this loop under 30fps at 1080p.
      pctx.globalCompositeOperation = 'lighter'
      pctx.lineCap = 'round'
      const buckets = scene.trailBuckets
      buckets[0].length = 0
      buckets[1].length = 0
      buckets[2].length = 0
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        if (p.alpha <= 0.06) continue
        let tx = p.x - p.px
        let ty = p.y - p.py
        const len = Math.hypot(tx, ty)
        if (len < 0.7) continue
        const L = Math.min(p.cls === 2 ? 7 : 5, Math.max(2, len * 1.5))
        tx = (tx / len) * L
        ty = (ty / len) * L
        const b = p.alpha > 0.8 ? 2 : p.alpha > 0.5 ? 1 : 0
        buckets[b].push(p.x - tx, p.y - ty, p.x, p.y)
      }
      for (let b = 0; b < 3; b++) {
        const arr = buckets[b]
        if (arr.length === 0) continue
        pctx.strokeStyle = TRAIL_STYLES[b]
        pctx.lineWidth = b === 2 ? 1.1 : 0.8
        pctx.beginPath()
        for (let i = 0; i < arr.length; i += 4) {
          pctx.moveTo(arr[i], arr[i + 1])
          pctx.lineTo(arr[i + 2], arr[i + 3])
        }
        pctx.stroke()
      }

      // Hero glow, kept to a handful of particles so the field never turns
      // into a row of glowing balls.
      pctx.fillStyle = 'rgb(196,170,255)'
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        if (p.cls !== 2 || p.alpha <= 0.06) continue
        pctx.globalAlpha = p.alpha * 0.085
        pctx.beginPath()
        pctx.arc(p.x, p.y, p.size * 2.5, 0, TAU)
        pctx.fill()
      }
      pctx.globalAlpha = 1
      pctx.globalCompositeOperation = 'source-over'

      // Cores. Particles are pre-sorted by (class, colour) so fillStyle is
      // assigned a few dozen times per frame instead of ~1500, and alpha
      // rides on globalAlpha rather than a freshly built rgba() string.
      // fillRect for the micro dust: at ~1px a square and a circle are
      // indistinguishable, and it is markedly cheaper.
      let lastFill = ''
      for (let i = 0; i < particles.length; i++) {
        const p = particles[i]
        if (p.alpha <= 0.04) continue
        if (p.fill !== lastFill) {
          pctx.fillStyle = p.fill
          lastFill = p.fill
        }
        pctx.globalAlpha = p.alpha
        if (p.cls === 0) {
          const s = p.size * 1.7
          pctx.fillRect(p.x - s * 0.5, p.y - s * 0.5, s, s)
        } else {
          pctx.beginPath()
          pctx.arc(p.x, p.y, p.size, 0, TAU)
          pctx.fill()
        }
      }
      pctx.globalAlpha = 1
    }

    const tick = (now) => {
      const t = now - startTime
      if (scene.ready) {
        drawGalaxy(t)
        drawParticles(t)
      }
      if (t < PIN_SETTLE_END_MS + 600) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        rafRef.current = null
      }
    }

    const img = new Image()
    img.src = galaxyBg
    const onResize = () => layout(img.complete && img.naturalWidth ? img : null)
    const begin = (decoded) => {
      if (disposed) return
      layout(decoded)
      window.addEventListener('resize', onResize)
    }

    if (img.complete && img.naturalWidth) begin(img)
    else
      img
        .decode()
        .then(() => begin(img))
        .catch(() => begin(null))

    rafRef.current = requestAnimationFrame(tick)

    timersRef.current = [
      setTimeout(() => setStage('decompose'), DECOMP_START_MS),
      setTimeout(() => setStage('coreBurst'), CORE_BURST_MS),
      setTimeout(() => setStage('particlePin'), PARTICLE_PIN_MS),
      setTimeout(() => setStage('pinSvg'), PIN_SVG_START_MS),
      setTimeout(() => setStage('settle'), PIN_SVG_END_MS),
      setTimeout(() => setStage('settled'), PIN_SETTLE_END_MS),
      setTimeout(() => setTextVisible(true), LOADING_TEXT_DELAY_MS),
    ]

    return () => {
      disposed = true
      window.removeEventListener('resize', onResize)
      timersRef.current.forEach(clearTimeout)
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [reducedMotion])

  const pinVisible = stage === 'pinSvg' || stage === 'settle' || stage === 'settled'
  const pinSettled = stage === 'settle' || stage === 'settled'
  // The delay timer alone isn't enough: if the map resolves right around it,
  // the copy would fade in on top of the map crossfade. Only a transition
  // that is genuinely still waiting ever shows it.
  const showText = textVisible && phase === 'holding'

  return (
    <div className="gp-root" data-stage={stage}>
      {!reducedMotion && (
        <>
          <canvas ref={galaxyRef} className="gp-galaxy" aria-hidden="true" />
          <canvas ref={particleRef} className="gp-canvas" aria-hidden="true" />
        </>
      )}
      <div className="gp-pin-wrap">
        <span className="gp-pin" data-visible={pinVisible} data-settled={pinSettled}>
          <HeroPin />
        </span>
      </div>
      <div className="gp-text" data-visible={showText}>
        <p className="gp-title">{TRANSITION_TITLE}</p>
        <span className="gp-hairline" aria-hidden="true" />
      </div>
    </div>
  )
}

// Same path data <PinIcon filled> renders — and the same shape the particle
// mask was rasterized from — but resolved with a violet gradient and a soft
// internal highlight, so it reads as collected light condensing into the icon
// rather than a flat purple fill.
function HeroPin() {
  const { x, y, w, h } = PIN_VIEWBOX
  return (
    <svg viewBox={`${x} ${y} ${w} ${h}`} aria-hidden="true">
      <defs>
        <linearGradient id="gp-pin-grad" x1="0" y1="0" x2="0.35" y2="1">
          <stop offset="0%" stopColor="#c4b1ff" />
          <stop offset="42%" stopColor="#8b5cf6" />
          <stop offset="100%" stopColor="#6d28d9" />
        </linearGradient>
        <radialGradient id="gp-pin-light" cx="0.38" cy="0.3" r="0.75">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.5" />
          <stop offset="45%" stopColor="#c4b5fd" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#6d28d9" stopOpacity="0" />
        </radialGradient>
      </defs>
      <path d={PIN_FILLED_PATH_D} fill="url(#gp-pin-grad)" fillRule="evenodd" clipRule="evenodd" />
      <path d={PIN_FILLED_PATH_D} fill="url(#gp-pin-light)" fillRule="evenodd" clipRule="evenodd" />
    </svg>
  )
}
