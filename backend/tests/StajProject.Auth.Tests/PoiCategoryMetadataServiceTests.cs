using Microsoft.EntityFrameworkCore;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Auth.Tests;

/// <summary>
/// Kategori servisinin sunum metadatası davranışı: slug üretimi, slug
/// değişmezliği, çakışma semantiği ve simge/renk doğrulaması.
/// </summary>
/// <remarks>
/// <b>Slug değişmezliği bu dosyanın en önemli iddiasıdır.</b> Slug, ileride
/// GeoServer stil kuralının eşleştiği anahtardır; görünen ad her
/// düzenlendiğinde yeniden üretilseydi, bir yeniden adlandırma o stil kuralını
/// sessizce sahipsiz bırakır ve kategorinin POI'leri haritada yedek simgeye
/// düşerdi. Kural burada, yazma yolunun sahibi olan serviste sınanır.
/// </remarks>
public class PoiCategoryMetadataServiceTests
{
    private static CreatePoiCategoryRequest Create(
        string? name,
        int? parentId = null,
        string? iconKey = "utensils",
        string? colorHex = "#F97316") =>
        new() { Name = name, ParentId = parentId, IconKey = iconKey, ColorHex = colorHex };

    private static UpdatePoiCategoryRequest Update(
        string? name,
        int? parentId = null,
        bool isActive = true,
        string? iconKey = "utensils",
        string? colorHex = "#F97316") =>
        new() { Name = name, ParentId = parentId, IsActive = isActive, IconKey = iconKey, ColorHex = colorHex };

    /* --- Oluşturma: slug üretimi -------------------------------------------------- */

    [Fact]
    public async Task Creating_a_category_generates_its_slug_from_the_name()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var result = await fixture.Categories.CreateCategoryAsync(Create("Yeme-İçme Yerleri"));

        Assert.True(result.IsSuccess);
        Assert.Equal("yeme-icme-yerleri", result.Value!.Slug);

