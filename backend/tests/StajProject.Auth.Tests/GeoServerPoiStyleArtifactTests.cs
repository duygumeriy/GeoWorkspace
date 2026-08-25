using System.Xml.Linq;
using StajProject.Domain.Common;
using StajProject.GeoServerStyleGenerator;

namespace StajProject.Auth.Tests;

/// <summary>
/// Üretilmiş GeoServer POI yapıtlarının kanonik taksonomiyle EŞ olduğunu
/// doğrular.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu testlerin konusu sürüklenmedir (drift).</b> Taksonomiye bir kategori
/// eklendiğinde SLD/SVG üretmeyi unutmak sessiz bir hatadır: uygulama derlenir,
/// testler geçer, kategori yönetim ekranında görünür — ve haritada hiç
/// çizilmez. Burada kırılan bir test, o sessizliği gürültüye çevirir.
/// </para>
/// <para>
/// <b>Beklenen çıktı üretecin KENDİSİNDEN alınır.</b> Şablonu test içinde
/// yeniden yazmak, birbirinden bağımsız olarak bozulabilecek ikinci bir gerçek
/// kaynağı demek olurdu; testler bu yüzden <see cref="PoiArtifactPlan"/>'ı
/// çağırır ve yalnızca DİSKTEKİ hâlle karşılaştırır.
/// </para>
/// <para>
/// Testler dosya sistemini yalnızca OKUR. Hiçbir yapıt üretilmez ya da
/// değiştirilmez — düzeltme geliştiricinin bilinçli <c>generate</c>
/// çağrısıdır.
/// </para>
/// </remarks>
public class GeoServerPoiStyleArtifactTests
{
    private static readonly string RepositoryRoot = FindRepositoryRoot();

    private static string Read(string relativePath) =>
        File.ReadAllText(Path.Combine(RepositoryRoot, relativePath.Replace('/', Path.DirectorySeparatorChar)))
            .Replace("\r\n", "\n", StringComparison.Ordinal);

    private static bool Exists(string relativePath) =>
        File.Exists(Path.Combine(RepositoryRoot, relativePath.Replace('/', Path.DirectorySeparatorChar)));

    /* --- Kapsam ------------------------------------------------------------------ */

    [Fact]
    public void Every_canonical_category_has_exactly_one_committed_style()
    {
        foreach (var category in PoiCategoryTaxonomy.All)
        {
            var path = $"{PoiArtifactPlan.StylesDirectory}/poi_{category.Slug}.sld";

            Assert.True(Exists(path), $"Eksik stil: {path}. 'generate' çalıştırılmalı.");
        }

        var committed = Directory
            .EnumerateFiles(Path.Combine(RepositoryRoot, "geoserver", "styles"), "poi_*.sld")
            .Select(Path.GetFileName)
            .Where(name => name != PoiStyleTemplates.CompositeFileName)
            .ToList();

        Assert.Equal(PoiCategoryTaxonomy.All.Count, committed.Count);
    }

    [Fact]
    public void No_stale_generated_artifact_remains()
    {
        /* Bir kategori taksonomiden ÇIKARILDIĞINDA dosyası geride kalırsa,
           GeoServer'da artık var olmayan bir kategoriye ait bir stil yayında
           kalırdı. */
        var expected = PoiArtifactPlan.Build()
            .Select(artifact => artifact.RelativePath)
            .ToHashSet(StringComparer.Ordinal);

        var owned = PoiArtifactPlan.FindOwnedFiles(RepositoryRoot);
        var stale = owned.Where(path => !expected.Contains(path)).ToList();

        Assert.True(stale.Count == 0, $"Artık yapıtlar: {string.Join(", ", stale)}");
    }

    [Fact]
    public void Committed_artifacts_equal_deterministic_generator_output()
    {
        // Sürüklenmenin TEK kapsayıcı testi: içerik birebir eşleşmeli.
        var drifted = new List<string>();

        foreach (var artifact in PoiArtifactPlan.Build())
        {
            if (!Exists(artifact.RelativePath))
            {
                drifted.Add($"eksik: {artifact.RelativePath}");

                continue;
            }

            if (Read(artifact.RelativePath) != artifact.Content)
            {
                drifted.Add($"bayat: {artifact.RelativePath}");
            }
        }

        Assert.True(
            drifted.Count == 0,
            "Üretilmiş yapıtlar güncel değil:\n  " + string.Join("\n  ", drifted));
    }

