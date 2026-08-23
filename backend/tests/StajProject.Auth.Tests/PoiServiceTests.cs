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
    [InlineData("18:00", "09:00")]
    [InlineData("09:00", "09:00")]
    public async Task Create_rejects_an_opening_time_that_is_not_before_closing(string open, string close)
    {
        await using var fixture = await PoiFixture.CreateAsync();
        var category = await fixture.AddCategoryAsync("Yeme-İçme");
        fixture.ActAs(await fixture.AddUserAsync("operator-11"));

        var request = Request(category.Id);
        request.WorkHours = new PoiWorkHoursDto
        {
            Monday = new PoiWorkHoursDayDto { Closed = false, Open = open, Close = close }
        };

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
           sabitlenir: creator alanı EKLENİRSE bu test düşer. */
        var properties = typeof(PoiResponse).GetProperties().Select(p => p.Name).ToArray();

        Assert.Equal(
            ["CategoryId", "CategoryName", "CategoryPath", "Id", "Latitude", "Longitude", "Name", "WorkHours"],
            properties.OrderBy(name => name, StringComparer.Ordinal));

        Assert.DoesNotContain(properties, name => name.Contains("User", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(properties, name => name.Contains("Creator", StringComparison.OrdinalIgnoreCase));
        Assert.DoesNotContain(properties, name => name.Contains("Deleted", StringComparison.OrdinalIgnoreCase));
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
        private PoiFixture(AppDbContext db, ICurrentUserService currentUser, IGeographicAuthorizationService geography)
        {
            Db = db;
            CurrentUser = currentUser;
            Geography = geography;
            Service = new PoiService(db, currentUser, geography);
            Categories = new PoiCategoryService(db);
        }

        public AppDbContext Db { get; }

        public ICurrentUserService CurrentUser { get; }

        public IGeographicAuthorizationService Geography { get; }

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

            /* Varsayılan: kısıtsız. Hiç coğrafi alan tanımlanmamış kurulumların
               davranışı budur ve testlerin çoğunun konusu coğrafya değildir. */
            geography.GetEffectiveAuthorizationAsync(Arg.Any<int>(), Arg.Any<CancellationToken>())
                .Returns(EffectiveGeographicAuthorization.Unrestricted);

            return Task.FromResult(new PoiFixture(db, currentUser, geography));
        }

        public void ActAs(User user)
        {
            CurrentUser.UserId.Returns(user.Id);
            CurrentUser.UserName.Returns(user.UserName!);
            CurrentUser.IsAuthenticated.Returns(true);
        }

        public void ActAsAnonymous()
        {
            CurrentUser.UserId.Returns((int?)null);
            CurrentUser.IsAuthenticated.Returns(false);
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
