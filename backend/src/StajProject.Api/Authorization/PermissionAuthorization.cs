using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using StajProject.Application.Interfaces;

namespace StajProject.Api.Authorization;

/// <summary>
/// "Bu istek şu yetkiyi gerektirir" gereksinimi. Taşıdığı tek şey kanonik
/// yetki kodudur.
/// </summary>
/// <remarks>
/// Bilerek yalnızca <see cref="PermissionCode"/> taşır: rol adı, kapsam
/// (OWN/ALL) veya kullanıcıya gösterilen Türkçe ad burada YOKTUR. Kimlik
/// daima teknik koddur — <c>drawings.point.create</c> gibi.
/// </remarks>
public sealed class PermissionRequirement : IAuthorizationRequirement
{
    public PermissionRequirement(string permissionCode)
    {
        if (string.IsNullOrWhiteSpace(permissionCode))
        {
            throw new ArgumentException("Yetki kodu boş olamaz.", nameof(permissionCode));
        }

        PermissionCode = permissionCode;
    }

    public string PermissionCode { get; }
}

/// <summary>
/// Yetki kararını <see cref="IEffectivePermissionService"/>'e devreden handler.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kural burada TEKRARLANMAZ.</b> Handler <c>role_permissions</c> veya
/// <c>user_permissions</c> tablolarını kendisi sorgulamaz; "etkin yetki nedir"
/// sorusunun tek sahibi Phase 2 servisidir. İki ayrı çözüm yeri olsaydı biri
/// zamanla diğerinden sapar ve sessiz bir güvenlik farkı doğardı.
/// </para>
/// <para>
/// <b>Rol adına göre kestirme YOKTUR.</b> Burada <c>IsInRole("Admin")</c>
/// benzeri bir süper kullanıcı geçişi bilinçli olarak bulunmaz. Legacy
/// <c>Admin</c> ve hedef <c>Administrator</c> rolleri yönetim uçlarından
/// geçebiliyorsa bunun sebebi Phase 1'de kendilerine verilmiş 27 yetki
/// satırıdır; adlarının ne olduğu değil. Bir satır silinirse erişim gerçekten
/// kapanır.
/// </para>
/// <para>
/// <b>Fail-closed.</b> Kimlik doğrulanmamışsa, kimlik claim'i yoksa veya
/// sayıya çevrilemiyorsa requirement başarısız sayılır — istisna fırlatılmaz,
/// böylece bir yetki reddi asla 500'e dönüşmez. Karar verilmemiş bir
/// requirement, authorization middleware tarafından reddedilir.
/// </para>
/// </remarks>
public class PermissionAuthorizationHandler : AuthorizationHandler<PermissionRequirement>
{
    private readonly IEffectivePermissionService _permissions;

    public PermissionAuthorizationHandler(IEffectivePermissionService permissions)
    {
        _permissions = permissions;
    }

    protected override async Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        PermissionRequirement requirement)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return;
        }

        /* Kimlik, projenin mevcut claim sözleşmesinden okunur (JwtTokenService
           hem sub hem NameIdentifier yazar; inbound mapping ikisini aynı değere
           getirir). İkinci bir kimlik temsili UYDURULMAZ. */
        var raw = context.User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var userId))
        {
            return;
        }

        // Endpoint routing altında Resource HttpContext'tir; istek iptal
        // edildiğinde yetki sorgusu da boşuna sürmesin.
        var cancellationToken = (context.Resource as HttpContext)?.RequestAborted ?? CancellationToken.None;

        if (await _permissions.HasPermissionAsync(userId, requirement.PermissionCode, cancellationToken))
        {
            context.Succeed(requirement);
        }
    }
}

