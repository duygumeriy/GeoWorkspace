export default function RulerIcon({ size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M3.6 14.2 14.2 3.6l6.2 6.2L9.8 20.4 3.6 14.2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M7.4 10.4 9 12M10.2 7.6l1.6 1.6M13 4.8l1.6 1.6M6.6 13.2l1.6 1.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}
