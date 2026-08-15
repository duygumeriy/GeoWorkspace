export default function BoxSelectIcon({ size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      {/* Dashed marquee + the two handles that read as "drag a box". */}
      <rect x="4" y="4" width="16" height="16" rx="1.5" stroke="currentColor" strokeWidth="1.6" strokeDasharray="3.5 2.5" />
      <rect x="2.4" y="2.4" width="3.2" height="3.2" rx="0.8" fill="currentColor" />
      <rect x="18.4" y="18.4" width="3.2" height="3.2" rx="0.8" fill="currentColor" />
    </svg>
  )
}
