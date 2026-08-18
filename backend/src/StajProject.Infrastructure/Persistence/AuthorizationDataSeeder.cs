using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence;

/// <summary>
/// Dinamik yetkilendirme temelinin startup provisioning'i: yetki kataloğu,
/// hedef GIS rolleri ve rollerin başlangıç yetkileri.
/// </summary>
/// <remarks>
/// <para>
/// <b>Idempotent.</b> Kaç kez çalışırsa çalışsın çift satır üretmez; kimlik
/// olarak her zaman <see cref="Permission.Code"/> ve rol adı kullanılır,
/// görünen adlar değil.
/// </para>
/// <para>
/// <b>Mevcut kararları ezmez.</b> <see cref="IdentityDataSeeder"/> ile aynı
/// ayrımı sürdürür: bir rol <i>ilk kez</i> yetkilendirilirken matris uygulanır;
/// o rolün zaten yetkileri varsa hiçbirine dokunulmaz. Aksi halde bir
/// yöneticinin bilinçli olarak geri aldığı yetki, her yeniden başlatmada
/// sessizce geri gelirdi.
/// </para>
/// <para>
/// <b>Hiçbir şey silmez.</b> Katalog dışında kalan yetkiler, tanınmayan roller
/// ve matriste olmayan grant satırları olduğu gibi bırakılır.
/// </para>
/// </remarks>
public static class AuthorizationDataSeeder
{
    public static async Task SeedAsync(
        AppDbContext dbContext,
        RoleManager<IdentityRole<int>> roleManager,
        ILogger logger,
        CancellationToken cancellationToken = default)
    {
        await EnsureTargetRolesAsync(roleManager, logger, cancellationToken);

        var permissionIdsByCode = await EnsurePermissionCatalogAsync(dbContext, logger, cancellationToken);

        await EnsureRolePermissionsAsync(dbContext, roleManager, permissionIdsByCode, logger, cancellationToken);
    }

    /* --- Hedef roller ---------------------------------------------------------- */

    /// <summary>
    /// <see cref="GisRoles.All"/> rollerinin var olmasını sağlar.
    /// </summary>
    /// <remarks>
    /// Bu roller şu an yalnızca <b>tanımlıdır</b>: onay ekranında atanabilir
    /// hale gelmeleri için <see cref="ApplicationRoles.All"/> içine girmeleri
    /// gerekir ve bu, bilinçli bir rol geçişi adımı olarak sonraki faza
    /// bırakılmıştır. Dolayısıyla mevcut yönetici onay akışı bu rollerden
    /// etkilenmez.
    /// </remarks>
    private static async Task EnsureTargetRolesAsync(
        RoleManager<IdentityRole<int>> roleManager,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        foreach (var roleName in GisRoles.All)
        {
            if (await roleManager.RoleExistsAsync(roleName))
            {
                continue;
            }

            var result = await roleManager.CreateAsync(new IdentityRole<int>(roleName));

            if (result.Succeeded)
            {
                logger.LogInformation("Hedef GIS rolü oluşturuldu: {Role}", roleName);
            }
            else
            {
                logger.LogError(
                    "Hedef GIS rolü oluşturulamadı: {Role}. {Errors}",
                    roleName,
                    string.Join("; ", result.Errors.Select(e => e.Description)));
            }
        }
    }

    /* --- Yetki kataloğu -------------------------------------------------------- */

