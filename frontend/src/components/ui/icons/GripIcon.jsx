// Altı noktalı taşıma tutamağı. Yalnızca bir AFFORDANCE'tır: anlamı
// düğmenin `aria-label`'ı taşır, bu yüzden erişilebilirlik ağacından gizlidir.
export default function GripIcon({ size = 24, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...props}>
      {[8, 16].map((cx) => (
        [6, 12, 18].map((cy) => (
          <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.6" fill="currentColor" />
        ))
      ))}
    </svg>
  )
}
