using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging.Abstractions;
using StajProject.Application.Activity;
using StajProject.Application.Journeys;
using StajProject.Domain.Common;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Faz 5E-B · Dilim 7B: kişisel yolculuğun MEVCUT aktivite defterine girişi.
/// </summary>
/// <remarks>
/// Ölçülen üç şey: hangi geçişlerin kaydedildiği, kaydın mükerrer olamayacağı
/// ve ayrıntıların güvenli kaldığı. Testler ağa, Docker'a ya da gerçek
/// beklemeye bağlı değildir.
/// </remarks>
public sealed class JourneyActivityHistoryTests
{
    /* --- Kelime dağarcığı --------------------------------------------------------- */

    [Fact]
    public void The_journey_lifecycle_owns_exactly_three_canonical_codes()
    {
        var codes = ActivityActionCatalog.All
            .Select(definition => definition.Code)
            .Where(code => code.StartsWith("journey.", StringComparison.Ordinal))
            .ToArray();

        Assert.Equal(
            [
                ActivityActionCatalog.JourneySimulationStart,
                ActivityActionCatalog.JourneySimulationCancel,
                ActivityActionCatalog.JourneySimulationComplete
            ],
            codes);

        /* Kodlar KİMLİKTİR: geçmiş satırlar bunlarla yazılır ve yeniden
           adlandırma o işlemin tüm geçmişini filtrelerden düşürürdü. */
        Assert.Equal("journey.simulation.start", ActivityActionCatalog.JourneySimulationStart);
        Assert.Equal("journey.simulation.cancel", ActivityActionCatalog.JourneySimulationCancel);
        Assert.Equal("journey.simulation.complete", ActivityActionCatalog.JourneySimulationComplete);

        foreach (var code in codes)
        {
            Assert.NotEqual(code, ActivityActionCatalog.NameOf(code));
        }
    }

    [Fact]
    public void Only_lifecycle_transitions_have_a_code_preview_and_runtime_noise_do_not()
    {
        var codes = ActivityActionCatalog.All.Select(definition => definition.Code).ToArray();

        /* Önizleme, takip, kurtarma, SignalR ve hareket tick'leri denetim
           olayı DEĞİLDİR: hiçbiri sistemin kalıcı durumunu değiştirmez. */
        foreach (var absent in (string[])
                 [
                     "journey.preview", "journey.plan", "journey.follow", "journey.unfollow",
                     "journey.recover", "journey.tick", "journey.progress", "journey.step"
                 ])
        {
            Assert.DoesNotContain(absent, codes);
        }
    }

    /* --- Güvenli ayrıntılar ------------------------------------------------------- */

    private static JourneyActivityOutcome Outcome(
        JourneyActivityKind kind = JourneyActivityKind.Started,
        JourneyMode mode = JourneyMode.RouteSegment,
        JourneyTravelProfile profile = JourneyTravelProfile.Cycling,
        int? routeId = 7,
        int? waypointCount = null,
        double? progressPercent = null) =>
        new(kind, Guid.NewGuid(), mode, profile, routeId, waypointCount, progressPercent, 4200, 600);

    [Fact]
    public void Details_carry_business_context_and_never_geometry()
    {
        var outcome = Outcome(waypointCount: 3, progressPercent: 100);
        var json = JourneyActivityDetails.Build(outcome);

        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        Assert.Equal("Started", root.GetProperty("kind").GetString());
        Assert.Equal("RouteSegment", root.GetProperty("mode").GetString());
        Assert.Equal("Cycling", root.GetProperty("profile").GetString());
        Assert.Equal(7, root.GetProperty("routeId").GetInt32());
        Assert.Equal(3, root.GetProperty("waypointCount").GetInt32());
        Assert.Equal(100, root.GetProperty("progressPercent").GetDouble());

        /* HAM GEOMETRİ YOKTUR ve olamaz: sonucu taşıyan tipte böyle bir alan
           bulunmadığı için sızabileceği bir yol da yoktur. İddia ALAN ADLARI ve
           DEĞERLER üzerinden kurulur; ham metin taraması "waypointCount"un
           içindeki "point"i geometri sanardı. */
        AssertNoGeometry(root);

        // Ve gövde tam olarak beklenen güvenli alanlardan oluşur.
        Assert.Equal(
            [
                "distanceMeters", "durationSeconds", "kind", "mode", "profile",
                "progressPercent", "routeId", "simulationId", "waypointCount"
            ],
            root.EnumerateObject().Select(property => property.Name).ToArray());
    }

    /// <summary>Gerçek WKT sözdizimi: tür adı + açılış parantezi.</summary>
    private static readonly Regex WellKnownText = new(
        @"\b(POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION)\s*\(",
        RegexOptions.IgnoreCase | RegexOptions.Compiled);

