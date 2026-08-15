import './Button.css'

export default function Button({
  variant = 'primary',
  loading = false,
  children,
  className = '',
  disabled,
  ...props
}) {
  return (
    <button
      className={`ui-button ui-button--${variant} ${loading ? 'is-loading' : ''} ${className}`.trim()}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <span className="ui-button-spinner" aria-hidden="true" />}
      <span className="ui-button-label">{children}</span>
    </button>
  )
}
