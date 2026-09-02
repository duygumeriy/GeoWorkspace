/**
 * Yolculuk Merkezi'nin kenar çubuğu simgesi: iki uç ve aralarındaki güzergah.
 *
 * Kenar çubuğu KENDİ simge kümesini kullanır (aynı görünüm alanı, aynı çizgi
 * kalınlığı); harita panellerindeki lucide simgelerinden birini buraya almak,
 * tek bir gezinme listesinde iki farklı çizim dili demekti. Bu yüzden yeni bir
 * kütüphane eklenmez, kümeye tek bir simge eklenir.
 */
export default function RouteIcon({ size = 20, ...props }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" {...props}>
      <path
        d="M7 18.5h6.5a3.5 3.5 0 0 0 0-7h-3a3.5 3.5 0 0 1 0-7H17"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="5.5" cy="18.5" r="2.5" fill="currentColor" />
      <circle cx="18.5" cy="4.5" r="2.5" fill="currentColor" />
    </svg>
  )
}
