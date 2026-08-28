using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Authorization.Policy;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Microsoft.IdentityModel.Tokens;
using NSubstitute;
using StajProject.Api.Activity;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Api.Services;
using StajProject.Application.Common;
using StajProject.Application.Activity;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Application.Routing;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Authentication;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Aktivite geçmişi (Phase 9): neyin kaydedildiği, neyin ASLA kaydedilmediği
/// ve kaydı kimin okuyabildiği.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu dosyanın en önemli testleri "yazılmayanlar"dır.</b> Bir denetim
/// kaydının en büyük riski, sistemin geri kalanının sırlarını tek bir tabloda
/// toplamasıdır. Aşağıdaki testler bunun yapısal olarak imkânsız olduğunu
/// ölçer: kaydedilecek uçlar bir izin listesindedir ve ayrıntılara istek
/// gövdesinden hiçbir METİN giremez.
/// </para>
/// <para>
/// <b>Kayıt bir istek izi değildir.</b> Okuma çağrıları hiç kaydedilmez;
/// aksi hâlde tablo, "kim neyi değiştirdi" sorusunun cevabını gürültünün
/// içinde kaybederdi.
/// </para>
/// </remarks>
public class ActivityHistoryTests
{
    private const string JwtKey = "activity-history-tests-signing-key-01234567890123456789";
    private const string Issuer = "StajProject.Api";
    private const string Audience = "StajProject.Client";

    private const string Area = "POLYGON ((32 39, 33 39, 33 40, 32 40, 32 39))";

    private static readonly string[] GeographyWrite =
        [PermissionCodes.UsersView, PermissionCodes.UsersUpdate, PermissionCodes.GeographyView, PermissionCodes.GeographyManage];

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    /* --- İzin listesinin sınırları ---------------------------------------------------- */

    [Fact]
    public void No_authentication_or_account_endpoint_can_ever_be_recorded()
    {
        /* Kayıt kapsamı bir YASAK listesiyle değil, İZİN listesiyle
           tanımlıdır. Bu test o tasarımın bekçisidir: oturum açma, parola
           sıfırlama, 2FA ve e-posta doğrulama uçlarını taşıyan controller
           listede hiç geçmez, dolayısıyla gövdeleri kayda hiç ulaşamaz.
           Ters tasarımda, yarın eklenecek bir parola ucu kaydedilenler
           kümesine SESSİZCE girerdi. */
        Assert.DoesNotContain(ActivityActionRegistry.Keys, key => key.StartsWith("Auth.", StringComparison.Ordinal));

        Assert.Null(ActivityActionRegistry.Find("Auth", "Login"));
        Assert.Null(ActivityActionRegistry.Find("Auth", "ResetPassword"));
        Assert.Null(ActivityActionRegistry.Find("Auth", "ChangePassword"));
        Assert.Null(ActivityActionRegistry.Find("Auth", "Enable"));
        Assert.Null(ActivityActionRegistry.Find("Auth", "RegenerateRecoveryCodes"));
    }

    [Fact]
    public void Every_registered_action_maps_to_a_known_catalog_code()
    {
        // Kayıt tablosundaki her kod kataloğun içinde OLMALIDIR; olmasaydı
        // ekranda ham bir kod belirir ve filtre listesinde hiç görünmezdi.
        foreach (var key in ActivityActionRegistry.Keys)
        {
            var parts = key.Split('.', 2);
            var descriptor = ActivityActionRegistry.Find(parts[0], parts[1]);

            Assert.NotNull(descriptor);
            Assert.Contains(descriptor!.Action, ActivityActionCatalog.AllCodes);
        }
    }

    [Theory]
    [InlineData("CreateRoute", ActivityActionCatalog.TransportRouteCreate, "transport_route", null)]
    [InlineData("UpdateRoute", ActivityActionCatalog.TransportRouteUpdate, "transport_route", "id")]
    [InlineData("DeleteRoute", ActivityActionCatalog.TransportRouteDelete, "transport_route", "id")]
    [InlineData("RestoreRoute", ActivityActionCatalog.TransportRouteRestore, "transport_route", "id")]
    [InlineData("ReorderStops", ActivityActionCatalog.TransportRouteReorder, "transport_route", "routeId")]
    [InlineData("GenerateRoutePath", ActivityActionCatalog.TransportRouteGenerate, "transport_route", "routeId")]
    [InlineData("CreateStop", ActivityActionCatalog.TransportStopCreate, "transport_stop", null)]
    [InlineData("UpdateStop", ActivityActionCatalog.TransportStopUpdate, "transport_stop", "id")]
    [InlineData("DeleteStop", ActivityActionCatalog.TransportStopDelete, "transport_stop", "id")]
    [InlineData("RestoreStop", ActivityActionCatalog.TransportStopRestore, "transport_stop", "id")]
    public void Every_transport_mutation_has_an_explicit_activity_descriptor(
        string action,
        string expectedCode,
        string expectedResource,
        string? expectedRouteKey)
    {
        var descriptor = ActivityActionRegistry.Find("Transport", action);
        Assert.NotNull(descriptor);
        Assert.Equal(expectedCode, descriptor!.Action);
        Assert.Equal(expectedResource, descriptor.ResourceType);
        Assert.Equal(expectedRouteKey, descriptor.ResourceRouteKey);
        Assert.NotEqual(expectedCode, ActivityActionCatalog.NameOf(expectedCode));
    }

