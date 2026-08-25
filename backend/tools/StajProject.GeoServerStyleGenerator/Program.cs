using System.Text;

namespace StajProject.GeoServerStyleGenerator;

/// <summary>
/// GeoServer POI stil/simge üreteci — geliştirici aracı.
/// </summary>
/// <remarks>
/// <para>
/// Kullanım:
/// <code>
/// dotnet run --project backend/tools/StajProject.GeoServerStyleGenerator -- generate
/// dotnet run --project backend/tools/StajProject.GeoServerStyleGenerator -- check
/// </code>
/// </para>
/// <para>
/// <b>Hiçbir ağ, veritabanı ya da GeoServer erişimi yoktur.</b> Girdi Domain
/// katmanındaki kanonik taksonomi, çıktı depodaki dosyalardır.
/// </para>
/// </remarks>
internal static class Program
{
    private const int ExitSuccess = 0;
    private const int ExitDrift = 1;
    private const int ExitUsage = 2;

    internal static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;

        var mode = args.Length > 0 ? args[0] : string.Empty;
        var root = ResolveRoot(args);

        if (root is null)
        {
            Console.Error.WriteLine(
                "Depo kökü bulunamadı. --root <yol> ile açıkça belirtin.");

            return ExitUsage;
        }

        return mode switch
        {
            "generate" => Generate(root),
            "check" => Check(root),
            _ => Usage()
        };
    }

    private static int Usage()
    {
        Console.Error.WriteLine(
            """
            StajProject.GeoServerStyleGenerator

              generate   Kanonik taksonomiden SLD ve SVG yapıtlarını üretir.
              check      Üretilecek çıktıyı depodakiyle karşılaştırır; fark varsa
                         sıfırdan farklı çıkar ve HİÇBİR dosyayı değiştirmez.

              --root <yol>   Depo kökü (varsayılan: otomatik bulunur).
            """);

        return ExitUsage;
    }

    /* --- generate --------------------------------------------------------------- */

    private static int Generate(string root)
    {
        var plan = PoiArtifactPlan.Build();
        var expected = plan.Select(item => item.RelativePath).ToHashSet(StringComparer.Ordinal);

        var written = 0;
        var unchanged = 0;

        foreach (var artifact in plan)
        {
            var absolute = Absolute(root, artifact.RelativePath);

            Directory.CreateDirectory(Path.GetDirectoryName(absolute)!);

            if (File.Exists(absolute) && ReadText(absolute) == artifact.Content)
            {
                unchanged++;

                continue;
            }

            // UTF-8, BOM'suz, \n satır sonlu — determinizm şablonda sabitlenir.
            File.WriteAllText(absolute, artifact.Content, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
            written++;
        }

        /* Bayat dosya temizliği. Silme YALNIZCA bu üretecin işaretini taşıyan ve
           artık planda olmayan dosyalara uygulanır: elle yazılmış stiller ve
           drawing_* sunum stilleri işaret taşımadıkları için kapsam dışıdır. */
        var removed = 0;

        foreach (var owned in PoiArtifactPlan.FindOwnedFiles(root))
        {
            if (expected.Contains(owned))
            {
                continue;
            }

            File.Delete(Absolute(root, owned));
            Console.WriteLine($"  silindi (bayat): {owned}");
            removed++;
        }

        Console.WriteLine(
            $"generate: {plan.Count} yapıt ({written} yazıldı, {unchanged} değişmedi, {removed} bayat silindi)");

        return ExitSuccess;
    }

    /* --- check ------------------------------------------------------------------ */

    private static int Check(string root)
    {
        var plan = PoiArtifactPlan.Build();
        var expected = plan.Select(item => item.RelativePath).ToHashSet(StringComparer.Ordinal);
        var problems = new List<string>();

        foreach (var artifact in plan)
        {
            var absolute = Absolute(root, artifact.RelativePath);

            if (!File.Exists(absolute))
            {
                problems.Add($"eksik: {artifact.RelativePath}");

                continue;
            }

            if (ReadText(absolute) != artifact.Content)
            {
                problems.Add($"bayat: {artifact.RelativePath}");
            }
        }

        foreach (var owned in PoiArtifactPlan.FindOwnedFiles(root))
        {
            if (!expected.Contains(owned))
            {
                problems.Add($"artık: {owned}");
            }
        }

        if (problems.Count > 0)
        {
            Console.Error.WriteLine($"check BAŞARISIZ — {problems.Count} sorun:");

            foreach (var problem in problems)
            {
                Console.Error.WriteLine($"  {problem}");
            }

            Console.Error.WriteLine(
                "\nDüzeltmek için: dotnet run --project backend/tools/StajProject.GeoServerStyleGenerator -- generate");

            return ExitDrift;
        }

        Console.WriteLine($"check TAMAM — {plan.Count} yapıt güncel.");

        return ExitSuccess;
    }

    /* --- Yardımcılar ------------------------------------------------------------ */

    private static string Absolute(string root, string relativePath) =>
        Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar));

    /// <summary>Satır sonu farkının sahte fark üretmemesi için normalize okur.</summary>
    private static string ReadText(string path) =>
        File.ReadAllText(path).Replace("\r\n", "\n", StringComparison.Ordinal);

    /// <summary>
    /// Depo kökü: <c>--root</c> ya da <c>global.json</c> + <c>geoserver/</c>
    /// taşıyan ilk üst dizin.
    /// </summary>
    private static string? ResolveRoot(string[] args)
    {
        var index = Array.IndexOf(args, "--root");

        if (index >= 0 && index + 1 < args.Length)
        {
            var explicitRoot = Path.GetFullPath(args[index + 1]);

            return Directory.Exists(explicitRoot) ? explicitRoot : null;
        }

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

        return null;
    }
}
