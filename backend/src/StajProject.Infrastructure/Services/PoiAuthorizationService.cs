using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// <see cref="IPoiAuthorizationService"/> gerçekleştirimi: kimlik + etkin
/// yetkiler.
/// </summary>
/// <remarks>
/// Üç yetki TEK bir okumadan çözülür: <c>HasPermissionAsync</c> üç kez
/// çağrılsaydı aynı istek içinde aynı kullanıcının yetki kümesi üç kez
/// hesaplanırdı. Kimlik yoksa <see cref="PoiAuthority.None"/> döner —
/// yetkilendirme sorusunun güvenli cevabı "hiçbiri"dir.
/// </remarks>
public class PoiAuthorizationService : IPoiAuthorizationService
{
    private readonly ICurrentUserService _currentUser;
    private readonly IEffectivePermissionService _permissions;

    public PoiAuthorizationService(ICurrentUserService currentUser, IEffectivePermissionService permissions)
    {
        _currentUser = currentUser;
        _permissions = permissions;
    }

    public async Task<PoiAuthority> GetAuthorityAsync(CancellationToken cancellationToken = default)
    {
        var userId = _currentUser.UserId;

        if (userId is null)
        {
            return PoiAuthority.None;
        }

        var codes = await _permissions.GetEffectivePermissionCodesAsync(userId.Value, cancellationToken);

        return new PoiAuthority(
            userId,
            CanManage: codes.Contains(PermissionCodes.PoiManage),
            CanUpdateOwn: codes.Contains(PermissionCodes.PoiUpdate),
            CanDeleteOwn: codes.Contains(PermissionCodes.PoiDelete));
    }
}
