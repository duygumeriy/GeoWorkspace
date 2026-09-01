using System.Reflection;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Api.Hubs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Yolculuk Merkezi Faz 1: kişisel yolculuk ile paylaşılan hat simülasyonunun
/// yetki KİMLİKLERİNİN ayrıştırılması.
/// </summary>
/// <remarks>
/// <para>
/// Ölçülen iddia şudur: kişisel yolculuk artık kendi ürün kapısını
/// (<c>journey.use</c>) taşır ve bu kapı bir KAYNAK anahtarı değildir —
/// ulaşım rotası/durağı hâlâ <c>transport.view</c>, POI hâlâ <c>poi.view</c>
/// ister. Paylaşılan hattın yaşam döngüsü ise ayrı iki koddur
/// (<c>transport.simulation.start</c> / <c>transport.simulation.stop</c>) ve
/// izleme/takip HİÇBİRİNİ gerektirmez.
/// </para>
/// <para>
/// Kararların tamamı ETKİN YETKİ kodları üzerindendir. Hiçbir testte — ve
/// hiçbir üretim kod yolunda — rol adı, kullanıcı adı, <c>isAdmin</c> ya da
/// <c>isOperator</c> bir yetki kaynağı DEĞİLDİR; rol adları yalnızca başlangıç
/// verisi üretmek için okunur.
/// </para>
/// </remarks>
public class JourneyCenterPermissionFoundationTests
{
    private static readonly string[] NewCodes =
    [
        PermissionCodes.JourneyUse,
        PermissionCodes.TransportSimulationStop
    ];

    /* --- Kanonik kodlar ---------------------------------------------------------- */

    [Fact]
    public void The_two_new_capabilities_exist_as_canonical_codes()
    {
        Assert.Equal("journey.use", PermissionCodes.JourneyUse);
        Assert.Equal("transport.simulation.stop", PermissionCodes.TransportSimulationStop);

        Assert.All(NewCodes, code => Assert.Contains(code, PermissionCatalog.AllCodes));

        /* Kodlar birbirinden ve mevcut kodlardan AYRIDIR: başlatma ile
           durdurma tek koda birleştirilmedi, ürün kapısı da ulaşım
           görüntülemenin takma adı değildir. */
        Assert.NotEqual(PermissionCodes.TransportSimulationStart, PermissionCodes.TransportSimulationStop);
        Assert.NotEqual(PermissionCodes.TransportView, PermissionCodes.JourneyUse);
        Assert.Equal("transport.simulation.start", PermissionCodes.TransportSimulationStart);
    }

    [Fact]
    public void The_catalog_declares_them_with_usable_metadata_and_no_scope_suffix()
    {
        var journey = Single(PermissionCodes.JourneyUse);
        var stop = Single(PermissionCodes.TransportSimulationStop);

        Assert.Equal("Kişisel Yolculuk Kullanma", journey.Name);
        Assert.Equal("Ulaşım Simülasyonunu Durdurma", stop.Name);
        Assert.All(NewCodes, code => Assert.NotEmpty(Single(code).Description));

        /* Kişisel yolculuk KENDİ kategorisindedir: ortak ulaşım ağının bir
           parçası değildir ve yetki ekranında onunla tek grup gibi
           görünmemelidir. Kategori yalnızca GÖSTERİMDİR. */
        Assert.Equal(PermissionCategories.Journey, journey.Category);
        Assert.Equal(PermissionCategories.Transport, stop.Category);
        Assert.NotEqual(journey.Category, stop.Category);

        // Kapsam koda gömülmez (projenin kural kitabı).
        Assert.DoesNotContain(
            NewCodes,
            code => code.EndsWith(".own", StringComparison.Ordinal)
                || code.EndsWith(".all", StringComparison.Ordinal));
    }

