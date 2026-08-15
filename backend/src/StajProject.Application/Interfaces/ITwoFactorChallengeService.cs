namespace StajProject.Application.Interfaces;

/// <summary>
/// Login'in iki adımı arasındaki geçici bileti üretir ve doğrular.
/// </summary>
/// <remarks>
/// <para>
/// Bu bilet <b>bilinçli olarak JWT DEĞİLDİR</b>. Sebep: JwtBearer handler'ı
/// aynı anahtarla imzalanmış her token'ı kabul eder ve claim'lerine bakarak
/// bir <c>ClaimsPrincipal</c> kurar. Challenge JWT biçiminde olsaydı, onu
/// <c>Authorization: Bearer</c> başlığında gönderen biri — audience/purpose
/// ayrımı bir yerde unutulduğu anda — authenticated sayılabilirdi. Ayrı bir
/// kriptografik zarf (ASP.NET Core Data Protection) kullanıldığında bu risk
/// <i>yapısal olarak</i> ortadan kalkar: bilet JWT formatında bile olmadığı
/// için JwtBearer onu ayrıştıramaz, hiçbir korumalı uçta oturum açamaz.
/// </para>
/// <para>
/// Bilet ayrıca kullanıcının security stamp'ine bağlıdır; şifre değişimi gibi
/// stamp yenileyen bir işlem bekleyen tüm biletleri anında geçersiz kılar.
/// </para>
/// </remarks>
public interface ITwoFactorChallengeService
{
    /// <summary>
    /// Belirli bir kullanıcı ve amaç için kısa ömürlü bilet üretir.
    /// </summary>
    /// <param name="purpose">
    /// Biletin ne için kullanılabileceği. <see cref="TwoFactorChallengePurpose.Verify"/>
    /// ile üretilmiş bir bilet kurulum uçlarında, <see cref="TwoFactorChallengePurpose.Setup"/>
    /// ile üretilmiş bir bilet de doğrulama ucunda kabul edilmez.
    /// </param>
    string Create(int userId, string securityStamp, TwoFactorChallengePurpose purpose);

    /// <summary>
    /// Bileti çözer. Süresi dolmuş, kurcalanmış, farklı amaç için üretilmiş
    /// veya çözülemeyen her durumda <c>null</c> döner — ayrım dışarı sızmaz.
    /// </summary>
    TwoFactorChallenge? Validate(string? challengeToken, TwoFactorChallengePurpose expectedPurpose);

    /// <summary>Biletin geçerlilik süresi; raporlama ve UI metinleri için.</summary>
    TimeSpan Lifetime { get; }
}

/// <summary>
/// Biletin hangi işlemi yapmaya yetkili olduğunu sınırlar. Amaç, kriptografik
/// zarfın <i>içinde</i> taşınır: değiştirilirse imza tutmaz.
/// </summary>
public enum TwoFactorChallengePurpose
{
    /// <summary>Mevcut bir authenticator ile ikinci faktörü doğrulama.</summary>
    Verify,

    /// <summary>
    /// Henüz 2FA'sı olmayan zorunlu-MFA hesabının authenticator kurulumu.
    /// Bu bilet drawing/admin uçlarında değil, yalnız kurulum uçlarında geçer.
    /// </summary>
    Setup
}

/// <summary>Çözülmüş bilet içeriği.</summary>
/// <param name="UserId">Biletin bağlı olduğu kullanıcı.</param>
/// <param name="SecurityStamp">Bilet üretildiği andaki security stamp.</param>
public sealed record TwoFactorChallenge(int UserId, string SecurityStamp);
