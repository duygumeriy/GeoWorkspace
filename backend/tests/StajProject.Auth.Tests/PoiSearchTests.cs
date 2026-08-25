using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Pois;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Faz 5 — POI arama sözleşmesi: sınırlar, joker kaçışı ve üretilen SQL.
/// </summary>
/// <remarks>
/// <para>
/// <b>Sorgu semantiği SQL üzerinden doğrulanır, bellek üzerinden değil.</b>
/// <c>EF.Functions.ILike</c> PostgreSQL'e özgüdür ve InMemory sağlayıcısında
/// çalışmaz; InMemory üzerinde koşan bir "arama testi" ise gerçekte üretimde
/// çalışan sorguyu HİÇ sınamazdı. Npgsql sağlayıcısı bir sorguyu veritabanına
/// BAĞLANMADAN SQL'e çevirebildiği için (<c>ToQueryString</c>) süzmenin,
/// sıralamanın ve sınırın gerçekten veritabanında yapıldığı burada, canlı bir
/// veritabanı olmadan kanıtlanır.
/// </para>
/// <para>
/// Yetkilendirme sınırı <see cref="PoiApiAuthorizationTests"/> içindedir;
/// burada tekrarlanmaz.
/// </para>
/// </remarks>
public class PoiSearchTests
{
    /* --- Sözleşme sabitleri ------------------------------------------------------ */

    [Fact]
    public void The_search_contract_has_the_expected_bounds()
    {
        Assert.Equal(2, PoiSearchContract.MinimumQueryLength);
        Assert.Equal(100, PoiSearchContract.MaximumQueryLength);
        Assert.Equal(8, PoiSearchContract.DefaultLimit);
        Assert.Equal(1, PoiSearchContract.MinimumLimit);
        Assert.Equal(20, PoiSearchContract.MaximumLimit);
    }

    /* --- Joker kaçışı ------------------------------------------------------------ */

    [Theory]
    [InlineData("kafe", "kafe")]
    [InlineData("100%", @"100\%")]
    [InlineData("a_b", @"a\_b")]
    [InlineData("%", @"\%")]
    [InlineData("_", @"\_")]
    [InlineData("%_%", @"\%\_\%")]
    [InlineData(@"a\b", @"a\\b")]
    [InlineData(@"\%", @"\\\%")]
    public void Wildcards_typed_by_the_user_are_escaped_into_literal_text(string input, string expected)
    {
        /* Kullanıcı bir DESEN değil, aradığı METNİ yazar. Kaçırılmasaydı tek
           bir "%" bütün envanteri döndürürdü. */
        Assert.Equal(expected, PoiSearchContract.EscapeLikePattern(input));
    }

    [Fact]
    public void The_escape_character_itself_is_escaped_first()
    {
        /* Sıra ters olsaydı, jokerler için eklenen ters bölüler ikinci geçişte
           yeniden kaçırılır ve desen bozulurdu. */
        Assert.Equal(@"\\\%", PoiSearchContract.EscapeLikePattern(@"\%"));
    }

