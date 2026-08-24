namespace StajProject.Application.Interfaces;

/// <summary>
/// Çağıranın POI kayıtları üzerindeki YETENEKLERİ: hangi yetki kodlarını
/// taşıdığı ve kim olduğu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sahiplik kararı burada verilmez, burada MÜMKÜN kılınır.</b> Kayıt
/// bazındaki "bu POI'ye dokunabilir miyim" sorusunu <see cref="CanUpdate"/> ve
/// <see cref="CanDelete"/> yanıtlar; ikisi de iki ekseni birleştirir — yetki
/// kodu (<c>poi.update</c> / <c>poi.delete</c> / <c>poi.manage</c>) ve kaydın
/// veritabanındaki sahibi. Bir eksen tek başına asla yeterli değildir.
/// </para>
/// <para>
/// <b>Rol adı hiçbir yerde geçmez.</b> "Administrator" ya da "Operatör" gibi
/// adlar bu kararın parçası değildir: bir kullanıcı herkesin kaydını
/// yönetebiliyorsa bunun sebebi taşıdığı <c>poi.manage</c> grant'ıdır.
/// </para>
/// </remarks>
/// <param name="UserId">Doğrulanmış kimlik; kimlik yoksa <c>null</c>.</param>
/// <param name="CanManage"><c>poi.manage</c> — herkesin kaydında tam yetki.</param>
/// <param name="CanUpdateOwn"><c>poi.update</c> — yalnızca kendi kaydında.</param>
/// <param name="CanDeleteOwn"><c>poi.delete</c> — yalnızca kendi kaydında.</param>
public sealed record PoiAuthority(int? UserId, bool CanManage, bool CanUpdateOwn, bool CanDeleteOwn)
{
    /// <summary>Kimliği çözülemeyen çağıran: hiçbir mutasyona yetkisi yoktur.</summary>
    public static readonly PoiAuthority None = new(null, false, false, false);

    /// <summary>Kayıt çağırana mı ait.</summary>
    public bool Owns(int ownerUserId) => UserId is { } id && id == ownerUserId;

    /// <summary>
    /// Güncelleme izni: <c>poi.manage</c> VEYA (sahiplik VE <c>poi.update</c>).
    /// </summary>
    public bool CanUpdate(int ownerUserId) => CanManage || (Owns(ownerUserId) && CanUpdateOwn);

    /// <summary>
    /// Silme/geri yükleme izni: <c>poi.manage</c> VEYA (sahiplik VE
    /// <c>poi.delete</c>). Geri yükleme silmenin tersidir ve aynı yetkiyi
    /// kullanır — kendi sildiğini geri alabilmek ayrı bir otorite değildir.
    /// </summary>
    public bool CanDelete(int ownerUserId) => CanManage || (Owns(ownerUserId) && CanDeleteOwn);
}

/// <summary>
/// Geçerli isteğin POI yetkilerini çözen port.
/// </summary>
/// <remarks>
/// Etkin yetki hesabı tekrarlanmaz: kaynak <see cref="IEffectivePermissionService"/>
/// (rol grant'ları ∪ doğrudan grant'lar) ve kimlik
/// <see cref="ICurrentUserService"/>'tir. Bu port yalnızca ikisini tek bir
/// karar nesnesinde birleştirir, böylece servis katmanı HttpContext'i
/// tanımadan sahiplik kuralını uygulayabilir.
/// </remarks>
public interface IPoiAuthorizationService
{
    Task<PoiAuthority> GetAuthorityAsync(CancellationToken cancellationToken = default);
}
