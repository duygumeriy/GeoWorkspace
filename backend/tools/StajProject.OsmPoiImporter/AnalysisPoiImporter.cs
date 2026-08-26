using System.Diagnostics;
using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using StajProject.Application.Pois;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.OsmPoiImporter;

/// <summary>İçe aktarım ayarları.</summary>
/// <param name="DryRun">
/// <c>true</c> ise hiçbir satır YAZILMAZ; ayrıştırma, eşleme, temsilî nokta
/// üretimi ve istatistik aynen çalışır.
/// </param>
/// <param name="BatchSize">Tek <c>SaveChanges</c> ile yazılacak azami satır.</param>
/// <param name="ProgressInterval">Kaç elemanda bir ilerleme yazılacağı.</param>
/// <param name="MappingDiagnostics">
/// Çözülmüş belirsizliklerin çakışma başına kırılımı toplansın mı. Kapalıyken
/// eşleme DAVRANIŞI birebir aynıdır; yalnızca ek rapor toplanmaz.
/// </param>
public sealed record ImportOptions(
    bool DryRun = false,
    int BatchSize = 500,
    int ProgressInterval = 5000,
    bool MappingDiagnostics = false);

/// <summary>
/// Normalleştirilmiş dış özellikleri <c>analysis_poi</c> tablosuna aktarır.
/// </summary>
/// <remarks>
/// <para>
/// <b>Yalnızca <c>analysis_poi</c> yazılır.</b> Normal POI envanteri
/// (<c>poi</c>), kategori taksonomisi (<c>poi_category</c>) ve diğer hiçbir
/// tablo bu sınıftan yazılmaz; <c>PoiService</c>/<c>PoiController</c> hiç
/// çağrılmaz. Açık veri, kullanıcı envanterine karışmaz.
/// </para>
/// <para>
/// <b>Kategori OLUŞTURULMAZ.</b> Eşleme tablosunun hedeflediği bir slug
/// veritabanında yoksa bu bir YAPILANDIRMA HATASIDIR ve içe aktarım hiç
/// başlamadan durur — binlerce nesnenin sessizce atlanması yerine tek bir
/// anlaşılır hata. Taksonominin sahibi seed ve yönetim ekranıdır.
/// </para>
/// <para>
/// <b>Yukarıdan silinenler SİLİNMEZ.</b> "Bu çalıştırmada görülmeyen satırları
/// sil" davranışı bilinçli olarak YOKTUR: yerel bir çıkarım tek bir ili ya da
/// ilçeyi içerebilir ve bir nesnenin dosyada olmaması, OSM'de silindiği
/// ANLAMINA GELMEZ. Böyle bir temizlik, ancak kapsamı açıkça beyan eden bir
/// komutla yapılabilir. Bu faz yalnızca ekler ve günceller.
/// </para>
/// </remarks>
public sealed class AnalysisPoiImporter
{
    private static readonly GeometryFactory Factory = new(new PrecisionModel(), 4326);

    private readonly AppDbContext _dbContext;
    private readonly ImportOptions _options;
    private readonly Action<string> _log;

    public AnalysisPoiImporter(AppDbContext dbContext, ImportOptions? options = null, Action<string>? log = null)
    {
        _dbContext = dbContext;
        _options = options ?? new ImportOptions();
        _log = log ?? (_ => { });
    }

    /// <summary>
    /// Aktif kanonik taksonomiyi TEK sorguda okuyup eşleyiciyi kurar.
    /// </summary>
    /// <remarks>
    /// Nesne başına kategori sorgusu AÇILMAZ: taksonomi küçüktür (bugün 44
    /// satır) ve tamamı bir kez okunur — <c>PoiCategoryService</c> ve
    /// <c>LocationAnalysisService</c> ile aynı kalıp. Pasif/silinmiş
    /// kategoriler global query filter sayesinde kümeye hiç girmez.
    /// </remarks>
    public async Task<OsmCategoryMapper> CreateMapperAsync(CancellationToken cancellationToken = default)
    {
        var taxonomy = await _dbContext.PoiCategories
            .AsNoTracking()
            .Select(category => new { category.Id, category.Slug, category.Name, category.ParentId })
            .ToListAsync(cancellationToken);

        return new OsmCategoryMapper(
            taxonomy.ToDictionary(row => row.Slug, row => row.Id, StringComparer.Ordinal),
            taxonomy.ToDictionary(
                row => row.Id,
                row => new PoiCategoryHierarchy.Node(row.Id, row.Name, row.ParentId)));
    }