    [Fact]
    public void Every_referenced_icon_file_exists()
    {
        foreach (var category in PoiCategoryTaxonomy.All)
        {
            var path = $"{PoiArtifactPlan.IconsDirectory}/{category.IconKey}.svg";

            Assert.True(Exists(path), $"{category.Slug} kategorisinin simgesi yok: {path}");
        }
    }

    [Fact]
    public void Every_approved_icon_key_has_geometry()
    {
        /* İzin listesi ile çizim kütüphanesi ayrışırsa, onaylı ama çizilemeyen
           bir simge seçilebilir hâle gelirdi. */
        foreach (var iconKey in PoiCategoryIcons.All)
        {
            Assert.True(
                PoiIconLibrary.All.ContainsKey(iconKey),
                $"'{iconKey}' onaylı ama PoiIconLibrary içinde geometrisi yok.");
        }
    }

    /* --- Kategori stilinin sözleşmesi -------------------------------------------- */

    [Fact]
    public void Every_category_style_filters_only_on_its_own_slug()
    {
        foreach (var category in PoiCategoryTaxonomy.All)
        {
            var document = XDocument.Parse(Read($"{PoiArtifactPlan.StylesDirectory}/poi_{category.Slug}.sld"));

            var properties = document.Descendants(Ogc("PropertyIsEqualTo"))
                .Select(node => node.Element(Ogc("PropertyName"))!.Value)
                .ToList();

            var literals = document.Descendants(Ogc("PropertyIsEqualTo"))
                .Select(node => node.Element(Ogc("Literal"))!.Value)
                .ToList();

            /* Kuralların HER BİRİ kendi süzgecini taşır. Beklenen sayı üreteçten
               türetilir; testin içine sabit yazmak, bant sayısı değiştiğinde
               sessizce yanlışa dönecek ikinci bir gerçek kaynağı olurdu. */
            Assert.Equal(PoiStyleTemplates.RulesPerCategory, literals.Count);
            Assert.Equal(["kategori_slug"], properties.Distinct());
            Assert.Equal([category.Slug], literals.Distinct());
        }
    }

    [Fact]
    public void No_category_style_can_render_another_category()
    {
        /* <ElseFilter/> burada, çizim stillerindeki gerekçenin aksine, YANLIŞ
           olurdu: kategoriye özgü bir stili "eşleşmeyen her şeyi de çiz"e
           dönüştürür ve kategori başına ayrı stil şartını ihlal ederdi. */
        foreach (var category in PoiCategoryTaxonomy.All)
        {
            var document = XDocument.Parse(Read($"{PoiArtifactPlan.StylesDirectory}/poi_{category.Slug}.sld"));

            Assert.Empty(document.Descendants(Sld("ElseFilter")));
        }
    }

    [Fact]
    public void No_style_identifies_a_category_by_id_or_display_name()
    {
        /* Kimlik ortama özgüdür, ad düzenlenebilir. Teknik kimliğin var oluş
           nedeni tam olarak budur. */
        foreach (var artifact in PoiArtifactPlan.Build().Where(a => a.RelativePath.EndsWith(".sld", StringComparison.Ordinal)))
        {
            var document = XDocument.Parse(artifact.Content);

            var properties = document.Descendants(Ogc("PropertyName"))
                .Select(node => node.Value)
                .Distinct()
                .ToList();

            // Süzgeç ve etiket dışında hiçbir alan okunmaz.
            Assert.All(properties, name => Assert.Contains(name, new[] { "kategori_slug", "isim" }));
            Assert.DoesNotContain("kategori_id", properties);
            Assert.DoesNotContain("kategori_adi", properties);
        }
    }

