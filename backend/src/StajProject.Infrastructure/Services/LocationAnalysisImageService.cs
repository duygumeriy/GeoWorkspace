using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StajProject.Application.Analysis;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Application.Rendering;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// Konum analizinin ağırlıklı ısı haritasını <b>sunucuda</b> üretir.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden GeoServer değil.</b> Ödevin istediği yüzey
/// <c>S(x) = Σ w_c · normalize(D_c(x))</c>'tir: her ölçütün yoğunluk yüzeyi
/// ÖNCE kendi en yükseğine göre 0–1'e çekilir, ağırlıklar SONRA uygulanır.
/// <c>vec:Heatmap</c> bütün kayıtlar üzerinde tek geçiş yapar ve yalnızca
/// sonuç yüzeyini normalleştirir; ölçüt başına bir en yüksek değer o sürecin
/// içinde ne hesaplanabilir ne ifade edilebilir. Gerekçenin tamamı ve
/// reddedilen alternatifler <see cref="LocationAnalysisHeatmapRenderer"/>
/// belgesindedir.
/// </para>
/// <para>
/// <b>Nokta örtüsünün rasteri GeoServer'da KALIR.</b> O görüntü bir yoğunluk
/// hesabı değil, bir SUNUMdur (kategori simgeleri, ölçek bantları, etiket
/// çakışma çözümü) ve GeoServer onu zaten doğru yapıyor. Bu servis o çağrıyı
/// olduğu gibi iç servise devreder; ikisi de aynı sözleşmenin
/// (<see cref="ILocationAnalysisImageService"/>) arkasındadır.
/// </para>
/// <para>
/// <b>Veri kümesi özet ucuyla AYNIDIR.</b> Noktalar
/// <see cref="LocationAnalysisService.Matching"/> ile okunur — yani
/// <c>analysis_poi_union</c>: açık veri + aktif ve silinmemiş uygulama
/// POI'leri. Raster, özetin saydığı kümenin BİREBİR aynısını çizer;
/// kullanıcının kendi eklediği bir POI sayıya girip ısıya girmemesi mümkün
/// değildir.
/// </para>
/// <para>
/// <b>Coğrafi yetki BURADA da denetlenir.</b> Bir raster da bir cevaptır:
/// sayıya erişemeyen birinin aynı bilgiyi görüntü olarak alabilmesi, kuralı
/// yalnızca bir uçta uygulamak olurdu.
/// </para>
/// </remarks>
public sealed class LocationAnalysisImageService : ILocationAnalysisImageService
{
    /// <summary>
    /// Analizin görüntü penceresinin CRS'i: kanonik <c>boylam,enlem</c>.
    /// </summary>
    /// <remarks>
    /// <b>Sözleşme KORUNUR.</b> Pencere, analiz alanıyla aynı datumda
    /// (WGS84) ve eksen sırası belirsiz OLMAYAN kodla ifade edilir. WMS
    /// 1.3.0'ın <c>EPSG:4326</c>'yı <c>enlem,boylam</c> okuması bu projede
    /// ölçülmüş ve rasteri devrik çizdiren hataydı; istemci hâlâ CRS:84
    /// gönderir, doğrulama hâlâ CRS:84'e göre yapılır ve raster hâlâ
    /// <c>ImageStatic</c> ile EPSG:4326 kapsamına oturur.
    /// </remarks>
    private const string TargetCrs = WmsRenderContract.Crs.Wgs84LonLat;

    /// <summary>
    /// Rasterlenebilecek en fazla nokta.
    /// </summary>
    /// <remarks>
    /// <b>Kesme YAPILMAZ, REDDEDİLİR.</b> Kesilmiş bir nokta kümesiyle
    /// çizilen yoğunluk yüzeyi sessizce YANLIŞ olurdu: eksik kalan noktalar
    /// yalnızca kendi bölgelerini soğutmakla kalmaz, ölçüt başına en yüksek
    /// değeri de değiştirdiği için bütün görüntünün ölçeğini kaydırır.
    /// Sınır, nokta listesi ucundan (5.000) çok daha yüksektir çünkü burada
    /// satır başına yalnızca üç sayı taşınır ve hiçbiri istemciye gitmez.
    /// </remarks>
    internal const int MaxPoints = 200_000;