        var stored = await fixture.Db.PoiCategories.SingleAsync();
        Assert.Equal("yeme-icme-yerleri", stored.Slug);
    }

    [Fact]
    public async Task The_generated_slug_folds_turkish_characters()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var result = await fixture.Categories.CreateCategoryAsync(Create("Sağlık Kurumları"));

        Assert.True(result.IsSuccess);
        Assert.Equal("saglik-kurumlari", result.Value!.Slug);
    }

    [Fact]
    public async Task A_name_without_usable_characters_is_rejected()
    {
        /* Ad doğrulamasını GEÇEN ama slug üretemeyen bir ad: boş slug bir
           kimlik olmadığı için istek sessizce kabul edilmez. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var result = await fixture.Categories.CreateCategoryAsync(Create("!!! ???"));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    [Fact]
    public async Task The_client_cannot_choose_the_slug()
    {
        /* Sözleşme iddiası: istek DTO'sunda bir Slug alanı YOKTUR. Olsaydı iki
           istemci aynı ad için farklı teknik kimlikler üretebilir ve stil
           kurallarının hangisine bakacağı belirsizleşirdi. */
        Assert.Null(typeof(CreatePoiCategoryRequest).GetProperty("Slug"));
        Assert.Null(typeof(UpdatePoiCategoryRequest).GetProperty("Slug"));

        await Task.CompletedTask;
    }

    /* --- Oluşturma: çakışma -------------------------------------------------------- */

    [Fact]
    public async Task A_duplicate_slug_is_reported_as_a_conflict()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        Assert.True((await fixture.Categories.CreateCategoryAsync(Create("Eczane"))).IsSuccess);

        var second = await fixture.Categories.CreateCategoryAsync(Create("Eczane"));

        Assert.False(second.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, second.ErrorKind);
    }

    [Fact]
    public async Task A_conflict_is_never_resolved_by_appending_a_counter()
    {
        /* Sessiz bir "-2", yöneticinin beklemediği ve SLD tarafında elle
           kullanacağı yanlış bir teknik kimlik üretirdi. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        await fixture.Categories.CreateCategoryAsync(Create("Eczane"));
        await fixture.Categories.CreateCategoryAsync(Create("Eczane"));

        var stored = await fixture.Db.PoiCategories.IgnoreQueryFilters().ToListAsync();

        Assert.Single(stored);
        Assert.DoesNotContain(stored, row => row.Slug == "eczane-2");
    }

    [Fact]
    public async Task The_conflict_message_leaks_no_database_detail()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        await fixture.Categories.CreateCategoryAsync(Create("Eczane"));
        var second = await fixture.Categories.CreateCategoryAsync(Create("Eczane"));

        Assert.Equal("Bu kategori için oluşturulan teknik kimlik zaten kullanılıyor.", second.Error);
        Assert.DoesNotContain("IX_poi_category_slug", second.Error!, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("duplicate key", second.Error!, StringComparison.OrdinalIgnoreCase);
    }

    [Theory]
    [InlineData(false, false)]
    [InlineData(false, true)]
    [InlineData(true, false)]
    public async Task A_slug_held_by_a_hidden_row_is_still_taken(bool isDeleted, bool isInactive)
    {
        /* Tekillik KÜRESELDİR: pasif ya da silinmiş bir kategorinin teknik
           kimliği yeniden kullanılamaz. Filtreli bir kontrol, o slug'ı "boşta"
           gösterir ve kaçınılmaz olarak veritabanı indeks ihlaline düşerdi. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        await fixture.AddCategoryAsync(
            "Eczane",
            isActive: !isInactive,
            isDeleted: isDeleted,
            slug: "eczane");

        var result = await fixture.Categories.CreateCategoryAsync(Create("Eczane"));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Conflict, result.ErrorKind);
    }

    /* --- Oluşturma: metadata doğrulaması ------------------------------------------ */

    [Fact]
    public async Task Creating_a_category_stores_the_supplied_icon_and_color()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var result = await fixture.Categories.CreateCategoryAsync(
            Create("Eczane", iconKey: "pill", colorHex: "#EF4444"));

        Assert.True(result.IsSuccess);
        Assert.Equal("pill", result.Value!.IconKey);
        Assert.Equal("#EF4444", result.Value.ColorHex);
    }

    [Fact]
    public async Task A_lowercase_color_is_canonicalised_before_storage()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var result = await fixture.Categories.CreateCategoryAsync(
            Create("Eczane", colorHex: "#ef4444"));

        Assert.True(result.IsSuccess);
        Assert.Equal("#EF4444", result.Value!.ColorHex);

        var stored = await fixture.Db.PoiCategories.SingleAsync();
        Assert.Equal("#EF4444", stored.ColorHex);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task Creating_without_an_icon_is_rejected(string? iconKey)
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var result = await fixture.Categories.CreateCategoryAsync(Create("Eczane", iconKey: iconKey));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    [Theory]
    [InlineData("not-an-icon")]
    [InlineData("../../../etc/passwd")]
    [InlineData("http://evil.example/icon.svg")]
    [InlineData("<svg onload=alert(1)>")]
    [InlineData("pill\"/><Rule>")]
    public async Task An_icon_outside_the_allow_list_is_rejected(string iconKey)
    {
        /* Bu değer ileride bir SLD dosya yoluna ve bir bileşen aramasına
           girecektir; kapalı küme, dizin geçişi ve işaretleme enjeksiyonunu
           yapısal olarak imkânsız kılar. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var result = await fixture.Categories.CreateCategoryAsync(Create("Eczane", iconKey: iconKey));

        Assert.False(result.IsSuccess);
        Assert.Empty(await fixture.Db.PoiCategories.IgnoreQueryFilters().ToListAsync());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("#FFF")]
    [InlineData("#EF4444FF")]
    [InlineData("red")]
    [InlineData("#GGGGGG")]
    public async Task An_invalid_color_is_rejected(string? colorHex)
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var result = await fixture.Categories.CreateCategoryAsync(Create("Eczane", colorHex: colorHex));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    /* --- Güncelleme: slug değişmezliği -------------------------------------------- */

    [Fact]
    public async Task Renaming_a_category_preserves_its_slug()
    {
        /* Bu fazın merkezi kuralı. Ad bir SUNUM kararıdır; teknik kimliği
           taşımaz. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var created = await fixture.Categories.CreateCategoryAsync(Create("Yeme-İçme"));
        var id = created.Value!.Id;
        var originalSlug = created.Value.Slug;

        var updated = await fixture.Categories.UpdateCategoryAsync(id, Update("Yeme-İçme Yerleri"));

        Assert.True(updated.IsSuccess);
        Assert.Equal("Yeme-İçme Yerleri", updated.Value!.Name);
        Assert.Equal(originalSlug, updated.Value.Slug);
        Assert.Equal("yeme-icme", updated.Value.Slug);

        var stored = await fixture.Db.PoiCategories.SingleAsync(row => row.Id == id);
        Assert.Equal("yeme-icme", stored.Slug);
    }

    [Fact]
    public async Task Repeated_renames_never_move_the_slug()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var created = await fixture.Categories.CreateCategoryAsync(Create("Eğlence"));
        var id = created.Value!.Id;

        await fixture.Categories.UpdateCategoryAsync(id, Update("Eğlence Yerleri"));
        await fixture.Categories.UpdateCategoryAsync(id, Update("Eğlence ve Kültür"));
        await fixture.Categories.UpdateCategoryAsync(id, Update("Tamamen Başka Bir Ad"));

        var stored = await fixture.Db.PoiCategories.SingleAsync(row => row.Id == id);

        Assert.Equal("eglence", stored.Slug);
    }

    [Fact]
    public async Task Renaming_to_a_name_whose_slug_is_taken_still_succeeds()
    {
        /* Slug yeniden üretilmediği için çakışma sorusu güncellemede HİÇ
           sorulmaz. Üretilseydi, iki kategoriyi aynı ada getirmek ikinci
           kategoriyi düzenlenemez hâle sokardı. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        await fixture.Categories.CreateCategoryAsync(Create("Eczane"));
        var other = await fixture.Categories.CreateCategoryAsync(Create("Okullar"));

        var result = await fixture.Categories.UpdateCategoryAsync(other.Value!.Id, Update("Eczane"));

        Assert.True(result.IsSuccess);
        Assert.Equal("okullar", result.Value!.Slug);
    }

    /* --- Güncelleme: metadata ------------------------------------------------------ */

    [Fact]
    public async Task Updating_a_category_changes_its_icon_and_color()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var created = await fixture.Categories.CreateCategoryAsync(
            Create("Eczane", iconKey: "pill", colorHex: "#EF4444"));

        var updated = await fixture.Categories.UpdateCategoryAsync(
            created.Value!.Id,
            Update("Eczane", iconKey: "hospital", colorHex: "#22c55e"));

        Assert.True(updated.IsSuccess);
        Assert.Equal("hospital", updated.Value!.IconKey);
        Assert.Equal("#22C55E", updated.Value.ColorHex);
    }

    [Theory]
    [InlineData(null, "#EF4444")]
    [InlineData("pill", null)]
    [InlineData("", "#EF4444")]
    [InlineData("not-an-icon", "#EF4444")]
    [InlineData("pill", "#FFF")]
    public async Task Updating_with_missing_or_invalid_metadata_is_rejected(string? iconKey, string? colorHex)
    {
        /* Bu uç DEĞİŞTİRME semantiğine sahiptir (isActive de her istekte tam
           bildirilir), dolayısıyla atlanan bir metadata alanı "değiştirme"
           anlamına gelemez — öyle sayılsaydı kısmi bir istek simgeyi ve rengi
           sessizce silerdi. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var created = await fixture.Categories.CreateCategoryAsync(
            Create("Eczane", iconKey: "pill", colorHex: "#EF4444"));

        var result = await fixture.Categories.UpdateCategoryAsync(
            created.Value!.Id,
            Update("Eczane", iconKey: iconKey, colorHex: colorHex));

        Assert.False(result.IsSuccess);

        // Reddedilen istek hiçbir alanı değiştirmemiş olmalıdır.
        var stored = await fixture.Db.PoiCategories.SingleAsync();
        Assert.Equal("pill", stored.IconKey);
        Assert.Equal("#EF4444", stored.ColorHex);
    }

    [Fact]
    public async Task A_legacy_row_without_metadata_can_be_completed_through_an_update()
    {
        /* Göç, bilinmeyen satırlara metadata atamaz. Yönetim ekranından geçen
           böyle bir kayıt eksiğini tamamlar — yeni metadatasız kayıt
           üretilmemesinin karşılığı budur. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        var legacy = await fixture.AddCategoryAsync(
            "Elle Eklenen", slug: "category-42", iconKey: null, colorHex: null);

        var result = await fixture.Categories.UpdateCategoryAsync(
            legacy.Id,
            Update("Elle Eklenen", iconKey: "store", colorHex: "#8B5CF6"));

        Assert.True(result.IsSuccess);
        Assert.Equal("store", result.Value!.IconKey);
        Assert.Equal("#8B5CF6", result.Value.ColorHex);

        // Teknik kimlik yine korunur.
        Assert.Equal("category-42", result.Value.Slug);
    }

    /* --- Okuma sözleşmesi ---------------------------------------------------------- */

    [Fact]
    public async Task Both_read_contracts_expose_the_presentation_metadata()
    {
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        await fixture.Categories.CreateCategoryAsync(
            Create("Eczane", iconKey: "pill", colorHex: "#EF4444"));

        var forClients = Assert.Single(await fixture.Categories.GetActiveCategoriesAsync());
        Assert.Equal("eczane", forClients.Slug);
        Assert.Equal("pill", forClients.IconKey);
        Assert.Equal("#EF4444", forClients.ColorHex);

        var forAdmin = Assert.Single(await fixture.Categories.GetAdminCategoriesAsync());
        Assert.Equal("eczane", forAdmin.Slug);
        Assert.Equal("pill", forAdmin.IconKey);
        Assert.Equal("#EF4444", forAdmin.ColorHex);
    }

    [Fact]
    public async Task Null_metadata_survives_the_read_path_as_null()
    {
        /* Eksik metadata, sessizce doldurulmuş YANLIŞ metadatadan daha
           dürüsttür: yedek değer render tarafının kararıdır, veritabanının
           değil. */
        await using var fixture = await PoiServiceTests.PoiFixture.CreateAsync();

        await fixture.AddCategoryAsync("Eski", slug: "category-7", iconKey: null, colorHex: null);

        var row = Assert.Single(await fixture.Categories.GetAdminCategoriesAsync());

        Assert.Equal("category-7", row.Slug);
        Assert.Null(row.IconKey);
        Assert.Null(row.ColorHex);
    }

    /* --- EF eşlemesi --------------------------------------------------------------- */

    [Fact]
    public void The_slug_column_is_required_and_globally_unique()
    {
        /* Tekilliğin GERÇEK garantisi veritabanı indeksidir; servisteki kontrol
           yalnızca dostane mesaj içindir. InMemory sağlayıcı indeksi
           uygulamadığı için iddia MODEL üzerinden kurulur. */
        using var db = new AppDbContext(
            new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"poi-mapping-{Guid.NewGuid():N}")
                .Options);

        var entity = db.Model.FindEntityType(typeof(PoiCategory))!;

        var slug = entity.FindProperty(nameof(PoiCategory.Slug))!;
        Assert.False(slug.IsNullable);
        Assert.Equal("slug", slug.GetColumnName());
        Assert.Equal(PoiCategory.MaxSlugLength, slug.GetMaxLength());

        var slugIndex = entity.GetIndexes().Single(index =>
            index.Properties.Count == 1 && index.Properties[0].Name == nameof(PoiCategory.Slug));

        Assert.True(slugIndex.IsUnique);

        // Kısmi (partial) indeks DEĞİL: silinmiş satırlar da kapsanır.
        Assert.Null(slugIndex.GetFilter());

        var iconKey = entity.FindProperty(nameof(PoiCategory.IconKey))!;
        Assert.True(iconKey.IsNullable);
        Assert.Equal("icon_key", iconKey.GetColumnName());
        Assert.Equal(PoiCategory.MaxIconKeyLength, iconKey.GetMaxLength());

        var colorHex = entity.FindProperty(nameof(PoiCategory.ColorHex))!;
        Assert.True(colorHex.IsNullable);
        Assert.Equal("color_hex", colorHex.GetColumnName());
        Assert.Equal(PoiCategory.ColorHexLength, colorHex.GetMaxLength());
    }
}
