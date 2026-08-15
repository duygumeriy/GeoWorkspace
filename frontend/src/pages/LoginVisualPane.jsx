import earthImage from '../assets/earth-login.jpg'
import PinIcon from '../components/ui/icons/PinIcon.jsx'
import { ShieldIcon } from '../components/ui/icons/index.js'
import './LoginVisualPane.css'

/**
 * Purely decorative — aria-hidden so screen-reader users go straight to the
 * real form. No real map data is shown here, only brand visuals.
 */
export default function LoginVisualPane() {
  return (
    <div className="login-visual-pane" aria-hidden="true">
      <img className="login-visual-earth" src={earthImage} alt="" />
      <div className="login-visual-earth-fade" />

      <div className="login-visual-brand">
        <span className="login-visual-brand-icon">
          <PinIcon size={60} />
        </span>
        <div>
          <p className="login-visual-brand-name">
            <span className="login-visual-brand-accent">Harita</span> Uygulaması
          </p>
          <p className="login-visual-brand-tagline">Akıllı haritalar, güçlü kararlar.</p>
        </div>
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