/// <summary>
/// Endpoint'lerin kullandığı yüz: <c>[RequirePermission(PermissionCodes.DrawingsView)]</c>.
/// </summary>
/// <remarks>
/// <para>
/// <see cref="AuthorizeAttribute"/>'tan türer ve politika adını
/// <see cref="PermissionPolicyProvider.PolicyPrefix"/> ile üretir; böylece her
/// yetki için elle policy tanımlamak gerekmez.
/// </para>
/// <para>
/// <b>Birden çok kez uygulanabilir</b> ve bu durumda hepsi birden aranır (VE):
/// ASP.NET Core aynı endpoint'teki tüm authorization verilerini tek bir
/// politikada birleştirir ve requirement'ların TAMAMI sağlanmak zorundadır.
/// Birden fazla işlemi tek gövdede yapan uçlar (ör. ad + stil + geometry'i
/// birlikte güncelleyen PUT) bu sayede gerçekten gerektirdiği yetkilerin
/// hepsini isteyebilir.
/// </para>
/// </remarks>
[AttributeUsage(AttributeTargets.Class | AttributeTargets.Method, AllowMultiple = true, Inherited = true)]
public sealed class RequirePermissionAttribute : AuthorizeAttribute
{
    public RequirePermissionAttribute(string permissionCode)
        : base(PermissionPolicyProvider.PolicyPrefix + permissionCode)
    {
        PermissionCode = permissionCode;
    }

    public string PermissionCode { get; }
}

/// <summary>
/// <c>Permission:&lt;kod&gt;</c> adlı politikaları üretir; diğer her politikayı
/// ASP.NET Core'un varsayılan sağlayıcısına bırakır.
/// </summary>
/// <remarks>
/// <para>
/// <b>Mevcut politikalar bozulmaz.</b> <c>AuthenticatedUser</c>,
/// <c>AdminOnly</c>, <c>AdminMfaRequired</c> ve <c>MfaRequired</c> hâlâ
/// Program.cs'te tanımlıdır ve buradaki fallback üzerinden çözülür. Bu
/// sağlayıcı yalnızca kendi ön ekini tanır.
/// </para>
/// <para>
/// <b>Katalogda olmayan kod fail-closed'dur.</b> Sağlayıcı kodun gerçekten var
/// olup olmadığına bakmaz — geçerli bir politika üretir ve kararı handler'a
/// bırakır. Hiç kimsede olmayan bir yetki hiç kimseye izin vermez; sonuç 403
/// olur, "tanım bulunamadı" diye 500 DEĞİL.
/// </para>
/// </remarks>
public class PermissionPolicyProvider : IAuthorizationPolicyProvider
{
    /// <summary>Bu sağlayıcıya ayrılmış politika ön eki.</summary>
    public const string PolicyPrefix = "Permission:";

    private readonly DefaultAuthorizationPolicyProvider _fallback;

    public PermissionPolicyProvider(IOptions<AuthorizationOptions> options)
    {
        _fallback = new DefaultAuthorizationPolicyProvider(options);
    }

    public Task<AuthorizationPolicy> GetDefaultPolicyAsync() => _fallback.GetDefaultPolicyAsync();

    public Task<AuthorizationPolicy?> GetFallbackPolicyAsync() => _fallback.GetFallbackPolicyAsync();

    public Task<AuthorizationPolicy?> GetPolicyAsync(string policyName)
    {
        if (!policyName.StartsWith(PolicyPrefix, StringComparison.Ordinal))
        {
            // Bize ait değil: AdminMfaRequired gibi mevcut politikalar buradan geçer.
            return _fallback.GetPolicyAsync(policyName);
        }

        var permissionCode = policyName[PolicyPrefix.Length..];

        if (string.IsNullOrWhiteSpace(permissionCode))
        {
            /* Kodsuz bir yetki politikası bir programlama hatasıdır. İstisna
               fırlatmak isteği 500'e çevirirdi; bunun yerine hiç kimsenin
               geçemeyeceği bir politika döndürülür — hata görünür olur ama
               güvenlik tarafında açık bırakmaz. */
            return Task.FromResult<AuthorizationPolicy?>(
                new AuthorizationPolicyBuilder().RequireAssertion(_ => false).Build());
        }

        var policy = new AuthorizationPolicyBuilder()
            .RequireAuthenticatedUser()
            .AddRequirements(new PermissionRequirement(permissionCode))
            .Build();

        return Task.FromResult<AuthorizationPolicy?>(policy);
    }
}
