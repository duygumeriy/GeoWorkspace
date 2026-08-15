using System.Text.Json.Serialization;

namespace StajProject.Application.DTOs;

/// <summary>
/// <c>POST /api/auth/login</c> ve ikinci adım uçlarının ortak gövdesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Geriye dönük uyumluluk:</b> ikinci faktör gerekmeyen kullanıcı için gövde
/// eskisiyle birebir aynıdır — <c>{ "token": "...", "expiresAt": "..." }</c>.
/// Aşağıdaki 2FA alanları varsayılan değerlerinde serialize EDİLMEZ
/// (<see cref="JsonIgnoreCondition.WhenWritingDefault"/>), dolayısıyla mevcut
/// istemciler için hiçbir şey değişmez.
/// </para>
/// <para>
/// <b>En kritik kural:</b> <see cref="Token"/> ile
/// <see cref="RequiresTwoFactor"/>/<see cref="RequiresTwoFactorSetup"/> asla
/// aynı anda dolu olmaz. İkinci faktör gerekiyorsa bu gövdede <b>hiçbir</b>
/// access token bulunmaz; yalnızca yetkisiz, kısa ömürlü bir challenge döner.
/// </para>
/// </remarks>
public class LoginResponse
{
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Token { get; set; }

    /// <summary>UTC token expiration time.</summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public DateTime? ExpiresAt { get; set; }

    /// <summary>
    /// Şifre doğru; kullanıcının 2FA'sı etkin. İstemci authenticator kodunu
    /// sormalı ve <c>POST /api/auth/login/2fa</c> ile devam etmelidir.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool RequiresTwoFactor { get; set; }

    /// <summary>
    /// Şifre doğru; hesap 2FA'sı zorunlu olan bir Admin ama henüz kurulum
    /// yapmamış. İstemci kurulum akışını başlatmalıdır.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingDefault)]
    public bool RequiresTwoFactorSetup { get; set; }

    /// <summary>
    /// İkinci adıma geçiş bileti. <b>Access token değildir</b>: korumalı
    /// hiçbir uçta Bearer olarak kullanılamaz, kısa ömürlüdür ve yalnızca
    /// üretildiği kullanıcı/amaç için geçerlidir.
    /// </summary>
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ChallengeToken { get; set; }
}
