import LoginVisualPane from './LoginVisualPane.jsx'
import GlassPanel from '../components/ui/GlassPanel.jsx'
import LanguagePill from '../components/ui/LanguagePill.jsx'
import { useFixedThemePresentation } from '../styles/theme.jsx'
import './LoginPage.css'
import './AuthShell.css'

/**
 * Shared frame for every auth screen other than login (register, forgot /
 * reset password, e-mail confirmation).
 *
 * It deliberately reuses the login page's own classes — `.login-page`,
 * `.login-card`, `.login-eyebrow` — so these screens inherit that design
 * exactly rather than re-implementing it. The only addition is
 * `.auth-card--compact`, which drops the login card's fixed 740px min-height:
 * these forms are shorter and would otherwise float in an oversized card.
 *
 * <b>`showLanguageSelector`.</b> Dil hapı bu çerçevenin İSTEĞE BAĞLI bir
 * parçasıdır. Varsayılan `true`'dur: kabuk hâlihazırda onu çizen ekranların
 * (şifre sıfırlama, e-posta doğrulama, hesap etkinleştirme) görünümü bu
 * eklemeyle DEĞİŞMEZ. Kayıt ekranı ise açıkça devre dışı bırakır — hap
 * hiçbir şeyi değiştirmediği için orada tutulamayan bir söz veriyordu.
 *
 * Kapatıldığında sarmalayıcı `div` hiç ÇİZİLMEZ; boş bir kap bırakmak, ekran
 * okuyucuda anlamsız bir düğüm ve kaynakta "burada bir şey olmalıydı" izlenimi
 * bırakırdı. Rotaya göre CSS ile gizlemek de bilinçli olarak seçilmedi:
 * görünürlük bir DÜZEN kararıdır ve bileşen sözleşmesinde durmalıdır.
 *
 * @param {boolean} [showLanguageSelector=true] dil hapı çizilsin mi
 */
export default function AuthShell({ eyebrow, title, children, showLanguageSelector = true }) {
  // Same fixed presentation as the login screen this shell borrows its design
  // from; see LoginPage for why these screens are not themeable.
  useFixedThemePresentation('dark')

  return (
    <div className="login-page">
      <div className="login-page-stars" aria-hidden="true" />

      <LoginVisualPane />

      {showLanguageSelector && (
        <div className="login-page-top-controls">
          <LanguagePill />
        </div>
      )}

      <div className="login-form-wrap">
        <GlassPanel className="login-card auth-card--compact" as="div">
          <p className="login-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <span className="login-title-accent" aria-hidden="true" />

          {children}
        </GlassPanel>
      </div>
    </div>
  )
}