    [Fact]
    public void The_catalog_stays_unique_and_the_phase_adds_exactly_two_codes()
    {
        Assert.Equal(
            PermissionCatalog.AllCodes.Count,
            PermissionCatalog.AllCodes.Distinct(StringComparer.Ordinal).Count());

        Assert.Equal(2, PermissionCatalog.AllCodes.Count(NewCodes.Contains));
        Assert.All(NewCodes, code => Assert.Single(PermissionCatalog.All, p => p.Code == code));

        // Gösterim sırası katalog genelinde çakışmaz.
        Assert.Equal(
            PermissionCatalog.All.Count,
            PermissionCatalog.All.Select(p => p.SortOrder).Distinct().Count());

        // Durdurma, başlatmanın hemen ardında okunur.
        Assert.True(
            Single(PermissionCodes.TransportSimulationStart).SortOrder
            < Single(PermissionCodes.TransportSimulationStop).SortOrder);
    }

    [Fact]
    public async Task Seeding_writes_both_codes_as_active_rows()
    {
        await using var scope = CreateScope();
        await SeedAsync(scope);

        var stored = await Db(scope).Permissions.Where(p => NewCodes.Contains(p.Code)).ToListAsync();

        Assert.Equal(2, stored.Count);
        Assert.All(stored, permission =>
        {
            Assert.True(permission.IsActive);
            Assert.NotEmpty(permission.Name);
        });
    }

    /* --- Varsayılan rol matrisi -------------------------------------------------- */

    [Fact]
    public void Ordinary_map_roles_may_use_the_personal_journey_and_read_the_transport_network()
    {
        foreach (var role in OrdinaryMapRoles)
        {
            var grants = RolePermissionDefaults.For(role);

            Assert.Contains(PermissionCodes.JourneyUse, grants);
            Assert.Contains(PermissionCodes.TransportView, grants);

            /* İZLEMEK ile İŞLETMEK ayrıdır: sıradan harita rolleri paylaşılan
               hattı başlatamaz ve durduramaz. */
            Assert.DoesNotContain(PermissionCodes.TransportSimulationStart, grants);
            Assert.DoesNotContain(PermissionCodes.TransportSimulationStop, grants);
        }
    }

    [Fact]
    public void The_transport_operator_gains_both_lifecycle_codes_and_the_journey_product()
    {
        var operatorGrants = RolePermissionDefaults.For(GisRoles.TransportOperator);

        Assert.Contains(PermissionCodes.TransportView, operatorGrants);
        Assert.Contains(PermissionCodes.JourneyUse, operatorGrants);
        Assert.Contains(PermissionCodes.TransportSimulationStart, operatorGrants);
        Assert.Contains(PermissionCodes.TransportSimulationStop, operatorGrants);
    }

    [Fact]
    public void The_transport_user_observes_but_never_operates_the_shared_simulation()
    {
        var grants = RolePermissionDefaults.For(GisRoles.TransportUser);

        Assert.Contains(PermissionCodes.TransportView, grants);
        Assert.Contains(PermissionCodes.JourneyUse, grants);
        Assert.DoesNotContain(PermissionCodes.TransportSimulationStart, grants);
        Assert.DoesNotContain(PermissionCodes.TransportSimulationStop, grants);
    }

    [Fact]
    public void The_administrator_list_is_the_catalog_itself()
    {
        /* Yönetici yetkileri elle sayılan bir listeden DEĞİL, katalogdan gelir;
           iddia bu yüzden "iki yeni kod eklendi" değil, "listesi kataloğun
           kendisidir" biçiminde kurulur. */
        Assert.Equal(
            PermissionCatalog.AllCodes.OrderBy(code => code, StringComparer.Ordinal),
            RolePermissionDefaults.For(GisRoles.Administrator).OrderBy(code => code, StringComparer.Ordinal));

        Assert.All(NewCodes, code => Assert.Contains(code, RolePermissionDefaults.For(GisRoles.Administrator)));
    }

    /* --- Mevcut kurulum genişlemesi ---------------------------------------------- */

    [Fact]
    public void Expansions_carry_the_same_distribution_as_the_default_matrix()
    {
        /* Genişlemenin işi yeni kodları ZATEN provision edilmiş rollere
           ULAŞTIRMAKTIR — farklı bir profil tanımlamak değil. İki liste
           ayrışırsa taze veritabanı ile mevcut veritabanı sessizce farklı
           davranmaya başlar. */
        foreach (var role in RoleCatalog.Canonical)
        {
            Assert.Equal(DefaultNewCodesOf(role), ExpansionNewCodesOf(role));
        }
    }