    /// <summary>Geometri taşıyan bir ALAN ADI; iş sözcükleri buraya girmez.</summary>
    private static readonly string[] GeometryFieldNames =
    [
        "geometry", "geometryWkt", "wkt", "coordinate", "coordinates",
        "longitude", "latitude", "points", "path", "routeGeometry", "pathGeometry"
    ];

    /// <summary>
    /// Ayrıntılarda ne geometri ALANI ne de geometri DEĞERİ bulunur.
    /// </summary>
    /// <remarks>
    /// <b>"point" bir yasak sözcük DEĞİLDİR.</b> <c>waypointCount</c> bir sayı
    /// alanıdır ve tam olarak geometri taşımadığı için oradadır; onu geometri
    /// sanan bir iddia, koruduğunu sandığı şeyi korumaz. Aranan şey gerçek WKT
    /// sözdizimi ve gerçek konum alan adlarıdır.
    /// </remarks>
    private static void AssertNoGeometry(JsonElement root)
    {
        foreach (var property in root.EnumerateObject())
        {
            foreach (var forbidden in GeometryFieldNames)
            {
                Assert.False(
                    string.Equals(property.Name, forbidden, StringComparison.OrdinalIgnoreCase),
                    $"{property.Name} geometri alanı olarak ayrıntılara sızdı");
            }

            if (property.Value.ValueKind != JsonValueKind.String) continue;

            var value = property.Value.GetString() ?? string.Empty;
            Assert.False(
                WellKnownText.IsMatch(value),
                $"{property.Name} ham WKT taşıyor: {value}");
        }
    }

    [Fact]
    public void The_geometry_guard_still_catches_real_well_known_text()
    {
        /* İddianın KENDİSİ sınanır: gevşetilmiş bir koruma, korumasızlıktan
           daha kötüdür çünkü güven verir. */
        foreach (var leak in (string[])
                 [
                     "LINESTRING (30 40, 31 41)", "POINT(30 40)", "polygon((0 0,1 1,1 0,0 0))",
                     "MULTIPOINT ((1 1))", "GEOMETRYCOLLECTION(POINT(1 1))"
                 ])
        {
            using var document = JsonDocument.Parse(
                JsonSerializer.Serialize(new Dictionary<string, string> { ["note"] = leak }));

            Assert.Throws<Xunit.Sdk.FalseException>(() => AssertNoGeometry(document.RootElement));
        }

        // Ve iş sözcükleri yanlışlıkla yakalanmaz.
        foreach (var safe in (string[])["waypointCount", "Waypoints", "checkpoint", "pointer"])
        {
            Assert.False(WellKnownText.IsMatch(safe));
        }
    }

    [Fact]
    public void The_outcome_type_cannot_carry_geometry_or_free_text()
    {
        var properties = typeof(JourneyActivityOutcome).GetProperties().Select(item => item.Name).ToArray();

        Assert.Equal(
            [
                "Kind", "SimulationId", "Mode", "RequestedProfile", "RouteId",
                "WaypointCount", "ProgressPercent", "DistanceMeters", "DurationSeconds"
            ],
            properties);

        /* Serbest metin de taşınmaz: geçiş noktalarının ADI değil yalnızca
           SAYISI girer — ad, kullanıcının yazdığı içeriktir. */
        foreach (var forbidden in (string[])
                 ["GeometryWkt", "Points", "Coordinates", "Waypoints", "WaypointNames", "RouteName", "Note"])
        {
            Assert.Null(typeof(JourneyActivityOutcome).GetProperty(forbidden));
        }
    }

    [Fact]
    public void Absent_optional_context_is_omitted_rather_than_written_as_null()
    {
        var json = JourneyActivityDetails.Build(
            new JourneyActivityOutcome(
                JourneyActivityKind.Completed,
                Guid.NewGuid(),
                JourneyMode.Waypoints,
                JourneyTravelProfile.Walking));

        using var document = JsonDocument.Parse(json);
        var root = document.RootElement;

        Assert.False(root.TryGetProperty("routeId", out _));
        Assert.False(root.TryGetProperty("progressPercent", out _));

        // Kip ve profil her zaman vardır: satırın anlamı onlardan okunur.
        Assert.Equal("Waypoints", root.GetProperty("mode").GetString());
        Assert.Equal("Walking", root.GetProperty("profile").GetString());
    }

    /* --- Kaydedicinin eşlemesi ---------------------------------------------------- */

    private sealed class CapturingWriter : Application.Interfaces.IActivityLogWriter
    {
        public List<(ActivityLogEntry Entry, ActivityActor? Actor)> Written { get; } = [];

        public Task WriteAsync(ActivityLogEntry entry, CancellationToken cancellationToken = default)
        {
            Written.Add((entry, null));
            return Task.CompletedTask;
        }

