import './TextField.css'

export default function TextField({
  label,
  icon,
  trailing,
  error,
  id,
  className = '',
  ...inputProps
}) {
  return (
    <label className={`text-field ${error ? 'text-field--error' : ''} ${className}`.trim()} htmlFor={id}>
      <span className="text-field-label">{label}</span>
      <span className="text-field-control">
        {icon && (
          <span className="text-field-icon" aria-hidden="true">
            {icon}
          </span>
        )}
        <input
          id={id}
          className="text-field-input"
          aria-invalid={error ? 'true' : undefined}
          {...inputProps}
        />
        {trailing && <span className="text-field-trailing">{trailing}</span>}
      </span>
    </label>
  )
}
