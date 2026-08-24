using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Geographic;
using StajProject.Application.Interfaces;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// <see cref="PoiService"/> davranışı: sahiplik, doğrulama, coğrafi sınır ve
/// iki ayrı okuma sözleşmesi (harita / yönetim).
/// </summary>
/// <remarks>
/// <para>
/// Gerçek servis, gerçek <see cref="AppDbContext"/> ve gerçek doğrulayıcılar
/// kullanılır; yalnızca veritabanı in-memory'dir. Substitute edilen tek şey
/// çağıranın kimliği ve coğrafi sınırıdır — ikisi de bu servisin dışında
/// belirlenen girdilerdir.
/// </para>
/// <para>
/// <b>Yetki kapıları burada ölçülmez.</b> <c>poi.view</c> / <c>poi.create</c>
/// / <c>poi.manage</c> denetimi API katmanının işidir ve
/// <see cref="PoiApiAuthorizationTests"/> tarafından gerçek HTTP hattı
/// üzerinde doğrulanır.
/// </para>
/// </remarks>
public class PoiServiceTests
{
    /* --- Sahiplik --------------------------------------------------------------- */

    [Fact]
    public async Task Create_takes_ownership_from_the_authenticated_actor()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var actor = await fixture.AddUserAsync("operator-1");
        fixture.ActAs(actor);

        var result = await fixture.Service.CreatePoiAsync(Request(category.Id));

        Assert.True(result.IsSuccess);