    [Fact]
    public void Expansions_touch_no_role_outside_the_canonical_set()
    {
        Assert.All(
            RolePermissionExpansions.All,
            expansion => Assert.Contains(expansion.RoleName, RoleCatalog.Canonical));

        Assert.All(NewCodes, code => Assert.Contains(code, RolePermissionExpansions.AllCodes));
    }

    [Fact]
    public async Task An_already_provisioned_role_still_receives_the_new_codes()
    {
        /* Asıl regresyon riski: RolePermissionDefaults YALNIZCA hiç yetkisi
           olmayan rolleri doldurur. Genişleme olmasaydı ayrıştırma, üzerinde
           çalıştığı kurulumlarda kişisel yolculuğu HERKESE kapatırdı. */
        await using var scope = CreateScope();

        var db = Db(scope);
        var roles = Roles(scope);

        await roles.CreateAsync(new IdentityRole<int>(GisRoles.Viewer));
        var viewer = await roles.FindByNameAsync(GisRoles.Viewer);

        db.Permissions.Add(new Permission
        {
            Code = PermissionCodes.MapView,
            Name = "Haritayı Görüntüleme",
            Category = PermissionCategories.Map
        });
        await db.SaveChangesAsync();

        var mapView = await db.Permissions.SingleAsync(p => p.Code == PermissionCodes.MapView);
        db.RolePermissions.Add(new RolePermission { RoleId = viewer!.Id, PermissionId = mapView.Id });
        await db.SaveChangesAsync();

        await SeedAsync(scope);

        var codes = await RoleCodesAsync(scope, GisRoles.Viewer);

        Assert.Contains(PermissionCodes.JourneyUse, codes);
        Assert.Contains(PermissionCodes.TransportView, codes);
        Assert.DoesNotContain(PermissionCodes.TransportSimulationStart, codes);
        Assert.DoesNotContain(PermissionCodes.TransportSimulationStop, codes);
    }

    [Fact]
    public async Task Reseeding_creates_no_duplicate_grants_for_the_new_codes()
    {
        await using var scope = CreateScope();

        await SeedAsync(scope);
        await SeedAsync(scope);

        var db = Db(scope);
        var ids = await db.Permissions.Where(p => NewCodes.Contains(p.Code)).Select(p => p.Id).ToListAsync();

        Assert.Equal(2, ids.Count);

        var pairs = await db.RolePermissions
            .Where(rp => ids.Contains(rp.PermissionId))
            .Select(rp => new { rp.RoleId, rp.PermissionId })
            .ToListAsync();

        Assert.Equal(pairs.Count, pairs.Distinct().Count());
    }

    [Fact]
    public async Task A_privileged_looking_custom_role_receives_nothing()
    {
        /* Rol ADI bir yetki kaynağı DEĞİLDİR. "Ulaşım Operatörü" gibi görünen
           bir özel rol, adı yüzünden hiçbir şey kazanmaz; yetkiyi yalnızca bir
           yöneticinin açık ataması verebilir. */
        await using var scope = CreateScope();

        var roles = Roles(scope);
        await roles.CreateAsync(new IdentityRole<int>("Ulaşım Operatörleri"));
        await roles.CreateAsync(new IdentityRole<int>("Süper Yönetici"));

        await SeedAsync(scope);

        Assert.Empty(await RoleCodesAsync(scope, "Ulaşım Operatörleri"));
        Assert.Empty(await RoleCodesAsync(scope, "Süper Yönetici"));
    }

    /* --- Etkin yetki motoru ------------------------------------------------------ */

