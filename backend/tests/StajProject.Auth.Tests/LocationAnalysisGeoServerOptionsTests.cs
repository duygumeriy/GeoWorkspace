using System.Text.Json;
using StajProject.Application.Options;

namespace StajProject.Auth.Tests;

/// <summary>
/// Konum analizi için eklenen GeoServer ayarlarının açılışta doğrulanması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden açılışta.</b> Eksik ya da bozuk bir katman/style adı, ilk gerçek
/// isteğe kadar sessiz kalır ve orada anlaşılması güç bir GeoServer hatası
/// olarak görünürdü. <c>Validate()</c> bunu bir yapılandırma hatasına
/// çevirir.
/// </para>
/// <para>
/// <b>Mevcut doğrulama ZAYIFLATILMAZ.</b> Yeni alanlar eklendi; eski alanların
/// hiçbirinin zorunluluğu kaldırılmadı.
/// </para>
/// </remarks>
public class LocationAnalysisGeoServerOptionsTests
{
    [Fact]
    public void A_complete_configuration_is_accepted() => Valid().Validate();

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void A_missing_analysis_layer_stops_startup(string layer)
    {
        var options = Valid();
        options.AnalysisPoiLayer = layer;

        Assert.Throws<InvalidOperationException>(options.Validate);
    }

    [Theory]
    [InlineData("analysis_poi_read;DROP TABLE analysis_poi")]
    [InlineData("analysis_poi_read&STYLES=poi_all")]
    [InlineData("../../etc/passwd")]
    [InlineData("analysis poi read")]
    [InlineData("geoworkspace:analysis_poi_read")]
    public void An_unsafe_catalog_name_stops_startup(string name)
    {
        /* Katman adı istemciden GELMEZ ama yapılandırmadan gelir ve WMS
           parametresine yazılır. Ad denetimi, bir yapılandırma hatasının
           parametre enjeksiyonuna dönüşmesini engeller. */
        var layerBroken = Valid();
        layerBroken.AnalysisPoiLayer = name;
        Assert.Throws<InvalidOperationException>(layerBroken.Validate);

        var styleBroken = Valid();
        styleBroken.AnalysisPoiPointStyle = name;
        Assert.Throws<InvalidOperationException>(styleBroken.Validate);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(50_001)]
    [InlineData(double.NaN)]
    public void An_out_of_range_radius_stops_startup(double radiusMeters)
    {
        /* Yarıçap artık METREdir: piksel cinsinden bir bant, aynı sayıda
           piksele çizilen bir il ile küçük bir poligonda tamamen farklı iki
           coğrafi genişlik anlamına geliyordu. */
        var options = Valid();
        options.AnalysisHeatmapRadiusMeters = radiusMeters;

        Assert.Throws<InvalidOperationException>(options.Validate);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(121)]
    public void An_out_of_range_timeout_stops_startup(int seconds)
    {
        var options = Valid();
        options.AnalysisTimeoutSeconds = seconds;

        Assert.Throws<InvalidOperationException>(options.Validate);
    }

    [Fact]
    public void The_existing_drawing_heatmap_settings_are_still_required()
    {
        /* Regresyon: yeni alanlar eklenirken eski zorunluluklar
           GEVŞETİLMEDİ. */
        var options = Valid();
        options.HeatmapLayer = string.Empty;

        Assert.Throws<InvalidOperationException>(options.Validate);
    }

    [Fact]
    public void The_analysis_layer_is_not_the_drawing_heatmap_layer()
    {
        var options = Valid();

        // İki ısı haritası AYRI veri kümelerine bakar; aynı katmanı
        // göstermeleri özelliğin anlamını bozardı.
        Assert.NotEqual(options.HeatmapLayer, options.AnalysisPoiLayer);
        Assert.NotEqual(options.HeatmapStyle, options.AnalysisPoiPointStyle);
    }

    /* --- appsettings ---------------------------------------------------------------- */

    [Fact]
    public void The_development_configuration_supplies_every_analysis_setting()
    {
        /* Ayar dosyası eksik kalırsa uygulama açılışta durur; bu test o hatayı
           geliştirme ortamına ulaşmadan yakalar. */
        var geoServer = DevelopmentGeoServerSection();

        Assert.Equal("analysis_poi_read", geoServer.GetProperty("AnalysisPoiLayer").GetString());
        Assert.Equal("analysis_poi_points", geoServer.GetProperty("AnalysisPoiPointStyle").GetString());
        Assert.InRange(geoServer.GetProperty("AnalysisHeatmapRadiusMeters").GetDouble(), 1, 50_000);

        /* Emekli ayarlar GERİ GELMEMELİDİR: ağırlıklı ısı haritası artık
           GeoServer stiliyle üretilmiyor ve yarıçap piksel değil metre. */
        Assert.False(geoServer.TryGetProperty("AnalysisHeatmapStyle", out _));
        Assert.False(geoServer.TryGetProperty("AnalysisHeatmapRadiusPixels", out _));
        Assert.InRange(geoServer.GetProperty("AnalysisTimeoutSeconds").GetInt32(), 1, 120);
    }

    [Fact]
    public void The_development_configuration_carries_no_GeoServer_credential()
    {
        var geoServer = DevelopmentGeoServerSection();

        foreach (var forbidden in new[] { "Password", "password", "User", "Secret", "ApiKey" })
        {
            Assert.False(
                geoServer.TryGetProperty(forbidden, out _),
                $"GeoServer ayarında kimlik bilgisi olmamalıdır: {forbidden}");
        }
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static JsonElement DevelopmentGeoServerSection()
    {
        var path = Path.Combine(
            FindRepositoryRoot(),
            "backend", "src", "StajProject.Api", "appsettings.Development.json");

        using var document = JsonDocument.Parse(File.ReadAllText(path));

        return document.RootElement.GetProperty("GeoServer").Clone();
    }

    private static string FindRepositoryRoot()
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);

        while (directory is not null && !Directory.Exists(Path.Combine(directory.FullName, "geoserver")))
        {
            directory = directory.Parent;
        }

        return directory?.FullName
            ?? throw new InvalidOperationException("Depo kökü bulunamadı: 'geoserver' dizini yok.");
    }

    private static GeoServerOptions Valid() => new()
    {
        BaseUrl = "http://localhost:8080/geoserver",
        Workspace = "geoworkspace",
        PointLayer = "tbl_point_read",
        LineLayer = "tbl_line_read",
        PolygonLayer = "tbl_polygon_read",
        HeatmapLayer = "tbl_point_heatmap",
        HeatmapStyle = "point_density_heatmap",
        PointPresentationStyle = "drawing_point_presentation",
        LinePresentationStyle = "drawing_line_presentation",
        PolygonPresentationStyle = "drawing_polygon_presentation",
        PoiLayer = "poi_read",
        PoiStyle = "poi_all",
        AnalysisPoiLayer = "analysis_poi_read",
        AnalysisPoiPointStyle = "analysis_poi_points",
        AnalysisHeatmapRadiusMeters = 1500,
        AnalysisTimeoutSeconds = 30
    };
}
