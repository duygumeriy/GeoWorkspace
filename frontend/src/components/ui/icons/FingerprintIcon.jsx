export default function FingerprintIcon({ size = 18, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5v2.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path
        d="M12 4.5a7.5 7.5 0 0 0-7.5 7.5v2.2M8.2 20a13 13 0 0 1-.7-4V12a4.5 4.5 0 0 1 9 0v3.2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M12 9.3a2.7 2.7 0 0 0-2.7 2.7v2.3a10 10 0 0 0 1 4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12 9.3a2.7 2.7 0 0 1 2.7 2.7v1.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}
