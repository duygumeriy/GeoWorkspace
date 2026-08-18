using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Rol ve rol-yetki yönetiminin uygulaması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Identity tek rol deposudur.</b> Paralel bir rol tablosu kurulmaz;
/// oluşturma, yeniden adlandırma, silme ve benzersizlik
/// <see cref="RoleManager{TRole}"/> üzerinden yürür, böylece normalize edilmiş
/// ad semantiği (büyük/küçük harf duyarsız benzersizlik) otomatik olarak
/// geçerli olur.
/// </para>
/// <para>
/// <b>Koruma kuralları tek yerden gelir.</b> Hangi rolün korunduğu, atanabilir
/// olduğu veya yetkilerinin düzenlenebildiği <see cref="RoleCatalog"/>'dan
/// okunur; bu dosyada rol adı karşılaştırması yapılmaz.
/// </para>
/// </remarks>
public class RoleManagementService : IRoleManagementService
{
    private readonly AppDbContext _dbContext;
    private readonly RoleManager<IdentityRole<int>> _roleManager;
    private readonly ILogger<RoleManagementService> _logger;

    public RoleManagementService(
        AppDbContext dbContext,
        RoleManager<IdentityRole<int>> roleManager,
        ILogger<RoleManagementService> logger)
    {
        _dbContext = dbContext;
        _roleManager = roleManager;
        _logger = logger;
    }

    /* --- Okuma ----------------------------------------------------------------- */

