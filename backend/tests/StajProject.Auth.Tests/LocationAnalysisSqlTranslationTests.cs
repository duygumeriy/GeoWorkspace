using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

/// <summary>
/// Konum analizi sorgusunun <b>Npgsql/PostGIS'e çevrildiğini</b> kanıtlar.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı bir dosya.</b> <see cref="LocationAnalysisServiceTests"/> ve
/// <see cref="LocationAnalysisHierarchyTests"/> in-memory sağlayıcıyla çalışır
/// ve SEMANTİĞİ ölçer — hangi POI'nin sayıldığını. Ama in-memory sağlayıcı
/// <c>Intersects</c>'i NetTopologySuite ile BELLEKTE değerlendirir; o testler
/// yeşil kalırken sorgu üretimde sessizce istemci tarafına düşebilirdi. Burada
/// ölçülen tek şey ÇEVİRİDİR.
/// </para>
/// <para>
/// <b>Hiçbir bağlantı açılmaz.</b> <c>ToQueryString()</c> yalnızca sorgu
/// planını metne döker; veritabanına gidilmez, dolayısıyla test bir PostgreSQL
/// örneği gerektirmez ve hiçbir şeyi değiştirmez.
/// <see cref="AnalysisPoiPersistenceTests"/> ile aynı sağlayıcı-modeli
/// yaklaşımı.
/// </para>
/// <para>
/// <b>Bu bir CANLI PostGIS testi DEĞİLDİR.</b> Kanıtlanan şey, Npgsql'in
/// yüklemleri SQL'e çevirdiğidir; sorgunun gerçek bir veritabanında beklenen
/// satırları döndürdüğü, göç uygulandıktan ve veri yüklendikten sonra elle
/// doğrulanacaktır.
/// </para>
/// <para>
/// İddialar <b>dar</b> tutulur: tam SQL anlık görüntüsü alınmaz, takma adlar ve
/// parametre adları sabitlenmez — bunlar EF sürümüyle değişir ve testi
/// kırılgan yapardı. Sabitlenen şey iki yüklemin SQL'de VAR OLMASIDIR.
/// </para>
/// </remarks>
public class LocationAnalysisSqlTranslationTests
{
    private static readonly int[] CategoryIds = [11, 12, 21];

