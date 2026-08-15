import './IconButton.css'

/**
 * Icon-only button. aria-label is required (not optional) since the visible
 * content is a decorative SVG with no accessible name of its own.
 */
export default function IconButton({ label, children, className = '', ...props }) {
  if (import.meta.env.DEV && !label) {
    console.warn('IconButton: missing required "label" prop (used as aria-label).')
  }

  return (
    <button type="button" className={`icon-button ${className}`.trim()} aria-label={label} title={label} {...props}>
      {children}
    </button>
  )
}