    /// <summary>
    /// Tek bir görüntü için harcanabilecek en fazla çekirdek hücresi.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Nokta sayısı tek başına maliyeti anlatmaz.</b> İş, nokta sayısı ile
    /// çekirdeğin ALANI çarpımıdır ve alan yarıçapın KARESİYLE büyür. İki
    /// büyüklük pratikte ters yönde hareket eder — çok nokta geniş bir alan
    /// demektir, geniş alan ise metre/piksel'i büyütüp yarıçapı küçültür —
    /// ama bu bir GÜVENCE değil, bir eğilimdir: dar bir alanı çok yüksek
    /// çözünürlükte isteyen bir istemci ikisini birden büyütmeye çalışabilir.
    /// </para>
    /// <para>
    /// Sınır bu yüzden doğrudan İŞE konur. 400 milyon hücre, ölçülen makinede
    /// birkaç saniyelik bir üst sınırdır ve gerçek kullanımın çok üstündedir:
    /// Ankara'nın tamamı iki kök ölçütle ~3,8 milyon hücre eder.
    /// </para>
    /// </remarks>
    internal const long MaxKernelCells = 400_000_000;

    private readonly AppDbContext _dbContext;
    private readonly ILocationAnalysisAreaGuard _areaGuard;
    private readonly ILocationAnalysisPointsImageService _pointsImageService;
    private readonly GeoServerOptions _options;
    private readonly ILogger<LocationAnalysisImageService> _logger;

    public LocationAnalysisImageService(
        AppDbContext dbContext,
        ILocationAnalysisAreaGuard areaGuard,
        ILocationAnalysisPointsImageService pointsImageService,
        GeoServerOptions options,
        ILogger<LocationAnalysisImageService> logger)
    {
        _dbContext = dbContext;
        _areaGuard = areaGuard;
        _pointsImageService = pointsImageService;
        _options = options;
        _logger = logger;
    }