    /* --- Doğrulama --------------------------------------------------------------- */

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("a")]
    [InlineData("  a  ")]
    public async Task A_query_shorter_than_the_minimum_is_rejected(string? query)
    {
        var result = await Service().SearchPoisAsync(query, null, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    [Fact]
    public async Task A_query_longer_than_the_maximum_is_rejected()
    {
        var result = await Service().SearchPoisAsync(
            new string('a', PoiSearchContract.MaximumQueryLength + 1),
            null,
            default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(21)]
    [InlineData(1000)]
    public async Task A_limit_outside_the_contract_is_rejected(int limit)
    {
        var result = await Service().SearchPoisAsync("kafe", limit, default);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    /* --- Üretilen SQL ------------------------------------------------------------ */

    [Fact]
    public void The_query_filters_case_insensitively_with_an_explicit_escape()
    {
        var sql = Sql("kafe");

        // ILIKE, PostgreSQL'in harfe duyarsız eşleştirmesidir.
        Assert.Contains("ILIKE", sql, StringComparison.Ordinal);
        // ESCAPE AÇIKÇA bildirilir; sunucu ayarına bırakılmaz.
        Assert.Contains("ESCAPE", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void The_query_matches_the_poi_name_and_the_category_name()
    {
        var sql = Sql("kafe");

        Assert.Contains("isim", sql, StringComparison.Ordinal);
        Assert.Contains("poi_category", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void Filtering_ordering_and_the_limit_all_happen_in_the_database()
    {
        /* Bunların hepsinin SQL'de olması, envanter büyüdükçe her tuş
           vuruşunda tablonun belleğe çekilmemesi demektir. */
        var sql = Sql("kafe", take: 5);

        Assert.Contains("WHERE", sql, StringComparison.Ordinal);
        Assert.Contains("ORDER BY", sql, StringComparison.Ordinal);
        Assert.Contains("LIMIT", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void Ranking_is_expressed_as_a_deterministic_case_expression()
    {
        var sql = Sql("kafe");

        // Tam eşleşme → ile başlayan → içeren → yalnızca kategori.
        Assert.Contains("CASE", sql, StringComparison.Ordinal);
        // Eşitlikte ad, en sonda kimlik: aynı sorgu her zaman aynı listeyi verir.
        Assert.Contains("ORDER BY", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void Deleted_and_inactive_rows_are_excluded_on_both_tables()
    {
        /* Global query filter POI ve kategori için AYNI yüklemi uygular; arama
           bunu tekrar yazmaz, devralır. Görünürlük harita okumasıyla birebir
           aynı kalır. */
        var sql = Sql("kafe");

        Assert.Contains("is_deleted", sql, StringComparison.Ordinal);
        Assert.Contains("is_active", sql, StringComparison.Ordinal);

        // İki tablo için de: POI ve kategori.
        var deletedOccurrences = Occurrences(sql, "is_deleted");
        Assert.True(deletedOccurrences >= 2, $"is_deleted yalnızca {deletedOccurrences} kez geçiyor.");
    }

    [Fact]
    public void No_ownership_or_geographic_predicate_is_applied()
    {
        /* POI ORTAK envanterdir ve coğrafi kapsam bir YAZMA kuralıdır. Buraya
           bir okuma filtresi eklemek, haritada görünen bir POI'nin aramada
           bulunamadığı tutarsız bir durum üretirdi. */
        var sql = Sql("kafe");

        Assert.DoesNotContain("user_id", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("ST_Within", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("ST_Intersects", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("geographic", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_projection_reads_longitude_from_x_and_latitude_from_y()
    {
        /* Ters çevrilmesi POI'yi dünyanın başka bir yerine taşırdı. */
        var sql = Sql("kafe");

        Assert.Contains("ST_X", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ST_Y", sql, StringComparison.OrdinalIgnoreCase);

        var query = Query("kafe");
        var expression = query.Expression.ToString();

        Assert.Contains("Coordinate.X", expression, StringComparison.Ordinal);
        Assert.Contains("Coordinate.Y", expression, StringComparison.Ordinal);
    }

    [Fact]
    public void The_projection_never_reads_work_hours_or_audit_columns()
    {
        var sql = Sql("kafe");

        Assert.DoesNotContain("mesai_saatleri", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("created_date", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("modified_date", sql, StringComparison.Ordinal);
    }

    /* --- DTO sözleşmesi ---------------------------------------------------------- */

    [Fact]
    public void The_search_result_exposes_only_the_fields_the_list_row_needs()
    {
        /* Kapalı bir liste, yazılabilir/okunabilir bir alanın yanlışlıkla
           EKLENMESİNİ de yakalar — mesai programı, sahiplik ya da yetenek
           bayrakları arama satırının cevaplamadığı sorulardır. */
        var properties = typeof(PoiSearchResult)
            .GetProperties()
            .Select(property => property.Name)
            .OrderBy(name => name, StringComparer.Ordinal);

        Assert.Equal(
            [
                "CategoryId", "CategoryName", "CategorySlug", "ColorHex",
                "IconKey", "Id", "Latitude", "Longitude", "Name"
            ],
            properties);
    }

    [Fact]
    public void The_search_result_carries_no_ownership_or_capability_state()
    {
        var names = typeof(PoiSearchResult).GetProperties().Select(property => property.Name).ToList();

        foreach (var forbidden in new[]
                 {
                     "UserId", "CreatorUserId", "CreatorUsername", "CanUpdate", "CanDelete",
                     "WorkHours", "WorkHoursJson", "IsDeleted", "IsActive", "CreatedDate", "ModifiedDate"
                 })
        {
            Assert.DoesNotContain(forbidden, names);
        }
    }

    /* --- Yardımcılar ------------------------------------------------------------- */

    private static int Occurrences(string haystack, string needle)
    {
        var count = 0;
        var index = haystack.IndexOf(needle, StringComparison.Ordinal);

        while (index >= 0)
        {
            count++;
            index = haystack.IndexOf(needle, index + needle.Length, StringComparison.Ordinal);
        }

        return count;
    }

    /// <summary>
    /// Doğrulama yolunu sınamak için yeterli servis: doğrulama veritabanına
    /// HİÇ ulaşmadan önce çalışır, dolayısıyla InMemory bağlam yeterlidir.
    /// </summary>
    private static PoiService Service()
    {
        var db = new AppDbContext(
            new DbContextOptionsBuilder<AppDbContext>()
                .UseInMemoryDatabase($"poi-search-{Guid.NewGuid():N}")
                .Options);

        return new PoiService(
            db,
            Substitute.For<ICurrentUserService>(),
            Substitute.For<IGeographicAuthorizationService>(),
            Substitute.For<IPoiAuthorizationService>());
    }

    private static IQueryable<PoiSearchResult> Query(string term, int take = 8)
    {
        var scope = NpgsqlScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var service = new PoiService(
            db,
            Substitute.For<ICurrentUserService>(),
            Substitute.For<IGeographicAuthorizationService>(),
            Substitute.For<IPoiAuthorizationService>());

        return service.BuildSearchQuery(term, take);
    }

    private static string Sql(string term, int take = 8) => Query(term, take).ToQueryString();

    /// <summary>
    /// PostgreSQL sağlayıcısı, sorguyu SQL'e çevirmek için veritabanına
    /// BAĞLANMAZ; bağlantı metni yalnızca sağlayıcıyı seçer ve hiçbir sorgu
    /// çalıştırılmaz. Aynı yaklaşım <see cref="GeographicAuthorizationTests"/>
    /// içinde de kullanılır.
    /// </summary>
    private static IServiceScope NpgsqlScope()
    {
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddDbContext<AppDbContext>(options => options.UseNpgsql(
            "Host=localhost;Database=schema-only;Username=none",
            npgsql => npgsql.UseNetTopologySuite()));

        return services.BuildServiceProvider().CreateScope();
    }
}
