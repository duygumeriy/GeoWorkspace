using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using NetTopologySuite.Operation.Union;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Application.Spatial;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Coğrafi yetki alanlarının okunması, yazılması ve kullanıcı için çözülmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Öncelik kuralı: kullanıcının kendi alanları rollerini EZER.</b>
/// Birleştirmek (kullanıcı ∪ roller) ilk bakışta daha "kapsayıcı" görünür ama
/// yöneticinin tek bir kişiyi rolünün altına daraltmasını imkânsız kılardı:
/// Ankara'ya yetkili bir rolün üyesine Kayseri vermek, o kişiye Ankara'yı da
/// bırakırdı. Daraltma yönetimin temel aracıdır; bu yüzden doğrudan alanların
/// VARLIĞI mirası tamamen devre dışı bırakır — sayıları kaç olursa olsun.
/// </para>
/// <para>
/// <b>Çok alan, tek kural.</b> (Phase 9) Hem kullanıcının kendi alanları hem
/// rollerinin alanları artık birden çok olabilir. Kural değişmedi, yalnızca
/// "tek alan" yerine "alanların birleşimi" okunur hâle geldi.
/// </para>
/// <para>
/// <b>Roller birleştirilir.</b> Kullanıcının kendi alanı yoksa, ÜYE OLDUĞU TÜM
/// rollerin TÜM alanları birleşir — Admin ekranında hangi rolün göründüğü
/// değil, <c>user_roles</c> tablosundaki gerçek üyelikler esastır.
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

    /* --- Kullanıcı hedefi: çoklu alan ------------------------------------------ */

    public async Task<ServiceResult<GeographicAreasResponse>> GetUserAreasAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        if (!await UserExistsAsync(userId, cancellationToken))
        {
            return NotFoundUser();
        }

        return ServiceResult<GeographicAreasResponse>.Success(
            await DescribeUserAsync(userId, cancellationToken));
    }

    public async Task<ServiceResult<GeographicAreasResponse>> CreateUserAreaAsync(
        int userId,
        SaveGeographicAreaRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!await UserExistsAsync(userId, cancellationToken))
        {
            return NotFoundUser();
        }

        var draft = ParseDraft(request);

        if (!draft.IsSuccess)
        {
            return ServiceResult<GeographicAreasResponse>.Failure(draft.Error!);
        }

        /* EKLEME, DEĞİŞTİRME DEĞİLDİR. Var olan satırlara hiç dokunulmaz —
           Phase 8A'nın upsert davranışını burada sürdürmek, "ikinci bölge
           ekle" isteğini sessizce "birinci bölgeyi sil" hâline getirirdi. */
        _dbContext.GeographicAuthorizations.Add(NewRow(draft.Value!, row => row.UserId = userId));

        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<GeographicAreasResponse>.Success(
            await DescribeUserAsync(userId, cancellationToken));
    }

    public async Task<ServiceResult<GeographicAreasResponse>> UpdateUserAreaAsync(
        int userId,
        int areaId,
        SaveGeographicAreaRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!await UserExistsAsync(userId, cancellationToken))
        {
            return NotFoundUser();
        }

        var draft = ParseDraft(request);

        if (!draft.IsSuccess)
        {
            return ServiceResult<GeographicAreasResponse>.Failure(draft.Error!);
        }

        /* Alan HEDEFİYLE BİRLİKTE aranır. Yalnızca id ile aramak, başka bir
           kullanıcının alanının kimliğini tahmin eden bir isteğin o alanı
           düzenlemesine izin verirdi — rotadaki kullanıcı id'si de doğru
           olduğu hâlde. */
        var existing = await _dbContext.GeographicAuthorizations
            .SingleOrDefaultAsync(g => g.Id == areaId && g.UserId == userId, cancellationToken);

        if (existing is null)
        {
            return NotFoundArea();
        }

        Apply(existing, draft.Value!);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<GeographicAreasResponse>.Success(
            await DescribeUserAsync(userId, cancellationToken));
    }

    public async Task<ServiceResult<GeographicAreasResponse>> DeleteUserAreaAsync(
        int userId,
        int areaId,
        CancellationToken cancellationToken = default)
    {
        if (!await UserExistsAsync(userId, cancellationToken))
        {
            return NotFoundUser();
        }

        var removed = await RemoveAsync(g => g.Id == areaId && g.UserId == userId, cancellationToken);

        if (!removed)
        {
            return NotFoundArea();
        }

        return ServiceResult<GeographicAreasResponse>.Success(
            await DescribeUserAsync(userId, cancellationToken));
    }

    /* --- Rol hedefi: çoklu alan ------------------------------------------------ */

    public async Task<ServiceResult<GeographicAreasResponse>> GetRoleAreasAsync(
        int roleId,
        CancellationToken cancellationToken = default)
    {
        if (!await RoleExistsAsync(roleId, cancellationToken))
        {
            return NotFoundRole();
        }

        return ServiceResult<GeographicAreasResponse>.Success(
            await DescribeRoleAsync(roleId, cancellationToken));
    }

    public async Task<ServiceResult<GeographicAreasResponse>> CreateRoleAreaAsync(
        int roleId,
        SaveGeographicAreaRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!await RoleExistsAsync(roleId, cancellationToken))
        {
            return NotFoundRole();
        }

        var draft = ParseDraft(request);

        if (!draft.IsSuccess)
        {
            return ServiceResult<GeographicAreasResponse>.Failure(draft.Error!);
        }

        _dbContext.GeographicAuthorizations.Add(NewRow(draft.Value!, row => row.RoleId = roleId));

        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<GeographicAreasResponse>.Success(
            await DescribeRoleAsync(roleId, cancellationToken));
    }

    public async Task<ServiceResult<GeographicAreasResponse>> UpdateRoleAreaAsync(
        int roleId,
        int areaId,
        SaveGeographicAreaRequest request,
        CancellationToken cancellationToken = default)
    {
        if (!await RoleExistsAsync(roleId, cancellationToken))
        {
            return NotFoundRole();
        }

        var draft = ParseDraft(request);

        if (!draft.IsSuccess)
        {
            return ServiceResult<GeographicAreasResponse>.Failure(draft.Error!);
        }

        var existing = await _dbContext.GeographicAuthorizations
            .SingleOrDefaultAsync(g => g.Id == areaId && g.RoleId == roleId, cancellationToken);

        if (existing is null)
        {
            return NotFoundArea();
        }

        Apply(existing, draft.Value!);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<GeographicAreasResponse>.Success(
            await DescribeRoleAsync(roleId, cancellationToken));
    }

    public async Task<ServiceResult<GeographicAreasResponse>> DeleteRoleAreaAsync(
        int roleId,
        int areaId,
        CancellationToken cancellationToken = default)
    {
        if (!await RoleExistsAsync(roleId, cancellationToken))
        {
            return NotFoundRole();
        }

        var removed = await RemoveAsync(g => g.Id == areaId && g.RoleId == roleId, cancellationToken);

        if (!removed)
        {
            return NotFoundArea();
        }

        return ServiceResult<GeographicAreasResponse>.Success(
            await DescribeRoleAsync(roleId, cancellationToken));
    }

    /* --- Çözüm ----------------------------------------------------------------- */

    public async Task<EffectiveGeographicAuthorization> GetEffectiveAuthorizationAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        /* Sorgu sayısı SABİTTİR: en fazla iki. Rol başına ya da alan başına bir
           sorgu açmak, çok rollü/çok alanlı bir kullanıcıda her çizim isteğini
           N+1'e çevirirdi. */
        var direct = await _dbContext.GeographicAuthorizations
            .AsNoTracking()
            .Where(g => g.UserId == userId)
            .Select(g => g.Area)
            .ToListAsync(cancellationToken);

        if (direct.Count > 0)
        {
            // Doğrudan alan varken roller HİÇ okunmaz: sonucu değiştiremezler.
            return Restrict(direct);
        }

        var roleAreas = await (
            from userRole in _dbContext.UserRoles
            join scope in _dbContext.GeographicAuthorizations on userRole.RoleId equals scope.RoleId
            where userRole.UserId == userId
            select scope.Area)
            .AsNoTracking()
            .ToListAsync(cancellationToken);

        // Ne kendi alanı ne rol alanı: kısıt YOK. Bu, alan tanımlanmamış
        // mevcut kurulumların davranışını olduğu gibi korur.
        return roleAreas.Count == 0
            ? EffectiveGeographicAuthorization.Unrestricted
            : Restrict(roleAreas);
    }

    public async Task<IReadOnlyList<EffectiveGeographicAreaSource>> GetEffectiveAreaSourcesAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        /* Geometri çözümüyle AYNI öncelik: tek bir doğrudan satır bile
           varsa rol kaynakları kataloğa karışmaz. Bu, katalog için ikinci
           bir "kullanıcı ∪ rol" yetki modeli kurulmasını engeller. */
        var direct = await _dbContext.GeographicAuthorizations
            .AsNoTracking()
            .Where(g => g.UserId == userId)
            .OrderBy(g => g.Id)
            .Select(g => new EffectiveGeographicAreaSource(g.SourceType, g.SourceKey))
            .ToListAsync(cancellationToken);

        if (direct.Count > 0)
        {
            return direct;
        }

        return await (
            from userRole in _dbContext.UserRoles
            join area in _dbContext.GeographicAuthorizations on userRole.RoleId equals area.RoleId
            where userRole.UserId == userId
            orderby area.Id
            select new EffectiveGeographicAreaSource(area.SourceType, area.SourceKey))
            .AsNoTracking()
            .ToListAsync(cancellationToken);
    }

    public async Task<SelfGeographicScopeResponse> GetSelfScopeAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        /* Kaynak, çizim uçlarının kullandığı ÇÖZÜMÜN TA KENDİSİDİR. Haritanın
           gösterdiği sınır ile sunucunun uyguladığı sınırın ayrışabileceği
           ikinci bir hesap yolu bilinçli olarak açılmaz. */
        var effective = await GetEffectiveAuthorizationAsync(userId, cancellationToken);

        return new SelfGeographicScopeResponse
        {
            IsRestricted = effective.IsRestricted,
            EffectiveWkt = effective.AllowedArea is null ? null : WktWriter.Write(effective.AllowedArea),
            AreaCount = await SelfAreaCountAsync(userId, cancellationToken)
        };
    }

    /* --- Uyumluluk: tekil alan sözleşmesi (Phase 8A) ---------------------------- */

    public async Task<ServiceResult<GeographicAuthorizationResponse>> GetUserAuthorizationAsync(
        int userId,
        CancellationToken cancellationToken = default)
    {
        if (!await UserExistsAsync(userId, cancellationToken))
        {
            return ServiceResult<GeographicAuthorizationResponse>.NotFound("Kullanıcı bulunamadı.");
        }

        var direct = await DirectAreasAsync(g => g.UserId == userId, cancellationToken);
        var effective = await GetEffectiveAuthorizationAsync(userId, cancellationToken);

        return ServiceResult<GeographicAuthorizationResponse>.Success(new GeographicAuthorizationResponse
        {
            HasDirectAuthorization = direct.Count > 0,
            // Tekil sözleşme tek bir WKT taşır: çok alanlı hedefte birleşim.
            Wkt = direct.Count == 0 ? null : WktWriter.Write(UnionOf(direct)),
            IsRestricted = effective.IsRestricted,
            EffectiveWkt = effective.AllowedArea is null ? null : WktWriter.Write(effective.AllowedArea)
        });
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

        var area = ParseArea(request?.Wkt);

        if (!area.IsSuccess)
        {
            return ServiceResult<GeographicAuthorizationResponse>.Failure(area.Error!);
        }

        await ReplaceAllAsync(g => g.UserId == userId, area.Value!, row => row.UserId = userId, cancellationToken);

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

        await RemoveAllAsync(g => g.UserId == userId, cancellationToken);

        /* Kaldırma İDEMPOTENT'tir: alanı zaten olmayan bir hedef için DELETE
           hata değildir. İstenen son durum ("bu kullanıcıya özel alan yok")
           her iki hâlde de sağlanmıştır; 404 döndürmek, iki kez tıklayan
           yöneticiye var olmayan bir sorunu bildirmek olurdu. */
        return await GetUserAuthorizationAsync(userId, cancellationToken);
    }

    public async Task<ServiceResult<GeographicAuthorizationResponse>> GetRoleAuthorizationAsync(
        int roleId,
        CancellationToken cancellationToken = default)
    {
        if (!await RoleExistsAsync(roleId, cancellationToken))
        {
            return ServiceResult<GeographicAuthorizationResponse>.NotFound("Rol bulunamadı.");
        }

        var direct = await DirectAreasAsync(g => g.RoleId == roleId, cancellationToken);
        var wkt = direct.Count == 0 ? null : WktWriter.Write(UnionOf(direct));

        /* Rol için kendi alanı ile yürürlükteki alan daima aynıdır: bir rol
           başka bir yerden alan devralmaz. */
        return ServiceResult<GeographicAuthorizationResponse>.Success(new GeographicAuthorizationResponse
        {
            HasDirectAuthorization = direct.Count > 0,
            Wkt = wkt,
            IsRestricted = direct.Count > 0,
            EffectiveWkt = wkt
        });
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

        var area = ParseArea(request?.Wkt);

        if (!area.IsSuccess)
        {
            return ServiceResult<GeographicAuthorizationResponse>.Failure(area.Error!);
        }

        await ReplaceAllAsync(g => g.RoleId == roleId, area.Value!, row => row.RoleId = roleId, cancellationToken);

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

        await RemoveAllAsync(g => g.RoleId == roleId, cancellationToken);

        return await GetRoleAuthorizationAsync(roleId, cancellationToken);
    }

    /* --- Alan taslağı ----------------------------------------------------------- */

    /// <summary>Doğrulanmış, yazılmaya hazır alan verisi.</summary>
    private sealed record AreaDraft(Polygon Area, string Name, GeographicAreaSource SourceType, string? SourceKey);

    private static ServiceResult<AreaDraft> ParseDraft(SaveGeographicAreaRequest? request)
    {
        var area = ParseArea(request?.Wkt);

        if (!area.IsSuccess)
        {
            return ServiceResult<AreaDraft>.Failure(area.Error!);
        }

        var source = request?.SourceType ?? GeographicAreaSource.ManualPolygon;

        var name = (request?.Name ?? string.Empty).Trim();

        if (name.Length == 0)
        {
            /* Adsız alana izin verilir ve kaynağından okunabilir bir ad
               üretilir. Zorunlu kılmak, "hızlıca bir alan daha ekle" akışını
               bir form doldurma adımına çevirirdi; ad zaten yetkilendirmeyi
               etkilemez. */
            name = DefaultName(source);
        }

        if (name.Length > GeographicAuthorization.MaxNameLength)
        {
            return ServiceResult<AreaDraft>.Failure(
                $"Alan adı en fazla {GeographicAuthorization.MaxNameLength} karakter olabilir.");
        }

        var sourceKey = string.IsNullOrWhiteSpace(request?.SourceKey) ? null : request!.SourceKey!.Trim();

        if (sourceKey is not null && sourceKey.Length > GeographicAuthorization.MaxSourceKeyLength)
        {
            return ServiceResult<AreaDraft>.Failure(
                $"Kaynak anahtarı en fazla {GeographicAuthorization.MaxSourceKeyLength} karakter olabilir.");
        }

        return ServiceResult<AreaDraft>.Success(new AreaDraft(area.Value!, name, source, sourceKey));
    }

    private static string DefaultName(GeographicAreaSource source) => source switch
    {
        GeographicAreaSource.Province => "İl alanı",
        GeographicAreaSource.Region => "Bölge alanı",
        GeographicAreaSource.Coordinates => "Koordinatlı alan",
        _ => "Çizilen alan"
    };

    private static ServiceResult<Polygon> ParseArea(string? wkt) =>
        /* Doğrulama çizim uçlarıyla AYNI parser'dan geçer: tip, boşluk, SRID,
           koordinat aralığı ve topolojik geçerlilik tek bir yerde tanımlıdır.
           Buraya ikinci bir ayrıştırma yazmak, iki yolun zamanla ayrışması
           demekti — geçersiz bir poligon çizim olarak reddedilirken yetki alanı
           olarak kabul edilebilirdi. */
        WktGeometryParser.Parse<Polygon>(wkt);

    private static GeographicAuthorization NewRow(AreaDraft draft, Action<GeographicAuthorization> setTarget)
    {
        var utcNow = DateTime.UtcNow;
        var row = new GeographicAuthorization
        {
            Area = draft.Area,
            Name = draft.Name,
            SourceType = draft.SourceType,
            SourceKey = draft.SourceKey,
            CreatedDate = utcNow,
            ModifiedDate = utcNow
        };

        setTarget(row);
        return row;
    }

    private static void Apply(GeographicAuthorization existing, AreaDraft draft)
    {
        existing.Area = draft.Area;
        existing.Name = draft.Name;
        existing.SourceType = draft.SourceType;
        existing.SourceKey = draft.SourceKey;
        existing.ModifiedDate = DateTime.UtcNow;
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
    private static Geometry UnionOf(IReadOnlyList<Polygon> areas) =>
        areas.Count == 1 ? areas[0] : UnaryUnionOp.Union([.. areas]);

    private static EffectiveGeographicAuthorization Restrict(IReadOnlyList<Polygon> areas) =>
        EffectiveGeographicAuthorization.Restricted(UnionOf(areas));

    private Task<List<Polygon>> DirectAreasAsync(
        Expression<Func<GeographicAuthorization, bool>> predicate,
        CancellationToken cancellationToken) =>
        _dbContext.GeographicAuthorizations
            .AsNoTracking()
            .Where(predicate)
            .OrderBy(g => g.Id)
            .Select(g => g.Area)
            .ToListAsync(cancellationToken);

    private async Task<GeographicAreasResponse> DescribeUserAsync(int userId, CancellationToken cancellationToken)
    {
        var areas = await AreaRowsAsync(g => g.UserId == userId, cancellationToken);
        var effective = await GetEffectiveAuthorizationAsync(userId, cancellationToken);

        return new GeographicAreasResponse
        {
            Areas = areas,
            IsRestricted = effective.IsRestricted,
            EffectiveWkt = effective.AllowedArea is null ? null : WktWriter.Write(effective.AllowedArea)
        };
    }

    private async Task<GeographicAreasResponse> DescribeRoleAsync(int roleId, CancellationToken cancellationToken)
    {
        var areas = await AreaRowsAsync(g => g.RoleId == roleId, cancellationToken);
        var direct = await DirectAreasAsync(g => g.RoleId == roleId, cancellationToken);

        return new GeographicAreasResponse
        {
            Areas = areas,
            IsRestricted = direct.Count > 0,
            EffectiveWkt = direct.Count == 0 ? null : WktWriter.Write(UnionOf(direct))
        };
    }

    private async Task<IReadOnlyList<GeographicAreaResponse>> AreaRowsAsync(
        Expression<Func<GeographicAuthorization, bool>> predicate,
        CancellationToken cancellationToken)
    {
        var rows = await _dbContext.GeographicAuthorizations
            .AsNoTracking()
            .Where(predicate)
            /* Sıra KARARLIDIR ve eklenme sırasıdır. Ada göre sıralamak,
               yöneticinin az önce eklediği alanı listenin ortasına atardı. */
            .OrderBy(g => g.Id)
            .ToListAsync(cancellationToken);

        return [.. rows.Select(row => new GeographicAreaResponse
        {
            Id = row.Id,
            Name = row.Name,
            Wkt = WktWriter.Write(row.Area),
            SourceType = row.SourceType,
            SourceKey = row.SourceKey,
            CreatedDate = row.CreatedDate,
            ModifiedDate = row.ModifiedDate
        })];
    }

    /// <summary>Sınırı kaç alandan oluştuğu — doğrudan varsa onlar, yoksa rollerinkiler.</summary>
    private async Task<int> SelfAreaCountAsync(int userId, CancellationToken cancellationToken)
    {
        var direct = await _dbContext.GeographicAuthorizations
            .AsNoTracking()
            .CountAsync(g => g.UserId == userId, cancellationToken);

        if (direct > 0)
        {
            return direct;
        }

        return await (
            from userRole in _dbContext.UserRoles.AsNoTracking()
            join scope in _dbContext.GeographicAuthorizations.AsNoTracking()
                on userRole.RoleId equals scope.RoleId
            where userRole.UserId == userId
            select scope.Id)
            .CountAsync(cancellationToken);
    }

    private async Task<bool> RemoveAsync(
        Expression<Func<GeographicAuthorization, bool>> predicate,
        CancellationToken cancellationToken)
    {
        var existing = await _dbContext.GeographicAuthorizations.SingleOrDefaultAsync(predicate, cancellationToken);

        if (existing is null)
        {
            return false;
        }

        _dbContext.GeographicAuthorizations.Remove(existing);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return true;
    }

    private async Task RemoveAllAsync(
        Expression<Func<GeographicAuthorization, bool>> predicate,
        CancellationToken cancellationToken)
    {
        var existing = await _dbContext.GeographicAuthorizations.Where(predicate).ToListAsync(cancellationToken);

        if (existing.Count == 0)
        {
            return;
        }

        _dbContext.GeographicAuthorizations.RemoveRange(existing);
        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    /// <summary>
    /// [Uyumluluk] Hedefin tüm alanlarını tek bir alanla değiştirir.
    /// </summary>
    /// <remarks>
    /// Var olan İLK satır yeniden kullanılır (kimliği korunur), fazlası silinir.
    /// Hepsini silip yeniden yazmak, tek alanlı bir hedefte bile alanın
    /// kimliğini her kayıtta değiştirirdi.
    /// </remarks>
    private async Task ReplaceAllAsync(
        Expression<Func<GeographicAuthorization, bool>> predicate,
        Polygon area,
        Action<GeographicAuthorization> setTarget,
        CancellationToken cancellationToken)
    {
        var existing = await _dbContext.GeographicAuthorizations
            .Where(predicate)
            .OrderBy(g => g.Id)
            .ToListAsync(cancellationToken);

        var draft = new AreaDraft(area, DefaultName(GeographicAreaSource.ManualPolygon), GeographicAreaSource.ManualPolygon, null);

        if (existing.Count == 0)
        {
            _dbContext.GeographicAuthorizations.Add(NewRow(draft, setTarget));
        }
        else
        {
            // Adı KORUNUR: tekil uç ad taşımaz, dolayısıyla yöneticinin daha
            // önce verdiği adı silmek için bir sebep yoktur.
            var kept = existing[0];
            kept.Area = draft.Area;
            kept.ModifiedDate = DateTime.UtcNow;

            _dbContext.GeographicAuthorizations.RemoveRange(existing.Skip(1));
        }

        await _dbContext.SaveChangesAsync(cancellationToken);
    }

    private static ServiceResult<GeographicAreasResponse> NotFoundUser() =>
        ServiceResult<GeographicAreasResponse>.NotFound("Kullanıcı bulunamadı.");

    private static ServiceResult<GeographicAreasResponse> NotFoundRole() =>
        ServiceResult<GeographicAreasResponse>.NotFound("Rol bulunamadı.");

    /* Hedefe ait OLMAYAN bir alan da "bulunamadı"dır, "yasak" değil: aksi
       hâlde cevap, o kimlikte bir alanın başka bir hedefte VAR OLDUĞUNU
       sızdırırdı. */
    private static ServiceResult<GeographicAreasResponse> NotFoundArea() =>
        ServiceResult<GeographicAreasResponse>.NotFound("Coğrafi alan bulunamadı.");

    /* Kullanıcı VARLIĞI sorulur, "yetki alabilir mi" değil: soft delete edilmiş
       ya da askıya alınmış bir hesabın alanı yönetici tarafından hâlâ
       görüntülenebilmeli ve düzenlenebilmelidir. Hesabın erişimi zaten etkin
       yetki tarafında kapatılır. */
    private Task<bool> UserExistsAsync(int userId, CancellationToken cancellationToken) =>
        _dbContext.Users.AsNoTracking().AnyAsync(u => u.Id == userId, cancellationToken);

    private Task<bool> RoleExistsAsync(int roleId, CancellationToken cancellationToken) =>
        _dbContext.Roles.AsNoTracking().AnyAsync(r => r.Id == roleId, cancellationToken);
}
