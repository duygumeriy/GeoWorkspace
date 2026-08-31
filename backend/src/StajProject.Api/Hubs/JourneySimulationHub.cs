using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;
using StajProject.Application.Interfaces;
using StajProject.Application.Simulation;
using StajProject.Domain.Common;

namespace StajProject.Api.Hubs;

/// <summary>
/// Kişisel yolculuk kanalının İNCE yüzü.
/// </summary>
/// <remarks>
/// <para>
/// <b>Mevcut hat hub'ından AYRIDIR.</b> Paylaşılan hat kanalını yeniden
/// yüklemek, iki farklı yetkilendirme anlamı olan iki ürünü aynı gruplara
/// sokardı: hat yayınını <c>transport.view</c> taşıyan HERKES izleyebilir,
/// kişisel yolculuğu ise YALNIZCA sahibi. Ayrı hub, bir yolculuğun kazara bir
/// hat grubuna katılmasını yapısal olarak imkânsız kılar.
/// </para>
/// <para>
/// <b>Katılım İKİ kapıdan geçer.</b> Önce <c>transport.view</c> etkin yetkisi
/// (bağlantı zaten kimlik doğrulamalıdır), sonra SAHİPLİK. Grup üyeliği bir
/// yetki DEĞİLDİR; adı kimlikten türese de kimin katılabileceğine sahiplik
/// karar verir — aksi hâlde bir GUID tahmin eden biri başkasının konumunu
/// izleyebilirdi.
/// </para>
/// <para>
/// <b>Fail-closed ve bilgi sızdırmaz:</b> "yok" ile "senin değil" aynı ve tek
/// tip cevabı üretir; istemci bir kimliğin gerçekten var olduğunu bu yoldan
/// öğrenemez.
/// </para>
/// </remarks>
[Authorize]
public sealed class JourneySimulationHub : Hub
{
    private const string ForbiddenMessage = "Bu yolculuk simülasyonuna erişiminiz bulunmuyor.";
    private const string InvalidSimulationMessage = "Geçersiz simülasyon kimliği.";

    private readonly IEffectivePermissionService _permissions;
    private readonly IJourneySimulationService _simulations;

    public JourneySimulationHub(
        IEffectivePermissionService permissions,
        IJourneySimulationService simulations)
    {
        _permissions = permissions;
        _simulations = simulations;
    }

    /// <summary>
    /// Yolculuğun yayın grubuna katılır ve GÜNCEL anlık görüntüyü döndürür.
    /// </summary>
    /// <remarks>
    /// Anlık görüntünün katılım yanıtında dönmesi bilinçlidir: yeniden
    /// bağlanan ya da sayfayı yenileyen istemci, bir sonraki tick'i beklemeden
    /// işaretçiyi doğru yerde çizebilir.
    /// </remarks>
    public async Task<JourneySimulationLiveUpdate?> JoinSimulation(Guid simulationId)
    {
        EnsureValidSimulation(simulationId);
        var userId = await EnsureCanViewAsync();

        /* SAHİPLİK gruba eklemeden ÖNCE doğrulanır. Sıra kritiktir: önce
           katılıp sonra denetlemek, denetim başarısız olsa bile bir sonraki
           yayının o bağlantıya ulaşmasına açık kapı bırakırdı. */
        var snapshot = _simulations.FindOwnedLiveUpdate(simulationId, userId);

        if (snapshot is null)
        {
            throw new HubException(ForbiddenMessage);
        }

        await Groups.AddToGroupAsync(
            Context.ConnectionId,
            JourneySimulationHubContract.GroupFor(simulationId),
            Context.ConnectionAborted);

        return snapshot;
    }

    /// <summary>
    /// Gruptan ayrılır.
    /// </summary>
    /// <remarks>
    /// Ayrılmak yetki gerektirmez: yalnızca çağıranın KENDİ bağlantısını
    /// gruptan çıkarır ve hiçbir veriye erişim açmaz.
    /// </remarks>
    public Task LeaveSimulation(Guid simulationId)
    {
        EnsureValidSimulation(simulationId);

        return Groups.RemoveFromGroupAsync(
            Context.ConnectionId,
            JourneySimulationHubContract.GroupFor(simulationId),
            Context.ConnectionAborted);
    }

    private static void EnsureValidSimulation(Guid simulationId)
    {
        if (simulationId == Guid.Empty)
        {
            throw new HubException(InvalidSimulationMessage);
        }
    }

    private async Task<int> EnsureCanViewAsync()
    {
        /* Kimlik projenin mevcut claim sözleşmesinden okunur — aynı değeri
           PermissionAuthorizationHandler ve hat hub'ı da okur. Okunamıyorsa
           karar verilmez: erişim kapalıdır. Rol adı, kullanıcı adı ya da
           IsAdmin hiçbir biçimde okunmaz. */
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
            throw new HubException(ForbiddenMessage);
        }

        return userId;
    }
}
