export default function LassoIcon({ size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      {/* A polygon drawn free-hand around a target: area selection. */}
      <path d="M12 3.5 20 8v8l-8 4.5L4 16V8z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeDasharray="3.5 2.5" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
    </svg>
  )
}
