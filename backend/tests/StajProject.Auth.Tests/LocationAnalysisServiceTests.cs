using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NetTopologySuite.Geometries;
using StajProject.Application.Analysis;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Konum analizi: istek doğrulaması, mekânsal süzme ve ağırlık aritmetiği.
/// </summary>
/// <remarks>
/// <para>
/// <b>Hedef alan Ankara çevresidir</b> ve tüm koordinatlar ona göre seçilmiştir.
/// Analiz alanı hiçbir tabloya YAZILMAZ; testler de bunu varsayar — sonuç
/// dönerken veritabanında yalnızca fixture satırları kalır.
/// </para>
/// <para>
/// <b>Ağırlıklar tam sayıdır ve toplamı tam 100'dür.</b> Ondalık toplam
/// karşılaştırması bilinçli olarak YOKTUR: <c>33.33 + 33.33 + 33.34</c>
/// ikili gösterimde 100'e eşit çıkmayabilir ve kullanıcı ekranda 100 gördüğü
/// hâlde reddedilirdi.
/// </para>
/// <para>
/// Mekânsal yüklem in-memory sağlayıcıda NetTopologySuite ile yerinde
/// değerlendirilir; üretimde aynı ifade <c>ST_Intersects</c>'e çevrilir.
/// Ölçülen şey SÖZLEŞMEDİR — hangi POI'nin sayıldığı — ve o iki tarafta
/// aynıdır. Aynı yaklaşım <see cref="InventoryAnalysisPoiTests"/> içinde de
/// kullanılır.
/// </para>
/// </remarks>
public class LocationAnalysisServiceTests
{
    /// <summary>Ankara çevresini kapsayan hedef alan.</summary>
    private const string Ankara = "POLYGON ((32 39, 34 39, 34 41, 32 41, 32 39))";

    /// <summary>Ankara alanına DEĞMEYEN ikinci parça (İstanbul çevresi).</summary>
    private const string Istanbul = "POLYGON ((28 40.5, 29.5 40.5, 29.5 41.5, 28 41.5, 28 40.5))";

    private const string Health = "saglik-kurumlari";
    private const string Schools = "okullar";
    private const string Markets = "zincir-marketler";

