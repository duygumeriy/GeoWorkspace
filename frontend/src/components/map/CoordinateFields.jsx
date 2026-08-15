import { useEffect, useState } from 'react'
import { formatCoordinate, isValidLat, isValidLon } from '../../map/geometryEdit.js'

/**
 * One vertex as an editable longitude/latitude pair.
 *
 * ## Why the text is local state
 *
 * The session stores numbers; an input has to hold text. Halfway through typing
 * "-32.8" the value is "-", which is not a number — so the raw string lives here
 * and only parses upward when it is one. Without that, every keystroke would be
 * round-tripped through `Number()` and the minus sign would vanish as the user
 * typed it.
 *
 * The field re-seeds from the session whenever the vertex changes from the
 * outside (a map drag, an undo, an extend) but *not* while it has focus, so an
 * incoming update can never overwrite what is being typed.
 *
 * Values are shown to six decimals — roughly 0.1 m, well past what anyone reads
 * off a map. That is presentation only: the session keeps the full precision the
 * map or the user produced, so re-rendering the panel never nudges a vertex.
 *
 * @param {{ vertex: number[], onChange: (vertex: number[]) => void,
 *           idPrefix: string, disabled?: boolean, compact?: boolean }} props
 */
export default function CoordinateFields({ vertex, onChange, idPrefix, disabled = false, compact = false }) {
  const [lonText, setLonText] = useState(() => formatCoordinate(vertex[0]))
  const [latText, setLatText] = useState(() => formatCoordinate(vertex[1]))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (focused) return
    setLonText(formatCoordinate(vertex[0]))
    setLatText(formatCoordinate(vertex[1]))
  }, [vertex, focused])

  const lonValue = Number(lonText)
  const latValue = Number(latText)
  // An empty or half-typed field is "not valid yet" rather than an error the
  // user has made; either way the save button is what stays disabled.
  const lonOk = lonText.trim() !== '' && isValidLon(lonValue)
  const latOk = latText.trim() !== '' && isValidLat(latValue)

  const push = (nextLon, nextLat) => {
    const lon = Number(nextLon)
    const lat = Number(nextLat)
    // Only complete, in-range pairs reach the session: pushing NaN would put a
    // broken geometry on the map mid-keystroke.
    if (!isValidLon(lon) || !isValidLat(lat)) return
    onChange([lon, lat])
  }

  return (
    <div className={`coord-fields ${compact ? 'coord-fields--compact' : ''}`}>
      <div className="coord-field">
        <label className="coord-label" htmlFor={`${idPrefix}-lon`}>
          Boylam
        </label>
        <input
          id={`${idPrefix}-lon`}
          className={`coord-input ${lonOk ? '' : 'is-invalid'}`}
          type="number"
          inputMode="decimal"
          step="any"
          value={lonText}
          disabled={disabled}
          aria-invalid={!lonOk}
          aria-describedby={lonOk ? undefined : `${idPrefix}-lon-error`}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            // Anything unusable falls back to the stored value, so leaving the
            // field never strands the editor on a coordinate that is not real.
            if (!lonOk) setLonText(formatCoordinate(vertex[0]))
          }}
          onChange={(event) => {
            setLonText(event.target.value)
            push(event.target.value, latText)
          }}
        />
        {!lonOk && (
          <span className="coord-error" id={`${idPrefix}-lon-error`} role="alert">
            -180 ile 180 arasında olmalı
          </span>
        )}
      </div>

      <div className="coord-field">
        <label className="coord-label" htmlFor={`${idPrefix}-lat`}>
          Enlem
        </label>
        <input
          id={`${idPrefix}-lat`}
          className={`coord-input ${latOk ? '' : 'is-invalid'}`}
          type="number"
          inputMode="decimal"
          step="any"
          value={latText}
          disabled={disabled}
          aria-invalid={!latOk}
          aria-describedby={latOk ? undefined : `${idPrefix}-lat-error`}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (!latOk) setLatText(formatCoordinate(vertex[1]))
          }}
          onChange={(event) => {
            setLatText(event.target.value)
            push(lonText, event.target.value)
          }}
        />
        {!latOk && (
          <span className="coord-error" id={`${idPrefix}-lat-error`} role="alert">
            -90 ile 90 arasında olmalı
          </span>
        )}
      </div>
    </div>
  )
}
