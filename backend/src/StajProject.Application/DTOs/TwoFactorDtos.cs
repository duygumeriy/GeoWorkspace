namespace StajProject.Application.DTOs;

/* İki faktörlü doğrulama sözleşmeleri.

   GİZLİLİK KURALI: authenticator anahtarı (SharedKey/AuthenticatorUri) ve
   kurtarma kodları YALNIZCA üretildikleri isteğin cevabında döner. Hiçbir
   listeleme/profil ucu bu alanları taşımaz, hiçbiri loglanmaz. */

/* --- İstekler ------------------------------------------------------------- */

/// <summary>
/// Login'in ikinci adımı. Kimlik request gövdesinden DEĞİL, challenge
/// token'ının içinden çözülür — istemci "hangi kullanıcı" diyemez.
/// </summary>
public class TwoFactorLoginRequest
{
    public string ChallengeToken { get; set; } = string.Empty;

    /// <summary>Authenticator uygulamasındaki 6 haneli kod.</summary>
    public string Code { get; set; } = string.Empty;
}

/// <summary>Authenticator'a erişilemediğinde kullanılan tek kullanımlık kod.</summary>
public class TwoFactorRecoveryLoginRequest
{
    public string ChallengeToken { get; set; } = string.Empty;

    public string RecoveryCode { get; set; } = string.Empty;
}

/// <summary>Zorunlu Admin kurulumunun başlatılması (yalnız challenge ile).</summary>
public class TwoFactorSetupChallengeRequest
{
    public string ChallengeToken { get; set; } = string.Empty;
}

/// <summary>
/// Oturum açmış kullanıcının kurulumu başlatması. JWT tek başına yeterli
/// sayılmaz: hassas bir güvenlik değişikliği olduğu için şifre yeniden istenir.
/// </summary>
public class TwoFactorSetupRequest
{
    public string CurrentPassword { get; set; } = string.Empty;
}

/// <summary>Kurulumun doğrulanıp 2FA'nın etkinleştirilmesi.</summary>
public class TwoFactorEnableRequest
{
    public string Code { get; set; } = string.Empty;
}

/// <summary>
/// 2FA'nın kapatılması. Şifre <b>ve</b> geçerli bir ikinci faktör birlikte
/// istenir: yalnız JWT'si çalınmış bir oturum korumayı kaldıramasın.
/// </summary>
public class TwoFactorDisableRequest
{
    public string CurrentPassword { get; set; } = string.Empty;

    /// <summary>Authenticator kodu; <see cref="RecoveryCode"/> ile alternatiftir.</summary>
    public string? Code { get; set; }

    /// <summary>Telefona erişimi olmayan kullanıcı için tek kullanımlık kod.</summary>
    public string? RecoveryCode { get; set; }
}

/// <summary>Kurtarma kodlarının yenilenmesi; eski set geçersizleşir.</summary>
public class RegenerateRecoveryCodesRequest
{
    public string CurrentPassword { get; set; } = string.Empty;

    public string Code { get; set; } = string.Empty;
}

/* --- Cevaplar ------------------------------------------------------------- */

/// <summary>
/// QR ekranının ihtiyaç duyduğu her şey. Bu gövde SADECE kurulumu yapmakta
/// olan kullanıcının kendi isteğine döner ve saklanmaz.
/// </summary>
public class AuthenticatorSetupResponse
{
    /// <summary>
    /// Manuel giriş anahtarı (Base32, dörtlü gruplar). QR okunamadığında
    /// kullanıcının uygulamaya elle yazması içindir.
    /// </summary>
    public string SharedKey { get; set; } = string.Empty;

    /// <summary>QR koduna gömülecek standart <c>otpauth://totp/...</c> URI'si.</summary>
    public string AuthenticatorUri { get; set; } = string.Empty;

    /// <summary>
    /// Yalnızca zorunlu (bootstrap) kurulum akışında dolu olur ve o akıştaki
    /// bir sonraki adımda kullanılacak <b>yenilenmiş</b> bileti taşır.
    /// </summary>
    /// <remarks>
    /// Yeni authenticator anahtarı üretmek kullanıcının security stamp'ini
    /// yeniler; elindeki bilet o stamp'e bağlı olduğu için doğrulama adımında
    /// reddedilirdi. Kurulum sırasında bileti yenileyerek akış kesintisiz
    /// kalır, stamp bağı da gevşetilmemiş olur.
    /// </remarks>
    public string? ChallengeToken { get; set; }
}

/// <summary>
/// Kurtarma kodları. Yalnızca üretildikleri anda döner; sonradan hiçbir uçtan
/// düz metin olarak okunamaz (Identity yalnızca kullanılabilirliklerini tutar).
/// </summary>
public class RecoveryCodesResponse
{
    public IReadOnlyList<string> RecoveryCodes { get; set; } = [];

    public string Message { get; set; } = string.Empty;
}

/// <summary>
/// Zorunlu Admin kurulumunun sonucu: kurulum doğrulandığı an hem oturum
/// açılır hem de kurtarma kodları bir kez gösterilir. Kullanıcının login
/// ekranına dönüp baştan başlaması gerekmez.
/// </summary>
public class TwoFactorSetupCompletedResponse
{
    public string Token { get; set; } = string.Empty;

    public DateTime ExpiresAt { get; set; }

    public IReadOnlyList<string> RecoveryCodes { get; set; } = [];
}

/// <summary>
/// Kullanıcının kendi 2FA durumu (Ayarlar → Güvenlik ekranı için).
/// Hiçbir sır içermez.
/// </summary>
public class TwoFactorStatusResponse
{
    public bool Enabled { get; set; }

    /// <summary>Admin rolünde 2FA zorunludur ve kapatılamaz.</summary>
    public bool Required { get; set; }

    public int RecoveryCodesLeft { get; set; }
}
