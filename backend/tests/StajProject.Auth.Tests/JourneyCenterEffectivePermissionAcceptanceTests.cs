using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Yolculuk Merkezi Faz 11: ETKİN YETKİ kabulü.
/// </summary>
/// <remarks>
/// <para>
/// Bu sınıf tek bir iddiayı, motorun kendisini çalıştırarak kanıtlar:
/// <b>etkin yetki = rol yetkileri ∪ doğrudan kullanıcı yetkileri</b> ve bu
/// kümenin dışında hiçbir şey — rol ADI, kullanıcı adı, ayrıcalıklı görünen
/// bir etiket — Yolculuk Merkezi yeteneği üretmez.
/// </para>
/// <para>
/// Faz 1'deki temel testler kataloğu, dağıtımı ve uç sözleşmesini çiviler;
/// burada ölçülen şey ÇALIŞMA ZAMANI kararıdır: aynı kod kümesi, kaynağı ve
/// taşıyıcısının adı ne olursa olsun aynı cevabı verir.
/// </para>
/// <para>
/// Rol adları yalnızca birer KABUL SENARYOSUDUR ve üretim koduna hiçbir
/// biçimde girmez.
/// </para>
/// </remarks>
public class JourneyCenterEffectivePermissionAcceptanceTests
{
    private static readonly string[] JourneyCenterCodes =
    [
        PermissionCodes.JourneyUse,
        PermissionCodes.TransportView,
        PermissionCodes.TransportSimulationStart,
        PermissionCodes.TransportSimulationStop
    ];

    /* --- A/B. Kişisel ürün: kaynak fark etmez ------------------------------------ */

    [Fact]
    public async Task Journey_use_is_effective_from_a_role_and_from_a_direct_grant_alike()
    {
        await using var scope = await SeededScopeAsync();

        var viaRole = await UserWithRoleAsync(scope, "a-role-journey", "Saha Ekibi", PermissionCodes.JourneyUse);
        var viaDirect = await UserWithDirectAsync(scope, "b-direct-journey", PermissionCodes.JourneyUse);

        var service = Permissions(scope);

        // İki yol AYNI etkin kümeyi üretir.
        Assert.Equal(
            new[] { PermissionCodes.JourneyUse },
            await JourneyCenterCodesOfAsync(service, viaRole.Id));
        Assert.Equal(
            new[] { PermissionCodes.JourneyUse },
            await JourneyCenterCodesOfAsync(service, viaDirect.Id));
    }

    /* --- C/D. Bölünmüş kaynaklar tek küme olur ----------------------------------- */

    [Fact]
    public async Task Role_permissions_and_direct_grants_combine_into_one_effective_set()
    {
        await using var scope = await SeededScopeAsync();

        // C) rol: transport.view — doğrudan: start
        var observerStarter = await UserWithRoleAsync(
            scope, "c-observer-starter", "Hat Gözcüsü", PermissionCodes.TransportView);
        await GrantDirectAsync(scope, observerStarter, PermissionCodes.TransportSimulationStart);

        // D) rol: view + start — doğrudan: stop
        var dispatcher = await UserWithRoleAsync(
            scope, "d-dispatcher", "Journey Dispatcher",
            PermissionCodes.TransportView, PermissionCodes.TransportSimulationStart);
        await GrantDirectAsync(scope, dispatcher, PermissionCodes.TransportSimulationStop);

        var service = Permissions(scope);

        Assert.Equal(
            new[] { PermissionCodes.TransportSimulationStart, PermissionCodes.TransportView },
            await JourneyCenterCodesOfAsync(service, observerStarter.Id));

        /* D) TAM yaşam döngüsü: yeniden başlatma İKİ kodu birden ister ve ikisi
           AYRI kaynaklardan gelmiş olsa da birleşir. */
        Assert.Equal(
            new[]
            {
                PermissionCodes.TransportSimulationStart,
                PermissionCodes.TransportSimulationStop,
                PermissionCodes.TransportView
            },
            await JourneyCenterCodesOfAsync(service, dispatcher.Id));

        // Aynı kod hem rolden hem doğrudan gelirse yine TEK kez görünür (UNION).
        await GrantDirectAsync(scope, dispatcher, PermissionCodes.TransportView);

        Assert.Equal(
            new[]
            {
                PermissionCodes.TransportSimulationStart,
                PermissionCodes.TransportSimulationStop,
                PermissionCodes.TransportView
            },
            await JourneyCenterCodesOfAsync(service, dispatcher.Id));
    }

    /* --- E. Yalnızca gözlem ------------------------------------------------------ */

    [Fact]
    public async Task Transport_view_alone_carries_no_lifecycle_capability()
    {
        await using var scope = await SeededScopeAsync();

        var viewer = await UserWithRoleAsync(
            scope, "e-viewer", "Hat İzleyici", PermissionCodes.TransportView);

        var service = Permissions(scope);

        Assert.True(await service.HasPermissionAsync(viewer.Id, PermissionCodes.TransportView));
        Assert.False(await service.HasPermissionAsync(viewer.Id, PermissionCodes.TransportSimulationStart));
        Assert.False(await service.HasPermissionAsync(viewer.Id, PermissionCodes.TransportSimulationStop));
        Assert.False(await service.HasPermissionAsync(viewer.Id, PermissionCodes.JourneyUse));
    }

