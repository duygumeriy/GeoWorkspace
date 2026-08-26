using System.Text;
using Microsoft.EntityFrameworkCore;
using StajProject.Infrastructure.Persistence;

namespace StajProject.OsmPoiImporter;

/// <summary>
/// Açık veri POI içe aktarıcısı — <b>geliştirici aracı</b>.
/// </summary>
/// <remarks>
/// <para>
/// Kullanım:
/// <code>
/// dotnet run --project backend/tools/StajProject.OsmPoiImporter -- \
///   import --input /yerel/yol/kucuk-cikarim.osm --connection "Host=...;Database=..." --dry-run
///
/// dotnet run --project backend/tools/StajProject.OsmPoiImporter -- rules
/// </code>
/// </para>
/// <para>
/// <b>HİÇBİR ağ erişimi yoktur.</b> Geofabrik'ten indirme, Overpass sorgusu ya
/// da openstreetmap.org çağrısı YAPILMAZ; girdi her zaman elle verilen yerel
/// bir dosya yoludur ve hiçbir yol koda gömülmez. Veri kümesini indirmek
/// kullanıcının açık kararıdır (bkz. <c>docs/osm-poi-import.md</c>).
/// </para>
/// <para>
/// <b>Yalnızca <c>analysis_poi</c> yazılır.</b> Normal POI envanterine,
/// kategori taksonomisine ve GeoServer'a dokunulmaz. Araç API'nin DI kabına
/// kaydedilmez ve açılışta çalışmaz.
/// </para>
/// </remarks>
internal static class Program
{
    private const int ExitSuccess = 0;
    private const int ExitFailure = 1;
    private const int ExitUsage = 2;

    /// <summary>Bağlantı dizesi için ortam değişkeni; parametre verilmezse okunur.</summary>
    private const string ConnectionEnvironmentVariable = "STAJPROJECT_ANALYSIS_CONNECTION";

    internal static async Task<int> Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;

        var mode = args.Length > 0 ? args[0] : string.Empty;