    /// <summary>
    /// Katalogdaki yetkilerin veritabanında var olmasını sağlar ve kod →
    /// <c>Id</c> eşlemesini döndürür.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Eşleşme <b>koda</b> göre yapılır. Var olan bir satır ASLA silinip
    /// yeniden eklenmez: <c>role_permissions</c> ve <c>user_permissions</c>
    /// satırları <c>permissions.id</c>'ye bağlıdır ve yeniden ekleme, tüm
    /// yetkilendirmeyi koparırdı. Satır kimliği kalıcıdır.
    /// </para>
    /// <para>
    /// Görünen ad / açıklama / kategori / sıra <i>güncellenir</i>: bunların tek
    /// kaynağı <see cref="PermissionCatalog"/>'dur ve düzenlenebilecekleri bir
    /// arayüz yoktur. <see cref="Permission.IsActive"/> ise güncellenmez —
    /// bir yetkiyi kullanımdan kaldırmak operasyonel bir karardır ve startup'ta
    /// geri alınmamalıdır.
    /// </para>
    /// </remarks>
    private static async Task<IReadOnlyDictionary<string, int>> EnsurePermissionCatalogAsync(
        AppDbContext dbContext,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        var existing = await dbContext.Permissions
            .ToDictionaryAsync(p => p.Code, StringComparer.Ordinal, cancellationToken);

        var created = 0;
        var updated = 0;

        foreach (var definition in PermissionCatalog.All)
        {
            if (existing.TryGetValue(definition.Code, out var permission))
            {
                if (permission.Name == definition.Name
                    && permission.Description == definition.Description
                    && permission.Category == definition.Category
                    && permission.SortOrder == definition.SortOrder)
                {
                    continue;
                }

                permission.Name = definition.Name;
                permission.Description = definition.Description;
                permission.Category = definition.Category;
                permission.SortOrder = definition.SortOrder;
                updated++;
                continue;
            }

            var added = new Permission
            {
                Code = definition.Code,
                Name = definition.Name,
                Description = definition.Description,
                Category = definition.Category,
                SortOrder = definition.SortOrder,
                IsActive = true
            };

            dbContext.Permissions.Add(added);
            existing[definition.Code] = added;
            created++;
        }

        if (created > 0 || updated > 0)
        {
            await dbContext.SaveChangesAsync(cancellationToken);
            logger.LogInformation(
                "Yetki kataloğu güncellendi. Eklenen={Created} Güncellenen={Updated}", created, updated);
        }

        // Id'ler SaveChanges sonrasında dolar; eşleme bu yüzden burada kurulur.
        return existing.ToDictionary(pair => pair.Key, pair => pair.Value.Id, StringComparer.Ordinal);
    }

    /* --- Rol yetkileri --------------------------------------------------------- */

    /// <summary>
    /// Matristeki rollere başlangıç yetkilerini verir.
    /// </summary>
    /// <remarks>
    /// Yalnızca <b>hiç yetkisi olmayan</b> roller doldurulur. Bir rolün zaten
    /// yetkisi varsa o rol provision edilmiş sayılır ve tek bir satırına bile
    /// dokunulmaz; eksik görünen yetkiler tamamlanmaz, fazlalıklar silinmez.
    /// </remarks>
    private static async Task EnsureRolePermissionsAsync(
        AppDbContext dbContext,
        RoleManager<IdentityRole<int>> roleManager,
        IReadOnlyDictionary<string, int> permissionIdsByCode,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        foreach (var (roleName, codes) in RolePermissionDefaults.Matrix)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var role = await roleManager.FindByNameAsync(roleName);

            if (role is null)
            {
                logger.LogWarning(
                    "'{Role}' rolü bulunamadı; başlangıç yetkileri atanmadı.", roleName);
                continue;
            }

            var alreadyProvisioned = await dbContext.RolePermissions
                .AnyAsync(rp => rp.RoleId == role.Id, cancellationToken);

            if (alreadyProvisioned)
            {
                continue;
            }

            var grants = codes
                .Distinct(StringComparer.Ordinal)
                .Where(permissionIdsByCode.ContainsKey)
                .Select(code => new RolePermission
                {
                    RoleId = role.Id,
                    PermissionId = permissionIdsByCode[code]
                })
                .ToArray();

            if (grants.Length == 0)
            {
                continue;
            }

            dbContext.RolePermissions.AddRange(grants);
            await dbContext.SaveChangesAsync(cancellationToken);

            logger.LogInformation(
                "'{Role}' rolüne {Count} başlangıç yetkisi verildi.", roleName, grants.Length);
        }
    }
}