    /* --- F. Okuma olmadan başlatma ------------------------------------------------ */

    [Fact]
    public async Task The_start_code_never_stands_in_for_the_read_code()
    {
        /* Yeni bir davranış UYDURULMAZ: başlatma yetkisi tek başına ulaşım
           ağını okumaya yetmez ve hiçbir rol kestirmesi bu boşluğu kapatmaz.
           Ürün erişiminin sahibi hâlâ `transport.view`tir. */
        await using var scope = await SeededScopeAsync();

        var starter = await UserWithRoleAsync(
            scope, "f-starter", "Yalnız Başlatıcı", PermissionCodes.TransportSimulationStart);

        var service = Permissions(scope);

        Assert.True(await service.HasPermissionAsync(starter.Id, PermissionCodes.TransportSimulationStart));
        Assert.False(await service.HasPermissionAsync(starter.Id, PermissionCodes.TransportView));
    }

    /* --- G. Hiçbir ilgili yetki --------------------------------------------------- */

    [Fact]
    public async Task A_user_with_no_relevant_permission_receives_no_journey_center_capability()
    {
        await using var scope = await SeededScopeAsync();

        var stranger = await UserWithRoleAsync(scope, "g-stranger", "Yabancı");

        Assert.Empty(await JourneyCenterCodesOfAsync(Permissions(scope), stranger.Id));
    }

    /* --- 4. ÖZEL ROL: ad hiçbir şey ifade etmez ----------------------------------- */

    [Fact]
    public async Task Two_differently_named_roles_with_identical_permissions_behave_identically()
    {
        /* Rol adı DEĞİŞİR, kod kümesi AYNI KALIR: etkin yetki de aynı kalır.
           Adlar birer kabul senaryosudur; hiçbiri üretim mantığına girmez. */
        await using var scope = await SeededScopeAsync();

        var codes = new[]
        {
            PermissionCodes.TransportView,
            PermissionCodes.TransportSimulationStart,
            PermissionCodes.TransportSimulationStop
        };

        var service = Permissions(scope);
        string[]? reference = null;

        foreach (var roleName in new[] { "Journey Dispatcher", "Foo", "Intern", "Temporary", "XYZ" })
        {
            var user = await UserWithRoleAsync(scope, $"custom-{roleName.Replace(' ', '-')}", roleName, codes);
            var effective = await JourneyCenterCodesOfAsync(service, user.Id);

            reference ??= effective;
            Assert.Equal(reference, effective);
        }

        Assert.NotNull(reference);
        Assert.Equal(
            new[]
            {
                PermissionCodes.TransportSimulationStart,
                PermissionCodes.TransportSimulationStop,
                PermissionCodes.TransportView
            },
            reference);
    }

