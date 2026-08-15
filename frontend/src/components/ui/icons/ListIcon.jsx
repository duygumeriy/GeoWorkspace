export default function ListIcon({ size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M9 6.5h11M9 12h11M9 17.5h11" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
      <circle cx="4.6" cy="6.5" r="1.4" fill="currentColor" />
      <circle cx="4.6" cy="12" r="1.4" fill="currentColor" />
      <circle cx="4.6" cy="17.5" r="1.4" fill="currentColor" />
    </svg>
  )
}
