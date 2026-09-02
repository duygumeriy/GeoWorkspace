using System.Reflection;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Api.Controllers;
using StajProject.Application.Activity;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Journeys;
using StajProject.Application.Simulation;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;
using StajProject.Infrastructure.Simulation;

namespace StajProject.Auth.Tests;

/// <summary>
/// Faz 7: sahibine ÖZEL, yeniden kullanılabilir kişisel yolculuk TANIMLARI.
/// </summary>
/// <remarks>
/// <para>
/// Ölçülen iki asıl iddia şudur: (1) kayıt bir çalıştırma anlık görüntüsü
/// DEĞİL, bir niyettir — çalışma zamanı durumu hiçbir yolla saklanmaz; (2)
/// yeniden kullanım eski bir çalıştırmayı diriltmez, kanonik referansları
/// YENİDEN çözer, motoru YENİDEN çağırır ve YENİ bir çalıştırma kimliği
/// üretir.
/// </para>
/// <para>
/// Testler Docker'a, ağa ya da çalışan bir OSRM'e BAĞLI DEĞİLDİR: yönlendirme
/// sahte bir porttan gelir ve veritabanı süreç içidir.
/// </para>
/// </remarks>
public sealed class SavedJourneyTests
{
    private const int Owner = 42;
    private const int Stranger = 99;

    /* --- Tanım, anlık görüntü DEĞİLDİR ------------------------------------------- */

    [Fact]
    public void The_saved_record_has_no_field_for_runtime_simulation_state()
    {
        /* ASIL İDDİA: çalışma zamanı durumunu saklayabileceğimiz bir ALAN
           YOKTUR. "Saklamıyoruz" kararı bir denetime değil, tablonun ve
           sözleşmenin ŞEKLİNE yaslanır. */
        foreach (var forbidden in (string[])
                 [
                     "SimulationId", "Status", "ProgressPercent", "ProgressRatio", "Longitude",
                     "Latitude", "Coordinate", "CurrentStepSequence", "GeometryWkt", "Geometry",
                     "DistanceMeters", "DurationSeconds", "StartedAt", "IsPaused", "IsFollowing",
                     "Steps", "Snapshot"
                 ])
        {
            Assert.Null(typeof(SavedJourney).GetProperty(forbidden));
            Assert.Null(typeof(SavedJourneyPoint).GetProperty(forbidden));
            Assert.Null(typeof(SavedJourneyResponse).GetProperty(forbidden));
            Assert.Null(typeof(SavedJourneySummaryResponse).GetProperty(forbidden));
        }

        /* Kaydedilen niyetin kendisi ise oradadır: kip, profil, hat referansı
           ve sıralı noktalar. */
        Assert.NotNull(typeof(SavedJourney).GetProperty("Mode"));
        Assert.NotNull(typeof(SavedJourney).GetProperty("Profile"));
        Assert.NotNull(typeof(SavedJourney).GetProperty("RouteId"));
        Assert.NotNull(typeof(SavedJourney).GetProperty("Points"));
    }

    [Fact]
    public void The_save_contract_carries_the_existing_journey_intent_rather_than_a_parallel_language()
    {
        /* Paralel bir rota dili kurulmadı: kaydedilen tanım, planlama ve
           başlatmanın kullandığı sözleşmenin TA KENDİSİDİR. */
        var journey = typeof(CreateSavedJourneyRequest).GetProperty("Journey");

        Assert.NotNull(journey);
        Assert.Equal(typeof(JourneyPlanRequest), journey!.PropertyType);

        // Ve gövdede bir çalıştırma kimliği/geometri alanı yoktur.
        foreach (var forbidden in (string[])["SimulationId", "GeometryWkt", "PlanId", "Steps"])
        {
            Assert.Null(typeof(CreateSavedJourneyRequest).GetProperty(forbidden));
        }
    }

    /* --- Oluşturma ---------------------------------------------------------------- */

    [Fact]
    public async Task Saving_a_free_journey_stores_the_canonical_references_in_order()
    {
        await using var fixture = await Fixture.CreateAsync();

        var created = await fixture.SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
        {
            Name = "  Ev → İş  ",
            Journey = fixture.WaypointIntent(),
        });

        Assert.True(created.IsSuccess);
        var saved = created.Value!;

        // Ad KIRPILIR; sahibin listesinde benzersiz olması İSTENMEZ.
        Assert.Equal("Ev → İş", saved.Name);
        Assert.Equal(JourneyContractNames.Waypoints, saved.Mode);
        Assert.Equal(JourneyContractNames.Driving, saved.Profile);
        Assert.False(saved.IsFavorite);

