export default function PaletteIcon({ size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path d="M12 3.2a8.8 8.8 0 0 0 0 17.6c1.3 0 2-.8 2-1.8 0-.6-.3-1-.6-1.4-.3-.4-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8h1.6a4.5 4.5 0 0 0 4.5-4.5c0-3.7-3.9-6.9-8.8-6.9Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="7.6" cy="12.4" r="1.2" fill="currentColor" />
      <circle cx="9.6" cy="8.4" r="1.2" fill="currentColor" />
      <circle cx="14.4" cy="7.6" r="1.2" fill="currentColor" />
    </svg>
  )
}
