using System.Xml.Linq;

namespace StajProject.Auth.Tests;

/// <summary>
/// Konum analizinin GeoServer stil YAPITLARI: hangisi depoda durmalı,
/// hangisi ARTIK durmamalı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Ağırlıklı ısı haritası stili EMEKLİ EDİLDİ.</b> Ödevin istediği yüzey
/// <c>S(x) = Σ w_c · normalize(D_c(x))</c>'tir ve ölçüt BAŞINA
/// normalleştirme gerektirir; <c>vec:Heatmap</c> tek geçişte yalnızca SONUÇ
/// yüzeyini normalleştirdiği için bu denklemi bir SLD ile kurmak mümkün
/// değildir. Yüzey artık sunucuda hesaplanıyor
/// (<c>LocationAnalysisHeatmapRenderer</c>), dolayısıyla stil dosyası,
/// <c>env</c> ağırlık yuvaları ve <c>AnalysisHeatmapStyle</c> ayarı birlikte
/// kaldırıldı. Buradaki ilk test o kaldırmanın geri sızmamasını sabitler:
/// yeniden eklenen bir SLD, artık kimsenin göndermediği ağırlıklarla sessizce
/// yanlış bir harita çizerdi.
/// </para>
/// <para>
/// <b>Nokta örtüsü stili KALIR.</b> O bir hesap değil bir sunumdur ve
/// GeoServer onu doğru yapıyor. Stil kataloğunda yaşar ve sürüm denetimi
/// altında değildir; depodaki dosya onun gözden geçirilebilir kaynağıdır.
/// </para>
/// </remarks>
public class LocationAnalysisStyleArtifactTests
{
    private const string PointsPath = "geoserver/styles/analysis_poi_points.sld";
    private const string RetiredHeatmapPath = "geoserver/styles/analysis_weighted_heatmap.sld";

    private static readonly XNamespace Sld = "http://www.opengis.net/sld";

    /* --- Emekli yapıt ---------------------------------------------------------------- */

    [Fact]
    public void The_weighted_heatmap_SLD_is_gone_and_must_not_come_back()
    {
        Assert.False(
            File.Exists(Path.Combine(FindRepositoryRoot(), RetiredHeatmapPath.Replace('/', Path.DirectorySeparatorChar))),
            "Ağırlıklı ısı haritası artık GeoServer stiliyle üretilmiyor; "
            + "bir SLD geri eklenirse ağırlıklar hiçbir yerden gelmez ve harita sessizce yanlış çizilir.");
    }

    /* --- Nokta örtüsü stili ---------------------------------------------------------- */

    [Fact]
    public void The_point_style_is_committed_and_is_valid_SLD_1_0()
    {
        var document = Load();

        Assert.Equal("StyledLayerDescriptor", document.Root!.Name.LocalName);
        Assert.Equal("1.0.0", document.Root.Attribute("version")!.Value);
        Assert.Equal(Sld, document.Root.Name.Namespace);
    }

    [Fact]
    public void The_named_layer_matches_the_configured_style_name()
    {
        // Stil adı ayardaki AnalysisPoiPointStyle ile aynı olmalıdır; aksi
        // hâlde STYLES parametresi kataloğa uymaz.
        Assert.Equal(
            "analysis_poi_points",
            Load().Descendants(Sld + "NamedLayer").Single().Element(Sld + "Name")!.Value);
    }

    [Fact]
    public void The_point_style_draws_points_and_runs_no_rendering_transformation()
    {
        var document = Load();

        /* Örtü bir SUNUMdur: yoğunluk hesabı yapmaz. Bir dönüşüm eklenirse
           örtü ile ısı haritası aynı soruyu iki farklı yerde yanıtlamaya
           başlardı. */
        Assert.Empty(document.Descendants(Sld + "Transformation"));
        Assert.NotEmpty(document.Descendants(Sld + "PointSymbolizer"));
    }

    [Fact]
    public void The_style_leaks_no_configuration_or_credential()
    {
        var text = File.ReadAllText(Path.Combine(FindRepositoryRoot(), PointsPath));

        foreach (var forbidden in new[] { "password", "Password", "jdbc:", "Host=", "Username=", "localhost:5432" })
        {
            Assert.DoesNotContain(forbidden, text, StringComparison.Ordinal);
        }
    }

    [Fact]
    public void The_style_is_not_owned_by_the_POI_artifact_generator()
    {
        /* Üretim işareti taşısaydı, üreteç onu "bayat yapıt" sayıp SİLERDİ:
           taksonomiden türetilmediği için beklenen dosya listesinde yer almaz. */
        var text = File.ReadAllText(Path.Combine(FindRepositoryRoot(), PointsPath));

        Assert.DoesNotContain("StajProject.GeoServerStyleGenerator tarafından", text, StringComparison.Ordinal);
    }

    /* --- Yardımcılar ---------------------------------------------------------------- */

    private static XDocument Load() =>
        XDocument.Load(Path.Combine(FindRepositoryRoot(), PointsPath.Replace('/', Path.DirectorySeparatorChar)));

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
}
