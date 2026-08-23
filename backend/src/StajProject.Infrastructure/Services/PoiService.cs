using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Pois;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// POI kayıtlarını EF Core üzerinden <c>poi</c> tablosuna yazar ve okur. Elle
/// SQL kullanılmaz.
/// </summary>
/// <remarks>
/// <para>
/// <b>Okuma sahibe göre KISITLANMAZ.</b> Çizim servisiyle arasındaki en önemli
/// fark budur ve bilinçlidir: çizimler kişinin kendi çalışma alanıdır, POI ise
/// <c>poi.view</c> taşıyan herkesin gördüğü ortak envanterdir. Burada sahiplik
/// yüklemi aramak, ödevin "Kullanıcı POI'leri görebilir" gereksinimini
/// karşılamayan bir liste üretirdi.
/// </para>
/// <para>
/// <b>Coğrafi sınır yalnızca YAZMAYA uygulanır.</b> Bir kullanıcının alanının
/// dışındaki POI'leri görebilmesi doğrudur — sınır, nerede veri
/// ÜRETEBİLECEĞİNİ belirler, ne görebileceğini değil.
/// </para>
/// </remarks>
public class PoiService : IPoiService
{
    /// <summary>
    /// Coğrafi yetki alanı dışına POI ekleme denemesinde dönen mesaj.
    /// </summary>
    /// <remarks>
    /// İzin verilen alanın kendisi paylaşılmaz: hata mesajı, yetkisi olmayan
    /// bir çağırana sınırı ikili aramayla haritalama imkânı vermemelidir. Çizim
    /// servisi de aynı kuralı izler.
    /// </remarks>
    private const string OutsideAreaMessage = "Bu alanda POI ekleme yetkiniz bulunmuyor.";

    private const string CategoryNotFoundMessage = "Seçilen kategori bulunamadı veya kullanımda değil.";

    /// <summary>Geometrinin ve mekânsal kısıtın SRID'si.</summary>
    private const int Srid = 4326;

    private readonly AppDbContext _dbContext;
    private readonly ICurrentUserService _currentUser;
    private readonly IGeographicAuthorizationService _geographicAuthorization;

    public PoiService(
        AppDbContext dbContext,
        ICurrentUserService currentUser,
        IGeographicAuthorizationService geographicAuthorization)
    {
        _dbContext = dbContext;
        _currentUser = currentUser;
        _geographicAuthorization = geographicAuthorization;
    }

    /* --- Harita okuması --------------------------------------------------------- */

    public async Task<IReadOnlyList<PoiResponse>> GetMapPoisAsync(CancellationToken cancellationToken = default)
    {
        /* Global query filter pasif/silinmiş POI'leri düşürür; burada
           IgnoreQueryFilters BİLİNÇLİ olarak kullanılmaz. Sahiplik yüklemi de
           yoktur — POI ortak envanterdir. */
        var rows = await _dbContext.Pois
            .AsNoTracking()
            .Select(p => new
            {
                p.Id,
                p.Name,
                p.CategoryId,
                p.WorkHoursJson,
                Longitude = p.Coordinate.X,
                Latitude = p.Coordinate.Y
            })
            .ToListAsync(cancellationToken);

        /* Kategori adları TEK sorguda okunur ve bellekte eşlenir: satır başına
           kategori sorgulamak (ya da yolu satır başına yürütmek) klasik N+1
           olurdu. Filtre burada da açıktır — sıradan istemci pasif bir
           kategorinin adını görmez; kategorisi kullanımdan kaldırılmış bir POI
           haritada kategori etiketi olmadan görünür, kaybolmaz. */
        var categories = await ReadCategoryNodesAsync(includeHidden: false, cancellationToken);

        return
        [
            .. rows
                .Select(row => new PoiResponse
                {
                    Id = row.Id,
                    Name = row.Name,
                    CategoryId = row.CategoryId,
                    CategoryName = categories.TryGetValue(row.CategoryId, out var category) ? category.Name : string.Empty,
                    CategoryPath = PoiCategoryHierarchy.BuildPath(categories, row.CategoryId),
                    WorkHours = PoiWorkHoursValidator.Deserialize(row.WorkHoursJson),
                    Longitude = row.Longitude,
                    Latitude = row.Latitude
                })
                // Deterministik sıra: ada göre, eşitlikte kimliğe göre.
                .OrderBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(item => item.Id)
        ];
    }

