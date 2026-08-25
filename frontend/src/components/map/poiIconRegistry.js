import {
  Armchair,
  BadgeDollarSign,
  Banknote,
  BatteryCharging,
  Building2,
  Car,
  CarFront,
  Castle,
  Church,
  Coffee,
  Dumbbell,
  Factory,
  Gauge,
  GraduationCap,
  Hammer,
  HeartHandshake,
  Hospital,
  House,
  KeyRound,
  Landmark,
  MapPin,
  Monitor,
  Music,
  PartyPopper,
  Pill,
  Plane,
  RadioTower,
  Recycle,
  Route,
  School,
  Shield,
  Shirt,
  ShoppingBag,
  ShoppingBasket,
  ShoppingCart,
  Ship,
  Store,
  Train,
  Trees,
  Users,
  Utensils,
  UtensilsCrossed,
  Wheat,
  Zap,
} from 'lucide-react'

/**
 * `icon_key` → Lucide bileşeni.
 *
 * <b>Bu tablo YALNIZCA bir eşlemedir.</b> Kategori adı, slug'ı ve rengi
 * buraya KOPYALANMAZ — onların tek kaynağı veritabanıdır ve arama yanıtıyla
 * gelirler. Taksonomiyi burada ikinci kez tanımlamak, bir kategori
 * düzenlendiğinde sessizce ayrışan ikinci bir gerçek kaynağı demek olurdu.
 *
 * <b>GeoServer bu dosyayı KULLANMAZ.</b> Sunucu tarafı, Faz 3'te üretilmiş
 * yerel SVG dosyalarını okur (`geoserver/icons/*.svg`) çünkü Batik bir React
 * bileşeni çizemez. İki taraf aynı `icon_key` semantiğini paylaşır, aynı
 * dosyayı değil: frontend'e Lucide, GeoServer'a durağan vektör.
 *
 * Anahtar kümesi backend'deki `PoiCategoryIcons.All` ile aynıdır (44 anahtar).
 */
const ICONS = Object.freeze({
  /* --- Kök / çekirdek ------------------------------------------------------ */
  store: Store,
  'shopping-bag': ShoppingBag,
  zap: Zap,
  'party-popper': PartyPopper,
  house: House,
  landmark: Landmark,
  recycle: Recycle,
  hospital: Hospital,
  'graduation-cap': GraduationCap,
  'radio-tower': RadioTower,
  wheat: Wheat,
  factory: Factory,
  trees: Trees,
  route: Route,
  'building-2': Building2,
  shield: Shield,
  train: Train,
  'badge-dollar-sign': BadgeDollarSign,
  castle: Castle,
  'map-pin': MapPin,
  dumbbell: Dumbbell,
  users: Users,
  'heart-handshake': HeartHandshake,
  utensils: Utensils,
  church: Church,
  plane: Plane,
  ship: Ship,

  /* --- Özel alt kategoriler ------------------------------------------------ */
  banknote: Banknote,
  gauge: Gauge,
  pill: Pill,
  'battery-charging': BatteryCharging,
  school: School,
  car: Car,
  armchair: Armchair,
  'shopping-cart': ShoppingCart,
  shirt: Shirt,
  monitor: Monitor,
  'key-round': KeyRound,
  hammer: Hammer,
  'car-front': CarFront,
  'shopping-basket': ShoppingBasket,

  /* --- Mevcut alt kategoriler ---------------------------------------------- */
  coffee: Coffee,
  'utensils-crossed': UtensilsCrossed,
  music: Music,
})

/**
 * Tanınmayan/boş anahtarda düşülen yedek.
 *
 * Backend'deki `PoiCategoryIcons.Fallback` ile aynı anahtar. Bir simgenin
 * bulunamaması bir satırın ÇİZİLMEMESİNE yol açmamalıdır — göç öncesinden
 * kalan metadatasız bir kategori de listelenebilmelidir.
 */
export const FALLBACK_ICON = MapPin

/** Rengi olmayan/bozuk kayıtların nötr yedeği; `PoiCategoryPalette.Fallback`. */
export const FALLBACK_COLOR = '#64748B'

/**
 * Anahtarın bileşeni; tanınmıyorsa {@link FALLBACK_ICON}.
 *
 * ASLA fırlatmaz ve asla `undefined` döndürmez: bir bileşen bekleyen JSX'e
 * `undefined` vermek React'i render sırasında düşürürdü.
 */
export function iconForKey(iconKey) {
  if (typeof iconKey !== 'string') return FALLBACK_ICON
  return ICONS[iconKey] ?? FALLBACK_ICON
}

/** Anahtar kayıtlı mı (testler ve doğrulama için). */
export function isKnownIconKey(iconKey) {
  return typeof iconKey === 'string' && Object.hasOwn(ICONS, iconKey)
}

/** Kayıtlı anahtarların tamamı. */
export function knownIconKeys() {
  return Object.keys(ICONS)
}

/**
 * Kanonik `#RRGGBB`, yoksa nötr yedek.
 *
 * Sunucu rengi zaten büyük harfe normalize eder; burada yapılan, bozuk ya da
 * eksik bir değerin satırı renksiz/hatalı bırakmasını engellemektir.
 */
export function accentColor(colorHex) {
  if (typeof colorHex !== 'string') return FALLBACK_COLOR
  const trimmed = colorHex.trim()
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toUpperCase() : FALLBACK_COLOR
}
