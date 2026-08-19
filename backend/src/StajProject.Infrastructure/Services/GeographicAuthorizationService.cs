using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using NetTopologySuite.Operation.Union;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Application.Spatial;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Coğrafi yetki alanlarının okunması, yazılması ve kullanıcı için çözülmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Öncelik kuralı: kullanıcının kendi alanı rollerini EZER.</b> Birleştirmek
/// (kullanıcı ∪ roller) ilk bakışta daha "kapsayıcı" görünür ama yöneticinin
/// tek bir kişiyi rolünün altına daraltmasını imkânsız kılardı: Ankara'ya
/// yetkili bir rolün üyesine Kayseri vermek, o kişiye Ankara'yı da bırakırdı.
/// Daraltma yönetimin temel aracıdır; bu yüzden doğrudan alan, mirası tamamen
/// devre dışı bırakır.
/// </para>
/// <para>
/// <b>Roller birleştirilir.</b> Kullanıcının kendi alanı yoksa, ÜYE OLDUĞU TÜM
/// rollerin alanları birleşir — Admin ekranında hangi rolün göründüğü değil,
/// <c>user_roles</c> tablosundaki gerçek üyelikler esastır.
/// </para>
/// </remarks>
public class GeographicAuthorizationService : IGeographicAuthorizationService
{
    private static readonly WKTWriter WktWriter = new();

    private readonly AppDbContext _dbContext;

    public GeographicAuthorizationService(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    /* --- Kullanıcı hedefi ------------------------------------------------------ */

    public async Task<ServiceResult<GeographicAuthorizationResponse>> GetUserAuthorizationAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        if (!await UserExistsAsync(userId, cancellationToken))
        {
            return ServiceResult<GeographicAuthorizationResponse>.NotFound("Kullanıcı bulunamadı.");
        }

        var direct = await _dbContext.GeographicAuthorizations
            .AsNoTracking()
            .SingleOrDefaultAsync(g => g.UserId == userId, cancellationToken);

        var effective = await GetEffectiveAuthorizationAsync(userId, cancellationToken);

        return ServiceResult<GeographicAuthorizationResponse>.Success(Describe(direct?.Area, effective));
    }

    public async Task<ServiceResult<GeographicAuthorizationResponse>> UpsertUserAuthorizationAsync(
        int userId,
        UpdateGeographicAuthorizationRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!await UserExistsAsync(userId, cancellationToken))
        {
            return ServiceResult<GeographicAuthorizationResponse>.NotFound("Kullanıcı bulunamadı.");
        }

        var area = ParseArea(request);

        if (!area.IsSuccess)
        {
            return ServiceResult<GeographicAuthorizationResponse>.Failure(area.Error!);
        }

        var existing = await _dbContext.GeographicAuthorizations
            .SingleOrDefaultAsync(g => g.UserId == userId, cancellationToken);

        Upsert(existing, area.Value!, () => new GeographicAuthorization { UserId = userId });

        await _dbContext.SaveChangesAsync(cancellationToken);

