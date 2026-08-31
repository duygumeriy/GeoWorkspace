using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using StajProject.Application.Interfaces;
using StajProject.Application.Simulation;
using StajProject.Domain.Common;

namespace StajProject.Api.Hubs;

/// <summary>
/// Canlı simülasyon kanalının İNCE yüzü: gruba katıl, gruptan ayrıl.
/// </summary>
/// <remarks>
/// <para>
/// <b>Burada hareket hesaplanmaz.</b> Konum, ilerleme ve yaşam döngüsü
/// sunucudaki runner'ın işidir; hub yalnızca kimin hangi yayını alacağını
/// yönetir ve katılana o anki anlık görüntüyü verir. Ulaşım iş kuralı da
/// içermez.
/// </para>
/// <para>
/// <b>Kimlik doğrulama zorunludur</b> (<see cref="AuthorizeAttribute"/>) ve
/// yetki kararı mevcut ETKİN YETKİ motoruna sorulur. Rol adı, kullanıcı adı,
/// <c>IsAdmin</c> ya da "zaten grupta olması" bir yetki kaynağı DEĞİLDİR:
/// grup üyeliği yayının hedefidir, erişim kararı değil.
/// </para>
/// <para>
/// <b>Neden <c>RequirePermission</c> değil.</b> O attribute bir MVC
/// endpoint'inin authorization politikasıdır ve hub METOTLARINA uygulanmaz
/// (SignalR yalnızca hub/metot düzeyinde <see cref="AuthorizeAttribute"/>
/// politikalarını değerlendirir, üstelik bağlantı kurulurken). Bu yüzden aynı
/// karar, aynı servise (<see cref="IEffectivePermissionService"/>) doğrudan
/// sorulur — ikinci bir yetki kuralı yazılmaz. Kimlik okunamazsa ya da yetki
/// yoksa sonuç FAIL-CLOSED'dur.
/// </para>
/// </remarks>
[Authorize]
public sealed class TransportSimulationHub : Hub
{
    private const string ForbiddenMessage = "Ulaşım simülasyonunu görüntüleme yetkiniz bulunmuyor.";
    private const string InvalidRouteMessage = "Geçersiz rota kimliği.";

    private readonly IEffectivePermissionService _permissions;
    private readonly ITransportSimulationService _simulations;

    public TransportSimulationHub(
        IEffectivePermissionService permissions,
        ITransportSimulationService simulations)
    {
        _permissions = permissions;
        _simulations = simulations;
    }

    /// <summary>
    /// Rotanın yayın grubuna katılır ve varsa GÜNCEL anlık görüntüyü döndürür.
    /// </summary>
    /// <remarks>
    /// Anlık görüntünün katılım yanıtında dönmesi bilinçlidir: geç katılan ya
    /// da yeniden bağlanan istemci, bir sonraki tick'i beklemeden aracı doğru
    /// yerde çizebilir. Çalışan simülasyon yoksa <c>null</c> döner.
    /// </remarks>
    public async Task<TransportSimulationLiveUpdate?> JoinRoute(int routeId)
    {
        EnsureValidRoute(routeId);
        await EnsureCanViewAsync();

        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            TransportSimulationHubContract.GroupFor(routeId),
            Context.ConnectionAborted);

        return _simulations.FindActiveLiveUpdate(routeId);
    }

    /// <summary>
    /// Rotanın yayın grubundan ayrılır.
    /// </summary>
    /// <remarks>
    /// Ayrılmak bir yetki gerektirmez: yalnızca çağıranın KENDİ bağlantısını
    /// gruptan çıkarır ve hiçbir veriye erişim açmaz.
    /// </remarks>
    public Task LeaveRoute(int routeId)
    {
        EnsureValidRoute(routeId);

        return Groups.RemoveFromGroupAsync(
            Context.ConnectionId,
            TransportSimulationHubContract.GroupFor(routeId),
            Context.ConnectionAborted);
    }

    private static void EnsureValidRoute(int routeId)
    {
        if (routeId <= 0)
        {
            throw new HubException(InvalidRouteMessage);
        }
    }

    private async Task EnsureCanViewAsync()
    {
        /* Kimlik, projenin mevcut claim sözleşmesinden okunur — aynı değeri
           PermissionAuthorizationHandler da okur. Okunamıyorsa karar
           verilmez: erişim kapalıdır. */
        var raw = Context.User?.FindFirstValue(ClaimTypes.NameIdentifier);

        if (!int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var userId))
        {
            throw new HubException(ForbiddenMessage);
        }

        if (!await _permissions.HasPermissionAsync(
                userId,
                PermissionCodes.TransportView,
                Context.ConnectionAborted))
        {
            /* İç ayrıntı sızdırmayan tek tip mesaj: istemci "yetkin yok"
               bilgisinden fazlasını öğrenmez. */
            throw new HubException(ForbiddenMessage);
        }
    }
}
