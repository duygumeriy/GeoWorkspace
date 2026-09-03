import earthImage from '../assets/earth-login.jpg'
import infomotionLogo from '../assets/brand/infomotion-logo.png'
import { ShieldIcon } from '../components/ui/icons/index.js'
import './LoginVisualPane.css'

/**
 * Kimlik doğrulama ekranlarının SOL görsel yüzeyi.
 *
 * <b>Tek bir yerde durur ve üç ekran onu paylaşır</b> — giriş, `AuthShell`
 * (kayıt, şifre sıfırlama, e-posta doğrulama, hesap etkinleştirme) ve iki
 * aşamalı doğrulama. Ürün kimliğini buraya koymak, onu her ekrana ayrı ayrı
 * kopyalamadan hepsinde aynı anda doğru yapar; kayıt ekranının BAŞARI dalı da
 * aynı kabuğu kullandığı için markalı kalır.
 *
 * <b>Ürün markası SAĞLANAN ÇİZİMDİR</b> (yerel, saydam zeminli PNG; ilk
 * denemedeki SVG geçerli bir belge değildi ve tarayıcıda hiç çizilmiyordu).
 * Eskiden burada bir iğne simgesi, elle yazılmış bir ad ve bir slogan vardı;
 * üçü de kurumsal çizimin içinde zaten mevcut. Metni ayrıca HTML olarak da
 * yazmak sloganı iki kez göstermek olurdu, bu yüzden eski blok kaldırıldı —
 * çizim yeniden üretilmedi, olduğu gibi kullanılıyor.
 *
 * Purely decorative — aria-hidden so screen-reader users go straight to the
 * real form. No real map data is shown here, only brand visuals.
 */
export default function LoginVisualPane() {
  return (
    <div className="login-visual-pane" aria-hidden="true">
      <img className="login-visual-earth" src={earthImage} alt="" />
      <div className="login-visual-earth-fade" />

      <div className="login-visual-brand">
        {/* Çizim ad ve sloganı KENDİSİ taşır; yanına metin eklenmez. */}
        <img
          className="login-visual-brand-logo"
          src={infomotionLogo}
          alt="Info&Motion — Sahadan veriye, veriden harekete."
        />
      </div>

      <div className="login-visual-badge">
        <span className="login-visual-badge-icon">
          <ShieldIcon size={20} />
        </span>
        <div>
          <p className="login-visual-badge-title">Güvenli, hızlı ve modern</p>
          <p className="login-visual-badge-subtitle">Verileriniz en üst düzeyde korunur.</p>
        </div>
      </div>
    </div>
  )
}