    [Fact]
    public void The_spatial_predicate_is_translated_to_postgis()
    {
        var sql = MatchingSql();

        /* ST_Intersects SQL'de görünüyorsa yüklem sunucuda çalışıyordur.
           Görünmeseydi, EF yüklemi istemciye çekip her satırı bellekte
           süzüyor olurdu — tam olarak yasaklanan davranış. */
        Assert.Contains("ST_Intersects", sql, StringComparison.OrdinalIgnoreCase);

        /* Geometri bir PARAMETRE olarak gider; WKT metni ifadenin GÖVDESİNE
           gömülmez. (ToQueryString çıktısının başındaki `-- @__target_1=...`
           satırları parametre BİLDİRİMİdir ve tam da parametrelendiğinin
           kanıtıdır; iddia bu yüzden gövde üzerinde kurulur.) */
        var body = Body(sql);

        Assert.DoesNotContain("POLYGON ((", body, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("@__target", body, StringComparison.Ordinal);
    }

    [Fact]
    public void The_category_filter_is_translated_server_side()
    {
        var sql = MatchingSql();

        Assert.Contains("category_id", sql, StringComparison.OrdinalIgnoreCase);

        /* Npgsql bir kimlik kümesini `= ANY (...)` olarak çevirir. İki yazımdan
           biri kabul edilir; sabitlenen şey biçim değil, süzmenin WHERE'de
           OLMASIDIR. */
        Assert.True(
            sql.Contains("ANY", StringComparison.OrdinalIgnoreCase)
            || sql.Contains(" IN ", StringComparison.OrdinalIgnoreCase),
            $"Kategori süzgeci sunucu tarafına çevrilmemiş görünüyor:\n{sql}");
    }

    [Fact]
    public void Both_predicates_live_in_the_same_where_clause()
    {
        var sql = MatchingSql();

        var whereIndex = sql.IndexOf("WHERE", StringComparison.OrdinalIgnoreCase);

        Assert.True(whereIndex >= 0, $"WHERE üretilmemiş:\n{sql}");

        var where = sql[whereIndex..];

        /* İkisi de AYNI WHERE'de: veritabanı önce kategori kümesiyle satırları
           daraltır, sonra mekânsal yüklemi uygular. Tek gidiş dönüş. */
        Assert.Contains("category_id", where, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ST_Intersects", where, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_query_reads_BOTH_poi_sources_as_one_union()
    {
        var sql = MatchingSql();

        /* Konum analizinin veri kümesi İKİ kaynaktır: açık veri
           `analysis_poi` ve uygulamada oluşturulmuş `poi`. Kullanıcının
           haritada eklediği bir POI, aktifse ve ölçüt/alan kapsamına
           giriyorsa analize KATILMALIDIR. */
        Assert.Contains("analysis_poi", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("FROM poi ", sql, StringComparison.OrdinalIgnoreCase);

        /* Tekilleştirme YAPILMAZ: iki kaynak arasında paylaşılan güvenilir
           bir dış kimlik yoktur, `UNION` yalnızca maliyet olurdu. */
        Assert.Contains("UNION ALL", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("UNION\n", sql, StringComparison.OrdinalIgnoreCase);

        /* Kategori tablosuna DOKUNULMAZ: hiyerarşi bellekte, ayrı ve tek bir
           kategori sorgusuyla çözülür — bu sorgu join taşımaz. */
        Assert.DoesNotContain("poi_category", sql, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("JOIN", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_application_branch_carries_the_trash_and_active_predicates()
    {
        var sql = MatchingSql();

        /* Süzgeç `poi_read` SQL View'ı ve EF global query filter'ı ile
           BİREBİR aynıdır: çöp kutusundaki ya da pasifleştirilmiş bir POI
           analize giremez. Bunu SQL'de sabitlemek gerekir çünkü `is_deleted`
           global filter'dan, `is_active` ise açık bir Where'den gelir —
           birinin düşmesi sessiz olurdu. */
        Assert.Contains("is_deleted", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("is_active", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Both_branches_are_filtered_before_the_union()
    {
        var sql = MatchingSql();

        /* Yüklemler birleşimden ÖNCE, her kola ayrı uygulanır: her kol kendi
           GiST/kategori indeksinden yararlanır. Birleşimin ÜSTÜNDE süzmek,
           veritabanını iki tabloyu önce tam olarak birleştirmeye
           zorlayabilirdi. */
        var union = sql.IndexOf("UNION ALL", StringComparison.OrdinalIgnoreCase);

        Assert.True(union > 0, $"Birleşim üretilmemiş:\n{sql}");

        var before = sql[..union];
        var after = sql[union..];

        Assert.Contains("ST_Intersects", before, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ST_Intersects", after, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("category_id", before, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("kategori_id", after, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_grouped_count_projection_is_translated_too()
    {
        using var context = Context();

        var sql = LocationAnalysisService
            .Matching(context, Target(), CategoryIds)
            .GroupBy(poi => poi.CategoryId)
            .Select(group => new { CategoryId = group.Key, Count = group.Count() })
            .ToQueryString();

        /* Servisin GERÇEKTEN çalıştırdığı sorgu budur. Sayım da gruplama da
           SQL'e iner: veritabanı kategori başına tek satır döndürür, POI
           satırları ASLA istemciye çekilmez. */
        Assert.Contains("GROUP BY", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("count(", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ST_Intersects", sql, StringComparison.OrdinalIgnoreCase);
    }

    /* --- Yardımcılar ------------------------------------------------------------ */

    /// <summary>
    /// Sorgu metninin GÖVDESİ: baştaki parametre bildirimi yorum satırları
    /// atılır. O satırlar parametre DEĞERLERİNİ gösterir; SQL'in kendisi
    /// değildir.
    /// </summary>
    private static string Body(string queryString) =>
        string.Join(
            '\n',
            queryString
                .Split('\n')
                .SkipWhile(line => line.TrimStart().StartsWith("--", StringComparison.Ordinal)
                    || line.Trim().Length == 0));

    /* --- İsabet testi: METRE mi DERECE mi ------------------------------------------

       Bu dosyadaki en kritik iddia. `analysis_poi.coordinate` EPSG:4326'dır ve
       o kolonda `ST_Distance(geometry, geometry)` DERECE döndürür. Ankara
       enleminde bir derece boylam, bir derece enlemin ~%77'si kadardır;
       dolayısıyla "derece cinsinden en yakın" ile "metre cinsinden en yakın"
       AYNI kayıt olmak zorunda değildir. Daha kötüsü, metre sanılan bir
       yarıçap derece olarak yorumlanırsa 250 "derece" tüm veri kümesini
       yakalar.

       PostGIS'te dört argümanlı `ST_DWithin` yalnızca GEOGRAPHY aşırı
       yüklemesinde vardır (`geography, geography, double, boolean`) ve
       geometry→geography örtük dönüşümüyle çözülür: yarıçap METREDİR.
       Gerçek veritabanında ölçüldü (kontrol noktası 32.852724, 39.885072):
       5 m → 1 kayıt, 250 m → 8, 5 km → 660. Derece olsaydı 5 zaten hepsini
       yakalardı. */

    [Fact]
    public void The_hit_test_measures_distance_in_metres_not_degrees()
    {
        var sql = HitTestSql();

        /* Dördüncü argüman (`TRUE`) geography aşırı yüklemesini seçer. Onsuz
           çağrı `ST_DWithin(geometry, geometry, double)` olurdu ve yarıçap
           sessizce DERECEYE dönerdi. */
        Assert.Contains("ST_DWithin", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Matches(@"ST_DWithin\([^)]*,\s*TRUE\)", sql);
        Assert.Matches(@"ST_Distance\([^)]*,\s*TRUE\)", sql);
    }

    [Fact]
    public void The_hit_test_orders_and_limits_in_the_database()
    {
        var sql = HitTestSql();

        /* Sıralama ve sınırlama SQL'de olmalıdır. Eşleşen satırları belleğe
           çekip C# tarafında en yakını seçmek, tablo büyüdükçe her tıklamada
           binlerce satır taşımak olurdu. */
        Assert.Contains("ORDER BY", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("LIMIT", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("ST_Distance", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_hit_test_keeps_the_shared_area_and_category_predicates()
    {
        /* İsabet testi ekranda görünen kümenin DIŞINA çıkamaz: alan ve
           kategori yüklemleri özet/raster/örtü ile aynı koddan gelir
           (`LocationAnalysisService.Matching`). Bunlar düşerse kullanıcı,
           analizine girmeyen bir noktayı analizin sonucu sanardı. */
        var sql = HitTestSql();

        Assert.Contains("ST_Intersects", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("category_id", sql, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void The_hit_test_parameterises_the_click_point()
    {
        /* Koordinat sorgu GÖVDESİNE gömülmez; parametre olarak gider. */
        var body = Body(HitTestSql());

        Assert.DoesNotContain("POINT (", body, StringComparison.OrdinalIgnoreCase);
    }

    private static string HitTestSql()
    {
        using var context = Context();

        var click = new Point(32.852724, 39.885072) { SRID = 4326 };

        return LocationAnalysisService
            .NearestMatching(context, Target(), CategoryIds, click, 250, 1)
            .ToQueryString();
    }

    private static string MatchingSql()
    {
        using var context = Context();

        return LocationAnalysisService.Matching(context, Target(), CategoryIds).ToQueryString();
    }

    private static Geometry Target()
    {
        var target = new WKTReader().Read("POLYGON ((32 39, 34 39, 34 41, 32 41, 32 39))");
        target.SRID = 4326;
        return target;
    }

    /// <summary>
    /// Npgsql sağlayıcısıyla context; <b>bağlantı açılmaz</b>, yalnızca sorgu
    /// metni üretilir.
    /// </summary>
    private static AppDbContext Context()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(
                "Host=localhost;Database=translation-only;Username=none;Password=none",
                npgsql => npgsql.UseNetTopologySuite())
            .Options;

        return new AppDbContext(options);
    }
}