    /* --- Ölçüt sayısı ----------------------------------------------------------- */

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(6)]
    public async Task Criteria_outside_two_to_five_are_rejected(int count)
    {
        await using var db = await NewDbAsync();

        /* Ağırlıklar bilinçli olarak GEÇERLİ toplanır (ya da tek ölçüt 100
           alır), böylece reddin sebebi yalnızca SAYIdır. */
        var criteria = Enumerable.Range(0, count)
            .Select(index => Criterion($"kategori-{index}", count == 0 ? 0 : 100 / count))
            .ToList();

        var result = await AnalyzeAsync(db, new LocationAnalysisRequest
        {
            AreaWkts = [Ankara],
            Criteria = criteria
        });

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
        Assert.Contains("kategori ölçütü", result.Error!, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Two_criteria_are_accepted()
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, Request((Health, 50), (Schools, 50)));

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(2, result.Value!.Criteria.Count);
    }

    [Fact]
    public async Task Five_criteria_are_accepted()
    {
        await using var db = await NewDbAsync();

        /* Beş kategori de kanoniktir ve seed edilmiştir; sınır ölçüt SAYISIdır,
           kategorilerin kendisi değil. */
        var result = await AnalyzeAsync(db, Request(
            (Health, 20), (Schools, 20), (Markets, 20), ("eczane", 20), ("kafe", 20)));

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(5, result.Value!.Criteria.Count);
    }

    /* --- Ağırlıklar -------------------------------------------------------------- */

    [Theory]
    [InlineData(49, 50)]   // toplam 99
    [InlineData(51, 50)]   // toplam 101
    [InlineData(1, 1)]     // toplam 2
    public async Task Weights_that_do_not_total_one_hundred_are_rejected(int first, int second)
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, Request((Health, first), (Schools, second)));

        Assert.False(result.IsSuccess);
        Assert.Contains("toplamı tam olarak 100", result.Error!, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-10)]
    public async Task A_non_positive_weight_is_rejected(int weight)
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, Request((Health, weight), (Schools, 100 - weight)));

        Assert.False(result.IsSuccess);
        Assert.Contains("pozitif bir tam sayı", result.Error!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_weight_above_one_hundred_is_rejected()
    {
        await using var db = await NewDbAsync();

        /* Toplam yine 100'dür (120 + (-20)); reddin sebebi TEK bir ağırlığın
           üst sınırı aşmasıdır. Aksi hâlde bu durum yalnızca toplam kuralına
           takılır ve üst sınır hiç sınanmamış olurdu. */
        var result = await AnalyzeAsync(db, Request((Health, 120), (Schools, -20)));

        Assert.False(result.IsSuccess);
        Assert.Contains("aşamaz", result.Error!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_valid_weight_distribution_is_accepted()
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, Request(
            (Health, 40), (Schools, 30), (Markets, 20), ("eczane", 10)));

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(100, result.Value!.Criteria.Sum(criterion => criterion.Weight));
    }

    /* --- Kategoriler ------------------------------------------------------------- */

    [Fact]
    public async Task The_same_category_cannot_be_selected_twice()
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, Request((Health, 50), (Health, 50)));

        Assert.False(result.IsSuccess);
        Assert.Contains("birden çok kez", result.Error!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_unknown_slug_is_rejected_rather_than_ignored()
    {
        await using var db = await NewDbAsync();

        /* Sessizce atlamak, kullanıcının dağıttığı 100 ağırlığın bir kısmının
           hiç uygulanmadığı bir sonucu tam cevap gibi göstermek olurdu. */
        var result = await AnalyzeAsync(db, Request((Health, 50), ("boyle-bir-kategori-yok", 50)));

        Assert.False(result.IsSuccess);
        Assert.Contains("boyle-bir-kategori-yok", result.Error!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_malformed_slug_is_rejected_before_the_database_is_touched()
    {
        await using var db = await NewDbAsync();

        // Kanonik biçim ihlali: büyük harf + boşluk + eğik çizgi.
        var result = await AnalyzeAsync(db, Request(("Sağlık Kurumları/x", 50), (Schools, 50)));

        Assert.False(result.IsSuccess);
        Assert.Contains("Geçersiz kategori", result.Error!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_slug_is_normalised_by_trimming_and_lowercasing()
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, Request(($"  {Health.ToUpperInvariant()}  ", 50), (Schools, 50)));

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(Health, result.Value!.Criteria[0].CategorySlug);
    }

    [Fact]
    public async Task A_soft_deleted_category_is_unknown_to_the_analysis()
    {
        await using var db = await NewDbAsync();

        /* Emekliye ayrılmış bir kategori uygulamanın geri kalanında da
           görünmez (global query filter); analiz için ayrı bir kural
           yazılmaz — "bulunamadı" aynı gerçeğin sonucudur. */
        var category = await db.PoiCategories.SingleAsync(item => item.Slug == Markets);
        category.IsDeleted = true;
        await db.SaveChangesAsync();

        var result = await AnalyzeAsync(db, Request((Health, 50), (Markets, 50)));

        Assert.False(result.IsSuccess);
        Assert.Contains(Markets, result.Error!, StringComparison.Ordinal);
    }

    /* --- Hedef alan --------------------------------------------------------------- */

    [Fact]
    public async Task A_missing_area_is_rejected()
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, new LocationAnalysisRequest
        {
            AreaWkts = null,
            Criteria = [Criterion(Health, 50), Criterion(Schools, 50)]
        });

        Assert.False(result.IsSuccess);
        Assert.Contains("Analiz alanı zorunludur", result.Error!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_empty_area_list_is_rejected()
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, RequestWithArea([]));

        Assert.False(result.IsSuccess);
        Assert.Contains("Analiz alanı zorunludur", result.Error!, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("bu bir wkt degil")]                                   // ayrıştırılamaz
    [InlineData("POLYGON EMPTY")]                                      // boş
    [InlineData("POINT (32 39)")]                                      // yanlış tip
    [InlineData("LINESTRING (32 39, 34 41)")]                          // yanlış tip
    [InlineData("SRID=3857;POLYGON ((0 0, 1 0, 1 1, 0 1, 0 0))")]      // yanlış SRID
    [InlineData("POLYGON ((3600000 4800000, 3600100 4800000, 3600100 4800100, 3600000 4800100, 3600000 4800000))")] // metrik koordinat
    [InlineData("POLYGON ((32 39, 34 41, 34 39, 32 41, 32 39))")]      // kendisiyle kesişen (bowtie)
    public async Task An_invalid_area_part_is_rejected(string wkt)
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, RequestWithArea([wkt]));

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Validation, result.ErrorKind);
    }

    [Fact]
    public async Task Too_many_area_parts_are_rejected()
    {
        await using var db = await NewDbAsync();

        var parts = Enumerable.Range(0, LocationAnalysisValidator.MaxAreaParts + 1)
            .Select(index => $"POLYGON (({index} 10, {index + 0.5} 10, {index + 0.5} 10.5, {index} 10.5, {index} 10))")
            .ToList();

        var result = await AnalyzeAsync(db, RequestWithArea(parts));

        Assert.False(result.IsSuccess);
        Assert.Contains("parçadan oluşabilir", result.Error!, StringComparison.Ordinal);
    }

    /* --- Çok parçalı hedef: ASIL sözleşme ----------------------------------------- */

    [Fact]
    public async Task Every_area_part_is_analysed_and_none_is_silently_dropped()
    {
        await using var db = await NewDbAsync();

        await SeedAsync(db,
            (Health, "Ankara hastanesi", 32.85, 39.93),
            (Health, "İstanbul hastanesi", 29.0, 41.0),
            (Health, "İzmir hastanesi", 27.14, 38.42));

        /* İki kopuk parça: adaları olan bir ilin ya da boğazla ayrılan bir
           bölgenin karşılığı. İkisi de sayılmalıdır — yalnızca ilk parçayı
           almak, seçilen kapsamın bir bölümünü sessizce yok saymak olurdu. */
        var result = await AnalyzeAsync(db, RequestWithArea([Ankara, Istanbul]));

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(2, result.Value!.TotalMatchingPoiCount);
        Assert.Equal(2, result.Value.Target.PartCount);

        // Tek parçayla çalıştırıldığında sonuç GERÇEKTEN daha küçüktür:
        // yukarıdaki 2, iki parçanın birleşiminden gelir.
        var onlyAnkara = await AnalyzeAsync(db, RequestWithArea([Ankara]));

        Assert.Equal(1, onlyAnkara.Value!.TotalMatchingPoiCount);
    }

    [Fact]
    public async Task One_invalid_part_rejects_the_whole_request()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, "Ankara hastanesi", 32.85, 39.93));

        /* Kısmi başarı YOKTUR: geçersiz parçayı atlayıp kalanla devam etmek,
           kullanıcıya seçtiğinden DAHA KÜÇÜK bir alanın sonucunu doğru cevap
           gibi sunmak olurdu. */
        var result = await AnalyzeAsync(db, RequestWithArea([Ankara, "POINT (33 40)"]));

        Assert.False(result.IsSuccess);
        Assert.Contains("parçası 2", result.Error!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_target_summary_reports_the_union_envelope()
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, RequestWithArea([Ankara, Istanbul]));

        var target = result.Value!.Target;

        // Kapsayan dikdörtgen İKİ parçayı da kapsar; yalnızca sunum içindir.
        Assert.Equal(28, target.MinLongitude);
        Assert.Equal(34, target.MaxLongitude);
        Assert.Equal(39, target.MinLatitude);
        Assert.Equal(41.5, target.MaxLatitude);
    }

    /* --- Mekânsal süzme ----------------------------------------------------------- */

    [Fact]
    public async Task Only_selected_categories_inside_the_target_are_counted()
    {
        await using var db = await NewDbAsync();

        await SeedAsync(db,
            (Health, "A: seçili kategori, içeride", 32.85, 39.93),
            (Health, "B: seçili kategori, içeride", 33.10, 40.10),
            (Health, "C: seçili kategori, DIŞARIDA", 29.00, 41.00),
            (Markets, "D: seçilmemiş kategori, içeride", 33.00, 40.00));

        var result = await AnalyzeAsync(db, Request((Health, 60), (Schools, 40)));

        Assert.True(result.IsSuccess, result.Error);

        // A ve B sayılır; C alan dışında, D ölçüt dışıdır.
        Assert.Equal(2, result.Value!.TotalMatchingPoiCount);
        Assert.Equal(2, Criterion(result.Value, Health).MatchingPoiCount);
        Assert.Equal(0, Criterion(result.Value, Schools).MatchingPoiCount);
    }

    [Fact]
    public async Task A_point_on_the_boundary_is_inside()
    {
        await using var db = await NewDbAsync();

        /* Sınır İÇERİDEDİR: yüklem Intersects'tir (envanter analiziyle aynı
           ölçüt). Kullanıcının çizdiği alanın kenarı, alanının dışı değildir.
           Contains bu noktayı dışarıda bırakırdı. */
        await SeedAsync(db, (Health, "Tam sınırda", 32.0, 40.0));

        var result = await AnalyzeAsync(db, Request((Health, 50), (Schools, 50)));

        Assert.Equal(1, result.Value!.TotalMatchingPoiCount);
    }

    [Fact]
    public async Task An_empty_dataset_returns_zeroes_rather_than_an_error()
    {
        await using var db = await NewDbAsync();

        var result = await AnalyzeAsync(db, Request((Health, 50), (Schools, 50)));

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(0, result.Value!.TotalMatchingPoiCount);
        Assert.Equal(0m, result.Value.TotalWeightedContribution);

        // Ölçütler yine de DÖNER: kullanıcı hangi kategorilerin sıfır olduğunu
        // görmelidir, liste kısaltılmaz.
        Assert.Equal(2, result.Value.Criteria.Count);
    }

    /* --- Ağırlık aritmetiği -------------------------------------------------------- */

    [Fact]
    public async Task Each_category_receives_its_own_normalised_weight()
    {
        await using var db = await NewDbAsync();

        await SeedAsync(db,
            (Health, "hastane 1", 32.85, 39.93),
            (Health, "hastane 2", 33.00, 40.00),
            (Health, "hastane 3", 33.20, 40.20),
            (Schools, "okul 1", 32.90, 39.95));

        var result = await AnalyzeAsync(db, Request((Health, 60), (Schools, 40)));

        var health = Criterion(result.Value!, Health);
        var schools = Criterion(result.Value!, Schools);

        /* Kazara EŞİT ağırlıklandırma olmadığının kanıtı: iki kategori farklı
           normalleştirilmiş değerler taşır ve katkılar bunu yansıtır. */
        Assert.Equal(0.60m, health.NormalizedWeight);
        Assert.Equal(0.40m, schools.NormalizedWeight);
        Assert.NotEqual(health.NormalizedWeight, schools.NormalizedWeight);

        Assert.Equal(3, health.MatchingPoiCount);
        Assert.Equal(1, schools.MatchingPoiCount);

        // 3 × 0.60 = 1.80 ve 1 × 0.40 = 0.40 — ondalık, kayan noktalı değil.
        Assert.Equal(1.80m, health.WeightedContribution);
        Assert.Equal(0.40m, schools.WeightedContribution);
        Assert.Equal(2.20m, result.Value!.TotalWeightedContribution);
    }

    [Fact]
    public async Task Weights_that_are_not_representable_in_binary_stay_exact()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, "hastane", 32.85, 39.93));

        var result = await AnalyzeAsync(db, Request((Health, 10), (Schools, 90)));

        /* 0.10 ikili gösterimde tam DEĞİLDİR; decimal olduğu için eşitlik
           birebir tutar. double olsaydı bu iddia kırılgan olurdu. */
        Assert.Equal(0.10m, Criterion(result.Value!, Health).NormalizedWeight);
        Assert.Equal(0.10m, result.Value!.TotalWeightedContribution);
    }

    /* --- Özet sözleşmesi ----------------------------------------------------------- */

    [Fact]
    public async Task The_summary_is_compact_and_internally_consistent()
    {
        await using var db = await NewDbAsync();

        await SeedAsync(db,
            (Health, "hastane 1", 32.85, 39.93),
            (Health, "hastane 2", 33.00, 40.00),
            (Schools, "okul 1", 32.90, 39.95),
            (Markets, "market (ölçüt dışı)", 33.10, 40.10));

        var result = await AnalyzeAsync(db, Request((Health, 70), (Schools, 30)));
        var value = result.Value!;

        // Toplam, kırılımların toplamına EŞİTTİR — iki ayrı sorgu değildir.
        Assert.Equal(
            value.Criteria.Sum(criterion => criterion.MatchingPoiCount),
            value.TotalMatchingPoiCount);
        Assert.Equal(
            value.Criteria.Sum(criterion => criterion.WeightedContribution),
            value.TotalWeightedContribution);

        // Ölçüt sırası İSTEKTEKİ sıradır; kategori adı da taşınır ki istemci
        // ikinci bir istek açmasın.
        Assert.Equal([Health, Schools], value.Criteria.Select(criterion => criterion.CategorySlug));
        Assert.Equal("Sağlık Kurumları", value.Criteria[0].CategoryName);
    }

    [Fact]
    public void The_response_contract_carries_no_per_poi_collection()
    {
        /* ASIL sözleşme: yanıt eşleşen POI'lerin KENDİSİNİ taşımaz. Ülke
           ölçeğinde bir veri kümesinde tek bir il seçimi yüz binlerce noktaya
           karşılık gelebilir; hepsini JSON olarak taşımak tarayıcıyı da ağı da
           anlamsızca yorardı. Yoğunluğun görsel karşılığı sonraki fazda
           sunucuda üretilir. */
        var properties = typeof(LocationAnalysisResponse).GetProperties();

        Assert.DoesNotContain(properties, property =>
            property.PropertyType.IsGenericType
            && property.PropertyType.GetGenericArguments()[0] == typeof(AnalysisPoi));

        Assert.DoesNotContain(properties, property =>
            property.Name.Contains("Poi", StringComparison.Ordinal)
            && property.PropertyType != typeof(int));
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static LocationAnalysisCriterionRequest Criterion(string slug, int weight) =>
        new() { CategorySlug = slug, Weight = weight };

    private static LocationAnalysisCriterionResponse Criterion(LocationAnalysisResponse response, string slug) =>
        Assert.Single(response.Criteria, criterion => criterion.CategorySlug == slug);

    private static LocationAnalysisRequest Request(params (string Slug, int Weight)[] criteria) =>
        new()
        {
            AreaWkts = [Ankara],
            Criteria = [.. criteria.Select(item => Criterion(item.Slug, item.Weight))]
        };

    /* --- Coğrafi yetki -------------------------------------------------------------

       <b>Bu, okuma yolundaki ilk coğrafi sınırdır.</b> Projede coğrafi yetki
       bugüne dek yalnızca bir YAZMA sınırıydı; konum analizi de bu gerekçeyle
       onu okumuyordu. Kural analiz için değişti ve DÖRT ucun da (özet,
       raster, vektör listesi, isabet testi) aynı kapıdan geçmesi gerekir —
       birine eklemeyi unutmak sessiz bir atlatma yolu bırakırdı. */

    [Fact]
    public async Task An_area_outside_the_users_authorisation_is_refused()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, "Ankara Hastanesi", 32.9, 39.9));

        // Kullanıcı yalnızca İstanbul'a yetkili; istek Ankara için geliyor.
        var guard = AreaGuards.Only(Polygon(Istanbul));
        var service = new LocationAnalysisService(db, guard);
        var request = Request((Health, 50), (Schools, 50));

        var summary = await service.AnalyzeAsync(request, CancellationToken.None);

        Assert.False(summary.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, summary.ErrorKind);
    }

    [Fact]
    public async Task Every_analysis_entry_point_shares_the_same_geographic_gate()
    {
        /* Tek tek denetlenir: yeni bir uç eklendiğinde kapıdan geçmediği
           buradan görülür. */
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, "Ankara Hastanesi", 32.9, 39.9));

        var service = new LocationAnalysisService(db, AreaGuards.Only(Polygon(Istanbul)));
        var request = Request((Health, 50), (Schools, 50));

        Assert.Equal(
            ServiceErrorKind.Forbidden,
            (await service.AnalyzeAsync(request, CancellationToken.None)).ErrorKind);

        Assert.Equal(
            ServiceErrorKind.Forbidden,
            (await service.ListPointsAsync(request, CancellationToken.None)).ErrorKind);

        var hitTest = new LocationAnalysisHitTestRequest
        {
            AreaWkts = request.AreaWkts,
            Criteria = request.Criteria,
            Longitude = 32.9,
            Latitude = 39.9
        };

        Assert.Equal(
            ServiceErrorKind.Forbidden,
            (await service.HitTestAsync(hitTest, CancellationToken.None)).ErrorKind);
    }

    [Fact]
    public async Task An_area_inside_the_users_authorisation_runs_normally()
    {
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, "Ankara Hastanesi", 32.9, 39.9));

        /* Yetki alanı hedefi KAPSIYOR: analiz aynen çalışır. */
        var guard = AreaGuards.Only(Polygon("POLYGON ((31 38, 35 38, 35 42, 31 42, 31 38))"));
        var result = await new LocationAnalysisService(db, guard)
            .AnalyzeAsync(Request((Health, 50), (Schools, 50)), CancellationToken.None);

        Assert.True(result.IsSuccess, result.Error);
        Assert.Equal(1, result.Value!.TotalMatchingPoiCount);
    }

    [Fact]
    public async Task An_unrestricted_user_is_unaffected()
    {
        /* Mevcut kurulumlarda hiç coğrafi alan tanımlı değildir; kural
           değişikliği onları KAPATMAMALIDIR. */
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, "Ankara Hastanesi", 32.9, 39.9));

        var result = await AnalyzeAsync(db, Request((Health, 50), (Schools, 50)));

        Assert.True(result.IsSuccess, result.Error);
    }

    [Fact]
    public async Task A_partially_overlapping_area_is_refused_not_silently_clipped()
    {
        /* Hedefin YARISI yetki alanında olsa bile reddedilir: sessizce
           kırpmak, kullanıcıya istemediği bir alanın sonucunu istediği alanın
           sonucu diye göstermek olurdu. */
        await using var db = await NewDbAsync();

        var guard = AreaGuards.Only(Polygon("POLYGON ((32 39, 33 39, 33 41, 32 41, 32 39))"));
        var result = await new LocationAnalysisService(db, guard)
            .AnalyzeAsync(Request((Health, 50), (Schools, 50)), CancellationToken.None);

        Assert.False(result.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, result.ErrorKind);
    }

    private static Geometry Polygon(string wkt)
    {
        var geometry = new NetTopologySuite.IO.WKTReader().Read(wkt);
        geometry.SRID = 4326;
        return geometry;
    }

    /* --- Vektör listesi -------------------------------------------------------------

       Analiz POI'leri artık haritada RASTER değil, normal POI'lerle aynı
       kategori rozetleriyle çizilir. Liste ucu bu yüzden kayıtların
       kendilerini döndürür — ama süzgeci ÖZETLE aynı koddan alır: haritada
       görünen nokta sayısı, özetin söylediği sayı olmalıdır.

       <b>Bu dosyanın taksonomisi DÜZDÜR</b> (her kategori bir kök). Alt ağaç
       genişletmesi ve tam yol, gerçek bir ağaç kuran
       <see cref="LocationAnalysisHierarchyTests"/> içinde ölçülür. */

    [Fact]
    public async Task The_vector_list_returns_only_the_analysed_records()
    {
        await using var db = await NewDbAsync();

        await SeedAsync(
            db,
            (Health, "Ankara Hastanesi", 32.9, 39.9),
            (Schools, "Ankara Okulu", 32.85, 39.92),
            /* İlgisiz kategori: seçilmedi, kapsanmadı. */
            ("kafe", "Ankara Kafesi", 32.87, 39.93),
            /* Alan dışında: doğru kategoride ama İstanbul'da. */
            (Health, "İstanbul Hastanesi", 28.9, 41.0));

        var result = await ListPointsAsync(db, Request((Health, 50), (Schools, 50)));

        Assert.True(result.IsSuccess, result.Error);

        var names = result.Value!.Pois.Select(poi => poi.Name).ToArray();

        Assert.Equal(2, result.Value!.TotalCount);
        Assert.Contains("Ankara Hastanesi", names);
        Assert.Contains("Ankara Okulu", names);
        Assert.DoesNotContain("Ankara Kafesi", names);
        Assert.DoesNotContain("İstanbul Hastanesi", names);
    }

    [Fact]
    public async Task Every_returned_record_carries_what_the_badge_needs()
    {
        /* Rozet `categoryId` üzerinden çözülür — simge ve renk kaydın
           kopyasında DEĞİL, kategori ucunda yaşar; bir yönetici simgeyi
           değiştirdiğinde analiz katmanı da değişsin diye. */
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, "Ankara Hastanesi", 32.9, 39.9));

        var poi = Assert.Single(
            (await ListPointsAsync(db, Request((Health, 50), (Schools, 50)))).Value!.Pois);

        Assert.True(poi.CategoryId > 0);
        Assert.Equal(Health, poi.CategorySlug);
        Assert.Equal("Sağlık Kurumları", poi.CategoryName);
        Assert.Equal("Sağlık Kurumları", poi.CategoryPath);
        Assert.Equal(32.9, poi.Longitude, 6);
        Assert.Equal(39.9, poi.Latitude, 6);
        Assert.True(poi.Id > 0);
    }

    [Fact]
    public async Task A_nameless_record_keeps_a_null_name_instead_of_an_invented_one()
    {
        /* Açık veri kümesinde adsız ama geçerli kayıtlar sıradandır — gerçek
           Ankara kümesinde 182 tane. Sunucu bir ad UYDURMAZ; boşluğu nasıl
           anlatacağına arayüz karar verir. */
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, null!, 32.9, 39.9));

        var poi = Assert.Single(
            (await ListPointsAsync(db, Request((Health, 50), (Schools, 50)))).Value!.Pois);

        Assert.Null(poi.Name);
        // Kimlik yine de tamdır: kaydın ne olduğu kategoriden okunur.
        Assert.Equal("Sağlık Kurumları", poi.CategoryPath);
    }

    [Fact]
    public async Task The_vector_list_agrees_with_the_summary_count()
    {
        /* BAŞLICA sözleşme: haritada çizilen nokta sayısı, özetin söylediği
           sayıdır. İki uç ayrışırsa kullanıcı, analizine girmeyen noktaları
           sonucun parçası sanardı. */
        await using var db = await NewDbAsync();

        await SeedAsync(
            db,
            (Health, "H1", 32.9, 39.9),
            (Health, "H2", 32.91, 39.91),
            (Schools, "O1", 32.85, 39.92),
            ("kafe", "K1", 32.87, 39.93),
            (Health, "Uzak", 28.9, 41.0));

        var request = Request((Health, 50), (Schools, 50));
        var summary = await AnalyzeAsync(db, request);
        var points = await ListPointsAsync(db, request);

        Assert.Equal(summary.Value!.TotalMatchingPoiCount, points.Value!.TotalCount);
        Assert.Equal(summary.Value!.TotalMatchingPoiCount, points.Value!.Pois.Count);
    }

    [Fact]
    public async Task The_vector_list_reports_its_own_ceiling()
    {
        /* Sınır bir GÜVENLİK tavanıdır (alan istemciden gelir ve bir istemci
           ülkenin tamamını hedef gösterebilir) ve normal bir analizde devreye
           girmez; yine de sözleşmesi görünür olmalıdır. */
        await using var db = await NewDbAsync();
        await SeedAsync(db, (Health, "H1", 32.9, 39.9));

        var value = (await ListPointsAsync(db, Request((Health, 50), (Schools, 50)))).Value!;

        Assert.Equal(LocationAnalysisService.MaxPoints, value.Limit);
        Assert.False(value.Truncated);
        Assert.True(value.Limit >= 5_000, "Tavan gerçek kullanımın üstünde kalmalı.");
    }

    [Fact]
    public async Task The_vector_list_shares_the_analysis_validation()
    {
        /* Alan/ölçüt kuralları İKİNCİ KEZ YAZILMAZ. */
        await using var db = await NewDbAsync();

        var badWeights = Request((Health, 10), (Schools, 10));
        Assert.False((await ListPointsAsync(db, badWeights)).IsSuccess);

        var noArea = Request((Health, 50), (Schools, 50));
        noArea.AreaWkts = [];
        Assert.False((await ListPointsAsync(db, noArea)).IsSuccess);

        Assert.False((await ListPointsAsync(db, null!)).IsSuccess);
    }

    private static Task<ServiceResult<LocationAnalysisPointsResponse>> ListPointsAsync(
        AppDbContext db,
        LocationAnalysisRequest request) =>
        new LocationAnalysisService(db, AreaGuards.Unrestricted).ListPointsAsync(request, CancellationToken.None);

    private static LocationAnalysisRequest RequestWithArea(List<string> areaWkts) =>
        new()
        {
            AreaWkts = areaWkts,
            Criteria = [Criterion(Health, 50), Criterion(Schools, 50)]
        };

    private static Task<ServiceResult<LocationAnalysisResponse>> AnalyzeAsync(
        AppDbContext db,
        LocationAnalysisRequest request) =>
        new LocationAnalysisService(db, AreaGuards.Unrestricted).AnalyzeAsync(request, CancellationToken.None);

    /// <summary>Deterministik fixture satırları; üretim seed'i kullanılmaz.</summary>
    private static async Task SeedAsync(
        AppDbContext db,
        params (string CategorySlug, string Name, double Longitude, double Latitude)[] rows)
    {
        var factory = new GeometryFactory(new PrecisionModel(), 4326);
        var index = 0;

        foreach (var row in rows)
        {
            var category = await db.PoiCategories.SingleAsync(item => item.Slug == row.CategorySlug);

            db.AnalysisPois.Add(new AnalysisPoi
            {
                Name = row.Name,
                CategoryId = category.Id,
                Coordinate = factory.CreatePoint(new Coordinate(row.Longitude, row.Latitude)),
                Source = "test",
                ExternalId = $"node/{++index}",
                ImportedAt = DateTime.UtcNow
            });
        }

        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Kanonik taksonominin bir alt kümesiyle in-memory context.
    /// </summary>
    /// <remarks>
    /// Kategoriler ÜRETİM seed'inden değil, testin kendi belirlediği satırlardan
    /// gelir: burada ölçülen şey taksonominin içeriği değil, analizin
    /// davranışıdır. Slug'lar yine de kanonik olanlardır.
    /// </remarks>
    private static async Task<AppDbContext> NewDbAsync()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"location-analysis-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;

        var db = new AppDbContext(options);

        foreach (var (slug, name) in ((string Slug, string Name)[])
        [
            (Health, "Sağlık Kurumları"),
            (Schools, "Okullar"),
            (Markets, "Zincir Marketler"),
            ("eczane", "Eczane"),
            ("kafe", "Kafe")
        ])
        {
            db.PoiCategories.Add(new PoiCategory { Name = name, Slug = slug });
        }

        await db.SaveChangesAsync();

        return db;
    }
}
