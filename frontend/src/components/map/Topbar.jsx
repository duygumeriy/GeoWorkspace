import IconButton from '../ui/IconButton.jsx'
import ThemeToggle from '../ui/ThemeToggle.jsx'
import { MenuIcon, ClockIcon, LogoutIcon } from '../ui/icons/index.js'
import './Topbar.css'

/**
 * Harita çalışma alanının üst şeridi.
 *
 * <b>Kimlik ile MARKA ayrılmıştır.</b> Projenin adı ("Staj Harita
 * Uygulaması") kenar çubuğuna aittir ve burada BİR KEZ DAHA yazılmaz; iki
 * yerde birden durduğunda ekranda iki ayrı başlık gibi okunuyordu. Üst şerit
 * kurumsal ATMOSFERİ taşır: arkada Başarsoft afişi, önde denetimler.
 *
 * <b>Afiş bir ARTALANDIR, bir `img` değil.</b> Mutlak konumlu, `aria-hidden`,
 * tıklama geçirgen ve denetimlerin ALTINDA bir katmandır; sağ tarafta
 * denetimler için temiz bir güvenli bölge bırakacak biçimde solar (bkz.
 * Topbar.css). Bu ayrım olmasaydı afiş metni kullanıcı adının ve çıkış
 * düğmesinin altına girerdi — düzeltilen tam olarak buydu.
 */
export default function Topbar({ username, remaining, onLogout, onOpenMobileMenu, mobileMenuOpen }) {
  return (
    <header className="map-topbar">
      <span className="map-topbar-brand-artwork" aria-hidden="true" />

      <div className="map-topbar-left">
        <IconButton
          label="Menüyü aç"
          aria-expanded={mobileMenuOpen}
          className="map-topbar-menu-btn"
          onClick={onOpenMobileMenu}
        >
          <MenuIcon size={20} />
        </IconButton>
      </div>

      <div className="map-topbar-right">
        <ThemeToggle />

        <div className="map-topbar-profile">
          {username && (
            /* Ad kısaltılabildiği için tam hâli `title` ile erişilebilir kalır;
               kısaltma bilgiyi GİZLEMEZ, yalnızca sığdırır. */
            <span className="map-topbar-username" title={username}>{username}</span>
          )}
          {remaining && (
            <span className="map-topbar-timer" aria-label={`Oturum süresi: ${remaining}`} title="Oturum süresi">
              <ClockIcon size={14} />
              {remaining}
            </span>
          )}
          <button type="button" className="map-topbar-logout" onClick={onLogout}>
            <LogoutIcon size={16} />
            <span>Çıkış Yap</span>
          </button>
        </div>
      </div>
    </header>
  )
}