    [Theory]
    [InlineData("GetRoutes")]
    [InlineData("GetRoute")]
    [InlineData("GetRouteStops")]
    [InlineData("GetStops")]
    [InlineData("GetDeletedStops")]
    [InlineData("GetOwnStops")]
    [InlineData("GetRouteTrash")]
    [InlineData("GetStopTrash")]
    public void Transport_reads_are_not_activity_mutations(string action) =>
        Assert.Null(ActivityActionRegistry.Find("Transport", action));

    [Fact]
    public void Details_never_carry_text_from_the_request_body()
    {
        /* Gövdede bir parola, bir kurtarma kodu ve bir poligonun tüm WKT'si
           var. Hiçbiri ayrıntılara giremez, çünkü kural alan ADINA değil
           TİPİNE bakar: string alanlar yapısal olarak elenir. Bu yüzden
           "şu alanı hariç tut" listesi tutmaya da gerek yoktur. */
        var body = new SaveGeographicAreaRequest
        {
            Wkt = Area,
            Name = "Gizli-Alan-Adı",
            SourceType = GeographicAreaSource.Province,
            SourceKey = "TR-06"
        };

        var details = ActivityDetails.Build(
            new Dictionary<string, object?> { ["controller"] = "AdminUsers", ["action"] = "Create", ["id"] = 104 },
            new Dictionary<string, object?> { ["request"] = body, ["secret"] = "Str0ng!Password" });

        Assert.NotNull(details);
        Assert.DoesNotContain("POLYGON", details);
        Assert.DoesNotContain("Gizli-Alan-Adı", details);
        Assert.DoesNotContain("Str0ng!Password", details);
        Assert.DoesNotContain("TR-06", details);

        // Buna karşılık güvenli olanlar GİRER: rota kimliği ve enum tipli alan.
        Assert.Contains("104", details);
        Assert.Contains("Province", details);
    }

    [Fact]
    public void Route_values_that_are_not_short_identifiers_are_dropped()
    {
        // Rotalar bugün tamsayı kısıtlıdır; denetim, ileride eklenecek serbest
        // bir rota parçasının kayda keyfi metin taşımasını engeller.
        var details = ActivityDetails.Build(
            new Dictionary<string, object?>
            {
                ["controller"] = "AdminUsers",
                ["action"] = "Create",
                ["note"] = "boşluklu ve uzun bir serbest metin; kayda girmemeli"
            },
            new Dictionary<string, object?>());

        Assert.Null(details);
    }

    /* --- Neyin kaydedildiği ----------------------------------------------------------- */

    [Fact]
    public async Task Creating_a_geographic_area_is_recorded_with_actor_and_resource()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("geo-admin", [.. GeographyWrite, PermissionCodes.ActivityView]);
        var target = await host.CreateUserAsync("scoped-user");