    /// <summary>
    /// Özellikleri sırayla işler ve toplu hâlde yazar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Akış korunur.</b> <paramref name="features"/> tembel bir dizidir ve
    /// tamamı belleğe alınmaz; yalnızca bir yığın (batch) kadar satır aynı anda
    /// tutulur.
    /// </para>
    /// <para>
    /// <b>İşlem sınırı YIĞINDIR.</b> Ülke ölçeğinde tek bir dev transaction
    /// açmak, saatler süren bir yazma boyunca tabloyu kilitli tutar ve tek bir
    /// hatada her şeyi geri alırdı. Yığın başına <c>SaveChanges</c>, EF'in
    /// kendi transaction'ı içinde atomiktir: bir yığın ya tamamen yazılır ya
    /// hiç yazılmaz. Yarım kalan bir içe aktarım, tekrar çalıştırıldığında
    /// kaldığı yerden devam eder — çünkü işlem fikir birliği anahtarına göre
    /// idempotenttir.
    /// </para>
    /// </remarks>
    public async Task<ImportStatistics> ImportAsync(
        IEnumerable<OsmSourceFeature> features,
        OsmCategoryMapper mapper,
        ImportStatistics statistics,
        CancellationToken cancellationToken = default)
    {
        var stopwatch = Stopwatch.StartNew();
        var batch = new List<PendingRow>(_options.BatchSize);

        // Tanılama kararı seçeneklerden gelir; istatistik nesnesi onu taşır.
        statistics.DiagnosticsEnabled = _options.MappingDiagnostics;

        foreach (var feature in features)
        {
            cancellationToken.ThrowIfCancellationRequested();

            statistics.Read++;

            if (statistics.Read % _options.ProgressInterval == 0)
            {
                // Her POI değil, sınırlı aralıklarla ilerleme.
                _log($"  … {statistics.Read} eleman okundu, {statistics.Mapped} eşleşti");
            }

            var isArea = feature.Geometry is not Point;
            var match = mapper.Resolve(feature.Tags, isArea);

            if (!match.IsMatch)
            {
                statistics.Skip(match.SkipReason!.Value);

                if (match.SkipReason == ImportSkipReason.AmbiguousMapping)
                {
                    /* Çözülemeyen belirsizlik: eşleme tablosunu düzeltmek için
                       bakılacak ilk nesnelerdir, o yüzden birkaç örnek kimlik
                       saklanır. */
                    statistics.RecordUnresolvedAmbiguity(match.TiedSignature, feature.ExternalId);
                }

                continue;
            }

            statistics.Candidate++;

            if (match.Resolution is { } resolution)
            {
                statistics.AmbiguousResolved++;
                statistics.RecordResolvedAmbiguity(resolution, feature.ExternalId);
            }

            var coordinate = RepresentativePoint(feature.Geometry);

            if (coordinate is null)
            {
                statistics.Skip(ImportSkipReason.InvalidGeometry);
                continue;
            }

            statistics.Mapped++;
            statistics.CountSlug(match.Slug!);

            batch.Add(new PendingRow(
                feature.ExternalId,
                feature.Name,
                mapper.CategoryIdOf(match.Slug!),
                coordinate));

            if (batch.Count >= _options.BatchSize)
            {
                await FlushAsync(batch, statistics, cancellationToken);
                batch.Clear();
            }
        }

        if (batch.Count > 0)
        {
            await FlushAsync(batch, statistics, cancellationToken);
        }

        stopwatch.Stop();
        statistics.Duration = stopwatch.Elapsed;

        return statistics;
    }