        return mode switch
        {
            "import" => await ImportAsync(args),
            "rules" => Rules(),
            _ => Usage()
        };
    }

    private static int Usage()
    {
        Console.Error.WriteLine(
            """
            StajProject.OsmPoiImporter

              import   Yerel bir OSM XML (.osm) dosyasını analysis_poi tablosuna aktarır.
              rules    Etiket → kanonik kategori eşleme tablosunu yazdırır (veritabanı gerekmez).

              --input <yol>        Yerel OSM XML dosyası (zorunlu).
              --connection <dizge> PostgreSQL bağlantı dizesi. Verilmezse
                                   STAJPROJECT_ANALYSIS_CONNECTION okunur.
              --dry-run            Hiçbir satır yazmaz; yalnızca istatistik üretir.
              --batch <n>          Yığın boyutu (varsayılan 500).
              --mapping-diagnostics
                                   Çözülen belirsizliklerin çakışma başına
                                   kırılımını ve sınırlı örnek kimlikleri yazar.

            Ağ erişimi yoktur: veri kümesi ELLE indirilir ve yolu açıkça verilir.
            """);

        return ExitUsage;
    }

    /* --- rules ------------------------------------------------------------------- */

    /// <summary>
    /// Eşleme tablosunu yazdırır. Veritabanı GEREKTİRMEZ: içe aktarımdan önce
    /// kuralları gözden geçirmenin en ucuz yoludur.
    /// </summary>
    private static int Rules()
    {
        Console.WriteLine($"Kaynak: {OsmCategoryMap.SourceName}");
        Console.WriteLine($"Kural sayısı: {OsmCategoryMap.Rules.Count}");
        Console.WriteLine();

        foreach (var group in OsmCategoryMap.Rules
            .GroupBy(rule => rule.Slug, StringComparer.Ordinal)
            .OrderBy(group => group.Key, StringComparer.Ordinal))
        {
            Console.WriteLine($"  {group.Key}");

            foreach (var rule in group)
            {
                var tag = rule.Value is null ? $"{rule.Key}=*" : $"{rule.Key}={rule.Value}";
                var area = rule.AreaEligible ? "alan+nokta" : "yalnızca nokta";

                Console.WriteLine($"    {tag,-38} {area}");
            }
        }

        Console.WriteLine();
        Console.WriteLine("Bilinçli olarak eşlenmeyen kategoriler:");

        foreach (var (slug, reason) in OsmCategoryMap.DeliberatelyUnmapped.OrderBy(pair => pair.Key, StringComparer.Ordinal))
        {
            Console.WriteLine($"  {slug}");
            Console.WriteLine($"    {reason}");
        }

        return ExitSuccess;
    }

    /* --- import ------------------------------------------------------------------- */

    private static async Task<int> ImportAsync(string[] args)
    {
        var input = Argument(args, "--input");

        if (string.IsNullOrWhiteSpace(input))
        {
            Console.Error.WriteLine("--input zorunludur: yerel bir OSM XML (.osm) dosyasının yolu.");
            return ExitUsage;
        }

        if (!File.Exists(input))
        {
            Console.Error.WriteLine($"Girdi dosyası bulunamadı: {input}");
            return ExitUsage;
        }

        var connection = Argument(args, "--connection")
            ?? Environment.GetEnvironmentVariable(ConnectionEnvironmentVariable);

        if (string.IsNullOrWhiteSpace(connection))
        {
            Console.Error.WriteLine(
                $"Bağlantı dizesi gerekli: --connection ya da {ConnectionEnvironmentVariable}.");

            return ExitUsage;
        }

        var dryRun = args.Contains("--dry-run", StringComparer.Ordinal);
        var diagnostics = args.Contains("--mapping-diagnostics", StringComparer.Ordinal);
        var batchSize = int.TryParse(Argument(args, "--batch"), out var parsed) && parsed > 0 ? parsed : 500;

        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseNpgsql(connection, npgsql => npgsql.UseNetTopologySuite())
            .Options;

        await using var dbContext = new AppDbContext(options);

        var importer = new AnalysisPoiImporter(
            dbContext,
            new ImportOptions(dryRun, batchSize, MappingDiagnostics: diagnostics),
            Console.WriteLine);

        OsmCategoryMapper mapper;

        try
        {
            mapper = await importer.CreateMapperAsync();
        }
        catch (Exception exception)
        {
            /* Bağlantı dizesi ASLA loglanmaz: kimlik bilgisi taşır. Yalnızca
               hata türü ve mesajı yazılır. */
            Console.Error.WriteLine($"Veritabanına bağlanılamadı: {exception.GetType().Name}: {exception.Message}");
            return ExitFailure;
        }

        /* Eşleme tablosunun hedeflediği bir slug veritabanında yoksa içe
           aktarım HİÇ BAŞLAMAZ: eksik bir hedef, o kategoriye ait tüm
           nesnelerin sessizce atlanması demek olurdu. */
        if (mapper.MissingSlugs.Count > 0)
        {
            Console.Error.WriteLine(
                "Eşleme tablosundaki şu slug'lar veritabanında yok (taksonomi seed edilmemiş olabilir):");

            foreach (var slug in mapper.MissingSlugs)
            {
                Console.Error.WriteLine($"  {slug}");
            }

            return ExitFailure;
        }

        Console.WriteLine($"Girdi     : {input}");
        Console.WriteLine($"Kip       : {(dryRun ? "kuru çalıştırma (yazma YOK)" : "içe aktarım")}");
        Console.WriteLine($"Yığın     : {batchSize}");
        Console.WriteLine($"Tanılama  : {(diagnostics ? "açık" : "kapalı")}");
        Console.WriteLine();

        var statistics = new ImportStatistics();
        var source = new OsmXmlSource(input);

        var features = source.Read(
            tags => OsmCategoryMap.Rules.Any(rule => rule.Matches(tags)),
            (_, _, reason) => statistics.Skip(reason),
            (_, _) => statistics.TaggedElements++);

        try
        {
            await importer.ImportAsync(features, mapper, statistics);
        }
        catch (Exception exception)
        {
            Console.Error.WriteLine($"İçe aktarım başarısız: {exception.GetType().Name}: {exception.Message}");
            Console.Error.WriteLine(statistics.Format(dryRun));

            return ExitFailure;
        }

        Console.WriteLine();
        Console.WriteLine(statistics.Format(dryRun));

        return ExitSuccess;
    }

    private static string? Argument(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);

        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}
