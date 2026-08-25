using StajProject.Domain.Common;

namespace StajProject.GeoServerStyleGenerator;

/// <summary>
/// Üretilecek yapıtların TAM listesi: yol → içerik.
/// </summary>
/// <remarks>
/// <para>
/// Plan saf bir hesaplamadır: dosya sistemine dokunmaz. <c>generate</c> onu
/// diske yazar, <c>check</c> diskte olanla karşılaştırır ve testler de aynı
/// planı kullanır — üç yol da AYNI kaynağı okuduğu için birbirinden
/// ayrışamazlar.
/// </para>
/// </remarks>
internal static class PoiArtifactPlan
{
    internal const string StylesDirectory = "geoserver/styles";
    internal const string IconsDirectory = "geoserver/icons";

    /// <param name="RelativePath">Depo köküne göre yol; ayıraç daima <c>/</c>.</param>
    /// <param name="Content">Dosyanın tam içeriği.</param>
    internal sealed record Artifact(string RelativePath, string Content);

    /// <summary>
    /// Kanonik taksonomiden üretilecek her şey.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// Aynı <c>icon_key</c> farklı renklerde iki kategoriye bağlanmışsa.
    /// </exception>
    internal static IReadOnlyList<Artifact> Build()
    {
        var categories = PoiCategoryTaxonomy.All;
        var artifacts = new List<Artifact>();

        /* Renk simgenin İÇİNE gömülüdür (Faz 3A'da kanıtlanan biçim). Bu,
           icon_key başına TEK renk olduğu sürece doğrudur. Bugün eşleme
           birebirdir; ileride iki kategori aynı simgeyi farklı renklerle
           paylaşırsa gömülü renk birinde YANLIŞ olurdu.

           Üreteç bu durumu sessizce geçmez: açık bir hatayla durur ve
           parametrik SVG'ye (fill="param(fill,...)") geçilmesi gerektiğini
           söyler. Sessiz yanlış renk, gürültülü bir hatadan çok daha pahalıdır. */
        var colorByIcon = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var category in categories)
        {
            if (colorByIcon.TryGetValue(category.IconKey, out var existing))
            {
                if (!string.Equals(existing, category.ColorHex, StringComparison.Ordinal))
                {
                    throw new InvalidOperationException(
                        $"'{category.IconKey}' simgesi iki farklı renkte kullanılıyor "
                        + $"({existing} ve {category.ColorHex}). Rengin SVG'ye gömülmesi artık "
                        + "güvenli değil; parametrik SVG'ye geçilmelidir.");
                }

                continue;
            }

            colorByIcon[category.IconKey] = category.ColorHex;
        }

        // Simgeler: icon_key başına BİR dosya, kategori başına değil.
        foreach (var (iconKey, colorHex) in colorByIcon.OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            artifacts.Add(new Artifact(
                $"{IconsDirectory}/{PoiStyleTemplates.IconFileName(iconKey)}",
                PoiStyleTemplates.RenderIcon(iconKey, colorHex)));
        }

        // Kategori stilleri: ödevin literal şartı — kategori başına ayrı stil.
        foreach (var category in categories)
        {
            artifacts.Add(new Artifact(
                $"{StylesDirectory}/{PoiStyleTemplates.StyleFileName(category)}",
                PoiStyleTemplates.RenderCategoryStyle(category)));
        }

        // Bileşik stil: 44'ün yerine geçmez, yanlarına eklenir.
        artifacts.Add(new Artifact(
            $"{StylesDirectory}/{PoiStyleTemplates.CompositeFileName}",
            PoiStyleTemplates.RenderCompositeStyle(categories)));

        return artifacts;
    }

    /// <summary>
    /// Bu üretecin SAHİP OLDUĞU, diskte duran dosyalar.
    /// </summary>
    /// <remarks>
    /// <b>Sahiplik testi işaretin varlığıdır, dosya adı değil.</b> Yalnızca ada
    /// bakan bir temizlik, elle yazılmış bir <c>poi_*.sld</c>'yi silebilirdi.
    /// <c>drawing_*_presentation.sld</c> gibi ilgisiz stiller işareti
    /// taşımadıkları için hiçbir koşulda dokunulmaz.
    /// </remarks>
    internal static IReadOnlyList<string> FindOwnedFiles(string repositoryRoot)
    {
        var owned = new List<string>();

        foreach (var directory in new[] { StylesDirectory, IconsDirectory })
        {
            var absolute = Path.Combine(repositoryRoot, directory.Replace('/', Path.DirectorySeparatorChar));

            if (!Directory.Exists(absolute))
            {
                continue;
            }

            foreach (var file in Directory.EnumerateFiles(absolute))
            {
                var extension = Path.GetExtension(file);

                if (extension is not (".sld" or ".svg"))
                {
                    continue;
                }

                // İşaret dosyanın başındaki yorumdadır; tamamını okumaya gerek yok.
                var head = ReadHead(file);

                if (head.Contains(PoiStyleTemplates.GeneratedMarker, StringComparison.Ordinal))
                {
                    owned.Add($"{directory}/{Path.GetFileName(file)}");
                }
            }
        }

        owned.Sort(StringComparer.Ordinal);

        return owned;
    }

    private static string ReadHead(string path)
    {
        using var reader = new StreamReader(path);
        var buffer = new char[1024];
        var read = reader.Read(buffer, 0, buffer.Length);

        return new string(buffer, 0, read);
    }
}
