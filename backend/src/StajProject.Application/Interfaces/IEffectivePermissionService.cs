namespace StajProject.Application.Interfaces;

/// <summary>
/// Bir kullanıcının o an gerçekten sahip olduğu yetkileri çözen port.
/// </summary>
/// <remarks>
/// <para>
/// <b>Etkin yetki = rolden gelenler ∪ doğrudan verilenler.</b> İki kaynak da
/// veritabanından okunur; hiçbir rol adı özel muamele görmez. "Administrator"
/// 27 yetkiye sahipse bunun sebebi <c>role_permissions</c> satırlarıdır, adının
/// Administrator olması değil.
/// </para>
/// <para>
/// <b>Kaynak daima canlı veritabanıdır.</b> Yetkiler JWT'ye claim olarak
/// yazılmaz: token ömrü boyunca yetki değişebilir ve askıya alınan bir
/// kullanıcının erişimi token'ın süresi dolana kadar sürmemelidir.
/// </para>
/// <para>
/// <b>Kimlik daima <c>Permission.Code</c>'dur.</b> Kullanıcıya gösterilen
/// Türkçe adlar yetkilendirme kararı vermez.
/// </para>
/// <para>
/// Bu port yalnızca "ne yapabilir" sorusunu yanıtlar; "hangi kayıtlar
/// üzerinde" sorusu (kapsam) bilinçli olarak kapsam dışıdır ve sonraki bir
/// fazın konusudur.
/// </para>
/// </remarks>
public interface IEffectivePermissionService
{
    /// <summary>
    /// Kullanıcının etkin yetki kodları. Her kod en fazla bir kez bulunur.
    /// </summary>
    /// <remarks>
    /// Uygulamayı kullanmaya uygun olmayan hesaplar (bulunamayan, silinmiş,
    /// pasif veya <c>Active</c> dışındaki her durum) için <b>boş</b> döner —
    /// hata fırlatılmaz. Yetkilendirme sorusunun güvenli cevabı "hiçbiri"dir.
    /// </remarks>
    Task<IReadOnlyCollection<string>> GetEffectivePermissionCodesAsync(
        int userId,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Kullanıcı belirtilen yetkiye sahip mi?
    /// </summary>
    /// <remarks>
    /// <see cref="GetEffectivePermissionCodesAsync"/> ile <b>birebir aynı</b>
    /// kuralları uygular. Katalogda olmayan bir kod, boş/whitespace bir kod ve
    /// uygun olmayan hesaplar için istisna fırlatmaz, <c>false</c> döner.
    /// </remarks>
    Task<bool> HasPermissionAsync(
        int userId,
        string? permissionCode,
        CancellationToken cancellationToken = default);
}
