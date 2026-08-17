import './TextField.css'

/**
 * Labelled input with an optional leading icon and trailing control.
 *
 * States are visually distinct on purpose: normal, hover, focus, disabled and
 * error each look different, and only a genuinely disabled field looks muted.
 * The colours come from the `--field-*` tokens so light and dark each get a
 * palette that suits them.
 *
 * `hint` and `error` are wired to the input through `aria-describedby`, so the
 * requirement text or the failure reason is announced with the field rather
 * than being loose text a screen reader has to stumble across.
 *
 * @param {string} [error] message shown under the field; also marks it invalid
 * @param {React.ReactNode} [hint] helper content shown when there is no error
 */
export default function TextField({
  label,
  icon,
  trailing,
  error,
  hint,
  id,
  className = '',
  ...inputProps
}) {
  const isDisabled = Boolean(inputProps.disabled)
  const hintId = hint && !error ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = errorId ?? hintId

  return (
    <div
      className={[
        'text-field',
        error ? 'text-field--error' : '',
        isDisabled ? 'text-field--disabled' : '',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <label className="text-field-label" htmlFor={id}>
        {label}
      </label>

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
          aria-describedby={describedBy}
          {...inputProps}
        />
        {trailing && <span className="text-field-trailing">{trailing}</span>}
      </span>

      {/* The error replaces the hint rather than stacking under it: two blocks
          of guidance at once is noise at the exact moment the user needs one
          clear instruction. */}
      {error ? (
        <p className="text-field-message text-field-message--error" id={errorId} role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <div className="text-field-message" id={hintId}>
            {hint}
          </div>
        )
      )}
    </div>
  )
}
