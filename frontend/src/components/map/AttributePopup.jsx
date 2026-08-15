import { useEffect, useId, useRef, useState } from 'react'
import Button from '../ui/Button.jsx'
import TextField from '../ui/TextField.jsx'
import { COLOR_PRESETS, DRAWING_TYPES, normalizeHex, primaryColorOf } from '../../map/drawingTypes.js'
import './AttributePopup.css'

/** Backend limit (DrawingAttributeValidator.MaxNameLength / EF HasMaxLength). */
const MAX_NAME_LENGTH = 200

/**
 * The attribute dialog that opens the moment a shape is finished (`drawend`).
 *
 * Nothing has been written to the database when this appears: the geometry is
 * sitting on the pending layer, and this form decides whether it becomes a
 * record at all. "Kaydet" sends name + colour + geometry in one request;
 * "İptal" throws the geometry away and leaves the draw tool exactly as it was.
 *
 * The colour offered here is the same preset row the style panel uses, plus a
 * native picker for anything else — one required colour, with the detailed
 * stroke/fill/width controls staying in the style panel where they belong.
 */
export default function AttributePopup({
  open,
  /** `{ type, style }` of the shape awaiting attributes. */
  pending,
  saving = false,
  onSave,
  onCancel,
  /** Live preview on the map as the colour changes. */
  onColorChange,
}) {
  const fieldId = useId()
  const nameInputRef = useRef(null)

  const [name, setName] = useState('')
  const [color, setColor] = useState(COLOR_PRESETS[0].value)
  const [nameError, setNameError] = useState('')

  const typeId = pending?.type ?? null

  // Each new shape starts from a clean form, seeded with the tool's own colour
  // so confirming straight away keeps the style the user was already drawing in.
  useEffect(() => {
    if (!open || !pending) return
    setName('')
    setNameError('')
    setColor(primaryColorOf(pending.style))
    // Focus goes to the name field: it is the one required free-text input.
    nameInputRef.current?.focus()
  }, [open, pending])

  if (!open || !pending) return null

  const type = DRAWING_TYPES[typeId]

  const applyColor = (value) => {
    const hex = normalizeHex(value)
    if (!hex) return
    setColor(hex)
    onColorChange?.(hex)
  }

  const handleSubmit = (event) => {
    event.preventDefault()
    const trimmed = name.trim()

    if (!trimmed) {
      setNameError('İsim zorunludur.')
      nameInputRef.current?.focus()
      return
    }

    onSave?.({ name: trimmed, color })
  }

  return (
    <div className="attribute-scrim" role="presentation">
      <form
        className="attribute-popup"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-title`}
        onSubmit={handleSubmit}
      >
        <header className="attribute-popup-header">
          <h2 className="attribute-popup-title" id={`${fieldId}-title`}>
            {type.label} bilgileri
          </h2>
          <p className="attribute-popup-subtitle">
            Kaydetmeden önce çiziminize bir isim ve renk verin.
          </p>
        </header>

        <TextField
          id={`${fieldId}-name`}
          ref={nameInputRef}
          label="İsim"
          value={name}
          maxLength={MAX_NAME_LENGTH}
          autoComplete="off"
          placeholder={`${type.label} adı`}
          error={nameError}
          onChange={(event) => {
            setName(event.target.value)
            if (nameError) setNameError('')
          }}
        />

        {nameError && (
          <p className="attribute-popup-error" role="alert">
            {nameError}
          </p>
        )}

        <div className="attribute-color">
          <span className="attribute-color-label" id={`${fieldId}-color-label`}>
            Renk
          </span>
          <div className="attribute-color-row" role="radiogroup" aria-labelledby={`${fieldId}-color-label`}>
            {COLOR_PRESETS.map((preset) => {
              const isActive = color === preset.value
              return (
                <button
                  key={preset.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={preset.label}
                  title={preset.label}
                  className={`attribute-swatch ${isActive ? 'is-active' : ''}`}
                  style={{ '--swatch': preset.value }}
                  onClick={() => applyColor(preset.value)}
                >
                  {/* Selected state is a ring + check, never colour alone. */}
                  {isActive && (
                    <svg viewBox="0 0 24 24" className="attribute-swatch-check" aria-hidden="true">
                      <path
                        d="M5 12.5 10 17.5 19 7.5"
                        stroke="currentColor"
                        strokeWidth="3"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              )
            })}

            <label className="attribute-swatch attribute-swatch--custom" title="Özel renk">
              <span className="sr-only">Özel renk seç</span>
              <span aria-hidden="true" className="attribute-swatch-plus">
                +
              </span>
              <input
                type="color"
                value={color}
                onChange={(event) => applyColor(event.target.value)}
              />
            </label>

            <output className="attribute-color-value">{color}</output>
          </div>
        </div>

        <div className="attribute-popup-actions">
          <Button type="button" variant="ghost" onClick={onCancel} className="attribute-popup-button">
            İptal
          </Button>
          <Button type="submit" loading={saving} className="attribute-popup-button">
            Kaydet
          </Button>
        </div>
      </form>
    </div>
  )
}