    public async Task<IReadOnlyList<RoleListItem>> GetRolesAsync(CancellationToken cancellationToken = default)
    {
        var roles = await _roleManager.Roles.AsNoTracking().ToListAsync(cancellationToken);

        /* Sayımlar tek sorguda toplanır: rol başına ayrı sorgu açmak, rol
           sayısı arttıkça N+1'e dönüşürdü. */
        var userCounts = await _dbContext.UserRoles
            .GroupBy(ur => ur.RoleId)
            .Select(g => new { RoleId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.RoleId, x => x.Count, cancellationToken);

        var permissionCounts = await _dbContext.RolePermissions
            .Where(rp => _dbContext.Permissions.Any(p => p.Id == rp.PermissionId && p.IsActive))
            .GroupBy(rp => rp.RoleId)
            .Select(g => new { RoleId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(x => x.RoleId, x => x.Count, cancellationToken);

        return roles
            .Select(role => Describe<RoleListItem>(
                role,
                userCounts.GetValueOrDefault(role.Id),
                permissionCounts.GetValueOrDefault(role.Id)))
            .OrderBy(item => RoleCatalog.SortKey(item.Name).Group)
            .ThenBy(item => RoleCatalog.SortKey(item.Name).Index)
            .ThenBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public async Task<ServiceResult<RoleDetail>> GetRoleAsync(int roleId, CancellationToken cancellationToken = default)
    {
        var role = await FindRoleAsync(roleId, cancellationToken);

        return role is null
            ? ServiceResult<RoleDetail>.NotFound("Rol bulunamadı.")
            : ServiceResult<RoleDetail>.Success(await DescribeAsync(role, cancellationToken));
    }

    /* --- Oluşturma -------------------------------------------------------------- */

    public async Task<ServiceResult<RoleDetail>> CreateRoleAsync(
        CreateRoleRequest request,
        CancellationToken cancellationToken = default)
    {
        var name = (request.Name ?? string.Empty).Trim();

        if (name.Length == 0)
        {
            return ServiceResult<RoleDetail>.Failure("Rol adı boş olamaz.");
        }

        if (name.Length > 100)
        {
            return ServiceResult<RoleDetail>.Failure("Rol adı en fazla 100 karakter olabilir.");
        }

        /* Korunan adlar önce kontrol edilir ki hata mesajı "zaten var" yerine
           gerçek sebebi söylesin. Karşılaştırma büyük/küçük harf duyarsızdır:
           "administrator" ile "Administrator" aynı rolü hedefler. */
        if (RoleCatalog.IsReserved(name))
        {
            return ServiceResult<RoleDetail>.Conflict(
                $"'{name}' sistem tarafından ayrılmış bir rol adıdır ve yeniden oluşturulamaz.");
        }

        if (await _roleManager.RoleExistsAsync(name))
        {
            return ServiceResult<RoleDetail>.Conflict($"'{name}' adında bir rol zaten var.");
        }

        var role = new IdentityRole<int>(name);
        var result = await _roleManager.CreateAsync(role);

        if (!result.Succeeded)
        {
            return Failed<RoleDetail>("Rol oluşturulamadı.", result);
        }

        /* Yeni rol SIFIR yetkiyle başlar. Bir şablondan (ör. GIS Editor)
           kopyalamak, yöneticinin farkında olmadığı yetkiler dağıtırdı;
           yetkilendirme ayrı ve açık bir adımdır. */
        _logger.LogInformation("Özel rol oluşturuldu: {Role} (RoleId={RoleId})", name, role.Id);

        return ServiceResult<RoleDetail>.Success(await DescribeAsync(role, cancellationToken));
    }

    /* --- Yeniden adlandırma ------------------------------------------------------ */

    public async Task<ServiceResult<RoleDetail>> RenameRoleAsync(
        int roleId,
        UpdateRoleRequest request,
        CancellationToken cancellationToken = default)
    {
        var role = await FindRoleAsync(roleId, cancellationToken);

        if (role is null)
        {
            return ServiceResult<RoleDetail>.NotFound("Rol bulunamadı.");
        }

        if (!RoleCatalog.CanRename(role.Name))
        {
            return ServiceResult<RoleDetail>.Conflict(
                $"'{role.Name}' sistem rolüdür ve yeniden adlandırılamaz.");
        }

        var name = (request.Name ?? string.Empty).Trim();

        if (name.Length == 0)
        {
            return ServiceResult<RoleDetail>.Failure("Rol adı boş olamaz.");
        }

        if (name.Length > 100)
        {
            return ServiceResult<RoleDetail>.Failure("Rol adı en fazla 100 karakter olabilir.");
        }

        if (RoleCatalog.IsReserved(name))
        {
            return ServiceResult<RoleDetail>.Conflict(
                $"'{name}' sistem tarafından ayrılmış bir rol adıdır.");
        }

        var existing = await _roleManager.FindByNameAsync(name);

        if (existing is not null && existing.Id != role.Id)
        {
            return ServiceResult<RoleDetail>.Conflict($"'{name}' adında bir rol zaten var.");
        }

        /* Satır silinip yeniden oluşturulmaz: SetRoleNameAsync yalnızca adı
           günceller, RoleId sabit kalır ve role bağlı role_permissions ile
           user_roles satırları olduğu gibi korunur. Yeniden adlandırma bir
           kimlik değişikliği DEĞİLDİR. */
        var rename = await _roleManager.SetRoleNameAsync(role, name);

        if (!rename.Succeeded)
        {
            return Failed<RoleDetail>("Rol adı güncellenemedi.", rename);
        }

        // Normalize edilmiş adın da yenilenmesi için güncelleme şarttır.
        var update = await _roleManager.UpdateAsync(role);

        if (!update.Succeeded)
        {
            return Failed<RoleDetail>("Rol adı güncellenemedi.", update);
        }

        _logger.LogInformation("Özel rol yeniden adlandırıldı: RoleId={RoleId} YeniAd={Role}", role.Id, name);

        return ServiceResult<RoleDetail>.Success(await DescribeAsync(role, cancellationToken));
    }

    /* --- Silme ------------------------------------------------------------------- */

    public async Task<ServiceResult<bool>> DeleteRoleAsync(int roleId, CancellationToken cancellationToken = default)
    {
        var role = await FindRoleAsync(roleId, cancellationToken);

        if (role is null)
        {
            return ServiceResult<bool>.NotFound("Rol bulunamadı.");
        }

        if (!RoleCatalog.CanDelete(role.Name))
        {
            return ServiceResult<bool>.Conflict($"'{role.Name}' sistem rolüdür ve silinemez.");
        }

        var userCount = await _dbContext.UserRoles.CountAsync(ur => ur.RoleId == role.Id, cancellationToken);

        if (userCount > 0)
        {
            /* Kullanıcılar sessizce başka bir role TAŞINMAZ. Hangi rolün doğru
               olduğu bir yönetim kararıdır; burada tahmin etmek, insanların
               yetkilerini haberleri olmadan değiştirmek olurdu. */
            return ServiceResult<bool>.Conflict(
                $"'{role.Name}' rolü {userCount} kullanıcıya atanmış durumda. Önce bu kullanıcıları başka bir role taşıyın.");
        }

        var result = await _roleManager.DeleteAsync(role);

        if (!result.Succeeded)
        {
            return Failed<bool>("Rol silinemedi.", result);
        }

        /* role_permissions satırları veritabanı tarafından cascade ile
           temizlenir (Phase 1 FK tasarımı). permissions tablosuna ASLA
           dokunulmaz: yetki tanımları sistem tanımlarıdır ve bir rolün
           silinmesiyle yok olmazlar. */
        _logger.LogInformation("Özel rol silindi: {Role} (RoleId={RoleId})", role.Name, role.Id);

        return ServiceResult<bool>.Success(true);
    }

    /* --- Yetki kataloğu ---------------------------------------------------------- */

    public async Task<IReadOnlyList<PermissionCatalogItem>> GetPermissionCatalogAsync(
        CancellationToken cancellationToken = default) =>
        await OrderedCatalog()
            .Select(p => new PermissionCatalogItem
            {
                Id = p.Id,
                Code = p.Code,
                Name = p.Name,
                Description = p.Description,
                Category = p.Category,
                IsActive = p.IsActive,
                SortOrder = p.SortOrder
            })
            .ToArrayAsync(cancellationToken);

    public async Task<ServiceResult<RolePermissionsResponse>> GetRolePermissionsAsync(
        int roleId,
        CancellationToken cancellationToken = default)
    {
        var role = await FindRoleAsync(roleId, cancellationToken);

        return role is null
            ? ServiceResult<RolePermissionsResponse>.NotFound("Rol bulunamadı.")
            : ServiceResult<RolePermissionsResponse>.Success(await BuildRolePermissionsAsync(role, cancellationToken));
    }

    /* --- Yetki atama -------------------------------------------------------------- */

    public async Task<ServiceResult<RolePermissionsResponse>> ReplaceRolePermissionsAsync(
        int roleId,
        UpdateRolePermissionsRequest request,
        CancellationToken cancellationToken = default)
    {
        var role = await FindRoleAsync(roleId, cancellationToken);

        if (role is null)
        {
            return ServiceResult<RolePermissionsResponse>.NotFound("Rol bulunamadı.");
        }

        if (!RoleCatalog.CanEditPermissions(role.Name))
        {
            /* Legacy rollerin yetkileri dondurulmuştur: mevcut kullanıcıların
               erişimi onlara bağlı ve Admin ≡ Administrator / User ≡ GIS Editor
               eşitliği migrasyon fazına kadar korunmalıdır. */
            return ServiceResult<RolePermissionsResponse>.Conflict(
                $"'{role.Name}' geçiş dönemi rolüdür; yetkileri bu aşamada değiştirilemez. " +
                "Hedef rollerin (Viewer, GIS Editor, GIS Analyst, GIS Manager, Administrator) yetkileri düzenlenebilir.");
        }

        // Aynı kodun birden çok kez gönderilmesi hata değildir; küme anlamı taşır.
        var requested = (request.PermissionCodes ?? [])
            .Select(code => (code ?? string.Empty).Trim())
            .Where(code => code.Length > 0)
            .ToHashSet(StringComparer.Ordinal);

        var catalog = await _dbContext.Permissions.ToListAsync(cancellationToken);
        var byCode = catalog.ToDictionary(p => p.Code, StringComparer.Ordinal);

        /* Tanınmayan veya pasif kodlar SESSİZCE YOK SAYILMAZ. Yönetici bir
           yetkiyi işaretlediğini sanırken isteğin yarısının düşmesi, yetki
           ekranını güvenilmez kılardı. */
        var unknown = requested.Where(code => !byCode.ContainsKey(code)).OrderBy(c => c, StringComparer.Ordinal).ToArray();

        if (unknown.Length > 0)
        {
            return ServiceResult<RolePermissionsResponse>.Failure(
                $"Tanınmayan yetki kodu: {string.Join(", ", unknown)}.");
        }

        var inactive = requested.Where(code => !byCode[code].IsActive).OrderBy(c => c, StringComparer.Ordinal).ToArray();

        if (inactive.Length > 0)
        {
            /* Pasif bir yetki atanamaz ve bu uçtan yeniden aktifleştirilemez:
               kullanımdan kaldırma operasyonel bir karardır, yetki atama
               ekranının yan etkisi olamaz. */
            return ServiceResult<RolePermissionsResponse>.Failure(
                $"Kullanımdan kaldırılmış yetki atanamaz: {string.Join(", ", inactive)}.");
        }

        var desired = requested.Select(code => byCode[code].Id).ToHashSet();

        var currentGrants = await _dbContext.RolePermissions
            .Where(rp => rp.RoleId == role.Id)
            .ToListAsync(cancellationToken);

        var activeIds = catalog.Where(p => p.IsActive).Select(p => p.Id).ToHashSet();

        /* Fark hesabı. "Hepsini sil, yeniden ekle" yapılmaz: gereksiz yazma
           üretir ve satır kimliklerini boşuna değiştirirdi.

           Pasif yetkilere ait mevcut bağlar KORUNUR — istek yalnızca aktif
           yetki kümesini tanımlar. Aksi hâlde bir yetki pasifleştirildiğinde
           ilk kaydetmede ilişkisi kalıcı olarak silinir ve yetki yeniden
           aktifleştirildiğinde geri gelmezdi. */
        var toRemove = currentGrants
            .Where(rp => activeIds.Contains(rp.PermissionId) && !desired.Contains(rp.PermissionId))
            .ToArray();

        var currentIds = currentGrants.Select(rp => rp.PermissionId).ToHashSet();

        var toAdd = desired
            .Where(id => !currentIds.Contains(id))
            .Select(id => new RolePermission { RoleId = role.Id, PermissionId = id })
            .ToArray();

        if (toRemove.Length > 0 || toAdd.Length > 0)
        {
            /* Tek transaction: yarısı uygulanmış bir yetki kümesi, rolün hiç
               olmadığı bir güvenlik durumunda kalması demek olurdu. */
            await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);

            _dbContext.RolePermissions.RemoveRange(toRemove);
            _dbContext.RolePermissions.AddRange(toAdd);

            await _dbContext.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            _logger.LogInformation(
                "Rol yetkileri güncellendi: {Role} (RoleId={RoleId}) Eklenen={Added} Kaldırılan={Removed}",
                role.Name,
                role.Id,
                toAdd.Length,
                toRemove.Length);
        }

        return ServiceResult<RolePermissionsResponse>.Success(await BuildRolePermissionsAsync(role, cancellationToken));
    }

    /* --- Atanabilir roller --------------------------------------------------------- */

    public async Task<IReadOnlyList<AssignableRole>> GetAssignableRolesAsync(
        CancellationToken cancellationToken = default)
    {
        var roles = await _roleManager.Roles
            .AsNoTracking()
            .Select(r => r.Name!)
            .ToListAsync(cancellationToken);

        return roles
            .Where(RoleCatalog.IsAssignable)
            .OrderBy(name => RoleCatalog.SortKey(name).Group)
            .ThenBy(name => RoleCatalog.SortKey(name).Index)
            .ThenBy(name => name, StringComparer.OrdinalIgnoreCase)
            .Select(name => new AssignableRole
            {
                Name = name,
                Description = DescribeRole(name),
                /* Yönetim yetkilerine sahip roller için ikinci faktör bilgisi
                   istemciye gösterilir. Kaynak rol ADI değil, rolün gerçekten
                   yönetim yetkisi taşıyıp taşımadığıdır — ama bu bilgi burada
                   sunucu tarafında hesaplanmadığı için kanonik yönetici rolü
                   ile legacy Admin işaretlenir; yetki bazlı ayrıntı yönetim
                   ekranının kendi sorumluluğudur. */
                RequiresTwoFactor = RoleCatalog.IsCanonical(name)
                    && string.Equals(name, GisRoles.Administrator, StringComparison.OrdinalIgnoreCase)
            })
            .ToArray();
    }

    public async Task<ServiceResult<string>> ResolveAssignableRoleAsync(
        string? roleName,
        CancellationToken cancellationToken = default)
    {
        var trimmed = (roleName ?? string.Empty).Trim();

        if (trimmed.Length == 0)
        {
            return ServiceResult<string>.Failure("Rol seçilmedi.");
        }

        // Identity normalize edilmiş ada göre bulur; "viewer" da "Viewer"ı çözer.
        var role = await _roleManager.FindByNameAsync(trimmed);

        if (role?.Name is null)
        {
            return ServiceResult<string>.Failure($"'{trimmed}' adında bir rol yok.");
        }

        if (!RoleCatalog.IsAssignable(role.Name))
        {
            /* Legacy roller mevcut kullanıcılarda GEÇERLİ kalır; kapalı olan
               yalnızca YENİ atamalardır. İkisi ayrı kavramdır. */
            return ServiceResult<string>.Failure(
                $"'{role.Name}' geçiş dönemi rolüdür ve yeni atamalarda kullanılamaz. " +
                "Lütfen hedef rollerden veya tanımlı özel rollerden birini seçin.");
        }

        // Kanonik yazım döner; kullanıcıya "viewer" değil "Viewer" atanır.
        return ServiceResult<string>.Success(role.Name);
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private IQueryable<Permission> OrderedCatalog() =>
        _dbContext.Permissions
            .AsNoTracking()
            .OrderBy(p => p.Category)
            .ThenBy(p => p.SortOrder)
            .ThenBy(p => p.Code);

    private Task<IdentityRole<int>?> FindRoleAsync(int roleId, CancellationToken cancellationToken) =>
        _roleManager.Roles.SingleOrDefaultAsync(r => r.Id == roleId, cancellationToken);

    private async Task<RolePermissionsResponse> BuildRolePermissionsAsync(
        IdentityRole<int> role,
        CancellationToken cancellationToken)
    {
        var assigned = await _dbContext.RolePermissions
            .Where(rp => rp.RoleId == role.Id)
            .Select(rp => rp.PermissionId)
            .ToListAsync(cancellationToken);

        var assignedIds = assigned.ToHashSet();

        var permissions = await OrderedCatalog().ToListAsync(cancellationToken);

        return new RolePermissionsResponse
        {
            Role = await DescribeAsync(role, cancellationToken),
            Permissions = permissions
                .Select(p => new RolePermissionItem
                {
                    Id = p.Id,
                    Code = p.Code,
                    Name = p.Name,
                    Description = p.Description,
                    Category = p.Category,
                    IsActive = p.IsActive,
                    SortOrder = p.SortOrder,
                    Assigned = assignedIds.Contains(p.Id)
                })
                .ToArray()
        };
    }

    private async Task<RoleDetail> DescribeAsync(IdentityRole<int> role, CancellationToken cancellationToken)
    {
        var userCount = await _dbContext.UserRoles.CountAsync(ur => ur.RoleId == role.Id, cancellationToken);

        var permissionCount = await _dbContext.RolePermissions
            .CountAsync(
                rp => rp.RoleId == role.Id && _dbContext.Permissions.Any(p => p.Id == rp.PermissionId && p.IsActive),
                cancellationToken);

        return Describe<RoleDetail>(role, userCount, permissionCount);
    }

    /// <summary>
    /// Rolün istemciye açılan metadata'sı. Tüm bayraklar rol adından
    /// <see cref="RoleCatalog"/> üzerinden türetilir; veritabanında karşılığı
    /// olan bir kolon yoktur.
    /// </summary>
    private static TItem Describe<TItem>(IdentityRole<int> role, int userCount, int permissionCount)
        where TItem : RoleListItem, new()
    {
        var name = role.Name ?? string.Empty;

        return new TItem
        {
            Id = role.Id,
            Name = name,
            UserCount = userCount,
            PermissionCount = permissionCount,
            IsSystem = RoleCatalog.IsReserved(name),
            IsLegacy = RoleCatalog.IsLegacy(name),
            IsAssignable = RoleCatalog.IsAssignable(name),
            CanRename = RoleCatalog.CanRename(name),
            CanDelete = RoleCatalog.CanDelete(name),
            CanEditPermissions = RoleCatalog.CanEditPermissions(name)
        };
    }

    private static string DescribeRole(string name) => name switch
    {
        GisRoles.Viewer => "Haritayı ve çizimleri görüntüler; veri değiştirmez.",
        GisRoles.GisEditor => "Çizim oluşturur ve kendi GIS verisini yönetir.",
        GisRoles.GisAnalyst => "Görüntüleme ve envanter analizi yapar; operasyonel veriyi düzenlemez.",
        GisRoles.GisManager => "GIS verisini ve katmanları yönetir, analiz çalıştırır.",
        GisRoles.Administrator => "Tüm GIS erişimi ile kullanıcı, rol ve yetki yönetimi.",
        _ => "Yöneticinin tanımladığı özel rol."
    };

    private static ServiceResult<T> Failed<T>(string message, IdentityResult result) =>
        ServiceResult<T>.Failure($"{message} {string.Join(" ", result.Errors.Select(e => e.Description))}".Trim());
}
