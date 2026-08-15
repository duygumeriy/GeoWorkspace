import { useId } from 'react'
import { COLOR_PRESETS, LINE_STYLES, STYLE_LIMITS, normalizeHex } from '../../map/drawingTypes.js'
import { lineDashFor } from '../../map/featureStyle.js'
import './StyleControls.css'

/**
 * The individual controls of the style editor. Kept separate from the panel
 * shell so the same swatches/sliders can be reused (presets, selected-feature
 * quick edit) without duplicating the ARIA wiring.
 */

/** Preset swatch row plus a native color input for anything else. */
export function ColorField({ label, value, onChange }) {
  const inputId = useId()
  const current = normalizeHex(value)

  return (
    <div className="style-field">
      <span className="style-field-label" id={`${inputId}-label`}>
        {label}
      </span>
      <div className="style-swatches" role="radiogroup" aria-labelledby={`${inputId}-label`}>
        {COLOR_PRESETS.map((preset) => {
          const isActive = current === preset.value
          return (
            <button
              key={preset.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={preset.label}
              title={preset.label}
              className={`style-swatch ${isActive ? 'is-active' : ''}`}
              style={{ '--swatch': preset.value }}
              onClick={() => onChange(preset.value)}
            >
              {/* Active state is a ring + check, never colour alone. */}
              {isActive && (
                <svg viewBox="0 0 24 24" className="style-swatch-check" aria-hidden="true">
                  <path d="M5 12.5 10 17.5 19 7.5" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
          )
        })}

        <label className="style-swatch style-swatch--custom" title="Özel renk">
          <span className="sr-only">Özel renk seç</span>
          <span aria-hidden="true" className="style-swatch-plus">
            +
          </span>
          <input
            type="color"
            value={current ?? '#6D4AFF'}
            onChange={(event) => {
              const hex = normalizeHex(event.target.value)
              if (hex) onChange(hex)
            }}
          />
        </label>
      </div>
      <output className="style-field-value">{current}</output>
    </div>
  )
}

/** Labelled range input with a live value readout. */
export function SliderField({ label, value, min, max, step = 1, suffix = '', onChange, format }) {
  const inputId = useId()
  const display = format ? format(value) : `${value}${suffix}`

  return (
    <div className="style-field">
      <div className="style-field-head">
        <label className="style-field-label" htmlFor={inputId}>
          {label}
        </label>
        <output className="style-field-value" htmlFor={inputId}>
          {display}
        </output>
      </div>
      <input
        id={inputId}
        className="style-slider"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}

export function StrokeWidthField({ value, onChange }) {
  return (
    <SliderField
      label="Çizgi Kalınlığı"
      value={value}
      min={STYLE_LIMITS.strokeWidth.min}
      max={STYLE_LIMITS.strokeWidth.max}
      suffix=" px"
      onChange={onChange}
    />
  )
}

export function PointRadiusField({ value, onChange }) {
  return (
    <SliderField
      label="Nokta Boyutu"
      value={value}
      min={STYLE_LIMITS.pointRadius.min}
      max={STYLE_LIMITS.pointRadius.max}
      suffix=" px"
      onChange={onChange}
    />
  )
}

/** Shown as a percentage, sent to the API as 0–1. */
export function FillOpacityField({ value, onChange }) {
  return (
    <SliderField
      label="Dolgu Opaklığı"
      value={Math.round(value * 100)}
      min={0}
      max={100}
      step={1}
      format={(percent) => `${percent}%`}
      onChange={(percent) => onChange(percent / 100)}
    />
  )
}

/** Visual line-type picker: each option previews its own dash pattern. */
export function LineStyleField({ value, strokeColor, onChange }) {
  const groupId = useId()

  return (
    <div className="style-field">
      <span className="style-field-label" id={groupId}>
        Çizgi Tipi
      </span>
      <div className="style-linestyles" role="radiogroup" aria-labelledby={groupId}>
        {LINE_STYLES.map((option) => {
          const isActive = value === option.id
          const dash = lineDashFor(option.id, 3)

          return (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={option.label}
              title={option.label}
              className={`style-linestyle ${isActive ? 'is-active' : ''}`}
              onClick={() => onChange(option.id)}
            >
              <svg viewBox="0 0 48 12" className="style-linestyle-preview" aria-hidden="true">
                <line
                  x1="3"
                  y1="6"
                  x2="45"
                  y2="6"
                  stroke={strokeColor || 'currentColor'}
                  strokeWidth="3"
                  strokeLinecap={option.id === 'dotted' ? 'round' : 'butt'}
                  strokeDasharray={dash ? dash.join(' ') : undefined}
                />
              </svg>
              <span className="style-linestyle-label">{option.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
