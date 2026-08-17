import { useEffect, useId, useRef, useState } from 'react'
import { MapIcon, CheckIcon } from '../ui/icons/index.js'
import './BasemapSelector.css'

/**
 * Basemap picker, docked in the map's own control stack.
 *
 * It lives on the map rather than in Ayarlar because choosing a background is a
 * map operation, not an application preference — and it is deliberately NOT the
 * "Katmanlar" panel, which switches the data overlays (Noktalar, Çizgiler,
 * Poligonlar) drawn *on top of* whatever is chosen here.
 *
 * One component serves every breakpoint: a popover anchored to the button on
 * desktop and tablet, and a bottom sheet on phones. That is a CSS decision — the
 * markup, the state and the keyboard handling exist once.
 *
 * Accessibility: the trigger is a labelled button reporting `aria-expanded`; the
 * options are a radio group, so the current choice is exposed as `aria-checked`
 * rather than only as an accent colour, and a tick icon repeats it visually.
 * Escape and an outside click both close, and focus returns to the trigger so
 * the keyboard user is not dropped back at the top of the document.
 *
 * @param {string} value id of the selected basemap
 * @param {Array<{id: string, label: string, description: string, swatch: string}>} options
 * @param {(id: string) => void} onChange
 */
export default function BasemapSelector({ value, options, onChange }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const triggerRef = useRef(null)
  const titleId = useId()

  const selected = options.find((option) => option.id === value) ?? options[0]

  useEffect(() => {
    if (!open) return undefined

    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return
      /* Stopped here so the map's global Escape handler does not also fire and
         drop the user's selection or leave a drawing tool while they were only
         dismissing this popover. */
      event.stopPropagation()
      setOpen(false)
      triggerRef.current?.focus()
    }

    const handlePointerDown = (event) => {
      if (!containerRef.current?.contains(event.target)) setOpen(false)
    }

    // Capture phase for the key, so it runs before the page-level handler.
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('mousedown', handlePointerDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true)
      document.removeEventListener('mousedown', handlePointerDown)
    }
  }, [open])

  const choose = (id) => {
    onChange(id)
    setOpen(false)
    triggerRef.current?.focus()
  }

  return (
    <div className="basemap-control" ref={containerRef}>
      <button
        type="button"
        ref={triggerRef}
        className={`quick-action basemap-trigger ${open ? 'is-open' : ''}`}
        aria-label={`Harita altlığı: ${selected?.label ?? 'Standart'}`}
        title="Harita Altlığı"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <MapIcon size={18} />
      </button>

      {open && (
        <>
          {/* Phone-only backdrop behind the bottom sheet. Presentational: the
              outside-click listener above already handles dismissal. */}
          <div className="basemap-scrim" aria-hidden="true" />

          <div className="basemap-popover" role="dialog" aria-labelledby={titleId}>
            <p className="basemap-popover-title" id={titleId}>
              Harita Altlığı
            </p>

            <div className="basemap-options" role="radiogroup" aria-labelledby={titleId}>
              {options.map((option) => {
                const isSelected = option.id === selected?.id

                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    /* Named by the basemap alone. Without this the accessible
                       name would be the label and the description run together
                       ("Uydu Esri World Imagery uydu görüntüsü"), which is a
                       sentence to listen to where a name is wanted; the
                       description is still read from the visible text. */
                    aria-label={option.label}
                    className={`basemap-option ${isSelected ? 'is-selected' : ''}`}
                    onClick={() => choose(option.id)}
                  >
                    {/* Abstract preview: a few CSS gradients rather than real
                        tiles, so opening the picker makes no network request. */}
                    <span
                      className={`basemap-preview basemap-preview--${option.swatch}`}
                      aria-hidden="true"
                    />
                    <span className="basemap-option-text">
                      <span className="basemap-option-label">{option.label}</span>
                      <span className="basemap-option-description">{option.description}</span>
                    </span>
                    <span className="basemap-option-check" aria-hidden="true">
                      {isSelected && <CheckIcon size={14} />}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