    /// <summary>
    /// Bir yığını fikir birliği anahtarına göre ekler/günceller.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Kimlik <c>(Source, ExternalId)</c>'dir</b> ve veritabanında tekil bir
    /// indekstir. Aynı dış nesne ikinci kez içe aktarıldığında YENİ satır
    /// üretilmez; var olan satır güncellenir.
    /// </para>
    /// <para>
    /// Mevcut satırlar yığın başına TEK sorguyla okunur; satır başına sorgu
    /// açmak, aynı cevabı yığın boyu kadar gidiş dönüşle üretirdi.
    /// </para>
    /// </remarks>
    private async Task FlushAsync(
        List<PendingRow> batch,
        ImportStatistics statistics,
        CancellationToken cancellationToken)
    {
        var externalIds = batch.Select(row => row.ExternalId).ToArray();

        var existing = await _dbContext.AnalysisPois
            .Where(poi => poi.Source == OsmCategoryMap.SourceName && externalIds.Contains(poi.ExternalId))
            .ToDictionaryAsync(poi => poi.ExternalId, StringComparer.Ordinal, cancellationToken);

        var importedAt = DateTime.UtcNow;
        var changed = false;

        foreach (var row in batch)
        {
            if (existing.TryGetValue(row.ExternalId, out var stored))
            {
                if (!HasChanges(stored, row))
                {
                    statistics.Unchanged++;
                    continue;
                }

                if (_options.DryRun)
                {
                    statistics.WouldUpdate++;
                    continue;
                }

                stored.Name = row.Name;
                stored.CategoryId = row.CategoryId;
                stored.Coordinate = row.Coordinate;
                stored.ImportedAt = importedAt;
                statistics.Updated++;
                changed = true;

                continue;
            }

            if (_options.DryRun)
            {
                statistics.WouldInsert++;
                continue;
            }

            _dbContext.AnalysisPois.Add(new AnalysisPoi
            {
                Name = row.Name,
                CategoryId = row.CategoryId,
                Coordinate = row.Coordinate,
                Source = OsmCategoryMap.SourceName,
                ExternalId = row.ExternalId,
                ImportedAt = importedAt
            });

            statistics.Inserted++;
            changed = true;
        }

        if (_options.DryRun)
        {
            /* Kuru çalıştırmada okunan varlıklar izlenmeye devam eder; hiçbir
               değişiklik yapılmadığı için temizlemek yalnızca bir tedbirdir. */
            _dbContext.ChangeTracker.Clear();
            return;
        }

        if (changed)
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        // Bir sonraki yığın kendi satırlarını taze okusun.
        _dbContext.ChangeTracker.Clear();
    }

    private static bool HasChanges(AnalysisPoi stored, PendingRow row) =>
        !string.Equals(stored.Name, row.Name, StringComparison.Ordinal)
        || stored.CategoryId != row.CategoryId
        || !stored.Coordinate.EqualsExact(row.Coordinate);

    /// <summary>
    /// Geometrinin TEMSİLÎ noktası.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Nokta zaten noktadır. Alanlar için <b>iç nokta</b> (PointOnSurface)
    /// kullanılır, ağırlık merkezi (centroid) DEĞİL: içbükey bir poligonun,
    /// halka biçimli bir alanın ya da kopuk parçalardan oluşan bir alanın
    /// merkezi, alanın DIŞINA düşebilir — ve o zaman POI, temsil ettiği tesisin
    /// dışında bir yerde görünürdü.
    /// </para>
    /// <para>
    /// Hesap içe aktarıcıda yapılır: yalnızca temsilî nokta üretmek için
    /// PostGIS'e gidip yazmak, geçersiz bir geometrinin veritabanına ulaşması
    /// demek olurdu. Geçersiz poligon burada elenir.
    /// </para>
    /// </remarks>
    internal static Point? RepresentativePoint(Geometry geometry)
    {
        if (geometry is Point point)
        {
            return IsUsable(point) ? Normalize(point) : null;
        }

        if (geometry.IsEmpty || !geometry.IsValid)
        {
            return null;
        }

        var interior = geometry.InteriorPoint;

        return interior is not null && IsUsable(interior) ? Normalize(interior) : null;
    }

    private static bool IsUsable(Point point) =>
        !point.IsEmpty
        && !double.IsNaN(point.X) && !double.IsNaN(point.Y)
        && point.X is >= -180 and <= 180
        && point.Y is >= -90 and <= 90;

    private static Point Normalize(Point point)
    {
        var normalized = Factory.CreatePoint(new Coordinate(point.X, point.Y));
        normalized.SRID = 4326;

        return normalized;
    }

    private sealed record PendingRow(string ExternalId, string? Name, int CategoryId, Point Coordinate);
}
