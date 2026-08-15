// Solid fill + true circular cutout (evenodd), sharing the outline's exact
// path data. Used wherever the pin needs to read as a bold silhouette (the
// login -> map hero transition) instead of the thin outline used elsewhere.
export const PIN_FILLED_PATH_D =
  'M12 22s7-7.58 7-12.5A7 7 0 0 0 5 9.5C5 14.42 12 22 12 22Z M14.75,9.5 A2.75,2.75 0 1,0 9.25,9.5 A2.75,2.75 0 1,0 14.75,9.5 Z'

export default function PinIcon({ size = 24, filled = false, ...props }) {
  if (filled) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...props}>
        <path d={PIN_FILLED_PATH_D} fill="currentColor" fillRule="evenodd" clipRule="evenodd" />
      </svg>
    )
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 22s7-7.58 7-12.5A7 7 0 0 0 5 9.5C5 14.42 12 22 12 22Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="9.5" r="2.75" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}
