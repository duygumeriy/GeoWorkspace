/** A survey area with the inventory it contains — the Envanter Analizi tool. */
export default function AnalysisIcon({ size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      {/* Dashed boundary: the area is a query, not a saved shape. */}
      <path
        d="M12 3 20.5 9.3 17.3 19.5H6.7L3.5 9.3 12 3Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeDasharray="3 2.4"
        fill="currentColor"
        fillOpacity="0.12"
      />
      {/* The inventory counted inside it. */}
      <circle cx="9.4" cy="11" r="1.5" fill="currentColor" />
      <circle cx="14.6" cy="10" r="1.5" fill="currentColor" />
      <circle cx="12" cy="15.2" r="1.5" fill="currentColor" />
    </svg>
  )
}
