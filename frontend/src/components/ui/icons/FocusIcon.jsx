export default function FocusIcon({ size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M4 9V5.4A1.4 1.4 0 0 1 5.4 4H9M15 4h3.6A1.4 1.4 0 0 1 20 5.4V9M20 15v3.6a1.4 1.4 0 0 1-1.4 1.4H15M9 20H5.4A1.4 1.4 0 0 1 4 18.6V15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="9" y="9" width="6" height="6" rx="1.2" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