    [Fact]
    public void The_proven_phase_3a_behaviour_is_preserved()
    {
        /* Faz 3A'da CANLI doğrulanan davranış: ~1:15K'da simge + etiket,
           ~1:29K'da yalnızca simge, 1:150000'de işaretçi boyutu değişimi. Faz
           5B bu eşiklerin hiçbirini KALDIRMAZ — yalnızca üzerine ikinci bir
           işaretçi bandı ekler. */
        Assert.Equal(150000, PoiStyleTemplates.MarkerScaleSplit);
        Assert.Equal(25000, PoiStyleTemplates.LabelMaxScale);
        Assert.Equal("isim", PoiStyleTemplates.LabelProperty);
        Assert.Equal("kategori_slug", PoiStyleTemplates.FilterProperty);

        var document = XDocument.Parse(Read($"{PoiArtifactPlan.StylesDirectory}/poi_eczane.sld"));

        Assert.Equal("poi_eczane", document.Descendants(Sld("NamedLayer")).Single().Element(Sld("Name"))!.Value);

        // ExternalGraphic YÜKLENEMEZSE devreye giren yedek, kategori renginde.
        var markFills = document.Descendants(Sld("Mark"))
            .SelectMany(mark => mark.Descendants(Sld("CssParameter")))
            .Where(css => css.Attribute("name")?.Value == "fill")
            .Select(css => css.Value)
            .Distinct();

        Assert.Equal(["#EF4444"], markFills);
    }

    /* --- İşaretçi ölçek bantları -------------------------------------------------
       Faz 5B: iki bant yerine üç. Kullanıcının canlı denemede bildirdiği iki
       şikâyetin sayısal karşılığı budur — ülke ölçeğinde okunamayan rozet ve
       yakınlaşınca büyümeyen simge. */

    [Fact]
    public void The_marker_scale_bands_grow_with_zoom_and_stay_bounded()
    {
        Assert.Equal(20, PoiStyleTemplates.VeryFarMarkerSize);
        Assert.Equal(24, PoiStyleTemplates.MediumMarkerSize);
        Assert.Equal(30, PoiStyleTemplates.NearMarkerSize);

        // Yakınlaştıkça BÜYÜR: kullanıcının istediği tek yönlü davranış.
        Assert.True(PoiStyleTemplates.VeryFarMarkerSize < PoiStyleTemplates.MediumMarkerSize);
        Assert.True(PoiStyleTemplates.MediumMarkerSize < PoiStyleTemplates.NearMarkerSize);

        /* Ama KONTROLLÜ: "biraz büyüsün" istendi, "devasa olsun" değil. 32
           piksel bilinçli üst sınırdır. */
        Assert.True(PoiStyleTemplates.NearMarkerSize <= 32);

        // Bant sınırları da sıralıdır; ters çevrilmiş bir eşik sessizce boş bant üretirdi.
        Assert.True(PoiStyleTemplates.MarkerScaleSplit < PoiStyleTemplates.VeryFarScaleThreshold);
        Assert.True(PoiStyleTemplates.LabelMaxScale < PoiStyleTemplates.MarkerScaleSplit);
    }

    [Fact]
    public void Every_category_carries_three_marker_bands_and_one_label()
    {
        foreach (var category in PoiCategoryTaxonomy.All)
        {
            var document = XDocument.Parse(Read($"{PoiArtifactPlan.StylesDirectory}/poi_{category.Slug}.sld"));
            var rules = document.Descendants(Sld("Rule")).ToList();

            Assert.Equal(PoiStyleTemplates.RulesPerCategory, rules.Count);

            Assert.Equal(
                [
                    $"{category.Slug}-marker-very-far",
                    $"{category.Slug}-marker-medium",
                    $"{category.Slug}-marker-near",
                    $"{category.Slug}-label"
                ],
                rules.Select(rule => rule.Element(Sld("Name"))!.Value));

            // Yakınlaştıkça büyüyen üç boyut, taksonomi sırasında.
            Assert.Equal(
                ["20", "24", "30"],
                document.Descendants(Sld("Size")).Select(node => node.Value));

            // Üç işaretçi kuralının üçü de KENDİ simgesini ve KENDİ rengini taşır.
            var hrefs = document.Descendants(Sld("OnlineResource"))
                .Select(node => node.Attribute(XName.Get("href", "http://www.w3.org/1999/xlink"))!.Value)
                .ToList();

            Assert.Equal(3, hrefs.Count);
            Assert.Equal([$"./icons/{category.IconKey}.svg"], hrefs.Distinct());

            var markFills = document.Descendants(Sld("Mark"))
                .SelectMany(mark => mark.Descendants(Sld("CssParameter")))
                .Where(css => css.Attribute("name")?.Value == "fill")
                .Select(css => css.Value)
                .ToList();

            // ExternalGraphic yüklenemezse devreye giren yedek de kategori renginde.
            Assert.Equal(3, markFills.Count);
            Assert.Equal([category.ColorHex], markFills.Distinct());

            // Etiket eşiği DEĞİŞMEDİ: kullanıcı simge boyutundan şikâyet etti, etiketten değil.
            var label = rules[3];
            Assert.Equal("25000", label.Element(Sld("MaxScaleDenominator"))!.Value);
            Assert.Equal(
                "12",
                label.Descendants(Sld("CssParameter"))
                    .Single(css => css.Attribute("name")?.Value == "font-size").Value);
        }
    }

