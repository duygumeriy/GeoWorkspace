export default function PointIcon({ size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <circle cx="12" cy="12" r="4" fill="currentColor" />
      <circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.6" opacity="0.5" />
    </svg>
  )
}