        public Task WriteAsync(
            ActivityLogEntry entry,
            ActivityActor actor,
            CancellationToken cancellationToken = default)
        {
            Written.Add((entry, actor));
            return Task.CompletedTask;
        }
    }

    [Theory]
    [InlineData(JourneyActivityKind.Started, "journey.simulation.start", "POST")]
    [InlineData(JourneyActivityKind.Cancelled, "journey.simulation.cancel", "POST")]
    [InlineData(JourneyActivityKind.Completed, "journey.simulation.complete", "SYSTEM")]
    public async Task Each_lifecycle_event_maps_to_its_canonical_code_and_resource(
        JourneyActivityKind kind,
        string expectedAction,
        string expectedMethod)
    {
        var writer = new CapturingWriter();
        /* GERÇEK kaydedici sınanır; yalnızca günlük yutulur. Projenin test
           kalıbı budur (bkz. controller testleri): sahte bir logger yerine
           `NullLogger` verilir, üretim yapıcısı test için gevşetilmez. */
        var recorder = new JourneyActivityRecorder(writer, NullLogger<JourneyActivityRecorder>.Instance);
        var outcome = Outcome(kind);

        await recorder.RecordAsync(outcome, ownerUserId: 42);

        var (entry, actor) = Assert.Single(writer.Written);

        Assert.Equal(expectedAction, entry.Action);
        Assert.Equal(expectedMethod, entry.HttpMethod);
        Assert.Equal("journey_simulation", entry.ResourceType);
        Assert.Equal(outcome.SimulationId.ToString(), entry.ResourceId);

        // Kayıt YALNIZCA kazanan geçişte oluşur; her satır bir başarıdır.
        Assert.InRange(entry.StatusCode, 200, 299);

        /* Aktör AÇIKÇA verilir: doğal tamamlanmada oturum yoktur, ama olayın
           sahibi yine gerçek kullanıcıdır — uydurma bir "sistem kullanıcısı"
           değil. */
        Assert.NotNull(actor);
        Assert.Equal(42, actor!.UserId);

        // Yol sorgu dizesi taşımaz.
        Assert.DoesNotContain('?', entry.Path);
        Assert.StartsWith("/api/transport/journeys/simulations", entry.Path, StringComparison.Ordinal);
    }

    [Fact]
    public void The_writer_contract_never_accepts_an_actor_from_the_request_body()
    {
        /* Aktör ya doğrulanmış oturumdan okunur ya da sunucunun kendi çalışma
           zamanı durumundan gelen açık bir kimliktir. Kaydın gövdesini taşıyan
           tipte bir kullanıcı alanı YOKTUR. */
        foreach (var forbidden in (string[])["ActorUserId", "ActorUsername", "UserId", "UserName"])
        {
            Assert.Null(typeof(ActivityLogEntry).GetProperty(forbidden));
        }

        var actorProperties = typeof(ActivityActor).GetProperties().Select(item => item.Name).ToArray();
        Assert.Equal(["UserId", "UserName"], actorProperties);
    }

    [Fact]
    public void Recording_uses_no_role_name_username_or_admin_shortcut()
    {
        var source = File.ReadAllText(SourcePath("src/StajProject.Infrastructure/Services/JourneyActivityRecorder.cs"))
            + File.ReadAllText(SourcePath("src/StajProject.Application/Activity/JourneyActivityOutcome.cs"));

        foreach (var shortcut in (string[])["IsAdmin", "Administrator", "IsInRole", "RoleName", "Roles"])
        {
            Assert.DoesNotContain(shortcut, source, StringComparison.Ordinal);
        }
    }

    /* --- Komşu ürün --------------------------------------------------------------- */

    [Fact]
    public void The_fixed_route_transport_activity_vocabulary_is_untouched()
    {
        var codes = ActivityActionCatalog.All.Select(definition => definition.Code).ToArray();

        foreach (var transport in (string[])
                 [
                     ActivityActionCatalog.TransportRouteCreate,
                     ActivityActionCatalog.TransportRouteGenerate,
                     ActivityActionCatalog.TransportStopCreate,
                     ActivityActionCatalog.TransportStopTransfer,
                     ActivityActionCatalog.TransportStopCoordinateMove
                 ])
        {
            Assert.Contains(transport, codes);
        }

        // Ulaşım özeti kendi tipinde kalır; yolculuk ona hiç dokunmaz.
        var transportSource = File.ReadAllText(
            SourcePath("src/StajProject.Application/Activity/TransportActivityContext.cs"));
        Assert.DoesNotContain("Journey", transportSource, StringComparison.Ordinal);
    }

    private static string SourcePath(string relative)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "src")))
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        return Path.Combine(directory!.FullName, relative);
    }
}