    [Fact]
    public async Task A_custom_role_and_a_direct_grant_both_carry_the_new_codes()
    {
        /* Karar rol adına değil ETKİN YETKİYE bakar: kodu taşıyan ÖZEL bir rol
           de, doğrudan kullanıcı yetkisi de geçerlidir. */
        await using var scope = await SeededScopeAsync();

        var db = Db(scope);
        var roles = Roles(scope);

        await roles.CreateAsync(new IdentityRole<int>("Saha Ekibi"));
        var custom = await roles.FindByNameAsync("Saha Ekibi");

        var journey = await db.Permissions.SingleAsync(p => p.Code == PermissionCodes.JourneyUse);
        db.RolePermissions.Add(new RolePermission { RoleId = custom!.Id, PermissionId = journey.Id });
        await db.SaveChangesAsync();

        var viaRole = await CreateUserAsync(scope, "custom-role-journey", "Saha Ekibi");
        var viaDirect = await CreateUserAsync(scope, "direct-journey", role: null);

        var stop = await db.Permissions.SingleAsync(p => p.Code == PermissionCodes.TransportSimulationStop);
        db.UserPermissions.Add(new UserPermission { UserId = viaDirect.Id, PermissionId = stop.Id });
        await db.SaveChangesAsync();

        var service = scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>();

        Assert.True(await service.HasPermissionAsync(viaRole.Id, PermissionCodes.JourneyUse));
        Assert.False(await service.HasPermissionAsync(viaRole.Id, PermissionCodes.TransportSimulationStop));

        Assert.True(await service.HasPermissionAsync(viaDirect.Id, PermissionCodes.TransportSimulationStop));
        Assert.False(await service.HasPermissionAsync(viaDirect.Id, PermissionCodes.JourneyUse));
    }

    /* --- CASE C: ürün ile ağın karşılıklı bağımsızlığı --------------------------- */

