using System.Globalization;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using StajProject.Application.Interfaces;

namespace StajProject.Infrastructure.Authentication;

/// <summary>
/// <see cref="ITwoFactorChallengeService"/>'in ASP.NET Core Data Protection
/// tabanlı gerçekleştirimi.
/// </summary>
/// <remarks>
/// <para>
/// Bilet, <see cref="ITimeLimitedDataProtector"/> ile şifrelenip imzalanmış
/// opak bir metindir. Üç güvenlik özelliği buradan gelir:
/// </para>
/// <list type="number">
/// <item><b>Kurcalanamaz:</b> içerik authenticated encryption ile korunur;
/// tek karakter değişse çözme başarısız olur.</item>
/// <item><b>Kısa ömürlü:</b> son kullanma tarihi zarfın <i>içindedir</i>,
/// istemci uzatamaz. Süre dolduğunda çözme başarısız olur.</item>
/// <item><b>Access token olamaz:</b> JWT değildir. JwtBearer handler'ı bu
/// biçimi ayrıştıramadığı için <c>Authorization: Bearer &lt;challenge&gt;</c>
/// her korumalı uçta 401 alır — ayrıca bir "bu bir challenge mı" kontrolü
/// yazmaya gerek kalmaz.</item>
/// </list>
/// <para>
/// Purpose ayrımı Data Protection'ın kendi purpose zincirine verilir: farklı
/// amaç = farklı türetilmiş anahtar. Kurulum bileti doğrulama ucunda
/// <i>çözülemez</i> bile; kontrol unutulamaz.
/// </para>
/// </remarks>
public class TwoFactorChallengeService : ITwoFactorChallengeService
{
    /// <summary>
    /// Bilet ömrü. Kullanıcının telefonunu alıp kod girmesine yeter, çalınmış
    /// bir biletin kullanılabileceği pencereyi dar tutar.
    /// </summary>
    private static readonly TimeSpan ChallengeLifetime = TimeSpan.FromMinutes(5);

    /// <summary>
    /// Zarf biçimi sürümü. İleride alan eklenirse eski biletler sessizce
    /// yanlış yorumlanmaz, reddedilir.
    /// </summary>
    private const string PayloadVersion = "v1";

    private const string RootPurpose = "StajProject.TwoFactorChallenge";

    private readonly IDataProtectionProvider _provider;

    public TwoFactorChallengeService(IDataProtectionProvider provider)
    {
        _provider = provider;
    }

    public TimeSpan Lifetime => ChallengeLifetime;

    public string Create(int userId, string securityStamp, TwoFactorChallengePurpose purpose)
    {
        // Security stamp zarfın içinde taşınır: şifre değişimi / 2FA değişimi
        // gibi stamp yenileyen her işlem bekleyen biletleri anında geçersizler.
        var payload = string.Join('|', PayloadVersion, userId.ToString(CultureInfo.InvariantCulture), securityStamp);

        var protectedPayload = ProtectorFor(purpose).Protect(payload, ChallengeLifetime);

        // Base64Url: bilet JSON gövdesinde ve gerekirse URL'de sorunsuz taşınsın.
        return WebEncoders.Base64UrlEncode(System.Text.Encoding.UTF8.GetBytes(protectedPayload));
    }

    public TwoFactorChallenge? Validate(string? challengeToken, TwoFactorChallengePurpose expectedPurpose)
    {
        if (string.IsNullOrWhiteSpace(challengeToken))
        {
            return null;
        }

        string payload;

        try
        {
            var encoded = System.Text.Encoding.UTF8.GetString(WebEncoders.Base64UrlDecode(challengeToken));

            // Unprotect: süresi dolmuş, kurcalanmış veya başka purpose ile
            // üretilmiş biletlerin HEPSİ burada exception ile düşer. Ayrımı
            // dışarı yansıtmıyoruz — hepsi tek tip "geçersiz challenge".
            payload = ProtectorFor(expectedPurpose).Unprotect(encoded);
        }
        catch (Exception)
        {
            // Bilerek geniş: Data Protection kurcalanmış/expired girdilerde
            // CryptographicException, bozuk Base64Url'de FormatException atar.
            // Hiçbiri istisnai bir sistem hatası değil, normal bir reddediştir.
            return null;
        }

        var parts = payload.Split('|');

        if (parts.Length != 3
            || parts[0] != PayloadVersion
            || !int.TryParse(parts[1], NumberStyles.Integer, CultureInfo.InvariantCulture, out var userId))
        {
            return null;
        }

        return new TwoFactorChallenge(userId, parts[2]);
    }

    private ITimeLimitedDataProtector ProtectorFor(TwoFactorChallengePurpose purpose) =>
        _provider.CreateProtector(RootPurpose, purpose.ToString()).ToTimeLimitedDataProtector();
}