        return await GetUserAuthorizationAsync(userId, cancellationToken);
    }

    public async Task<ServiceResult<GeographicAuthorizationResponse>> DeleteUserAuthorizationAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        if (!await UserExistsAsync(userId, cancellationToken))
        {
            return ServiceResult<GeographicAuthorizationResponse>.NotFound("Kullanıcı bulunamadı.");
        }

        await RemoveAsync(g => g.UserId == userId, cancellationToken);

        /* Kaldırma İDEMPOTENT'tir: alanı zaten olmayan bir hedef için DELETE
           hata değildir. İstenen son durum ("bu kullanıcıya özel alan yok")
           her iki hâlde de sağlanmıştır; 404 döndürmek, iki kez tıklayan
           yöneticiye var olmayan bir sorunu bildirmek olurdu. */
        return await GetUserAuthorizationAsync(userId, cancellationToken);
    }

    /* --- Rol hedefi ------------------------------------------------------------ */

    public async Task<ServiceResult<GeographicAuthorizationResponse>> GetRoleAuthorizationAsync(
        int roleId,
        CancellationToken cancellationToken = default)
    {
        if (!await RoleExistsAsync(roleId, cancellationToken))
        {
            return ServiceResult<GeographicAuthorizationResponse>.NotFound("Rol bulunamadı.");
        }

        var direct = await _dbContext.GeographicAuthorizations
            .AsNoTracking()
            .SingleOrDefaultAsync(g => g.RoleId == roleId, cancellationToken);

        return ServiceResult<GeographicAuthorizationResponse>.Success(DescribeRole(direct?.Area));
    }

    public async Task<ServiceResult<GeographicAuthorizationResponse>> UpsertRoleAuthorizationAsync(
        int roleId,
        UpdateGeographicAuthorizationRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!await RoleExistsAsync(roleId, cancellationToken))
        {
            return ServiceResult<GeographicAuthorizationResponse>.NotFound("Rol bulunamadı.");
        }

        var area = ParseArea(request);

        if (!area.IsSuccess)
        {
            return ServiceResult<GeographicAuthorizationResponse>.Failure(area.Error!);
        }

        var existing = await _dbContext.GeographicAuthorizations
            .SingleOrDefaultAsync(g => g.RoleId == roleId, cancellationToken);

        Upsert(existing, area.Value!, () => new GeographicAuthorization { RoleId = roleId });

        await _dbContext.SaveChangesAsync(cancellationToken);

        return await GetRoleAuthorizationAsync(roleId, cancellationToken);
    }

    public async Task<ServiceResult<GeographicAuthorizationResponse>> DeleteRoleAuthorizationAsync(
        int roleId,
        CancellationToken cancellationToken = default)
    {
        if (!await RoleExistsAsync(roleId, cancellationToken))
        {
            return ServiceResult<GeographicAuthorizationResponse>.NotFound("Rol bulunamadı.");
        }

        await RemoveAsync(g => g.RoleId == roleId, cancellationToken);

        return await GetRoleAuthorizationAsync(roleId, cancellationToken);
    }

    /* --- Çözüm ----------------------------------------------------------------- */

    public async Task<EffectiveGeographicAuthorization> GetEffectiveAuthorizationAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        /* Sorgu sayısı SABİTTİR: en fazla iki. Rol başına bir sorgu açmak,
           çok rollü bir kullanıcıda her çizim isteğini N+1'e çevirirdi. */
        var direct = await _dbContext.GeographicAuthorizations
            .AsNoTracking()
            .Where(g => g.UserId == userId)
            .Select(g => g.Area)
            .SingleOrDefaultAsync(cancellationToken);

        if (direct is not null)
        {
            // Doğrudan alan varken roller HİÇ okunmaz: sonucu değiştiremezler.
            return EffectiveGeographicAuthorization.Restricted(direct);
        }

        var roleAreas = await (
            from userRole in _dbContext.UserRoles
            join scope in _dbContext.GeographicAuthorizations on userRole.RoleId equals scope.RoleId
            where userRole.UserId == userId
            select scope.Area)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        return roleAreas.Count switch
        {
            // Ne kendi alanı ne rol alanı: kısıt YOK. Bu, alan tanımlanmamış
            // mevcut kurulumların davranışını olduğu gibi korur.
            0 => EffectiveGeographicAuthorization.Unrestricted,
            1 => EffectiveGeographicAuthorization.Restricted(roleAreas[0]),
            _ => EffectiveGeographicAuthorization.Restricted(Union(roleAreas))
        };
    }

    /* --- Yardımcılar ------------------------------------------------------------ */

    /// <summary>
    /// Alanların gerçek mekânsal birleşimi.
    /// </summary>
    /// <remarks>
    /// NetTopologySuite'in kaskad birleşimi kullanılır. Halkaları uç uca
    /// eklemek ya da kapsayan dikdörtgenleri birleştirmek DEĞİLDİR: ikisi de
    /// hiçbir alanın kapsamadığı boşlukları izinliymiş gibi gösterirdi. Kopuk
    /// alanların birleşimi doğal olarak MultiPolygon üretir ve aradaki boşluk
    /// izinsiz kalır.
    /// </remarks>
    private static Geometry Union(IReadOnlyCollection<Polygon> areas) =>
        UnaryUnionOp.Union([.. areas]);

    private static ServiceResult<Polygon> ParseArea(UpdateGeographicAuthorizationRequest? request) =>
        /* Doğrulama çizim uçlarıyla AYNI parser'dan geçer: tip, boşluk, SRID,
           koordinat aralığı ve topolojik geçerlilik tek bir yerde tanımlıdır.
           Buraya ikinci bir ayrıştırma yazmak, iki yolun zamanla ayrışması
           demekti — geçersiz bir poligon çizim olarak reddedilirken yetki alanı
           olarak kabul edilebilirdi. */
        WktGeometryParser.Parse<Polygon>(request?.Wkt);

    private void Upsert(GeographicAuthorization? existing, Polygon area, Func<GeographicAuthorization> create)
    {
        var utcNow = DateTime.UtcNow;

        if (existing is null)
        {
            var added = create();
            added.Area = area;
            added.CreatedDate = utcNow;
            added.ModifiedDate = utcNow;
            _dbContext.GeographicAuthorizations.Add(added);
            return;
        }

        // Aynı satır güncellenir; ikinci bir satır açmak hedef başına teklik
        // kuralını (ve veritabanı indeksini) ihlal ederdi.
        existing.Area = area;
        existing.ModifiedDate = utcNow;
    }

    private async Task RemoveAsync(
        System.Linq.Expressions.Expression<Func<GeographicAuthorization, bool>> predicate,
        CancellationToken cancellationToken)
    {
        var existing = await _dbContext.GeographicAuthorizations.SingleOrDefaultAsync(predicate, cancellationToken);

        if (existing is null)
        {
            return;
        }

        _dbContext.GeographicAuthorizations.Remove(existing);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private static GeographicAuthorizationResponse Describe(
        Polygon? direct,
        EffectiveGeographicAuthorization effective) =>
        new()
        {
            HasDirectAuthorization = direct is not null,
            Wkt = direct is null ? null : WktWriter.Write(direct),
            IsRestricted = effective.IsRestricted,
            EffectiveWkt = effective.AllowedArea is null ? null : WktWriter.Write(effective.AllowedArea)
        };

    /// <summary>
    /// Rol için kendi alanı ile yürürlükteki alan daima aynıdır: bir rol başka
    /// bir yerden alan devralmaz.
    /// </summary>
    private static GeographicAuthorizationResponse DescribeRole(Polygon? direct) =>
        new()
        {
            HasDirectAuthorization = direct is not null,
            Wkt = direct is null ? null : WktWriter.Write(direct),
            IsRestricted = direct is not null,
            EffectiveWkt = direct is null ? null : WktWriter.Write(direct)
        };

    /* Kullanıcı VARLIĞI sorulur, "yetki alabilir mi" değil: soft delete edilmiş
       ya da askıya alınmış bir hesabın alanı yönetici tarafından hâlâ
       görüntülenebilmeli ve düzenlenebilmelidir. Hesabın erişimi zaten etkin
       yetki tarafında kapatılır. */
    private Task<bool> UserExistsAsync(int userId, CancellationToken cancellationToken) =>
        _dbContext.Users.AsNoTracking().AnyAsync(u => u.Id == userId, cancellationToken);

    private Task<bool> RoleExistsAsync(int roleId, CancellationToken cancellationToken) =>
        _dbContext.Roles.AsNoTracking().AnyAsync(r => r.Id == roleId, cancellationToken);
}