        await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), new SaveGeographicAreaRequest
        {
            Wkt = Area,
            Name = "Ankara",
            SourceType = GeographicAreaSource.Province,
            SourceKey = "TR-06"
        });

        var entry = Assert.Single(await host.LogsAsync());

        Assert.Equal(ActivityActionCatalog.GeographicAreaCreate, entry.Action);
        Assert.Equal(actor.Id, entry.ActorUserId);
        Assert.Equal("geo-admin", entry.ActorUsername);
        Assert.Equal("user", entry.ResourceType);
        Assert.Equal(target.Id.ToString(), entry.ResourceId);
        Assert.Equal("POST", entry.HttpMethod);
        Assert.Equal(200, entry.StatusCode);

        /* Poligonun kendisi kayda GİRMEZ. Denetim kaydı "sınır değiştirildi"
           der; sınırın ne olduğu coğrafi tablonun işidir. */
        Assert.DoesNotContain("POLYGON", entry.Details ?? string.Empty);
        Assert.DoesNotContain("Ankara", entry.Details ?? string.Empty);
    }

    [Fact]
    public async Task Reading_is_never_recorded()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("reader", [.. GeographyWrite, PermissionCodes.ActivityView]);
        var target = await host.CreateUserAsync("read-target");

        await host.Client(actor).GetAsync(UserAreas(target.Id));
        await host.Client(actor).GetAsync("/api/admin/activity");

        // Tablo bir istek izi değildir: okumalar hiç girmez.
        Assert.Empty(await host.LogsAsync());
    }

    [Fact]
    public async Task Successful_transport_mutations_are_recorded_with_actor_action_and_resource()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("transport-auditor", [
            PermissionCodes.TransportRouteCreate,
            PermissionCodes.TransportRouteUpdate,
            PermissionCodes.TransportRouteDelete,
            PermissionCodes.TransportRouteRestore,
            PermissionCodes.TransportRouteReorder,
            PermissionCodes.TransportStopCreate,
            PermissionCodes.TransportStopUpdate,
            PermissionCodes.TransportStopDelete,
            PermissionCodes.TransportStopRestore
        ]);
        var client = host.Client(actor);

        await client.PostAsJsonAsync("/api/transport/routes", new CreateTransportRouteRequest { Name = "Hat", ColorHex = "#6D4AFF" });
        await client.PutAsJsonAsync("/api/transport/routes/12", new UpdateTransportRouteRequest { Name = "Hat 2", ColorHex = "#6D4AFF" });
        await client.DeleteAsync("/api/transport/routes/12");
        await client.PostAsync("/api/transport/routes/12/restore", null);
        await client.PostAsync("/api/transport/routes/12/path/generate", null);
        await client.PutAsJsonAsync("/api/transport/routes/12/stops/order", new ReorderTransportStopsRequest { StopIds = [37] });
        await client.PostAsJsonAsync("/api/transport/stops", new CreateTransportStopRequest { Name = "Durak", RouteId = 12, Longitude = 32.85, Latitude = 39.93 });
        await client.PutAsJsonAsync("/api/transport/stops/37", new UpdateTransportStopRequest { Name = "Durak 2", RouteId = 12, Longitude = 32.86, Latitude = 39.94 });
        await client.PutAsJsonAsync("/api/transport/stops/38", new UpdateTransportStopRequest { Name = "Aktarma", RouteId = 13, Longitude = 32.85, Latitude = 39.93 });
        await client.DeleteAsync("/api/transport/stops/37");
        await client.PostAsync("/api/transport/stops/37/restore", null);

        var logs = await host.LogsAsync();
        Assert.Equal([
            ActivityActionCatalog.TransportRouteCreate,
            ActivityActionCatalog.TransportRouteUpdate,
            ActivityActionCatalog.TransportRouteDelete,
            ActivityActionCatalog.TransportRouteRestore,
            ActivityActionCatalog.TransportRouteGenerate,
            ActivityActionCatalog.TransportRouteReorder,
            ActivityActionCatalog.TransportStopCreate,
            ActivityActionCatalog.TransportStopCoordinateMove,
            ActivityActionCatalog.TransportStopTransfer,
            ActivityActionCatalog.TransportStopDelete,
            ActivityActionCatalog.TransportStopRestore
        ], logs.Select(log => log.Action));
        Assert.All(logs, log => Assert.Equal(actor.Id, log.ActorUserId));
        Assert.All(logs, log => Assert.InRange(log.StatusCode, 200, 299));
        Assert.Equal("12", logs.Single(log => log.Action == ActivityActionCatalog.TransportRouteReorder).ResourceId);
        Assert.Equal("37", logs.Single(log => log.Action == ActivityActionCatalog.TransportStopCoordinateMove).ResourceId);
        Assert.Equal("38", logs.Single(log => log.Action == ActivityActionCatalog.TransportStopTransfer).ResourceId);
        Assert.Contains("orderedStopIds", logs.Single(log => log.Action == ActivityActionCatalog.TransportRouteReorder).Details);
        Assert.Contains("distanceMeters", logs.Single(log => log.Action == ActivityActionCatalog.TransportRouteGenerate).Details);
        var transferDetails = logs.Single(log => log.Action == ActivityActionCatalog.TransportStopTransfer).Details ?? string.Empty;
        Assert.Contains("sourceRouteId", transferDetails);
        Assert.Contains("destinationRouteId", transferDetails);
        Assert.DoesNotContain("longitude", transferDetails, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("latitude", transferDetails, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Transport_reads_and_mine_do_not_create_activity_rows()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("transport-reader", [PermissionCodes.TransportView]);
        var client = host.Client(actor);

        await client.GetAsync("/api/transport/routes");
        await client.GetAsync("/api/transport/routes/12");
        await client.GetAsync("/api/transport/routes/12/stops");
        await client.GetAsync("/api/transport/stops/mine");

        Assert.Empty(await host.LogsAsync());
    }

    [Fact]
    public async Task Failed_route_generation_is_recorded_as_failure_without_a_misleading_success_outcome()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("route-generator", [PermissionCodes.TransportRouteUpdate]);

        var response = await host.Client(actor).PostAsync("/api/transport/routes/999/path/generate", null);

        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        var entry = Assert.Single(await host.LogsAsync());
        Assert.Equal(ActivityActionCatalog.TransportRouteGenerate, entry.Action);
        Assert.Equal(502, entry.StatusCode);
        Assert.Contains("\"routeGenerated\":false", entry.Details);
        Assert.DoesNotContain("localhost", entry.Details ?? string.Empty);
    }

    [Fact]
    public async Task A_failed_mutation_is_recorded_with_its_status()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("clumsy-admin", [.. GeographyWrite, PermissionCodes.ActivityView]);
        var target = await host.CreateUserAsync("victim");

        // Kendisiyle kesişen halka → 400.
        await host.Client(actor).PostAsJsonAsync(
            UserAreas(target.Id),
            new SaveGeographicAreaRequest { Wkt = "POLYGON ((0 0, 10 10, 10 0, 0 10, 0 0))" });

        var entry = Assert.Single(await host.LogsAsync());

        // Başarısız deneme de bir denetim olayıdır.
        Assert.Equal(400, entry.StatusCode);
        Assert.False(entry.StatusCode is >= 200 and < 300);
    }

    [Fact]
    public async Task An_authorization_denial_is_recorded()
    {
        await using var host = await StartAsync();
        // Coğrafi yönetim yetkisi OLMAYAN ama kimliği doğrulanmış bir aktör.
        var actor = await host.CreateActorAsync("under-privileged", [PermissionCodes.UsersView, PermissionCodes.UsersUpdate]);
        var target = await host.CreateUserAsync("protected-user");

        var response = await host.Client(actor).PostAsJsonAsync(
            UserAreas(target.Id), new SaveGeographicAreaRequest { Wkt = Area });

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        /* Yetkilendirme MVC filtrelerinden ÖNCE çalışır ve action hiç
           çağrılmaz; "denendi ama yetkisi yoktu" kaydı tam da bu yüzden ayrı
           bir yoldan yazılır. */
        var entry = Assert.Single(await host.LogsAsync());
        Assert.Equal(403, entry.StatusCode);
        Assert.Equal(actor.Id, entry.ActorUserId);
        Assert.Equal(ActivityActionCatalog.GeographicAreaCreate, entry.Action);
    }

    [Fact]
    public async Task An_anonymous_request_writes_nothing()
    {
        await using var host = await StartAsync();
        var target = await host.CreateUserAsync("anon-target");

        await host.Client().PostAsJsonAsync(UserAreas(target.Id), new SaveGeographicAreaRequest { Wkt = Area });

        // Aktörü olmayan bir satır hiçbir soruyu yanıtlamaz; yazılmaz.
        Assert.Empty(await host.LogsAsync());
    }

    /* --- Okuma ucu: yetki ------------------------------------------------------------- */

    [Fact]
    public async Task The_activity_endpoint_rejects_anonymous_callers()
    {
        await using var host = await StartAsync();

        Assert.Equal(HttpStatusCode.Unauthorized, (await host.Client().GetAsync(Activity)).StatusCode);
    }

    [Fact]
    public async Task A_password_only_token_cannot_read_the_activity_history()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("single-factor", [PermissionCodes.ActivityView]);

        /* Kayıt tüm yöneticilerin hareketlerini gösterir ve en az onlar kadar
           korunmalıdır: diğer yönetim uçlarıyla aynı ikinci faktör şartı. */
        var response = await host.Client(actor, AuthenticationLevel.Password).GetAsync(Activity);

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task Reading_the_activity_history_requires_activity_view()
    {
        await using var host = await StartAsync();

        // Kullanıcı ve yetki yönetiminin tamamı bile aktivite geçmişini AÇMAZ.
        var without = await host.CreateActorAsync("no-activity", [
            PermissionCodes.UsersView, PermissionCodes.UsersUpdate,
            PermissionCodes.RolesView, PermissionCodes.PermissionsView
        ]);
        var with = await host.CreateActorAsync("with-activity", [PermissionCodes.ActivityView]);

        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(without).GetAsync(Activity)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await host.Client(with).GetAsync(Activity)).StatusCode);
    }

    [Fact]
    public async Task A_custom_role_carrying_activity_view_can_read_it()
    {
        await using var host = await StartAsync();

        // Adı hiçbir yerde özel anlam taşımayan bir rol. Karar VERİDEN gelir.
        var actor = await host.CreateActorAsync("auditor", [PermissionCodes.ActivityView]);

        Assert.Equal(HttpStatusCode.OK, (await host.Client(actor).GetAsync(Activity)).StatusCode);
    }

    [Fact]
    public async Task An_administrator_without_the_code_is_refused()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateUserAsync("nominal-admin", GisRoles.Administrator);

        await host.RevokeRoleGrantAsync(GisRoles.Administrator, PermissionCodes.ActivityView);

        // Rol adı hâlâ "Administrator"; kaybolan tek şey bir grant satırıdır.
        Assert.Equal(HttpStatusCode.Forbidden, (await host.Client(actor).GetAsync(Activity)).StatusCode);
    }

    /* --- Okuma ucu: sıralama, sayfalama, filtreler ------------------------------------ */

    [Fact]
    public async Task The_history_is_returned_newest_first_and_paginated()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("busy-admin", [.. GeographyWrite, PermissionCodes.ActivityView]);
        var target = await host.CreateUserAsync("busy-target");

        for (var i = 0; i < 5; i++)
        {
            await host.Client(actor).PostAsJsonAsync(
                UserAreas(target.Id), new SaveGeographicAreaRequest { Wkt = Area, Name = $"Alan {i}" });
        }

        var page = await ReadPageAsync(await host.Client(actor).GetAsync($"{Activity}?page=1&pageSize=2"));

        Assert.Equal(5, page.TotalCount);
        Assert.Equal(3, page.TotalPages);
        Assert.Equal(2, page.Items.Count);

        /* En yeni önce. Aynı milisaniyede yazılmış kayıtlar için ikincil
           anahtar Id'dir; kararsız bir sıra, sayfalar arasında satır tekrarına
           ya da kaybına yol açardı. */
        Assert.True(page.Items[0].Id > page.Items[1].Id);

        var second = await ReadPageAsync(await host.Client(actor).GetAsync($"{Activity}?page=2&pageSize=2"));
        Assert.Equal(2, second.Items.Count);
        Assert.All(second.Items, item => Assert.DoesNotContain(item.Id, page.Items.Select(i => i.Id)));
    }

    [Fact]
    public async Task An_oversized_page_size_is_clamped_rather_than_rejected()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("greedy-reader", [PermissionCodes.ActivityView]);

        var page = await ReadPageAsync(await host.Client(actor).GetAsync($"{Activity}?pageSize=100000"));

        // Tek istekle tüm tabloyu çekebilmek, kayıt sayısı büyüdüğünde sunucuyu
        // ve tarayıcıyı birlikte durdururdu.
        Assert.Equal(ActivityLogQueryService.MaxPageSize, page.PageSize);
    }

    [Fact]
    public async Task The_history_can_be_narrowed_by_actor_and_by_action()
    {
        await using var host = await StartAsync();
        var first = await host.CreateActorAsync("actor-one", [.. GeographyWrite, PermissionCodes.ActivityView]);
        var second = await host.CreateActorAsync("actor-two", GeographyWrite);
        var target = await host.CreateUserAsync("shared-target");

        await host.Client(first).PostAsJsonAsync(UserAreas(target.Id), new SaveGeographicAreaRequest { Wkt = Area });
        await host.Client(second).PostAsJsonAsync(UserAreas(target.Id), new SaveGeographicAreaRequest { Wkt = Area });

        var byActor = await ReadPageAsync(
            await host.Client(first).GetAsync($"{Activity}?actorUserId={second.Id}"));

        Assert.Equal(second.Id, Assert.Single(byActor.Items).ActorUserId);

        var byAction = await ReadPageAsync(
            await host.Client(first).GetAsync($"{Activity}?action={ActivityActionCatalog.GeographicAreaCreate}"));

        Assert.Equal(2, byAction.TotalCount);

        var byOtherAction = await ReadPageAsync(
            await host.Client(first).GetAsync($"{Activity}?action={ActivityActionCatalog.RoleDelete}"));

        Assert.Empty(byOtherAction.Items);
    }

    [Fact]
    public async Task The_history_can_be_narrowed_to_failures()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("mixed-admin", [.. GeographyWrite, PermissionCodes.ActivityView]);
        var target = await host.CreateUserAsync("mixed-target");

        await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), new SaveGeographicAreaRequest { Wkt = Area });
        await host.Client(actor).PostAsJsonAsync(
            UserAreas(target.Id), new SaveGeographicAreaRequest { Wkt = "POLYGON ((0 0, 10 10, 10 0, 0 10, 0 0))" });

        var failures = await ReadPageAsync(await host.Client(actor).GetAsync($"{Activity}?succeeded=false"));

        var failure = Assert.Single(failures.Items);
        Assert.Equal(400, failure.StatusCode);
        Assert.False(failure.IsSuccess);
    }

    [Fact]
    public async Task Each_row_carries_a_readable_turkish_label_next_to_the_code()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("labelled", [.. GeographyWrite, PermissionCodes.ActivityView]);
        var target = await host.CreateUserAsync("labelled-target");

        await host.Client(actor).PostAsJsonAsync(UserAreas(target.Id), new SaveGeographicAreaRequest { Wkt = Area });

        var item = Assert.Single((await ReadPageAsync(await host.Client(actor).GetAsync(Activity))).Items);

        /* Ad kodla BİRLİKTE taşınır: arayüzün kendi çeviri tablosunu tutması,
           kataloğa eklenen bir işlemin ekranda ham kod olarak görünmesi
           demekti. */
        Assert.Equal(ActivityActionCatalog.GeographicAreaCreate, item.Action);
        Assert.Equal("Coğrafi yetki alanı oluşturuldu", item.ActionName);
    }

    [Fact]
    public async Task The_history_has_no_write_endpoint()
    {
        await using var host = await StartAsync();
        var actor = await host.CreateActorAsync("would-be-editor", [PermissionCodes.ActivityView]);

        /* Silinebilen bir denetim kaydı denetim kaydı değildir: geçmişi
           düzeltebilen bir yönetici kendi hareketini de silebilirdi.

           Tek satırlık bir rota HİÇ tanımlı olmadığı için 404, tanımlı yolun
           yazma metodu olmadığı için 405 gelir; ikisi de aynı şeyi söyler. */
        Assert.Equal(HttpStatusCode.NotFound, (await host.Client(actor).DeleteAsync($"{Activity}/1")).StatusCode);
        Assert.Equal(
            HttpStatusCode.MethodNotAllowed,
            (await host.Client(actor).PostAsJsonAsync(Activity, new { })).StatusCode);
    }

    /* --- Yardımcılar -------------------------------------------------------------------- */

    private const string Activity = "/api/admin/activity";

    private static string UserAreas(int userId) => $"/api/admin/users/{userId}/geographic-authorizations";

    private static async Task<ActivityLogPage> ReadPageAsync(HttpResponseMessage response)
    {
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return (await response.Content.ReadFromJsonAsync<ActivityLogPage>(Json))!;
    }

    private static async Task<ActivityHost> StartAsync()
    {
        var databaseName = $"activity-history-{Guid.NewGuid():N}";

        var builder = new HostBuilder().ConfigureWebHost(web =>
        {
            web.UseTestServer();
            web.ConfigureServices(services =>
            {
                services.AddLogging(l => l.SetMinimumLevel(LogLevel.Warning));
                services.AddHttpContextAccessor();

                services.AddDbContext<AppDbContext>(o => o
                    .UseInMemoryDatabase(databaseName)
                    .ConfigureWarnings(w => w.Ignore(InMemoryEventId.TransactionIgnoredWarning)));

                services.AddIdentityCore<User>(o => o.Password.RequiredLength = 8)
                    .AddRoles<IdentityRole<int>>()
                    .AddEntityFrameworkStores<AppDbContext>();

                services.AddSingleton(new ClientAppOptions { BaseUrl = "https://client.example.invalid" });
                services.AddSingleton(Substitute.For<IEmailSender>());
                services.AddScoped<ICurrentUserService, CurrentUserService>();
                services.AddScoped<TransportActivityContext>();

                services.AddScoped<IEffectivePermissionService, EffectivePermissionService>();
                services.AddScoped<IGeographicAuthorizationService, GeographicAuthorizationService>();
                services.AddScoped<IRoleManagementService, RoleManagementService>();
                services.AddScoped<IUserManagementService, UserManagementService>();
                services.AddScoped<IUserPermissionManagementService, UserPermissionManagementService>();
                services.AddScoped<ITransportService>(provider =>
                    TransportServiceStub(provider.GetRequiredService<TransportActivityContext>()));

                // Sınanan mekanizmanın kendisi: yazıcı, sorgu ve iki kayıt yolu.
                services.AddScoped<IActivityLogWriter, ActivityLogWriter>();
                services.AddScoped<IActivityLogQueryService, ActivityLogQueryService>();
                services.AddSingleton<IAuthorizationMiddlewareResultHandler, ActivityAuthorizationResultHandler>();

                services.AddSingleton<IAuthorizationPolicyProvider, PermissionPolicyProvider>();
                services.AddScoped<IAuthorizationHandler, PermissionAuthorizationHandler>();

                services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
                    .AddJwtBearer(o => o.TokenValidationParameters = ValidationParameters());

                services.AddAuthorization(o =>
                {
                    o.AddPolicy(AuthorizationPolicies.MfaRequired, p =>
                    {
                        p.RequireAuthenticatedUser();
                        p.RequireAssertion(c => AuthenticationMethods.IsMultiFactor(c.User));
                    });
                });

                services.AddControllers(options => options.Filters.Add<ActivityLogFilter>())
                    .AddApplicationPart(typeof(AdminUsersController).Assembly);
            });

            web.Configure(app =>
            {
                app.UseRouting();
                app.UseAuthentication();
                app.UseAuthorization();
                app.UseEndpoints(e => e.MapControllers());
            });
        });

        var host = new ActivityHost(await builder.StartAsync());
        await host.SeedAsync();
        return host;
    }

    private static TokenValidationParameters ValidationParameters() => new()
    {
        ValidateIssuer = true,
        ValidIssuer = Issuer,
        ValidateAudience = true,
        ValidAudience = Audience,
        ValidateLifetime = true,
        ValidateIssuerSigningKey = true,
        IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtKey)),
        ClockSkew = TimeSpan.Zero
    };

    private static ITransportService TransportServiceStub(TransportActivityContext activity)
    {
        var service = Substitute.For<ITransportService>();
        var route = new TransportRouteResponse { Id = 12, Name = "Merkez Hattı", ColorHex = "#6D4AFF", IsActive = true };
        var stop = new TransportStopResponse { Id = 37, RouteId = 12, RouteName = route.Name, Name = "Meydan", Longitude = 32.85, Latitude = 39.93, SequenceOrder = 1, IsActive = true };
        service.GetRoutesAsync(Arg.Any<CancellationToken>()).Returns(ServiceResult<IReadOnlyList<TransportRouteResponse>>.Success([route]));
        service.GetRouteAsync(Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(ServiceResult<TransportRouteResponse>.Success(route));
        service.GetRouteStopsAsync(Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(ServiceResult<IReadOnlyList<TransportStopResponse>>.Success([stop]));
        service.GetStopsAsync(Arg.Any<CancellationToken>()).Returns(ServiceResult<IReadOnlyList<TransportStopResponse>>.Success([stop]));
        service.GetDeletedStopsAsync(Arg.Any<CancellationToken>()).Returns(ServiceResult<IReadOnlyList<TransportStopResponse>>.Success([]));
        service.GetOwnStopsAsync(Arg.Any<CancellationToken>()).Returns(ServiceResult<IReadOnlyList<TransportStopResponse>>.Success([stop]));
        service.GetRouteTrashAsync(Arg.Any<CancellationToken>()).Returns(ServiceResult<IReadOnlyList<TransportRouteResponse>>.Success([]));
        service.GetStopTrashAsync(Arg.Any<CancellationToken>()).Returns(ServiceResult<IReadOnlyList<TransportStopResponse>>.Success([]));
        service.CreateRouteAsync(Arg.Any<CreateTransportRouteRequest>(), Arg.Any<CancellationToken>()).Returns(ServiceResult<TransportRouteResponse>.Success(route));
        service.UpdateRouteAsync(Arg.Any<int>(), Arg.Any<UpdateTransportRouteRequest>(), Arg.Any<CancellationToken>()).Returns(ServiceResult<TransportRouteResponse>.Success(route));
        service.DeleteRouteAsync(Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(ServiceResult<int>.Success(route.Id));
        service.RestoreRouteAsync(Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(ServiceResult<TransportRouteResponse>.Success(route));
        service.CreateStopAsync(Arg.Any<CreateTransportStopRequest>(), Arg.Any<CancellationToken>()).Returns(ServiceResult<TransportStopResponse>.Success(stop));
        service.UpdateStopAsync(Arg.Any<int>(), Arg.Any<UpdateTransportStopRequest>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var id = call.ArgAt<int>(0);
                var request = call.ArgAt<UpdateTransportStopRequest>(1);
                var transferred = request.RouteId != stop.RouteId;
                var moved = request.Longitude != stop.Longitude || request.Latitude != stop.Latitude;
                activity.Outcome = new TransportActivityOutcome(
                    transferred ? TransportActivityKind.StopTransfer : moved ? TransportActivityKind.StopCoordinateMove : TransportActivityKind.StopUpdate,
                    RouteId: request.RouteId,
                    RouteName: transferred ? "Sahil Hattı" : route.Name,
                    StopId: id,
                    StopName: request.Name,
                    SourceRouteId: transferred ? stop.RouteId : null,
                    SourceRouteName: transferred ? route.Name : null,
                    DestinationRouteId: transferred ? request.RouteId : null,
                    DestinationRouteName: transferred ? "Sahil Hattı" : null,
                    CoordinateChanged: moved);
                return ServiceResult<TransportStopResponse>.Success(stop);
            });
        service.DeleteStopAsync(Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(ServiceResult<int>.Success(stop.Id));
        service.RestoreStopAsync(Arg.Any<int>(), Arg.Any<CancellationToken>()).Returns(ServiceResult<TransportStopResponse>.Success(stop));
        service.ReorderStopsAsync(Arg.Any<int>(), Arg.Any<ReorderTransportStopsRequest>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var routeId = call.ArgAt<int>(0);
                var request = call.ArgAt<ReorderTransportStopsRequest>(1);
                activity.Outcome = new TransportActivityOutcome(
                    TransportActivityKind.StopReorder,
                    RouteId: routeId,
                    RouteName: route.Name,
                    OrderedStopIds: request.StopIds,
                    RouteGenerated: true);
                return ServiceResult<IReadOnlyList<TransportStopResponse>>.Success([stop]);
            });
        service.GenerateRoutePathAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
            .Returns(call =>
            {
                var routeId = call.ArgAt<int>(0);
                var succeeded = routeId != 999;
                activity.Outcome = new TransportActivityOutcome(
                    TransportActivityKind.RouteGeneration,
                    RouteId: routeId,
                    RouteName: route.Name,
                    RouteGenerated: succeeded,
                    DistanceMeters: succeeded ? 1250 : null,
                    DurationSeconds: succeeded ? 180 : null);
                if (!succeeded)
                {
                    return ServiceResult<TransportRoutePathResponse>.Upstream(RouteGenerationMessages.Unknown);
                }
                return ServiceResult<TransportRoutePathResponse>.Success(new TransportRoutePathResponse
                {
                    Id = 1,
                    RouteId = routeId,
                    GeometryWkt = "LINESTRING (32 39, 33 40)",
                    DistanceMeters = 1250,
                    DurationSeconds = 180,
                    Profile = "driving",
                    GeneratedAt = DateTime.UtcNow
                });
            });
        return service;
    }

    private sealed class ActivityHost : IAsyncDisposable
    {
        private readonly IHost _host;

        public ActivityHost(IHost host) => _host = host;

        public async Task SeedAsync()
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

            foreach (var role in ApplicationRoles.Retired)
            {
                await roles.CreateAsync(new IdentityRole<int>(role));
            }

            await AuthorizationDataSeeder.SeedAsync(
                scope.ServiceProvider.GetRequiredService<AppDbContext>(),
                roles,
                scope.ServiceProvider.GetRequiredService<ILoggerFactory>().CreateLogger("seed"));
        }

        public async Task<User> CreateActorAsync(string userName, string[] codes)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

            var roleName = $"Role-{userName}";
            Assert.True((await roles.CreateAsync(new IdentityRole<int>(roleName))).Succeeded);
            var role = (await roles.FindByNameAsync(roleName))!;

            var distinct = codes.Distinct().ToArray();
            var ids = await db.Permissions.Where(p => distinct.Contains(p.Code)).Select(p => p.Id).ToListAsync();
            Assert.Equal(distinct.Length, ids.Count);

            db.RolePermissions.AddRange(ids.Select(id => new RolePermission { RoleId = role.Id, PermissionId = id }));
            await db.SaveChangesAsync();

            return await CreateUserAsync(userName, roleName);
        }

        public async Task<User> CreateUserAsync(string userName, string? role = null)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();

            var user = new User
            {
                UserName = userName,
                Email = $"{Guid.NewGuid():N}@example.invalid",
                EmailConfirmed = true,
                AccountStatus = AccountStatus.Active,
                IsActive = true
            };

            Assert.True((await users.CreateAsync(user, "Str0ng!Password")).Succeeded);

            if (role is not null)
            {
                Assert.True((await users.AddToRoleAsync(user, role)).Succeeded);
            }

            return user;
        }

        public async Task RevokeRoleGrantAsync(string roleName, string code)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            var roles = scope.ServiceProvider.GetRequiredService<RoleManager<IdentityRole<int>>>();

            var role = (await roles.FindByNameAsync(roleName))!;
            var permission = await db.Permissions.SingleAsync(p => p.Code == code);

            db.RolePermissions.RemoveRange(
                await db.RolePermissions
                    .Where(rp => rp.RoleId == role.Id && rp.PermissionId == permission.Id)
                    .ToListAsync());

            await db.SaveChangesAsync();
        }

        /// <summary>Ham kayıt satırları — API'nin biçimlendirmesinden bağımsız.</summary>
        public async Task<List<ActivityLog>> LogsAsync()
        {
            await using var scope = _host.Services.CreateAsyncScope();
            return await scope.ServiceProvider.GetRequiredService<AppDbContext>()
                .ActivityLogs.AsNoTracking().OrderBy(l => l.Id).ToListAsync();
        }

        private async Task<string[]> RolesOfAsync(User user)
        {
            await using var scope = _host.Services.CreateAsyncScope();
            var users = scope.ServiceProvider.GetRequiredService<UserManager<User>>();
            return [.. await users.GetRolesAsync((await users.FindByIdAsync(user.Id.ToString()))!)];
        }

        public HttpClient Client() => _host.GetTestClient();

        public HttpClient Client(User user, AuthenticationLevel level = AuthenticationLevel.MultiFactor)
        {
            var roles = RolesOfAsync(user).GetAwaiter().GetResult();
            var tokens = new JwtTokenService(new JwtOptions
            {
                Key = JwtKey,
                Issuer = Issuer,
                Audience = Audience,
                ExpireMinutes = 10
            });

            var (token, _) = tokens.GenerateToken(user.Id, user.UserName!, roles, level);

            var client = _host.GetTestClient();
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
            return client;
        }

        public async ValueTask DisposeAsync()
        {
            await _host.StopAsync();
            _host.Dispose();
        }
    }
}
