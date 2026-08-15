export default function LineIcon({ size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M6.5 17.5 17.5 6.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="5.5" cy="18.5" r="2.5" fill="currentColor" />
      <circle cx="18.5" cy="5.5" r="2.5" fill="currentColor" />
    </svg>
  )
}