    [Fact]
    public async Task Transport_view_alone_does_not_grant_the_personal_journey_product()
    {
        await using var scope = await SeededScopeAsync();

        var db = Db(scope);
        var user = await CreateUserAsync(scope, "shared-observer", role: null);

        var transportView = await db.Permissions.SingleAsync(p => p.Code == PermissionCodes.TransportView);
        db.UserPermissions.Add(new UserPermission { UserId = user.Id, PermissionId = transportView.Id });
        await db.SaveChangesAsync();

        var service = scope.ServiceProvider.GetRequiredService<IEffectivePermissionService>();

        // Paylaşılan hattı İZLER ve TAKİP EDER (takip bir yetki değildir)…
        Assert.True(await service.HasPermissionAsync(user.Id, PermissionCodes.TransportView));

        // …ama kişisel yolculuğu KULLANAMAZ ve hattı başlatıp durduramaz.
        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.JourneyUse));
        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.TransportSimulationStart));
        Assert.False(await service.HasPermissionAsync(user.Id, PermissionCodes.TransportSimulationStop));
    }

    /* --- Uç ve kanal sözleşmesi -------------------------------------------------- */

    [Fact]
    public void Every_personal_journey_endpoint_is_gated_by_the_product_permission()
    {
        var gated = new (Type Controller, string Method)[]
        {
            (typeof(JourneyPlanningController), nameof(JourneyPlanningController.Preview)),
            (typeof(JourneySimulationController), nameof(JourneySimulationController.Start)),
            (typeof(JourneySimulationController), nameof(JourneySimulationController.Current)),
            (typeof(JourneySimulationController), nameof(JourneySimulationController.Stop))
        };

        foreach (var (controller, methodName) in gated)
        {
            var required = Assert.Single(
                controller.GetMethod(methodName)!.GetCustomAttributes<RequirePermissionAttribute>(true));

            Assert.Equal(PermissionCodes.JourneyUse, required.PermissionCode);

            /* Eski bağlanma geri gelmemelidir: ürün kapısı ARTIK
               `transport.view` değildir. */
            Assert.NotEqual(PermissionCodes.TransportView, required.PermissionCode);
            Assert.NotEqual(PermissionCodes.TransportSimulationStart, required.PermissionCode);
            Assert.NotEqual(PermissionCodes.TransportSimulationStop, required.PermissionCode);
        }
    }

    [Fact]
    public void The_journey_hub_asks_the_effective_permission_engine_for_journey_use()
    {
        /* Hub metotlarına `RequirePermission` uygulanmaz (SignalR onu
           değerlendirmez); karar aynı servise DOĞRUDAN sorulur. Kanıt, hub'ın
           IL'inde okunan yetki kodu sabitidir. */
        var journeyHub = PermissionCodesUsedBy(typeof(JourneySimulationHub));
        var sharedHub = PermissionCodesUsedBy(typeof(TransportSimulationHub));

        Assert.Equal(new[] { PermissionCodes.JourneyUse }, journeyHub);

        // Paylaşılan hat kanalı DEĞİŞMEDİ: hâlâ transport.view okur.
        Assert.Equal(new[] { PermissionCodes.TransportView }, sharedHub);
    }

    [Fact]
    public void The_shared_transport_surface_keeps_its_existing_permissions()
    {
        var start = Assert.Single(
            typeof(TransportSimulationController)
                .GetMethod(nameof(TransportSimulationController.Start))!
                .GetCustomAttributes<RequirePermissionAttribute>(true));

        var read = Assert.Single(
            typeof(TransportSimulationController)
                .GetMethod(nameof(TransportSimulationController.GetActive))!
                .GetCustomAttributes<RequirePermissionAttribute>(true));

        Assert.Equal(PermissionCodes.TransportSimulationStart, start.PermissionCode);
        Assert.Equal(PermissionCodes.TransportView, read.PermissionCode);

        // Okuma ucu YENİ kodu istemeye başlamadı.
        Assert.NotEqual(PermissionCodes.TransportSimulationStop, read.PermissionCode);
        Assert.NotEqual(PermissionCodes.JourneyUse, read.PermissionCode);
    }

    [Fact]
    public void No_shared_stop_endpoint_or_service_command_was_introduced_in_this_phase()
    {
        /* Bu faz yalnızca KİMLİĞİ tanımlar. Kodu tüketen komut sonraki fazın
           işidir; şimdi eklenseydi yaşam döngüsü, üzerinde anlaşılmamış bir
           davranışla açılmış olurdu. */
        Assert.DoesNotContain(
            typeof(TransportSimulationController).GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly),
            method => method.GetCustomAttributes<RequirePermissionAttribute>(true)
                .Any(attribute => attribute.PermissionCode == PermissionCodes.TransportSimulationStop));

        Assert.DoesNotContain(
            typeof(ITransportSimulationService).GetMethods(),
            method => method.Name.Contains("Stop", StringComparison.Ordinal)
                || method.Name.Contains("Cancel", StringComparison.Ordinal));

        // Yeni kodu isteyen HİÇBİR uç yoktur (tüm API yüzeyi taranır).
        Assert.Empty(
            typeof(TransportSimulationController).Assembly
                .GetTypes()
                .Where(type => typeof(ControllerBase).IsAssignableFrom(type))
                .SelectMany(type => type.GetMethods(BindingFlags.Instance | BindingFlags.Public | BindingFlags.DeclaredOnly))
                .SelectMany(method => method.GetCustomAttributes<RequirePermissionAttribute>(true))
                .Where(attribute => attribute.PermissionCode == PermissionCodes.TransportSimulationStop));
    }

    [Fact]
    public void No_follow_or_unfollow_permission_code_was_invented()
    {
        /* Takip, KAMERA sahipliğidir ve bir yaşam döngüsü komutu değildir:
           "Takibi Bırak", "Simülasyonu Durdur" DEĞİLDİR. */
        Assert.DoesNotContain(
            PermissionCatalog.AllCodes,
            code => code.Contains("follow", StringComparison.OrdinalIgnoreCase)
                || code.Contains("takip", StringComparison.OrdinalIgnoreCase));
    }

    /* --- Yardımcılar -------------------------------------------------------------- */

    private static readonly string[] OrdinaryMapRoles =
    [
        GisRoles.Viewer,
        GisRoles.GisEditor,
        GisRoles.GisAnalyst,
        GisRoles.GisManager
    ];

    /// <summary>
    /// Bir tipin DERLENMİŞ gövdesinde gerçekten kullandığı kanonik yetki
    /// kodları.
    /// </summary>
    /// <remarks>
    /// Kaynak metni aramak yerine IL'deki <c>ldstr</c> sabitleri okunur: iddia
    /// "dosyada şu harfler geçiyor" değil, "bu tip gerçekten bu kodu
    /// kullanıyor"dur. Hub metotlarına <c>RequirePermission</c> uygulanamadığı
    /// (SignalR onu değerlendirmez) için karar burada başka türlü
    /// gözlemlenemez.
    /// </remarks>
    private static string[] PermissionCodesUsedBy(Type type) =>
        [.. PermissionCatalog.AllCodes
            .Where(code => ReferencesString(type, code))
            .OrderBy(code => code, StringComparer.Ordinal)];

    private static bool ReferencesString(Type type, string value)
    {
        const BindingFlags Members =
            BindingFlags.Instance | BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic
            | BindingFlags.DeclaredOnly;

        var module = type.Module;

        /* İÇ TİPLER de taranır ve bu ZORUNLUDUR: `async` bir metodun gövdesi
           derleyicinin ürettiği durum makinesine (nested `<Method>d__N`) taşınır,
           dolayısıyla yetki kodu sabiti metodun kendisinde değil orada bulunur. */
        IEnumerable<MethodBase> Bodies(Type current) =>
            current.GetMethods(Members).Cast<MethodBase>()
                .Concat(current.GetConstructors(Members))
                .Concat(current.GetNestedTypes(Members).SelectMany(Bodies));

        foreach (var method in Bodies(type))
        {
            byte[]? il;

            try
            {
                il = method.GetMethodBody()?.GetILAsByteArray();
            }
            catch (InvalidOperationException)
            {
                continue;
            }

            if (il is null)
            {
                continue;
            }

            for (var index = 0; index + 4 < il.Length; index++)
            {
                // 0x72 = ldstr, ardından 4 baytlık metadata token.
                if (il[index] != 0x72)
                {
                    continue;
                }

                var token = BitConverter.ToInt32(il, index + 1);

                try
                {
                    if (string.Equals(module.ResolveString(token), value, StringComparison.Ordinal))
                    {
                        return true;
                    }
                }
                catch (ArgumentException)
                {
                    // Rastlantısal olarak ldstr gibi görünen bir bayt dizisi.
                }
            }
        }

        return false;
    }

    private static PermissionCatalog.Definition Single(string code) =>
        Assert.Single(PermissionCatalog.All, p => p.Code == code);

    private static string[] DefaultNewCodesOf(string roleName) =>
        [.. RolePermissionDefaults.For(roleName).Where(NewCodes.Contains).OrderBy(c => c, StringComparer.Ordinal)];

    private static string[] ExpansionNewCodesOf(string roleName) =>
    [
        .. RolePermissionExpansions.All
            .Where(expansion => expansion.RoleName == roleName)
            .SelectMany(expansion => expansion.PermissionCodes)
            .Where(NewCodes.Contains)
            .Distinct(StringComparer.Ordinal)
            .OrderBy(code => code, StringComparer.Ordinal)
    ];

    private static AppDbContext Db(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<AppDbContext>();

    private static RoleManager<IdentityRole<int>> Roles(AsyncServiceScope scope) =>
        scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

    private static async Task<string[]> RoleCodesAsync(AsyncServiceScope scope, string roleName)
    {
        var db = Db(scope);
        var role = await Roles(scope).FindByNameAsync(roleName);

        Assert.NotNull(role);

        var codes = await db.RolePermissions
            .Where(rp => rp.RoleId == role!.Id)
            .Join(db.Permissions, rp => rp.PermissionId, p => p.Id, (_, p) => p.Code)
            .ToListAsync();

        return [.. codes.OrderBy(code => code, StringComparer.Ordinal)];
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

    private static Task SeedAsync(AsyncServiceScope scope) =>
        AuthorizationDataSeeder.SeedAsync(
            Db(scope),
            Roles(scope),
            scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("JourneyCenterSeed"));

    private static async Task<AsyncServiceScope> SeededScopeAsync()
    {
        var scope = CreateScope();
        await SeedAsync(scope);
        return scope;
    }

    private static AsyncServiceScope CreateScope()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IDataProtectionProvider>(new EphemeralDataProtectionProvider());
        services.AddDbContext<AppDbContext>(options =>
            options.UseInMemoryDatabase($"journey-center-permissions-{Guid.NewGuid():N}"));
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