    /* --- Yönetim okuması -------------------------------------------------------- */

    public async Task<IReadOnlyList<AdminPoiResponse>> GetAdminPoisAsync(CancellationToken cancellationToken = default)
    {
        /* IgnoreQueryFilters BİLİNÇLİDİR: yönetim ekranı pasifleştirilmiş ve
           soft-delete edilmiş kayıtları da görmek zorundadır — aksi hâlde
           "POI Yönetimi" envanterin yalnızca bir bölümünü gösterir ve bir
           kaydın neden haritada olmadığı hiçbir yerden anlaşılamazdı. */
        var rows = await _dbContext.Pois
            .IgnoreQueryFilters()
            .AsNoTracking()
            .Select(p => new
            {
                p.Id,
                p.Name,
                p.CategoryId,
                p.WorkHoursJson,
                Longitude = p.Coordinate.X,
                Latitude = p.Coordinate.Y,
                p.UserId,
                // Sahiplik atfı için YALNIZCA kullanıcı adı okunur; e-posta,
                // hash, stamp ve rol bilgisi projeksiyona hiç girmez.
                CreatorUsername = p.User != null ? p.User.UserName : null,
                p.CreatedDate,
                p.ModifiedDate,
                p.IsActive,
                p.IsDeleted
            })
            .ToListAsync(cancellationToken);

        // Yönetim tarafında kategori adı pasif satırlar için de çözülmelidir.
        var categories = await ReadCategoryNodesAsync(includeHidden: true, cancellationToken);

        return
        [
            .. rows
                .Select(row => new AdminPoiResponse
                {
                    Id = row.Id,
                    Name = row.Name,
                    CategoryId = row.CategoryId,
                    CategoryName = categories.TryGetValue(row.CategoryId, out var category) ? category.Name : string.Empty,
                    CategoryPath = PoiCategoryHierarchy.BuildPath(categories, row.CategoryId),
                    WorkHours = PoiWorkHoursValidator.Deserialize(row.WorkHoursJson),
                    Longitude = row.Longitude,
                    Latitude = row.Latitude,
                    CreatorUserId = row.UserId,
                    CreatorUsername = row.CreatorUsername ?? string.Empty,
                    CreatedDate = row.CreatedDate,
                    ModifiedDate = row.ModifiedDate,
                    IsActive = row.IsActive,
                    IsDeleted = row.IsDeleted
                })
                // En yeni kayıt başta; eşitlikte kimlik sırayı deterministik yapar.
                .OrderByDescending(item => item.CreatedDate)
                .ThenByDescending(item => item.Id)
        ];
    }

    /* --- Oluşturma -------------------------------------------------------------- */

