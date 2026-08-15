export default function KeyIcon({ size = 18, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle cx="8.5" cy="8.5" r="4" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M11.4 11.4L19.5 19.5M17 17l2-2M14.5 14.5l1.5-1.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  )
}