    [Fact]
    public void The_marker_bands_neither_overlap_nor_leave_a_gap()
    {
        /* Her ölçekte TAM BİR işaretçi kuralı eşleşmelidir. Örtüşen bantlar
           POI'yi iki kez çizer (kalın, bulanık bir rozet), boşluk bırakan
           bantlar ise onu bir ölçek aralığında tamamen kaybederdi. */
        var document = XDocument.Parse(Read($"{PoiArtifactPlan.StylesDirectory}/poi_eczane.sld"));
        var markers = document.Descendants(Sld("Rule"))
            .Where(rule => rule.Descendants(Sld("PointSymbolizer")).Any())
            .ToList();

        static string? Min(XElement rule) => rule.Element(Sld("MinScaleDenominator"))?.Value;
        static string? Max(XElement rule) => rule.Element(Sld("MaxScaleDenominator"))?.Value;

        // Çok uzak: üstten sınırsız, altta 1000000'de biter.
        Assert.Equal("1000000", Min(markers[0]));
        Assert.Null(Max(markers[0]));

        // Orta: İKİ sınırı da taşır — komşularının bittiği yerde başlar.
        Assert.Equal("150000", Min(markers[1]));
        Assert.Equal("1000000", Max(markers[1]));

        // Yakın: alttan sınırsız, üstte 150000'de biter.
        Assert.Null(Min(markers[2]));
        Assert.Equal("150000", Max(markers[2]));
    }

    [Fact]
    public void The_label_clears_the_enlarged_near_marker()
    {
        /* Etiket yalnızca YAKIN bantta görünür; payı belirleyen işaretçi 30
           pikselliktir. Pay elle seçilmez, rozet boyutundan TÜRETİLİR — aksi
           hâlde boyut değişince etiket rozetin içine girerdi. */
        Assert.Equal((PoiStyleTemplates.NearMarkerSize / 2) + 4, PoiStyleTemplates.LabelDisplacementY);
        Assert.True(PoiStyleTemplates.LabelDisplacementY > PoiStyleTemplates.NearMarkerSize / 2);

        var document = XDocument.Parse(Read($"{PoiArtifactPlan.StylesDirectory}/poi_eczane.sld"));

        Assert.Equal(
            PoiStyleTemplates.LabelDisplacementY.ToString(System.Globalization.CultureInfo.InvariantCulture),
            document.Descendants(Sld("DisplacementY")).Single().Value);
    }

    /* --- Bileşik stil ------------------------------------------------------------ */

    [Fact]
    public void The_composite_style_covers_every_canonical_category_exactly_once()
    {
        var document = XDocument.Parse(Read($"{PoiArtifactPlan.StylesDirectory}/{PoiStyleTemplates.CompositeFileName}"));

        var literals = document.Descendants(Ogc("PropertyIsEqualTo"))
            .Select(node => node.Element(Ogc("Literal"))!.Value)
            .ToList();

        var canonical = PoiCategoryTaxonomy.All.Select(item => item.Slug).ToHashSet(StringComparer.Ordinal);

        /* Bilinmeyen slug yok, eksik kategori yok, kategori başına TAM kural
           takımı. Toplam sayı taksonomi × kural/kategori olarak TÜRETİLİR —
           bugünkü 176 sayısı teste elle yazılsaydı, taksonomiye bir kategori
           eklendiğinde testin kendisi düzeltilmesi gereken bir engel olurdu. */
        Assert.Equal(canonical, literals.ToHashSet(StringComparer.Ordinal));
        Assert.All(
            literals.GroupBy(slug => slug, StringComparer.Ordinal),
            group => Assert.Equal(PoiStyleTemplates.RulesPerCategory, group.Count()));
        Assert.Equal(canonical.Count * PoiStyleTemplates.RulesPerCategory, literals.Count);
    }