    public async Task<ServiceResult<PoiResponse>> CreatePoiAsync(
        CreatePoiRequest request,
        CancellationToken cancellationToken = default)
    {
        var name = PoiAttributeValidator.ValidateName(request.Name);

        if (!name.IsSuccess)
        {
            return ServiceResult<PoiResponse>.Failure(name.Error!);
        }

        var coordinate = PoiAttributeValidator.ValidateCoordinate(request.Longitude, request.Latitude);

        if (!coordinate.IsSuccess)
        {
            return ServiceResult<PoiResponse>.Failure(coordinate.Error!);
        }

        var workHours = PoiWorkHoursValidator.ValidateAndSerialize(request.WorkHours);

        if (!workHours.IsSuccess)
        {
            return ServiceResult<PoiResponse>.Failure(workHours.Error!);
        }

        /* Kategori doğrulaması global filtre ÜZERİNDEN yapılır: sorgu pasif ve
           silinmiş kategorileri zaten görmez, dolayısıyla "var ama kullanımda
           değil" durumu ayrı bir kontrol gerektirmez. */
        if (request.CategoryId <= 0
            || !await _dbContext.PoiCategories.AsNoTracking()
                .AnyAsync(c => c.Id == request.CategoryId, cancellationToken))
        {
            return ServiceResult<PoiResponse>.Failure(CategoryNotFoundMessage);
        }

        var owner = RequireOwnerId();

        if (!owner.IsSuccess)
        {
            return ServiceResult<PoiResponse>.Forbidden(owner.Error!);
        }

        // İstemci SRID göndermez; geometri sunucuda 4326 olarak kurulur.
        var point = new Point(coordinate.Value.Longitude, coordinate.Value.Latitude) { SRID = Srid };

        /* Coğrafi yetki, koordinat DOĞRULANDIKTAN sonra ve kayıt açılmadan ÖNCE
           sınanır. Sıra önemlidir: geçersiz bir koordinat "yanlış yerdesin"
           (403) diye raporlanmamalıdır — o 400'dür ve yukarıda çoktan dönmüştür.
           Kısıtı olmayan kullanıcı için Unrestricted her yeri kabul eder. */
        var area = await _geographicAuthorization.GetEffectiveAuthorizationAsync(owner.Value, cancellationToken);

        if (!area.Allows(point))
        {
            return ServiceResult<PoiResponse>.Forbidden(OutsideAreaMessage);
        }

        var poi = new Poi
        {
            Name = name.Value!,
            CategoryId = request.CategoryId,
            WorkHoursJson = workHours.Value,
            Coordinate = point,
            /* Sahiplik client'tan DEĞİL, doğrulanmış JWT kimliğinden gelir.
               İstek gövdesindeki userId/creator alanları DTO'da tanımlı olmadığı
               için zaten bind edilmez, edilse de burada kullanılmazdı. */
            UserId = owner.Value,
            IsActive = true,
            IsDeleted = false,
            /* CreatedDate AÇIKÇA damgalanır: AppDbContext yalnızca ModifiedDate'i
               IAuditableEntity üzerinden yazar; CreatedDate otomatiği çizim
               arayüzüne bağlıdır ve POI onu uygulamaz. */
            CreatedDate = DateTime.UtcNow
        };

        _dbContext.Pois.Add(poi);
        // ModifiedDate AppDbContext.SaveChanges içinde UTC damgalanır.
        await _dbContext.SaveChangesAsync(cancellationToken);

        return ServiceResult<PoiResponse>.Success(await ToMapResponseAsync(poi, cancellationToken));
    }

    /* --- Yardımcılar ------------------------------------------------------------ */

    /// <summary>
    /// Yeni kaydın sahibi: doğrulanmış JWT'deki kullanıcı kimliği. Uçlar
    /// <c>[Authorize]</c> olduğu için normalde daima doludur; boş gelmesi
    /// yapılandırma hatasıdır ve kayıt oluşturulmaz.
    /// </summary>
    private ServiceResult<int> RequireOwnerId()
    {
        var userId = _currentUser.UserId;

        return userId is null
            ? ServiceResult<int>.Forbidden("Kimlik doğrulanamadı; POI oluşturulamaz.")
            : ServiceResult<int>.Success(userId.Value);
    }

    private async Task<IReadOnlyDictionary<int, PoiCategoryHierarchy.Node>> ReadCategoryNodesAsync(
        bool includeHidden,
        CancellationToken cancellationToken)
    {
        var query = _dbContext.PoiCategories.AsNoTracking();

        if (includeHidden)
        {
            query = query.IgnoreQueryFilters();
        }

        var nodes = await query
            .Select(c => new { c.Id, c.Name, c.ParentId })
            .ToListAsync(cancellationToken);

        return nodes.ToDictionary(
            n => n.Id,
            n => new PoiCategoryHierarchy.Node(n.Id, n.Name, n.ParentId));
    }

    private async Task<PoiResponse> ToMapResponseAsync(Poi poi, CancellationToken cancellationToken)
    {
        var categories = await ReadCategoryNodesAsync(includeHidden: false, cancellationToken);

        return new PoiResponse
        {
            Id = poi.Id,
            Name = poi.Name,
            CategoryId = poi.CategoryId,
            CategoryName = categories.TryGetValue(poi.CategoryId, out var category) ? category.Name : string.Empty,
            CategoryPath = PoiCategoryHierarchy.BuildPath(categories, poi.CategoryId),
            WorkHours = PoiWorkHoursValidator.Deserialize(poi.WorkHoursJson),
            Longitude = poi.Coordinate.X,
            Latitude = poi.Coordinate.Y
        };
    }
}