        /* Kimlikler KANONİKTİR: koordinat değil, kaydın kendisi saklanır. */
        Assert.Equal([0, 1], saved.Points.Select(point => point.Sequence).ToArray());
        Assert.Equal(
            [JourneyContractNames.TransportStop, JourneyContractNames.Poi],
            saved.Points.Select(point => point.Source).ToArray());
        Assert.Equal([fixture.StopIds[0], fixture.PoiId], saved.Points.Select(point => point.ReferenceId).ToArray());

        // Rol SAKLANMAZ, sıradan türetilir.
        Assert.Equal(["origin", "destination"], saved.Points.Select(point => point.Role).ToArray());
    }

    [Fact]
    public async Task Saving_a_route_segment_keeps_the_two_chosen_stops_as_the_intent()
    {
        await using var fixture = await Fixture.CreateAsync();

        var created = await fixture.SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
        {
            Name = "Hat bölümü",
            Journey = new JourneyPlanRequest
            {
                Mode = JourneyContractNames.RouteSegment,
                Profile = JourneyContractNames.Driving,
                RouteId = fixture.RouteId,
                FromStopId = fixture.StopIds[0],
                ToStopId = fixture.StopIds[1],
            },
        });

        Assert.True(created.IsSuccess);
        var saved = created.Value!;

        /* Kip ayrımı KORUNUR: bölüm kipinin niyeti tam olarak seçilen İKİ
           duraktır ve hat kimliği de kaydın parçasıdır. */
        Assert.Equal(JourneyContractNames.RouteSegment, saved.Mode);
        Assert.Equal(fixture.RouteId, saved.RouteId);
        Assert.Equal([fixture.StopIds[0], fixture.StopIds[1]], saved.Points.Select(point => point.ReferenceId).ToArray());
    }

    [Fact]
    public async Task Saving_a_full_route_journey_stores_the_line_rather_than_a_frozen_stop_list()
    {
        await using var fixture = await Fixture.CreateAsync();

        var created = await fixture.SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
        {
            Name = "Tüm hat",
            Journey = new JourneyPlanRequest
            {
                Mode = JourneyContractNames.RouteFull,
                Profile = JourneyContractNames.Driving,
                RouteId = fixture.RouteId,
            },
        });

        Assert.True(created.IsSuccess);

        /* Tam-hat yolculuğu HATTIN KENDİSİNE bağlıdır: durakları yeniden
           kullanım anında çözülür. Donmuş bir durak listesi saklansaydı, hatta
           sonradan eklenen durak yolculuğa hiç girmezdi. */
        Assert.Empty(created.Value!.Points);
        Assert.Equal(fixture.RouteId, created.Value.RouteId);
        Assert.Equal("Hat", created.Value.RouteDisplayName);
    }

    [Fact]
    public async Task Saving_does_not_start_a_simulation()
    {
        await using var fixture = await Fixture.CreateAsync();

        var created = await fixture.SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
        {
            Name = "Sadece kayıt",
            Journey = fixture.WaypointIntent(),
        });

        Assert.True(created.IsSuccess);

        // Kaydetmek bir çalıştırma ÜRETMEZ ve çalıştırma GEREKTİRMEZ.
        Assert.Null(fixture.Store.FindByOwner(Owner));
        Assert.Empty(fixture.Activity.Written);
    }

    [Fact]
    public async Task Saving_rejects_a_blank_name()
    {
        await using var fixture = await Fixture.CreateAsync();

        foreach (var name in (string?[])[null, "", "   "])
        {
            var created = await fixture.SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
            {
                Name = name,
                Journey = fixture.WaypointIntent(),
            });

            Assert.False(created.IsSuccess);
            Assert.Equal(ServiceErrorKind.Validation, created.ErrorKind);
        }

        Assert.Empty(await fixture.Db.SavedJourneys.ToListAsync());
    }

    [Fact]
    public async Task Saving_rejects_a_name_longer_than_the_column()
    {
        await using var fixture = await Fixture.CreateAsync();

        var created = await fixture.SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
        {
            Name = new string('a', SavedJourney.MaxNameLength + 1),
            Journey = fixture.WaypointIntent(),
        });

        Assert.False(created.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, created.ErrorKind);
    }

    [Fact]
    public async Task Saving_rejects_an_unsupported_profile()
    {
        await using var fixture = await Fixture.CreateAsync();

        var intent = fixture.WaypointIntent();
        intent.Profile = "bus";

        var created = await fixture.SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
        {
            Name = "Otobüs", Journey = intent,
        });

        Assert.False(created.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, created.ErrorKind);
        Assert.Empty(await fixture.Db.SavedJourneys.ToListAsync());
    }

    [Fact]
    public async Task Saving_rejects_malformed_point_definitions()
    {
        await using var fixture = await Fixture.CreateAsync();

        var cases = new Dictionary<string, JourneyPlanRequest>
        {
            /* Bilinmeyen nokta türü: sözleşme yalnızca durak ve POI tanır. */
            ["unsupported source"] = new()
            {
                Mode = JourneyContractNames.Waypoints,
                Waypoints =
                [
                    new() { Source = "coordinate", ReferenceId = 1 },
                    new() { Source = JourneyContractNames.Poi, ReferenceId = fixture.PoiId },
                ],
            },

            // Tek nokta bir yolculuk değildir.
            ["too few points"] = new()
            {
                Mode = JourneyContractNames.Waypoints,
                Waypoints = [new() { Source = JourneyContractNames.Poi, ReferenceId = fixture.PoiId }],
            },

            // Açık sıra verildiyse TEKİL olmalıdır.
            ["duplicate sequence"] = new()
            {
                Mode = JourneyContractNames.Waypoints,
                Waypoints =
                [
                    new() { Source = JourneyContractNames.TransportStop, ReferenceId = fixture.StopIds[0], Order = 1 },
                    new() { Source = JourneyContractNames.Poi, ReferenceId = fixture.PoiId, Order = 1 },
                ],
            },

            // Var olmayan referans sessizce atlanmaz.
            ["missing reference"] = new()
            {
                Mode = JourneyContractNames.Waypoints,
                Waypoints =
                [
                    new() { Source = JourneyContractNames.TransportStop, ReferenceId = fixture.StopIds[0] },
                    new() { Source = JourneyContractNames.Poi, ReferenceId = 987654 },
                ],
            },
        };

        foreach (var (label, journey) in cases)
        {
            var created = await fixture.SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
            {
                Name = label, Journey = journey,
            });

            Assert.False(created.IsSuccess, label);
        }

        Assert.Empty(await fixture.Db.SavedJourneys.ToListAsync());
    }

    /* --- Liste -------------------------------------------------------------------- */

    [Fact]
    public async Task The_list_returns_only_the_callers_own_records()
    {
        await using var fixture = await Fixture.CreateAsync();
        var mine = await fixture.SaveAsync("Benim");

        var stranger = fixture.As(Stranger);
        await stranger.SaveAsync("Onun");

        var listed = await fixture.SavedJourneys.ListAsync();

        Assert.True(listed.IsSuccess);
        Assert.Equal([mine.Id], listed.Value!.Select(row => row.Id).ToArray());

        // Ve karşı taraf da yalnızca kendisininkini görür.
        var theirs = await stranger.SavedJourneys.ListAsync();
        Assert.DoesNotContain(mine.Id, theirs.Value!.Select(row => row.Id));
    }

    [Fact]
    public async Task The_list_puts_favourites_first_and_is_deterministic()
    {
        await using var fixture = await Fixture.CreateAsync();

        var first = await fixture.SaveAsync("Birinci");
        var second = await fixture.SaveAsync("İkinci");
        var third = await fixture.SaveAsync("Üçüncü");

        // En eski kayıt yıldızlanır: sıralamayı yalnızca yıldız belirlemelidir.
        await fixture.SavedJourneys.UpdateAsync(first.Id, new UpdateSavedJourneyRequest { IsFavorite = true });

        var listed = await fixture.SavedJourneys.ListAsync();

        Assert.True(listed.IsSuccess);
        Assert.Equal(first.Id, listed.Value![0].Id);
        Assert.True(listed.Value[0].IsFavorite);

        // Kalanlar en son değişenden eskiye; kimlik son ayraçtır.
        Assert.Equal([third.Id, second.Id], listed.Value.Skip(1).Select(row => row.Id).ToArray());

        // Aynı istek iki kez aynı sırayı verir.
        var again = await fixture.SavedJourneys.ListAsync();
        Assert.Equal(listed.Value.Select(row => row.Id).ToArray(), again.Value!.Select(row => row.Id).ToArray());
    }

    [Fact]
    public async Task The_list_row_stays_light_and_summarises_the_endpoints()
    {
        await using var fixture = await Fixture.CreateAsync();
        await fixture.SaveAsync("Özet");

        var row = Assert.Single((await fixture.SavedJourneys.ListAsync()).Value!);

        Assert.Equal(2, row.PointCount);
        Assert.Equal("A", row.OriginName);
        Assert.Equal("Kütüphane", row.DestinationName);
        Assert.Equal(JourneyContractNames.Driving, row.Profile);

        /* Liste satırında geometri ya da manevra ALANI yoktur: bir liste
           uğruna kilobaytlarca güzergah taşınmaz. */
        foreach (var forbidden in (string[])["GeometryWkt", "Steps", "Waypoints", "Points"])
        {
            Assert.Null(typeof(SavedJourneySummaryResponse).GetProperty(forbidden));
        }
    }

    /* --- Sahiplik ------------------------------------------------------------------ */

    [Fact]
    public async Task A_stranger_can_neither_read_nor_mutate_nor_reuse_another_users_record()
    {
        await using var fixture = await Fixture.CreateAsync();
        var mine = await fixture.SaveAsync("Gizli");

        var stranger = fixture.As(Stranger);

        var attempts = new Dictionary<string, Func<Task<ServiceErrorKind>>>
        {
            ["get"] = async () => (await stranger.SavedJourneys.GetAsync(mine.Id)).ErrorKind,
            ["rename"] = async () => (await stranger.SavedJourneys.UpdateAsync(
                mine.Id, new UpdateSavedJourneyRequest { Name = "Çalındı" })).ErrorKind,
            ["favourite"] = async () => (await stranger.SavedJourneys.UpdateAsync(
                mine.Id, new UpdateSavedJourneyRequest { IsFavorite = true })).ErrorKind,
            ["delete"] = async () => (await stranger.SavedJourneys.DeleteAsync(mine.Id)).ErrorKind,
            ["reuse"] = async () => (await stranger.SavedJourneys.ReuseAsync(mine.Id)).ErrorKind,
        };

        foreach (var (label, attempt) in attempts)
        {
            /* "Yok" ile "senin değil" AYNI cevabı verir: ayrı bir 403, kimlik
               tahmin eden birine o kaydın gerçekten var olduğunu doğrulardı. */
            Assert.Equal(ServiceErrorKind.NotFound, await attempt());
        }

        // Kayıt olduğu gibi durur ve yabancıya ait bir çalıştırma doğmaz.
        var untouched = await fixture.Db.SavedJourneys.AsNoTracking().SingleAsync();
        Assert.Equal("Gizli", untouched.Name);
        Assert.False(untouched.IsFavorite);
        Assert.Null(fixture.Store.FindByOwner(Stranger));
    }

    [Fact]
    public async Task Ownership_does_not_bend_for_an_administrator_identity()
    {
        await using var fixture = await Fixture.CreateAsync();
        var mine = await fixture.SaveAsync("Gizli");

        /* Yetkilendirme ETKİN YETKİ üzerindendir. Rol adı, `IsAdmin` bayrağı ya
           da kullanıcı adı bir kestirme DEĞİLDİR: yönetici kimliğiyle gelen
           yabancı da başkasının kaydını göremez. */
        var admin = fixture.As(Stranger, isAdmin: true, roles: ["Admin"]);

        Assert.Equal(ServiceErrorKind.NotFound, (await admin.SavedJourneys.GetAsync(mine.Id)).ErrorKind);
        Assert.Equal(ServiceErrorKind.NotFound, (await admin.SavedJourneys.DeleteAsync(mine.Id)).ErrorKind);
        Assert.Empty((await admin.SavedJourneys.ListAsync()).Value!);
        Assert.Single(await fixture.Db.SavedJourneys.ToListAsync());
    }

    /* --- Üst veri ------------------------------------------------------------------ */

    [Fact]
    public async Task Renaming_touches_only_the_name_and_stamps_the_record()
    {
        await using var fixture = await Fixture.CreateAsync();
        var saved = await fixture.SaveAsync("Eski");

        var renamed = await fixture.SavedJourneys.UpdateAsync(
            saved.Id, new UpdateSavedJourneyRequest { Name = "  Yeni  " });

        Assert.True(renamed.IsSuccess);
        Assert.Equal("Yeni", renamed.Value!.Name);

        // Tanım DEĞİŞMEZ: kip, profil ve noktalar aynıdır.
        Assert.Equal(saved.Mode, renamed.Value.Mode);
        Assert.Equal(saved.Profile, renamed.Value.Profile);
        Assert.Equal(
            saved.Points.Select(point => point.ReferenceId).ToArray(),
            renamed.Value.Points.Select(point => point.ReferenceId).ToArray());

        Assert.True(renamed.Value.ModifiedDate >= saved.ModifiedDate);
        Assert.Equal(saved.CreatedDate, renamed.Value.CreatedDate);
    }

    [Fact]
    public async Task The_favourite_flag_is_set_to_the_value_the_client_sends()
    {
        await using var fixture = await Fixture.CreateAsync();
        var saved = await fixture.SaveAsync("Yıldız");

        var starred = await fixture.SavedJourneys.UpdateAsync(
            saved.Id, new UpdateSavedJourneyRequest { IsFavorite = true });

        Assert.True(starred.IsSuccess);
        Assert.True(starred.Value!.IsFavorite);
        Assert.Equal("Yıldız", starred.Value.Name);

        /* Sunucuda "tersine çevir" YOKTUR: aynı isteği tekrarlamak değeri
           değiştirmez. Toggle olsaydı, geç gelen bir cevap yıldızı
           kullanıcının görmediği bir duruma çevirebilirdi. */
        var repeated = await fixture.SavedJourneys.UpdateAsync(
            saved.Id, new UpdateSavedJourneyRequest { IsFavorite = true });
        Assert.True(repeated.Value!.IsFavorite);

        var cleared = await fixture.SavedJourneys.UpdateAsync(
            saved.Id, new UpdateSavedJourneyRequest { IsFavorite = false });
        Assert.False(cleared.Value!.IsFavorite);
    }

    [Fact]
    public async Task An_empty_metadata_update_is_rejected_rather_than_silently_stamping()
    {
        await using var fixture = await Fixture.CreateAsync();
        var saved = await fixture.SaveAsync("Dokunma");

        var updated = await fixture.SavedJourneys.UpdateAsync(saved.Id, new UpdateSavedJourneyRequest());

        Assert.False(updated.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, updated.ErrorKind);
    }

    /* --- Silme -------------------------------------------------------------------- */

    [Fact]
    public async Task Deleting_removes_the_record_and_its_points()
    {
        await using var fixture = await Fixture.CreateAsync();
        var saved = await fixture.SaveAsync("Silinecek");

        var deleted = await fixture.SavedJourneys.DeleteAsync(saved.Id);

        Assert.True(deleted.IsSuccess);
        Assert.Equal(saved.Id, deleted.Value);

        /* GERÇEK silme: kaydedilmiş yolculuğun çöp kutusu ve geri yükleme ucu
           yoktur, işaretlenmiş bir satır hiç okunmayacak ölü veri olurdu. */
        Assert.Empty(await fixture.Db.SavedJourneys.ToListAsync());
        Assert.Empty(await fixture.Db.SavedJourneyPoints.ToListAsync());

        // İkinci silme "bulunamadı"dır; ayrı bir hata sınıfı üretilmez.
        Assert.Equal(ServiceErrorKind.NotFound, (await fixture.SavedJourneys.DeleteAsync(saved.Id)).ErrorKind);
    }

    [Fact]
    public async Task Deleting_a_saved_record_leaves_a_running_journey_alone()
    {
        await using var fixture = await Fixture.CreateAsync();
        var saved = await fixture.SaveAsync("Silinecek");

        var started = await fixture.SavedJourneys.ReuseAsync(saved.Id);
        Assert.True(started.IsSuccess);

        Assert.True((await fixture.SavedJourneys.DeleteAsync(saved.Id)).IsSuccess);

        /* Tanımı silmek çalıştırmayı DURDURMAZ: ikisi ayrı yaşam
           döngüsüdür ve kayıt zaten bir çalıştırma kimliği taşımaz. */
        var running = fixture.Store.FindByOwner(Owner);
        Assert.NotNull(running);
        Assert.Equal(started.Value!.SimulationId, running!.SimulationId);
    }

    /* --- Yeniden kullanım ---------------------------------------------------------- */

    [Fact]
    public async Task Reuse_reroutes_through_the_existing_routing_pipeline()
    {
        await using var fixture = await Fixture.CreateAsync();
        var saved = await fixture.SaveAsync("Yeniden");

        var callsAfterSave = fixture.Router.CallCount;

        var started = await fixture.SavedJourneys.ReuseAsync(saved.Id);

        Assert.True(started.IsSuccess);

        /* Kayıtta geometri YOKTUR: motora yeniden gidilmesi bir seçim değil,
           tek yoldur. */
        Assert.True(fixture.Router.CallCount > callsAfterSave);
        Assert.NotEmpty(started.Value!.GeometryWkt);
        Assert.Equal(JourneyContractNames.Waypoints, started.Value.Mode);
    }

    [Fact]
    public async Task Reuse_resolves_the_current_coordinate_of_a_moved_poi()
    {
        await using var fixture = await Fixture.CreateAsync();
        var saved = await fixture.SaveAsync("Taşınan POI");

        // POI kaydettikten SONRA taşınır.
        var poi = await fixture.Db.Pois.SingleAsync(item => item.Id == fixture.PoiId);
        poi.Coordinate = new Point(33.5, 43.5) { SRID = 4326 };
        await fixture.Db.SaveChangesAsync();

        Assert.True((await fixture.SavedJourneys.ReuseAsync(saved.Id)).IsSuccess);

        /* Motora giden koordinat POI'nin GÜNCEL konumudur: kayıt bir koordinat
           kopyası tutmadığı için bayat konuma düşülmesi yapısal olarak mümkün
           değildir. */
        var sent = fixture.Router.LastCoordinates[^1];
        Assert.Equal(33.5, sent.Longitude, 6);
        Assert.Equal(43.5, sent.Latitude, 6);
    }

    [Fact]
    public async Task Each_reuse_creates_a_brand_new_simulation_id()
    {
        await using var fixture = await Fixture.CreateAsync();
        var saved = await fixture.SaveAsync("İki kez");

        var first = await fixture.SavedJourneys.ReuseAsync(saved.Id);
        Assert.True(first.IsSuccess);

        await fixture.Simulations.StopAsync(first.Value!.SimulationId);

        var second = await fixture.SavedJourneys.ReuseAsync(saved.Id);
        Assert.True(second.IsSuccess);

        // B != C, ve kayıt hâlâ aynı kayıttır.
        Assert.NotEqual(first.Value.SimulationId, second.Value!.SimulationId);

        var stillThere = await fixture.SavedJourneys.GetAsync(saved.Id);
        Assert.True(stillThere.IsSuccess);
        Assert.Equal(saved.Id, stillThere.Value!.Id);
    }

    [Fact]
    public async Task Reuse_fails_before_any_simulation_when_a_reference_is_gone()
    {
        await using var fixture = await Fixture.CreateAsync();
        var saved = await fixture.SaveAsync("Kayıp nokta");

        var callsBefore = fixture.Router.CallCount;

        // Kaydedilen POI silinir.
        var poi = await fixture.Db.Pois.SingleAsync(item => item.Id == fixture.PoiId);
        poi.IsDeleted = true;
        await fixture.Db.SaveChangesAsync();

        var started = await fixture.SavedJourneys.ReuseAsync(saved.Id);

        Assert.False(started.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, started.ErrorKind);

        // Hangi noktanın çözülemediği KULLANICIYA söylenir.
        Assert.Contains("Kütüphane", started.Error);

        /* Yarım bir yolculuk BAŞLATILMAZ: motora hiç gidilmez ve hiçbir
           çalıştırma oluşmaz. */
        Assert.Equal(callsBefore, fixture.Router.CallCount);
        Assert.Null(fixture.Store.FindByOwner(Owner));
        Assert.Empty(fixture.Activity.Written);

        // Kaydın kendisi durur: incelenebilir, adlandırılabilir, silinebilir.
        Assert.True((await fixture.SavedJourneys.GetAsync(saved.Id)).IsSuccess);
        Assert.True((await fixture.SavedJourneys.UpdateAsync(
            saved.Id, new UpdateSavedJourneyRequest { Name = "Onarılacak" })).IsSuccess);
        Assert.True((await fixture.SavedJourneys.DeleteAsync(saved.Id)).IsSuccess);
    }

    [Fact]
    public async Task Reuse_fails_when_the_saved_line_is_gone()
    {
        await using var fixture = await Fixture.CreateAsync();

        var created = await fixture.SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
        {
            Name = "Tüm hat",
            Journey = new JourneyPlanRequest
            {
                Mode = JourneyContractNames.RouteFull,
                Profile = JourneyContractNames.Driving,
                RouteId = fixture.RouteId,
            },
        });

        var route = await fixture.Db.TransportRoutes.SingleAsync(item => item.Id == fixture.RouteId);
        route.IsDeleted = true;
        await fixture.Db.SaveChangesAsync();

        var started = await fixture.SavedJourneys.ReuseAsync(created.Value!.Id);

        Assert.False(started.IsSuccess);
        Assert.Equal(ServiceErrorKind.NotFound, started.ErrorKind);
        Assert.Null(fixture.Store.FindByOwner(Owner));
    }

    [Fact]
    public async Task Reuse_records_an_ordinary_journey_start_in_the_activity_history()
    {
        await using var fixture = await Fixture.CreateAsync();
        var saved = await fixture.SaveAsync("Defter");

        Assert.True((await fixture.SavedJourneys.ReuseAsync(saved.Id)).IsSuccess);

        /* Yeniden kullanım SIRADAN bir başlatmadır: mevcut defter davranışı
           aynen çalışır ve bu faz "kaydedilen görüntülendi/yıldızlandı" gibi
           yeni bir denetim olayı EKLEMEZ. */
        var written = Assert.Single(fixture.Activity.Written);
        Assert.Equal(JourneyActivityKind.Started, written.Outcome.Kind);
        Assert.Equal(Owner, written.OwnerUserId);
    }

    [Fact]
    public async Task Reuse_respects_the_existing_single_running_journey_rule()
    {
        await using var fixture = await Fixture.CreateAsync();
        var saved = await fixture.SaveAsync("Tek çalıştırma");

        Assert.True((await fixture.SavedJourneys.ReuseAsync(saved.Id)).IsSuccess);

        // Mevcut kural DEĞİŞMEZ: ikinci bir kişisel çalıştırma açılmaz.
        var second = await fixture.SavedJourneys.ReuseAsync(saved.Id);

        Assert.False(second.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, second.ErrorKind);
    }

    /* --- Yetki ve sınırlar ---------------------------------------------------------- */

    [Fact]
    public void Every_saved_journey_endpoint_is_gated_by_journey_use_and_nothing_else()
    {
        var endpoints = new[]
        {
            nameof(SavedJourneyController.Create),
            nameof(SavedJourneyController.List),
            nameof(SavedJourneyController.Get),
            nameof(SavedJourneyController.Update),
            nameof(SavedJourneyController.Delete),
            nameof(SavedJourneyController.Reuse),
        };

        foreach (var endpoint in endpoints)
        {
            var required = Assert.Single(
                typeof(SavedJourneyController).GetMethod(endpoint)!
                    .GetCustomAttributes<RequirePermissionAttribute>(true));

            Assert.Equal(PermissionCodes.JourneyUse, required.PermissionCode);
        }

        /* Bu faz YENİ bir yetki kodu açmadı: kişisel yolculuğu kullanabilen
           biri onu zaten kaydedebilmelidir. */
        Assert.DoesNotContain(
            PermissionCatalog.AllCodes,
            code => code.Contains("savedjourney", StringComparison.OrdinalIgnoreCase)
                || code.StartsWith("journey.saved", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void The_saved_journey_endpoints_never_take_an_owner_identity_from_the_route_or_body()
    {
        /* Sahip kimliği DAİMA doğrulanmış JWT'den gelir. Yoldan ya da gövdeden
           bir kullanıcı kimliği kabul eden bir uç, tahminle başkasının kaydına
           açılan bir kapı olurdu. */
        foreach (var method in typeof(SavedJourneyController).GetMethods(BindingFlags.Public | BindingFlags.DeclaredOnly | BindingFlags.Instance))
        {
            foreach (var parameter in method.GetParameters())
            {
                Assert.DoesNotContain("userId", parameter.Name, StringComparison.OrdinalIgnoreCase);
                Assert.DoesNotContain("ownerId", parameter.Name, StringComparison.OrdinalIgnoreCase);
            }
        }

        foreach (var contract in (Type[])[typeof(CreateSavedJourneyRequest), typeof(UpdateSavedJourneyRequest)])
        {
            Assert.Null(contract.GetProperty("UserId"));
            Assert.Null(contract.GetProperty("OwnerUserId"));
        }
    }

    /* --- Düzenek ------------------------------------------------------------------- */

    private sealed class Fixture : IAsyncDisposable
    {
        private Fixture(
            AppDbContext db,
            FakeJourneyRouter router,
            InMemoryJourneySimulationStateStore store,
            RecordingBroadcaster broadcaster,
            RecordingActivityRecorder activity,
            int? userId,
            bool isAdmin,
            string[] roles)
        {
            Db = db;
            Router = router;
            Store = store;
            Broadcaster = broadcaster;
            Activity = activity;

            var currentUser = Substitute.For<ICurrentUserService>();
            currentUser.UserId.Returns(userId);
            currentUser.IsAuthenticated.Returns(userId is not null);

            /* Kimlik nesnesi rol bilgisi TAŞIYABİLİR; ölçülen şey üretim
               kodunun ona bakmamasıdır. */
            currentUser.IsAdmin.Returns(isAdmin);
            currentUser.Roles.Returns(roles);

            var permissions = Substitute.For<IEffectivePermissionService>();
            permissions
                .HasPermissionAsync(Arg.Any<int>(), PermissionCodes.PoiView, Arg.Any<CancellationToken>())
                .Returns(true);
            permissions
                .HasPermissionAsync(Arg.Any<int>(), PermissionCodes.TransportView, Arg.Any<CancellationToken>())
                .Returns(true);

            Planning = new JourneyPlanningService(db, currentUser, permissions, router);
            Simulations = new JourneySimulationService(Planning, currentUser, store, broadcaster, activity);
            SavedJourneys = new SavedJourneyService(db, currentUser, Planning, Simulations);
        }

        public AppDbContext Db { get; }
        public FakeJourneyRouter Router { get; }
        public InMemoryJourneySimulationStateStore Store { get; }
        public RecordingBroadcaster Broadcaster { get; }
        public RecordingActivityRecorder Activity { get; }
        public JourneyPlanningService Planning { get; }
        public JourneySimulationService Simulations { get; }
        public SavedJourneyService SavedJourneys { get; }

        public int RouteId { get; private set; }
        public int[] StopIds { get; private set; } = [];
        public int PoiId { get; private set; }

        /// <summary>Aynı dünyayı BAŞKA bir kimlikle gören ikinci bir görünüm.</summary>
        public Fixture As(int? userId, bool isAdmin = false, string[]? roles = null) =>
            new(Db, Router, Store, Broadcaster, Activity, userId, isAdmin, roles ?? [])
            {
                RouteId = RouteId,
                StopIds = StopIds,
                PoiId = PoiId,
            };

        public static async Task<Fixture> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"saved-journey-{Guid.NewGuid():N}")
                .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
                .Options;

            var fixture = new Fixture(
                new AppDbContext(options),
                new FakeJourneyRouter(),
                new InMemoryJourneySimulationStateStore(),
                new RecordingBroadcaster(),
                new RecordingActivityRecorder(),
                Owner,
                isAdmin: false,
                roles: []);

            var route = new TransportRoute
            {
                Name = "Hat", ColorHex = "#123456", IsActive = true, CreatedDate = DateTime.UtcNow,
            };
            fixture.Db.TransportRoutes.Add(route);
            await fixture.Db.SaveChangesAsync();

            var stops = new List<TransportStop>();
            var index = 1;
            foreach (var (longitude, latitude, name) in
                     new (double, double, string)[] { (30, 40, "A"), (31, 41, "B") })
            {
                var stop = new TransportStop
                {
                    RouteId = route.Id, UserId = Owner, Name = name,
                    Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                    SequenceOrder = index++, IsActive = true, CreatedDate = DateTime.UtcNow,
                };
                fixture.Db.TransportStops.Add(stop);
                stops.Add(stop);
            }

            var poi = new Poi
            {
                Name = "Kütüphane",
                CategoryId = 1,
                Coordinate = new Point(32, 42) { SRID = 4326 },
                UserId = Owner,
                IsActive = true,
                CreatedDate = DateTime.UtcNow,
            };
            fixture.Db.Pois.Add(poi);
            await fixture.Db.SaveChangesAsync();

            fixture.RouteId = route.Id;
            fixture.StopIds = [.. stops.Select(stop => stop.Id)];
            fixture.PoiId = poi.Id;
            return fixture;
        }

        /// <summary>Varsayılan niyet: bir durak ve bir POI'den oluşan serbest yolculuk.</summary>
        public JourneyPlanRequest WaypointIntent() => new()
        {
            Mode = JourneyContractNames.Waypoints,
            Profile = JourneyContractNames.Driving,
            Waypoints =
            [
                new() { Source = JourneyContractNames.TransportStop, ReferenceId = StopIds[0] },
                new() { Source = JourneyContractNames.Poi, ReferenceId = PoiId },
            ],
        };

        public async Task<SavedJourneyResponse> SaveAsync(string name)
        {
            var created = await SavedJourneys.CreateAsync(new CreateSavedJourneyRequest
            {
                Name = name, Journey = WaypointIntent(),
            });

            Assert.True(created.IsSuccess, created.Error);
            return created.Value!;
        }

        public ValueTask DisposeAsync() => Db.DisposeAsync();
    }

    /// <summary>Yayınlanan kişisel yolculuk güncellemelerini toplar.</summary>
    private sealed class RecordingBroadcaster : IJourneySimulationBroadcaster
    {
        public List<JourneySimulationLiveUpdate> Published { get; } = [];

        public Task PublishAsync(
            JourneySimulationLiveUpdate update,
            CancellationToken cancellationToken = default)
        {
            Published.Add(update);
            return Task.CompletedTask;
        }
    }

    /// <summary>Yazılan yolculuk aktivite olaylarını toplar.</summary>
    private sealed class RecordingActivityRecorder : IJourneyActivityRecorder
    {
        public List<(JourneyActivityOutcome Outcome, int OwnerUserId)> Written { get; } = [];

        public Task RecordAsync(
            JourneyActivityOutcome outcome,
            int ownerUserId,
            CancellationToken cancellationToken = default)
        {
            Written.Add((outcome, ownerUserId));
            return Task.CompletedTask;
        }
    }
}