    public async Task<ServiceResult<LocationAnalysisImage>> RenderAsync(
        LocationAnalysisImageRequest request,
        CancellationToken cancellationToken,
        LocationAnalysisImageKind kind = LocationAnalysisImageKind.WeightedHeatmap)
    {
        if (kind == LocationAnalysisImageKind.Points)
        {
            return await _pointsImageService.RenderAsync(request, cancellationToken, kind);
        }

        if (request is null)
        {
            return Fail("İstek gövdesi zorunludur.");
        }

        /* Saf doğrulamalar ÖNCE ve İKİSİ de: analiz tanımı ile görüntü
           penceresi. Analiz kuralları ÖZET ucuyla AYNI doğrulayıcıdan geçer —
           ikinci bir kopya yazılmaz. */
        var validated = LocationAnalysisValidator.Validate(request);

        if (!validated.IsSuccess)
        {
            return Fail(validated.Error!);
        }

        /* CRS doğrulamaya VERİLİR. Verilmezse sınırlar Web Mercator'a göre
           denetlenir ve 32.74/39.84 gibi bir coğrafi pencere sessizce geçerdi. */
        var render = WmsRenderContract.Validate(
            request.Bbox,
            request.Width,
            request.Height,
            request.PixelRatio,
            TargetCrs);

        if (!render.IsSuccess)
        {
            return Fail(render.Error!);
        }

        var analysis = validated.Value!;

        if (!LocationAnalysisHeatmapLods.TryResolve(request.HeatmapLod, out var heatmapLod))
        {
            return Fail("heatmapLod; far, medium, near veya very_near olmalıdır.");
        }

        var authorized = await _areaGuard.AuthorizeAsync(
            analysis.Target,
            analysis.AdministrativeTargetType,
            analysis.AdministrativeTargetKey,
            cancellationToken);

        if (!authorized.IsSuccess)
        {
            return ServiceResult<LocationAnalysisImage>.Forbidden(authorized.Error!);
        }

        var resolution = await new LocationAnalysisCriterionResolver(_dbContext)
            .ResolveAsync(analysis.Criteria, cancellationToken);

        if (!resolution.IsSuccess)
        {
            return Fail(resolution.Error!);
        }

        var scope = resolution.Value!;

        /* --- Görünüm seçimi ---------------------------------------------------
           Boş `criterionSlug` → ağırlıklı BİRLEŞİK yüzey.
           Dolu → yalnızca o ölçütün SAF yoğunluğu: tek yüzey, ağırlık 1, yani
           N_c'nin kendisi. "Bu kategori nerede yoğun" sorusunu birleşik yüzey
           yanıtlayamaz. */
        var focus = request.CriterionSlug?.Trim();

        if (!string.IsNullOrEmpty(focus)
            && !analysis.Criteria.Any(criterion =>
                string.Equals(criterion.CategorySlug, focus, StringComparison.Ordinal)))
        {
            /* Gönderilen ölçütlerden biri DEĞİLSE reddedilir: bu alan analizin
               kapsamını genişletmek için kullanılamaz. */
            return Fail("criterionSlug, gönderilen ölçütlerden biri olmalıdır.");
        }

        var criteria = string.IsNullOrEmpty(focus)
            ? analysis.Criteria
            : [.. analysis.Criteria.Where(criterion =>
                string.Equals(criterion.CategorySlug, focus, StringComparison.Ordinal))];

        /* Ölçüt sırası HER ŞEYİ bağlar: ağırlık dizisinin indeksi, noktanın
           `CriterionIndex`'i ve kullanıcının panelde gördüğü satır aynı
           sıradır. */
        var indexBySlug = criteria
            .Select((criterion, index) => (criterion.CategorySlug, index))
            .ToDictionary(pair => pair.CategorySlug, pair => pair.index, StringComparer.Ordinal);

        var indexByCategoryId = new Dictionary<int, int>();

        foreach (var pair in scope.CriterionByCategoryId)
        {
            if (indexBySlug.TryGetValue(pair.Value, out var index))
            {
                indexByCategoryId[pair.Key] = index;
            }
        }

        if (indexByCategoryId.Count == 0)
        {
            return Fail("Seçilen ölçüt hiçbir kategoriyi kapsamıyor.");
        }

        /* Tek ölçütlü görünümde ağırlık ETKİSİZDİR (tek yüzey, tek ölçek);
           yine de 1 verilir, böylece yüzey 0–1 aralığında kalır ve rampanın
           anlamı iki görünümde de aynıdır. */
        var weights = string.IsNullOrEmpty(focus)
            ? criteria
                .Select(criterion => (double)criterion.Weight / LocationAnalysisValidator.RequiredWeightTotal)
                .ToArray()
            : [1.0];

        var categoryIds = indexByCategoryId.Keys.ToArray();
        var matching = LocationAnalysisService.Matching(_dbContext, analysis.Target, categoryIds);

        var total = await matching.CountAsync(cancellationToken);

        if (total > MaxPoints)
        {
            _logger.LogWarning(
                "Konum analizi rasteri için nokta sayısı sınırı aşıldı. Bulunan: {Total}, sınır: {Limit}.",
                total,
                MaxPoints);

            return Fail(
                $"Seçilen alan ve ölçütler {total:N0} kayıt kapsıyor; "
                + $"tek bir görüntü en fazla {MaxPoints:N0} kayıt işleyebilir. Daha dar bir alan seçin.");
        }

        /* Yalnızca üç kolon taşınır: geometri nesnesi kurulmaz, ad ve kategori
           yolu okunmaz. Raster için gereken tek şey konum ve ölçüttür. */
        var rows = await matching
            .Select(poi => new
            {
                poi.CategoryId,
                Longitude = poi.Coordinate.X,
                Latitude = poi.Coordinate.Y
            })
            .ToListAsync(cancellationToken);

        var points = new List<LocationAnalysisHeatmapPoint>(rows.Count);

        foreach (var row in rows)
        {
            if (indexByCategoryId.TryGetValue(row.CategoryId, out var index))
            {
                points.Add(new LocationAnalysisHeatmapPoint(row.Longitude, row.Latitude, index));
            }
        }

        var validatedRender = render.Value!;

        var kernel = LocationAnalysisHeatmapRenderer.ResolveKernel(
            validatedRender,
            LocationAnalysisHeatmapLods.RadiusMeters(
                heatmapLod,
                _options.AnalysisHeatmapRadiusMeters));

        var cells = (long)points.Count
            * (long)Math.Ceiling(4 * kernel.RadiusPixelsX * kernel.RadiusPixelsY);

        if (cells > MaxKernelCells)
        {
            _logger.LogWarning(
                "Konum analizi rasterinin iş yükü sınırı aşıldı. Hücre: {Cells}, sınır: {Limit}.",
                cells,
                MaxKernelCells);

            return Fail(
                "Seçilen alan ve çözünürlük bu ölçüt kümesi için fazla yoğun. "
                + "Daha dar bir alan seçin.");
        }

        var surface = LocationAnalysisHeatmapRenderer.BuildSurface(
            validatedRender,
            points,
            weights,
            kernel);

        /* BOŞ SONUÇ BİR HATA DEĞİLDİR. Alanda eşleşen kayıt yoksa yüzey
           tamamen sıfırdır ve tamamen saydam ama geçerli bir PNG döner:
           "burada aradığın kategorilerden yok" da analizin geçerli bir
           cevabıdır. */
        return ServiceResult<LocationAnalysisImage>.Success(
            new LocationAnalysisImage
            {
                Content = LocationAnalysisHeatmapRenderer.RenderPng(surface)
            });
    }

    private static ServiceResult<LocationAnalysisImage> Fail(string error) =>
        ServiceResult<LocationAnalysisImage>.Failure(error);
}