    [Fact]
    public void The_composite_style_does_not_replace_the_per_category_styles()
    {
        /* Ödev şartı kategori başına AYRI adlı stildir; poi_all yalnızca pratik
           sunum yoludur (tek WMS isteği 44 stil adı taşıyamaz). İkisi bir arada
           bulunmalıdır. */
        Assert.True(Exists($"{PoiArtifactPlan.StylesDirectory}/{PoiStyleTemplates.CompositeFileName}"));
        Assert.Equal(44, PoiCategoryTaxonomy.All.Count);

        foreach (var category in PoiCategoryTaxonomy.All)
        {
            Assert.True(Exists($"{PoiArtifactPlan.StylesDirectory}/poi_{category.Slug}.sld"));
        }
    }

    /* --- Sahiplik ve güvenlik ---------------------------------------------------- */

    [Fact]
    public void Unrelated_hand_authored_styles_are_not_generator_owned()
    {
        /* Temizlik yalnızca ÜRETİLMİŞ işareti taşıyan dosyaları siler. Çizim
           sunum stilleri o işareti taşımaz, dolayısıyla hiçbir koşulda
           silinemezler. */
        var owned = PoiArtifactPlan.FindOwnedFiles(RepositoryRoot);

        foreach (var handAuthored in new[]
                 {
                     "drawing_point_presentation.sld",
                     "drawing_line_presentation.sld",
                     "drawing_polygon_presentation.sld"
                 })
        {
            Assert.True(Exists($"{PoiArtifactPlan.StylesDirectory}/{handAuthored}"));
            Assert.DoesNotContain($"{PoiArtifactPlan.StylesDirectory}/{handAuthored}", owned);
        }
    }

    [Fact]
    public void Generated_icons_contain_no_active_or_remote_content()
    {
        /* Bir SVG'nin dışarıdan kaynak çekmesi, sunucu tarafında bir istek
           kanalı açardı; betik ise Batik'in içinde çalışan kod demek olurdu. */
        string[] forbidden =
        [
            "<script", "<image", "<use", "<foreignObject", "<style",
            "http://", "https://", "data:", "base64"
        ];

        foreach (var artifact in PoiArtifactPlan.Build()
                     .Where(a => a.RelativePath.EndsWith(".svg", StringComparison.Ordinal)))
        {
            // Yorumlar düz metindir; taramada işaretlemeden ayrılır.
            var markup = System.Text.RegularExpressions.Regex
                .Replace(artifact.Content, "<!--.*?-->", string.Empty,
                    System.Text.RegularExpressions.RegexOptions.Singleline)
                .Replace("http://www.w3.org/2000/svg", string.Empty, StringComparison.Ordinal);

            foreach (var token in forbidden)
            {
                Assert.DoesNotContain(token, markup, StringComparison.OrdinalIgnoreCase);
            }
        }
    }

    [Fact]
    public void Every_generated_artifact_is_marked_as_generated()
    {
        foreach (var artifact in PoiArtifactPlan.Build())
        {
            Assert.Contains(PoiStyleTemplates.GeneratedMarker, artifact.Content, StringComparison.Ordinal);
        }
    }

    /* --- Yardımcılar ------------------------------------------------------------- */

    private static XName Sld(string name) => XName.Get(name, "http://www.opengis.net/sld");

    private static XName Ogc(string name) => XName.Get(name, "http://www.opengis.net/ogc");

    private static string FindRepositoryRoot()
    {
        var current = new DirectoryInfo(AppContext.BaseDirectory);

        while (current is not null)
        {
            if (File.Exists(Path.Combine(current.FullName, "global.json"))
                && Directory.Exists(Path.Combine(current.FullName, "geoserver")))
            {
                return current.FullName;
            }

            current = current.Parent;
        }

        throw new InvalidOperationException("Depo kökü bulunamadı.");
    }
}