    [Fact]
    public async Task Renaming_a_role_changes_nothing_while_its_permissions_stay_the_same()
    {
        await using var scope = await SeededScopeAsync();

        var user = await UserWithRoleAsync(
            scope, "rename-subject", "Geçici Ekip",
            PermissionCodes.JourneyUse, PermissionCodes.TransportView);

        var service = Permissions(scope);
        var before = await JourneyCenterCodesOfAsync(service, user.Id);

        var roles = Roles(scope);
        var role = await roles.FindByNameAsync("Geçici Ekip");
        Assert.NotNull(role);
        Assert.True((await roles.SetRoleNameAsync(role!, "Administrator Ekibi")).Succeeded);
        Assert.True((await roles.UpdateAsync(role!)).Succeeded);

        // Ad ayrıcalıklı görünmeye başladı; yetki kümesi DEĞİŞMEDİ.
        Assert.Equal(before, await JourneyCenterCodesOfAsync(service, user.Id));
        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.TransportSimulationStart));
        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.TransportSimulationStop));
    }

    [Fact]
    public async Task An_admin_named_role_without_permissions_gains_no_journey_center_access()
    {
        /* Ad bir yetki kaynağı DEĞİLDİR. Motorda `IsInRole("Admin")` benzeri
           bir süper kullanıcı geçişi yoktur; olsaydı tam olarak burada
           görünürdü. */
        await using var scope = await SeededScopeAsync();

        var service = Permissions(scope);

        var impostorRoles = new[] { "Admin", "Administrator Yardımcısı", "SuperAdmin", "Operator" };

        for (var index = 0; index < impostorRoles.Length; index++)
        {
            /* Kullanıcı adı ASCII tutulur: Identity'nin varsayılan kullanıcı adı
               doğrulayıcısı Türkçe harfleri kabul etmez ve testin ölçtüğü şey rol
               ADI, kullanıcı adı değildir. */
            var roleName = impostorRoles[index];
            var user = await UserWithRoleAsync(scope, $"impostor-{index}", roleName);

            Assert.Empty(await JourneyCenterCodesOfAsync(service, user.Id));

            foreach (var code in JourneyCenterCodes)
            {
                Assert.False(
                    await service.HasPermissionAsync(user.Id, code),
                    $"'{roleName}' adı {code} yetkisini üretti");
            }
        }
    }

    /* --- Ürün yalıtımı ------------------------------------------------------------ */

    [Fact]
    public async Task The_two_products_are_authorized_independently()
    {
        await using var scope = await SeededScopeAsync();

        var personal = await UserWithDirectAsync(scope, "iso-personal", PermissionCodes.JourneyUse);
        var shared = await UserWithDirectAsync(scope, "iso-shared", PermissionCodes.TransportView);
        var both = await UserWithDirectAsync(
            scope, "iso-both", PermissionCodes.JourneyUse, PermissionCodes.TransportView);

        var service = Permissions(scope);

        Assert.Equal(new[] { PermissionCodes.JourneyUse }, await JourneyCenterCodesOfAsync(service, personal.Id));
        Assert.Equal(new[] { PermissionCodes.TransportView }, await JourneyCenterCodesOfAsync(service, shared.Id));
        Assert.Equal(
            new[] { PermissionCodes.JourneyUse, PermissionCodes.TransportView },
            await JourneyCenterCodesOfAsync(service, both.Id));
    }

    /* --- Yardımcılar -------------------------------------------------------------- */

    /// <summary>
    /// Kullanıcının Yolculuk Merkezi'ni ilgilendiren ETKİN kodları, kararlı
    /// sırada. Diğer kodlar (map.view, poi.view …) bilinçli olarak elenir:
    /// ölçülen şey bu ürünün yetkilendirmesidir.
    /// </summary>
    private static async Task<string[]> JourneyCenterCodesOfAsync(
        IEffectivePermissionService service,
        int userId)
    {
        var codes = await service.GetEffectivePermissionCodesAsync(userId);

        return [.. codes
            .Where(JourneyCenterCodes.Contains)
            .OrderBy(code => code, StringComparer.Ordinal)];
    }

    private static async Task<User> UserWithRoleAsync(
        AsyncServiceScope scope,
        string userName,
        string roleName,
        params string[] codes)
    {
        var roles = Roles(scope);

        if (await roles.FindByNameAsync(roleName) is null)
        {
            Assert.True((await roles.CreateAsync(new IdentityRole<int>(roleName))).Succeeded);
        }

        var role = await roles.FindByNameAsync(roleName);
        Assert.NotNull(role);

        var db = Db(scope);

        foreach (var code in codes)
        {
            var permission = await db.Permissions.SingleAsync(p => p.Code == code);

            var already = await db.RolePermissions
                .AnyAsync(rp => rp.RoleId == role!.Id && rp.PermissionId == permission.Id);

            if (!already)
            {
                db.RolePermissions.Add(new RolePermission { RoleId = role!.Id, PermissionId = permission.Id });
            }
        }

        await db.SaveChangesAsync();

        return await CreateUserAsync(scope, userName, roleName);
    }

    private static async Task<User> UserWithDirectAsync(
        AsyncServiceScope scope,
        string userName,
        params string[] codes)
    {
        var user = await CreateUserAsync(scope, userName, role: null);
        await GrantDirectAsync(scope, user, codes);
        return user;
    }

    private static async Task GrantDirectAsync(AsyncServiceScope scope, User user, params string[] codes)
    {
        var db = Db(scope);

        foreach (var code in codes)
        {
            var permission = await db.Permissions.SingleAsync(p => p.Code == code);

            var already = await db.UserPermissions
                .AnyAsync(up => up.UserId == user.Id && up.PermissionId == permission.Id);

            if (!already)
            {
                db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = permission.Id });
            }
        }

        await db.SaveChangesAsync();
    }

    private static async Task<User> CreateUserAsync(AsyncServiceScope scope, string userName, string? role)
    {
        var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

        var user = new User
        {
            UserName = userName,
            Email = $"{userName}@example.invalid",
            EmailConfirmed = true,
            AccountStatus = AccountStatus.Active,
            IsActive = true,
            IsDeleted = false
        };

        Assert.True((await users.CreateAsync(user, "Str0ng!Password")).Succeeded);

        if (role is not null)
        {
            Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
        }

        return user;
    }

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static RoleManager<IdentityRole<int>> Roles(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

    private static IEffectivePermissionService Permissions(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>();

    private static async Task<AsyncServiceScope> SeededScopeAsync()
    {
        var scope = CreateScope();

        await AuthorizationDataSeeder.SeedAsync(
            Db(scope),
            Roles(scope),
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("JourneyCenterAcceptance"));

        return scope;
    }

    private static AsyncServiceScope CreateScope()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options =>
            options.UseInMemoryDatabase($"journey-center-acceptance-{Guid.NewGuid():N}"));
        services
            .AddIdentityCore<User>(options =>
            {
                options.Password.RequiredLength = 8;
                options.User.RequireUniqueEmail = true;
            })
            .AddRoles<IdentityRole<int>>()
            .AddEntityFrameworkStores<AppDbContext>()
            .AddDefaultTokenProviders();

        services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();

        return services.BuildServiceProvider().CreateAsyncScope();
    }
}