        var stored = await fixture.Db.Pois.SingleAsync();
        Assert.Equal(actor.Id, stored.UserId);
    }

    [Fact]
    public void The_request_contract_cannot_carry_an_owner()
    {
        /* Sahiplik sahteciliğine karşı savunma bir "if" DEĞİL, sözleşmenin
           kendisidir: DTO'da userId/creator alanı yoktur, dolayısıyla gövdede
           gönderilse bile model binder onu bağlayacak bir yere sahip değildir.
           Test bunu tip üzerinden sabitler — bir gün böyle bir property
           eklenirse burada düşer. */
        var properties = typeof(CreatePoiRequest).GetProperties().Select(p => p.Name).ToArray();

        Assert.Equal(
            ["CategoryId", "Latitude", "Longitude", "Name", "WorkHours"],
            properties.OrderBy(name => name, StringComparer.Ordinal));
    }

    [Fact]
    public async Task Create_without_a_resolvable_actor_is_forbidden_and_writes_nothing()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAsAnonymous();

        var result = await fixture.Service.CreatePoiAsync(Request(category.Id));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
        Assert.Empty(await fixture.Db.Pois.IgnoreQueryFilters().ToListAsync());
    }

    /* --- Audit ve geometri ------------------------------------------------------ */

    [Fact]
    public async Task Create_stamps_created_and_modified_dates_on_the_server()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("operator-2"));

        var before = DateTime.UtcNow;
        Assert.True((await fixture.Service.CreatePoiAsync(Request(category.Id))).IsSuccess);
        var after = DateTime.UtcNow;

        var stored = await fixture.Db.Pois.SingleAsync();

        /* CreatedDate servis tarafından AÇIKÇA damgalanır: AppDbContext yalnızca
           ModifiedDate'i IAuditableEntity üzerinden yazar. Damgalanmasaydı satır
           default(DateTime) ile kalırdı ve bu test tam olarak onu yakalar. */
        Assert.InRange(stored.CreatedDate, before, after);
        Assert.InRange(stored.ModifiedDate, before, after);
        Assert.NotEqual(default, stored.CreatedDate);
    }

    [Fact]
    public async Task Create_writes_the_point_with_srid_4326()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("operator-3"));

        Assert.True((await fixture.Service.CreatePoiAsync(Request(category.Id, longitude: 32.85, latitude: 39.93))).IsSuccess);

        var stored = await fixture.Db.Pois.SingleAsync();

        Assert.Equal(4326, stored.Coordinate.SRID);
        Assert.Equal(32.85, stored.Coordinate.X, 9);
        Assert.Equal(39.93, stored.Coordinate.Y, 9);
    }

    /* --- Koordinat doğrulaması --------------------------------------------------- */

    [Theory]
    [InlineData(200, 39)]
    [InlineData(-200, 39)]
    [InlineData(32, 100)]
    [InlineData(32, -100)]
    [InlineData(double.NaN, 39)]
    [InlineData(32, double.NaN)]
    [InlineData(double.PositiveInfinity, 39)]
    public async Task Create_rejects_coordinates_outside_epsg_4326(double longitude, double latitude)
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("operator-4"));

        var result = await fixture.Service.CreatePoiAsync(Request(category.Id, longitude, latitude));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Empty(await fixture.Db.Pois.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Create_rejects_an_empty_name()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("operator-5"));

        var request = Request(category.Id);
        request.Name = "   ";

        Assert.False((await fixture.Service.CreatePoiAsync(request)).IsSuccess);
    }

    /* --- Kategori doğrulaması ---------------------------------------------------- */

    [Fact]
    public async Task Create_rejects_an_inactive_category()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Pasif", isActive: false);
        fixture.ActAs(await fixture.AddUserAsync("operator-6"));

        var result = await fixture.Service.CreatePoiAsync(Request(category.Id));

        Assert.False(result.IsSuccess);
        Assert.Empty(await fixture.Db.Pois.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Create_rejects_a_deleted_category()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Silinmiş", isDeleted: true);
        fixture.ActAs(await fixture.AddUserAsync("operator-7"));

        Assert.False((await fixture.Service.CreatePoiAsync(Request(category.Id))).IsSuccess);
    }

    [Fact]
    public async Task Create_rejects_a_category_that_does_not_exist()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        fixture.ActAs(await fixture.AddUserAsync("operator-8"));

        Assert.False((await fixture.Service.CreatePoiAsync(Request(4242))).IsSuccess);
    }

    /* --- Mesai saatleri ----------------------------------------------------------- */

    [Fact]
    public async Task Valid_work_hours_round_trip_through_the_jsonb_column()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("operator-9"));

        var request = Request(category.Id);
        request.WorkHours = new PoiWorkHoursDto
        {
            Monday = new PoiWorkHoursDayDto { Closed = false, Open = "09:00", Close = "18:00" },
            Sunday = new PoiWorkHoursDayDto { Closed = true }
        };

        var created = await fixture.Service.CreatePoiAsync(request);

        Assert.True(created.IsSuccess);
        Assert.False(created.Value!.WorkHours!.Monday!.Closed);
        Assert.Equal("09:00", created.Value.WorkHours.Monday.Open);
        Assert.Equal("18:00", created.Value.WorkHours.Monday.Close);
        Assert.True(created.Value.WorkHours.Sunday!.Closed);

        /* Kapalı günde saat bilgisi SAKLANMAZ: "kapalı ama 09:00-18:00" gibi
           kendi içinde çelişen bir satır hiç oluşmaz. */
        Assert.Null(created.Value.WorkHours.Sunday.Open);

        // Gönderilmeyen gün "bilinmiyor"dur ve kapalı SAYILMAZ.
        Assert.Null(created.Value.WorkHours.Tuesday);

        var stored = await fixture.Db.Pois.SingleAsync();
        Assert.Contains("monday", stored.WorkHoursJson);
    }

    [Theory]
    /* Sözleşme KATI HH:mm'dir: iki haneli saat, iki nokta üst üste, iki haneli
       dakika. Eksik doldurulmuş bir değer düzeltilmez, reddedilir — esnek kabul
       edip kanonikleştirmek, geçersiz sayılan bir girdiyi sessizce geçerli
       kılardı. */
    [InlineData("9:00", "18:00")]
    [InlineData("09:5", "18:00")]
    [InlineData("9:5", "18:00")]
    [InlineData("24:00", "18:00")]
    [InlineData("09:00", "24:00")]
    [InlineData("12:60", "18:00")]
    [InlineData("09:00", "12:60")]
    [InlineData(" 09:00", "18:00")]
    [InlineData("09:00 ", "18:00")]
    [InlineData("09.00", "18:00")]
    [InlineData("25:00", "26:00")]
    [InlineData("09:60", "18:00")]
    [InlineData("090:0", "18:00")]
    [InlineData("", "18:00")]
    [InlineData(null, "18:00")]
    [InlineData("09:00", null)]
    public async Task Create_rejects_malformed_times(string? open, string? close)
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("operator-10"));

        var request = Request(category.Id);
        request.WorkHours = new PoiWorkHoursDto
        {
            Monday = new PoiWorkHoursDayDto { Closed = false, Open = open, Close = close }
        };

        Assert.False((await fixture.Service.CreatePoiAsync(request)).IsSuccess);
        Assert.Empty(await fixture.Db.Pois.IgnoreQueryFilters().ToListAsync());
    }

    [Theory]
    [InlineData("00:00", "23:59")]
    [InlineData("09:00", "18:30")]
    public async Task Create_accepts_strictly_padded_times_and_stores_them_verbatim(string open, string close)
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("operator-10b"));

        var request = Request(category.Id);
        request.WorkHours = new PoiWorkHoursDto
        {
            Monday = new PoiWorkHoursDayDto { Closed = false, Open = open, Close = close }
        };

        var created = await fixture.Service.CreatePoiAsync(request);

        Assert.True(created.IsSuccess);

        // Geçerli değer olduğu gibi saklanır; yeniden biçimlendirilmez.
        Assert.Equal(open, created.Value!.WorkHours!.Monday!.Open);
        Assert.Equal(close, created.Value.WorkHours.Monday.Close);
    }

    [Theory]
    /* GECE AŞIMI GEÇERLİDİR. Kapanışın sayıca küçük olması hata değildir:
       17:00 – 01:00, açılış günü başlayıp ERTESİ GÜN kapanan gerçek bir mesai
       aralığıdır ve bunu reddetmek, gece çalışan hiçbir işletmenin saatini
       giremeyeceği anlamına gelirdi. Kural, ayrı bir bayrakla değil, saatlerin
       kendisiyle temsil edilir — kapanış açılıştan küçükse ertesi gündür — ve
       bu yüzden şema değişikliği gerektirmez. */
    [InlineData("17:00", "01:00")]
    [InlineData("18:00", "02:00")]
    [InlineData("20:00", "04:00")]
    [InlineData("23:30", "03:00")]
    public async Task Create_accepts_an_overnight_interval_and_stores_it_verbatim(string open, string close)
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync($"operator-11-{open[..2]}"));

        var request = Request(category.Id);
        request.WorkHours = new PoiWorkHoursDto
        {
            Monday = new PoiWorkHoursDayDto { Closed = false, Open = open, Close = close }
        };

        var created = await fixture.Service.CreatePoiAsync(request);

        Assert.True(created.IsSuccess);
        // Değerler OLDUĞU GİBİ saklanır; "ertesi gün" için ek bir alan yazılmaz.
        Assert.Equal(open, created.Value!.WorkHours!.Monday!.Open);
        Assert.Equal(close, created.Value.WorkHours.Monday.Close);
        Assert.False(created.Value.WorkHours.Monday.Closed);

        /* Pazartesi'nin aralığı Salı 01:00'de kapanır ama Salı'nın KENDİ
           programı bundan etkilenmez: gövdeye Salı hiç girmez. */
        Assert.Null(created.Value.WorkHours.Tuesday);
    }

    /* --- 24 saat açık ---------------------------------------------------------
       Günün DÖRDÜNCÜ durumu ve AÇIK bir bayrak. Eşit saatlerle temsil edilmez;
       o gösterim geçersiz kalır (aşağıdaki teoriye bakınız). */

    [Fact]
    public async Task Create_accepts_an_explicit_24_hour_day_and_stores_no_times()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("operator-24a"));

        var request = Request(category.Id);
        request.WorkHours = new PoiWorkHoursDto
        {
            Monday = new PoiWorkHoursDayDto { Closed = false, Open24Hours = true },
            Sunday = new PoiWorkHoursDayDto { Closed = true }
        };

        var created = await fixture.Service.CreatePoiAsync(request);

        Assert.True(created.IsSuccess);

        var monday = created.Value!.WorkHours!.Monday!;
        Assert.True(monday.Open24Hours);
        Assert.False(monday.Closed);
        // Sahte bir 00:00–23:59 aralığı UYDURULMAZ.
        Assert.Null(monday.Open);
        Assert.Null(monday.Close);

        // Diğer durumlar bozulmaz: kapalı kapalı, bildirilmemiş bildirilmemiş.
        Assert.True(created.Value.WorkHours.Sunday!.Closed);
        Assert.False(created.Value.WorkHours.Sunday.Open24Hours);
        Assert.Null(created.Value.WorkHours.Tuesday);

        var stored = await fixture.Db.Pois.AsNoTracking().SingleAsync();
        Assert.Contains("open24Hours", stored.WorkHoursJson);
    }

    [Fact]
    public async Task A_24_hour_day_needs_no_opening_or_closing_time()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("operator-24b"));

        var request = Request(category.Id);
        // Saatler gönderilse bile TEMİZLENİR: kesintisiz açık bir günün saati yoktur.
        request.WorkHours = new PoiWorkHoursDto
        {
            Monday = new PoiWorkHoursDayDto
            {
                Closed = false,
                Open24Hours = true,
                Open = "saçma",
                Close = null
            }
        };

        var created = await fixture.Service.CreatePoiAsync(request);

        Assert.True(created.IsSuccess);
        Assert.True(created.Value!.WorkHours!.Monday!.Open24Hours);
        Assert.Null(created.Value.WorkHours.Monday.Open);
    }

    [Fact]
    public async Task A_day_cannot_be_closed_and_open_24_hours_at_once()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("operator-24c"));

        var request = Request(category.Id);
        request.WorkHours = new PoiWorkHoursDto
        {
            Monday = new PoiWorkHoursDayDto { Closed = true, Open24Hours = true }
        };

        /* Çelişki REDDEDİLİR, normalize edilmez: hangisinin kazanacağına sunucu
           karar verseydi, istemcinin hiç söylemediği bir programı onun adına
           yazmış olurdu. Arayüz iki kutuyu birbirini dışlayacak biçimde kurar,
           dolayısıyla böyle bir gövde ancak elle gelir. */
        Assert.False((await fixture.Service.CreatePoiAsync(request)).IsSuccess);
        Assert.Empty(await fixture.Db.Pois.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task Update_accepts_a_24_hour_day()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("operator-24d");
        var poi = await fixture.AddPoiAsync(
            "Kafe",
            category.Id,
            owner.Id,
            workHoursJson: "{\"monday\":{\"closed\":false,\"open\":\"09:00\",\"close\":\"18:00\"}}");

        fixture.ActAs(owner);
        fixture.Grant(update: true);

        var request = new UpdatePoiRequest
        {
            Name = "Kafe",
            CategoryId = category.Id,
            WorkHours = new PoiWorkHoursDto
            {
                Monday = new PoiWorkHoursDayDto { Closed = false, Open24Hours = true }
            }
        };

        var updated = await fixture.Service.UpdatePoiAsync(poi.Id, request);

        Assert.True(updated.IsSuccess);
        Assert.True(updated.Value!.WorkHours!.Monday!.Open24Hours);
        Assert.Null(updated.Value.WorkHours.Monday.Open);
    }

    [Fact]
    public async Task Stored_rows_without_the_24_hour_field_stay_valid()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var actor = await fixture.AddUserAsync("operator-24e");

        /* ESKİ satırlar alanı hiç taşımaz. jsonb kolonuna yeni bir özellik
           eklemek onları bozmaz ve şema değişikliği de gerektirmez. */
        await fixture.AddPoiAsync(
            "Eski",
            category.Id,
            actor.Id,
            workHoursJson: "{\"monday\":{\"closed\":false,\"open\":\"17:00\",\"close\":\"01:00\"},\"sunday\":{\"closed\":true}}");

        var poi = Assert.Single(await fixture.Service.GetMapPoisAsync());

        Assert.False(poi.WorkHours!.Monday!.Open24Hours);
        Assert.Equal("17:00", poi.WorkHours.Monday.Open);
        Assert.Equal("01:00", poi.WorkHours.Monday.Close);
        Assert.True(poi.WorkHours.Sunday!.Closed);
        Assert.False(poi.WorkHours.Sunday.Open24Hours);
    }

    [Theory]
    [InlineData("09:00", "09:00")]
    [InlineData("00:00", "00:00")]
    public async Task Create_rejects_an_interval_that_has_no_duration(string open, string close)
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync($"operator-11b-{open[..2]}"));

        var request = Request(category.Id);
        request.WorkHours = new PoiWorkHoursDto
        {
            Monday = new PoiWorkHoursDayDto { Closed = false, Open = open, Close = close }
        };

        /* Aynı açılış ve kapanış, süresi olmayan bir aralıktır. "24 saat açık"
           SAYILMAZ: veriden türetilemeyen bir anlam uydurmak olurdu ve 24 saat
           desteği istenirse kendi alanıyla açıkça eklenmelidir. */
        Assert.False((await fixture.Service.CreatePoiAsync(request)).IsSuccess);
    }

    [Fact]
    public async Task Malformed_stored_json_does_not_break_the_list()
    {
        /* Kolonda elle yazılmış ya da eski biçimde bir değer bulunabilir. Bozuk
           bir satır o POI'yi mesaisiz gösterir; listenin TAMAMINI düşürmez. */
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var actor = await fixture.AddUserAsync("operator-12");

        await fixture.AddPoiAsync("Bozuk", category.Id, actor.Id, workHoursJson: "{ this is not json");
        await fixture.AddPoiAsync("Sağlam", category.Id, actor.Id);

        var pois = await fixture.Service.GetMapPoisAsync();

        Assert.Equal(2, pois.Count);
        Assert.Null(pois.Single(p => p.Name == "Bozuk").WorkHours);
    }

    /* --- Coğrafi yetki ------------------------------------------------------------ */

    [Fact]
    public async Task A_restricted_actor_cannot_create_outside_the_allowed_area()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var actor = await fixture.AddUserAsync("restricted");
        fixture.ActAs(actor);
        fixture.RestrictTo(actor, Box(30, 38, 31, 39));

        var result = await fixture.Service.CreatePoiAsync(Request(category.Id, longitude: 40, latitude: 45));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);

        // İzin verilen alan hata mesajında paylaşılmaz.
        Assert.DoesNotContain("POLYGON", result.Error!, StringComparison.OrdinalIgnoreCase);
        Assert.Empty(await fixture.Db.Pois.IgnoreQueryFilters().ToListAsync());
    }

    [Fact]
    public async Task A_restricted_actor_may_create_inside_the_allowed_area()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var actor = await fixture.AddUserAsync("restricted-inside");
        fixture.ActAs(actor);
        fixture.RestrictTo(actor, Box(30, 38, 31, 39));

        Assert.True((await fixture.Service.CreatePoiAsync(Request(category.Id, longitude: 30.5, latitude: 38.5))).IsSuccess);
    }

    [Fact]
    public async Task An_unrestricted_actor_may_create_anywhere()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("unrestricted"));

        // Varsayılan sınır Unrestricted'dır; hiç coğrafi alan tanımlanmamış bir
        // kurulumda POI ekleme sessizce kapanmamalıdır.
        Assert.True((await fixture.Service.CreatePoiAsync(Request(category.Id, longitude: 150, latitude: -40))).IsSuccess);
    }

    [Fact]
    public async Task Geography_is_not_applied_to_reads()
    {
        /* Sınır, nerede veri ÜRETİLEBİLECEĞİNİ belirler; ne görülebileceğini
           değil. Alanının dışındaki POI'ler de listede görünür. */
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("far-away-owner");
        await fixture.AddPoiAsync("Uzak", category.Id, owner.Id, longitude: 150, latitude: -40);

        var reader = await fixture.AddUserAsync("restricted-reader");
        fixture.ActAs(reader);
        fixture.RestrictTo(reader, Box(30, 38, 31, 39));

        Assert.Single(await fixture.Service.GetMapPoisAsync());
    }

    /* --- Harita listesi ------------------------------------------------------------ */

    [Fact]
    public async Task The_map_list_excludes_inactive_and_deleted_records()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner");

        await fixture.AddPoiAsync("Aktif", category.Id, owner.Id);
        await fixture.AddPoiAsync("Pasif", category.Id, owner.Id, isActive: false);
        await fixture.AddPoiAsync("Silinmiş", category.Id, owner.Id, isDeleted: true);

        var pois = await fixture.Service.GetMapPoisAsync();

        Assert.Equal(["Aktif"], pois.Select(p => p.Name));
    }

    [Fact]
    public async Task The_map_list_is_not_scoped_to_the_caller()
    {
        /* Çizimlerden AYRILAN nokta: POI ortak envanterdir. Sahiplik yüklemi
           eklenirse ödevin "Kullanıcı POI'leri görür" gereksinimi karşılanmaz. */
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var someoneElse = await fixture.AddUserAsync("someone-else");
        await fixture.AddPoiAsync("Başkasının POI'si", category.Id, someoneElse.Id);

        fixture.ActAs(await fixture.AddUserAsync("reader"));

        Assert.Single(await fixture.Service.GetMapPoisAsync());
    }

    [Fact]
    public void The_map_response_exposes_no_creator_information()
    {
        /* Sıradan bir harita kullanıcısının bir noktayı görebilmesi, onu kimin
           eklediğini öğrenebilmesi anlamına gelmez. Sözleşme tip üzerinden
           sabitlenir: creator alanı EKLENİRSE bu test düşer.

           Phase 3 sözleşmeye İKİ yetenek bayrağı ekledi (CanUpdate/CanDelete)
           ve bu, kuralı gevşetmez: bayraklar "bu ÇAĞIRAN bu kayıtta ne
           yapabilir" der, "bu kaydı KİM ekledi" demez. Arayüzün "Düzenle"
           düğmesini gösterebilmesi için sahibi bilmesi gerekmez — yalnızca
           kendi yetkisini bilmesi gerekir; sahibi göndermek ise haritayı
           sessizce bir personel dizinine çevirirdi. */
        var properties = typeof(PoiResponse).GetProperties().Select(p => p.Name).ToArray();

        Assert.Equal(
            [
                "CanDelete", "CanUpdate", "CategoryId", "CategoryName", "CategoryPath",
                "Id", "Latitude", "Longitude", "Name", "WorkHours"
            ],
            properties.OrderBy(name => name, StringComparer.Ordinal));

        /* Yasaklı alanlar AÇIKÇA sayılır: testin adı böylece tipin şekline
           dolaylı olarak güvenmek yerine doğrudan kanıtlanır. Liste, sahiplik
           kimliğinin projede aldığı adları kapsar (entity: UserId; yönetim
           sözleşmesi: CreatorUserId / CreatorUsername; çizim mirası:
           CreatedBy / CreatedByUserId). */
        string[] forbidden =
        [
            "UserId", "User",
            "CreatorUserId", "CreatorUsername",
            "CreatedBy", "CreatedByUserId",
            "OwnerId", "OwnerUsername"
        ];

        Assert.All(forbidden, name => Assert.DoesNotContain(name, properties, StringComparer.Ordinal));

        /* Ad KALIBI üzerinden ikinci bir kapı: yukarıdaki listede olmayan yeni
           bir sahiplik alanı (ör. AddedByUserId) da geçemesin. */
        Assert.DoesNotContain(properties, name => name.Contains("User", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(properties, name => name.Contains("Creator", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(properties, name => name.Contains("Owner", StringComparison.OrdinalIgnoreCase));

        /* Soft-delete DURUMU da haritaya çıkmaz: harita listesi zaten yalnızca
           aktif kayıtları taşır. "CanDelete" bir YETENEKTİR, bir durum değil —
           bu yüzden yasak kalıp "Deleted"tır ve onunla çakışmaz. */
        Assert.DoesNotContain(properties, name => name.Contains("Deleted", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(properties, name => name.Contains("IsActive", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task The_map_list_carries_the_category_path()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var parent = await fixture.AddCategoryAsync("Yeme-İçme");
        var child = await fixture.AddCategoryAsync("Restoran", parent.Id);
        var owner = await fixture.AddUserAsync("owner-path");
        await fixture.AddPoiAsync("Lokanta", child.Id, owner.Id);

        var poi = Assert.Single(await fixture.Service.GetMapPoisAsync());

        Assert.Equal("Restoran", poi.CategoryName);
        Assert.Equal("Yeme-İçme / Restoran", poi.CategoryPath);
    }

    /* --- Yönetim listesi ----------------------------------------------------------- */

    [Fact]
    public async Task The_admin_list_includes_inactive_and_deleted_records()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("owner-admin");

        await fixture.AddPoiAsync("Aktif", category.Id, owner.Id);
        await fixture.AddPoiAsync("Pasif", category.Id, owner.Id, isActive: false);
        await fixture.AddPoiAsync("Silinmiş", category.Id, owner.Id, isDeleted: true);

        var pois = await fixture.Service.GetAdminPoisAsync();

        Assert.Equal(3, pois.Count);
        Assert.Contains(pois, p => p.Name == "Pasif" && !p.IsActive);
        Assert.Contains(pois, p => p.Name == "Silinmiş" && p.IsDeleted);
    }

    [Fact]
    public async Task The_admin_list_attributes_each_record_to_its_creator()
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        var owner = await fixture.AddUserAsync("kaydeden");
        await fixture.AddPoiAsync("Kafe", category.Id, owner.Id);

        var poi = Assert.Single(await fixture.Service.GetAdminPoisAsync());

        Assert.Equal(owner.Id, poi.CreatorUserId);
        Assert.Equal("kaydeden", poi.CreatorUsername);
    }

    [Fact]
    public void The_admin_response_exposes_no_security_fields()
    {
        var properties = typeof(AdminPoiResponse).GetProperties().Select(p => p.Name).ToArray();

        // Oluşturan ATFI gereklidir; kimlik doğrulama verisi asla.
        Assert.Contains("CreatorUserId", properties);
        Assert.Contains("CreatorUsername", properties);
        Assert.DoesNotContain(properties, name => name.Contains("Password", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(properties, name => name.Contains("Email", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(properties, name => name.Contains("Stamp", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(properties, name => name.Contains("Role", StringComparison.OrdinalIgnoreCase));
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static CreatePoiRequest Request(int categoryId, double longitude = 32.85, double latitude = 39.93) =>
        new()
        {
            Name = "Test POI",
            CategoryId = categoryId,
            Longitude = longitude,
            Latitude = latitude
        };

    private static Polygon Box(double minX, double minY, double maxX, double maxY) =>
        new GeometryFactory(new PrecisionModel(), 4326).CreatePolygon(
        [
            new Coordinate(minX, minY),
            new Coordinate(maxX, minY),
            new Coordinate(maxX, maxY),
            new Coordinate(minX, maxY),
            new Coordinate(minX, minY)
        ]);

    /// <summary>
    /// Gerçek servis + in-memory veritabanı. Kimlik ve coğrafi sınır substitute
    /// edilir: ikisi de servisin DIŞINDA belirlenen girdilerdir.
    /// </summary>
    internal sealed class PoiFixture : IAsyncDisposable
    {
        private PoiFixture(
            AppDbContext db,
            ICurrentUserService currentUser,
            IGeographicAuthorizationService geography,
            IPoiAuthorizationService poiAuthorization)
        {
            Db = db;
            CurrentUser = currentUser;
            Geography = geography;
            PoiAuthorization = poiAuthorization;
            Service = new PoiService(db, currentUser, geography, poiAuthorization);
            Categories = new PoiCategoryService(db);
        }

        public AppDbContext Db { get; }

        public ICurrentUserService CurrentUser { get; }

        public IGeographicAuthorizationService Geography { get; }

        /// <summary>
        /// POI yetki/sahiplik portu. Substitute edilir çünkü etkin yetki
        /// hesabı bu servisin DIŞINDA belirlenen bir girdidir; buradaki
        /// testlerin konusu, o girdinin sahiplikle nasıl BİRLEŞTİĞİDİR.
        /// </summary>
        public IPoiAuthorizationService PoiAuthorization { get; }

        public PoiService Service { get; }

        public PoiCategoryService Categories { get; }

        public static Task<PoiFixture> CreateAsync()
        {
            var options = new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"poi-service-{Guid.NewGuid():N}")
                .Options;

            var db = new AppDbContext(options);
            var currentUser = Substitute.For<ICurrentUserService>();
            var geography = Substitute.For<IGeographicAuthorizationService>();
            var poiAuthorization = Substitute.For<IPoiAuthorizationService>();

            // Varsayılan: hiçbir POI mutasyon yetkisi yok (fail-closed).
            poiAuthorization.GetAuthorityAsync(Arg.Any<CancellationToken>())
                .Returns(PoiAuthority.None);

            /* Varsayılan: kısıtsız. Hiç coğrafi alan tanımlanmamış kurulumların
               davranışı budur ve testlerin çoğunun konusu coğrafya değildir. */
            geography.GetEffectiveAuthorizationAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
                .Returns(EffectiveGeographicAuthorization.Unrestricted);

            return Task.FromResult(new PoiFixture(db, currentUser, geography, poiAuthorization));
        }

        /// <summary>
        /// O an rol yapan kullanıcının kimliği — SIRADAN bir alan, substitute
        /// değil.
        /// </summary>
        /// <remarks>
        /// <b>Neden ayrı bir alan.</b> <see cref="Grant"/>, yetki nesnesini
        /// kurarken çağıranın kimliğine ihtiyaç duyar. Bu kimliği
        /// <c>CurrentUser.UserId</c>'den okumak, BİR substitute'u
        /// yapılandırırken BAŞKA bir substitute'u çağırmak demektir: NSubstitute
        /// son çağrıyı kaydettiği için <c>get_UserId</c> "son çağrı" hâline
        /// gelir ve ardından gelen <c>.Returns(...)</c> ona iliştirilmeye
        /// çalışılır (<c>Task&lt;PoiAuthority&gt;</c> değerini
        /// <c>int?</c> döndüren bir property'ye). Kimliği düz bir alanda
        /// tutmak, kurulum ifadesinin içinde hiçbir substitute çağrısı
        /// bulunmamasını garanti eder.
        /// </remarks>
        private int? _actingUserId;

        public void ActAs(User user)
        {
            // ÖNCE düz alan: Grant artık substitute'a hiç dokunmadan okur.
            _actingUserId = user.Id;

            CurrentUser.UserId.Returns(user.Id);
            CurrentUser.UserName.Returns(user.UserName!);
            CurrentUser.IsAuthenticated.Returns(true);
            // Kimlik değişince yetki nesnesi de o kimliği taşımalıdır; aksi
            // hâlde sahiplik karşılaştırması eski kullanıcıyı sorardı.
            Grant();
        }

        /// <summary>
        /// Çağıranın POI yetkilerini kurar. Sahiplik AYRI bir eksendir ve
        /// kaydın veritabanındaki sahibine bakılarak servis içinde uygulanır.
        /// </summary>
        /// <remarks>
        /// Yetki nesnesi, rol yapan kullanıcının GERÇEK kimliğini taşır —
        /// <c>Arg.Any</c> ya da sabit bir kimlik değil. Sahiplik testleri
        /// anlamını tam olarak buradan alır: "poi.update taşıyor ama kayıt
        /// başkasının" durumu ancak yetki nesnesindeki kimlik doğru olduğunda
        /// ölçülebilir.
        /// </remarks>
        /// <exception cref="InvalidOperationException">
        /// <see cref="ActAs"/> çağrılmadan kullanılırsa. Kimliksiz bir yetki
        /// nesnesi kurmak, sahiplik karşılaştırmasını sessizce anlamsız
        /// kılardı; hata AÇIKÇA verilir.
        /// </exception>
        public void Grant(bool manage = false, bool update = false, bool delete = false)
        {
            var actingUserId = _actingUserId
                ?? throw new InvalidOperationException(
                    "Grant, ActAs'tan sonra çağrılmalıdır: yetki nesnesi rol yapan kullanıcının kimliğini taşır.");

            /* Kurulum ifadesinin içinde HİÇBİR substitute çağrısı yoktur;
               yalnızca düz bir int okunur. */
            PoiAuthorization.GetAuthorityAsync(Arg.Any<CancellationToken>())
                .Returns(new PoiAuthority(actingUserId, manage, update, delete));
        }

        public void ActAsAnonymous()
        {
            // Kimlik yok: Grant çağrılırsa açıkça hata vermelidir.
            _actingUserId = null;

            CurrentUser.UserId.Returns((int?)null);
            CurrentUser.IsAuthenticated.Returns(false);

            /* Kimliksiz çağıranın hiçbir POI mutasyon yetkisi yoktur ve bu
               kurulum, önceki bir ActAs'tan kalan yetki nesnesinin sızmasını
               da engeller. */
            PoiAuthorization.GetAuthorityAsync(Arg.Any<CancellationToken>())
                .Returns(PoiAuthority.None);
        }

        public void RestrictTo(User user, Geometry area) =>
            Geography.GetEffectiveAuthorizationAsync(user.Id, Arg.Any<CancellationToken>())
                .Returns(EffectiveGeographicAuthorization.Restricted(area));

        public async Task<User> AddUserAsync(string userName)
        {
            var user = new User
            {
                UserName = userName,
                NormalizedUserName = userName.ToUpperInvariant(),
                Email = $"{userName}@example.invalid",
                NormalizedEmail = $"{userName}@example.invalid".ToUpperInvariant(),
                EmailConfirmed = true,
                IsActive = true
            };

            Db.Users.Add(user);
            await Db.SaveChangesAsync();
            return user;
        }

        public async Task<PoiCategory> AddCategoryAsync(
            string name,
            int? parentId = null,
            bool isActive = true,
            bool isDeleted = false)
        {
            var category = new PoiCategory
            {
                Name = name,
                ParentId = parentId,
                IsActive = isActive,
                IsDeleted = isDeleted,
                CreatedDate = DateTime.UtcNow
            };

            Db.PoiCategories.Add(category);
            await Db.SaveChangesAsync();
            return category;
        }

        public async Task<Poi> AddPoiAsync(
            string name,
            int categoryId,
            int userId,
            double longitude = 32.85,
            double latitude = 39.93,
            string? workHoursJson = null,
            bool isActive = true,
            bool isDeleted = false)
        {
            var poi = new Poi
            {
                Name = name,
                CategoryId = categoryId,
                UserId = userId,
                Coordinate = new Point(longitude, latitude) { SRID = 4326 },
                WorkHoursJson = workHoursJson,
                IsActive = isActive,
                IsDeleted = isDeleted,
                CreatedDate = DateTime.UtcNow
            };

            Db.Pois.Add(poi);
            await Db.SaveChangesAsync();
            return poi;
        }

        public async ValueTask DisposeAsync() => await Db.DisposeAsync();
    }
}
