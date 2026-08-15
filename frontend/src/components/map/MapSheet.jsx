import { useEffect, useRef } from 'react'
import IconButton from '../ui/IconButton.jsx'
import { CloseIcon } from '../ui/icons/index.js'
import './MapSheet.css'

/**
 * One panel primitive for every map-side surface (style editor, selected
 * feature, layers, drawings).
 *
 * The DOM is identical at all breakpoints and only CSS decides the
 * presentation: a docked card on the right at desktop/tablet sizes, a bottom
 * sheet with a drag handle and safe-area padding on phones. Keeping a single
 * DOM tree means the open/close logic, focus handling and ARIA wiring exist
 * once rather than per breakpoint.
 */
export default function MapSheet({
  open,
  title,
  onClose,
  children,
  footer,
  labelledById,
  className = '',
  tone = 'default',
}) {
  const panelRef = useRef(null)

  // Escape closes the panel wherever focus currently is.
  useEffect(() => {
    if (!open) return undefined
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose?.()
      }
    }
    const node = panelRef.current
    node?.addEventListener('keydown', handleKeyDown)
    return () => node?.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const titleId = labelledById ?? `map-sheet-${title}`

  return (
    <section
      ref={panelRef}
      className={`map-sheet map-sheet--${tone} ${className}`}
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
    >
      {/* Purely decorative on desktop; reads as a grabber on the mobile sheet. */}
      <div className="map-sheet-handle" aria-hidden="true" />

      <header className="map-sheet-header">
        <h2 className="map-sheet-title" id={titleId}>
          {title}
        </h2>
        <IconButton label={`${title} panelini kapat`} className="map-sheet-close" onClick={onClose}>
          <CloseIcon size={18} />
        </IconButton>
      </header>

      <div className="map-sheet-body">{children}</div>

      {footer && <footer className="map-sheet-footer">{footer}</footer>}
    </section>
  )
}
