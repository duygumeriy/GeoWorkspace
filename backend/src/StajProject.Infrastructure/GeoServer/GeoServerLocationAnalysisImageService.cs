using System.Globalization;
using Microsoft.EntityFrameworkCore;
using System.Net.Http.Headers;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using StajProject.Application.Analysis;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Application.Rendering;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Infrastructure.GeoServer;

/// <summary>
/// Analiz POI'lerinin <b>nokta örtüsü</b> rasterini sabit bir WMS GetMap
/// isteğiyle üretir.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu servis ARTIK ısı haritası üretmez.</b> Ağırlıklı yoğunluk yüzeyi
/// <c>LocationAnalysisImageService</c> tarafından sunucuda hesaplanır: ödevin
/// istediği <c>S(x) = Σ w_c · normalize(D_c(x))</c> denklemi ölçüt BAŞINA
/// normalleştirme gerektirir ve <c>vec:Heatmap</c> bunu tek bir istekte ne
/// hesaplayabilir ne ifade edebilir (gerekçe:
/// <see cref="StajProject.Application.Analysis.LocationAnalysisHeatmapRenderer"/>).
/// Burada kalan iş bir HESAP değil bir SUNUMdur — kategori işaretleri, ölçek
/// bantları, etiket çakışma çözümü — ve GeoServer onu zaten doğru yapıyor.
/// </para>
/// <para>
/// <b>İstemciden gelen hiçbir metin GeoServer parametresine girmez.</b>
/// Katman, style, CRS ve format sunucuya aittir; <c>CQL_FILTER</c>'ın kategori
/// kısmı veritabanından okunan <c>int</c> kimliklerden, alan kısmı ise
/// <c>WktGeometryParser</c>'dan geçmiş ve yeniden ÜRETİLMİŞ bir geometriden
/// gelir — istemcinin gönderdiği WKT metni olduğu gibi iletilmez.
/// </para>
/// <para>
/// <b>Coğrafi yetki BURADA da denetlenir</b> (bkz. <c>_areaGuard</c>): örtü de
/// bir cevaptır ve yetkisiz bir alanın noktalarını görüntü olarak sızdıramaz.
/// </para>
/// </remarks>
public sealed class GeoServerLocationAnalysisImageService : ILocationAnalysisPointsImageService
{
    /// <summary>
    /// Görüntü penceresinin CRS'i — analiz alanıyla <b>aynı</b> datum, kanonik
    /// <c>boylam,enlem</c> sırasıyla: <c>CRS:84</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Mevcut çizim uçlarından farklıdır ve bilinçlidir.</b> Çizim ısı
    /// haritası ve harita sunumu EPSG:3857 pencereler alır; burada hem analiz
    /// alanı (<c>AreaWkts</c>) hem yayımlanan katman (<c>analysis_poi_read</c>)
    /// EPSG:4326'dır, dolayısıyla istek tek bir CRS ile ifade edilir ve
    /// istemcinin aynı istek içinde iki farklı koordinat sistemi taşıması
    /// gerekmez.
    /// </para>
    /// <para>
    /// <b>Burada EPSG:4326 KULLANILAMAZ ve bu ölçülmüştür.</b> WMS 1.3.0 o kodu
    /// <c>enlem,boylam</c> okur ve GeoServer pencereyi <c>wms_bbox</c>'a aynı
    /// sırayla koyar; o pencereye bağlı bir stil zarfın X'ini doğu-batı sanar
    /// ve DEVRİK bir görüntü üretir — leke her kaydırma ve yakınlaştırmada
    /// başka bir coğrafyaya taşınır. Gerçek veriyle (Ankara, 7853 satır)
    /// ölçüldü: geniş pencerede leke 143 km doğu / 118 km güneyde, dar
    /// pencerede neredeyse yerinde çıktı — hata pencereye bağlıdır. Kural,
    /// stile bağlı olmayan bu uçta da KORUNUR: analiz penceresi tek bir yerde,
    /// eksen sırası belirsiz olmayan kodla ifade edilir.
    /// </para>
    /// <para>
    /// <c>CRS:84</c> aynı isteği kanonik <c>boylam,enlem</c> yapar ve leke her
    /// düzeyde gerçek veriye oturur. <b>Taşıma kuralı kaldırılmadı</b>:
    /// <see cref="WmsBboxFormatter"/> EPSG:4326 için enlem-önce yazmayı
    /// sürdürür; yalnızca bu uç, stili <c>wms_bbox</c>'a bağlı OLDUĞU için
    /// eksen sırası belirsiz olmayan kodu kullanır.
    /// </para>
    /// </remarks>
    private const string TargetCrs = WmsRenderContract.Crs.Wgs84LonLat;

    private const string WmsVersion = WmsRenderContract.WmsVersion.V130;

    /// <summary>SQL View'ın geometri kolonu.</summary>
    private const string GeometryAttribute = "coordinate";

    /// <summary>SQL View'ın kategori kolonu.</summary>
    private const string CategoryAttribute = "category_id";

    private const string PngMediaType = "image/png";
    private static readonly byte[] PngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

    private readonly HttpClient _httpClient;
    private readonly GeoServerOptions _options;
    private readonly AppDbContext _dbContext;
    private readonly ILocationAnalysisAreaGuard _areaGuard;
    private readonly ILogger<GeoServerLocationAnalysisImageService> _logger;

    public GeoServerLocationAnalysisImageService(
        HttpClient httpClient,
        GeoServerOptions options,
        AppDbContext dbContext,
        ILocationAnalysisAreaGuard areaGuard,
        ILogger<GeoServerLocationAnalysisImageService> logger)
    {
        _httpClient = httpClient;
        _options = options;
        _dbContext = dbContext;
        _areaGuard = areaGuard;
        _logger = logger;
    }

    public async Task<ServiceResult<LocationAnalysisImage>> RenderAsync(
        LocationAnalysisImageRequest request,
        CancellationToken cancellationToken,
        LocationAnalysisImageKind kind = LocationAnalysisImageKind.Points)
    {
        if (request is null)
        {
            return Fail("İstek gövdesi zorunludur.");
        }

        /* Saf doğrulamalar ÖNCE ve İKİSİ de: analiz tanımı ile görüntü
           penceresi. Geçersiz bir istek ne veritabanına ne GeoServer'a
           ulaşır. Analiz kuralları ÖZET ucuyla AYNI doğrulayıcıdan geçer —
           ikinci bir kopya yazılmaz. */
        var validated = LocationAnalysisValidator.Validate(request);

        if (!validated.IsSuccess)
        {
            return Fail(validated.Error!);
        }

        /* CRS doğrulamaya VERİLİR. Verilmezse sınırlar Web Mercator'a göre
           denetlenir ve 32.74/39.84 gibi bir EPSG:4326 pencere sessizce
           geçerdi — ölçülen hata tam olarak buydu. */
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

        /* Raster da bir CEVAPTIR: yetkisiz bir alanın yoğunluk görüntüsüne
           erişebilmek, sayıya erişemeyen birinin aynı bilgiyi resim olarak
           almasına izin vermek olurdu. */
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

        /* --- Tek ölçütlü görünüm ---------------------------------------------
           Ölçüt seçiliyse yalnızca ONUN kapsadığı kategoriler çizilir. Örtü ile
           ısı haritası aynı ölçüt alanını okur, dolayısıyla iki katman her
           zaman aynı kümeyi gösterir. */
        var focus = request.CriterionSlug?.Trim();
        var categoryIds = resolution.Value!.MatchedCategoryIds;

        if (!string.IsNullOrEmpty(focus))
        {
            if (!analysis.Criteria.Any(criterion =>
                    string.Equals(criterion.CategorySlug, focus, StringComparison.Ordinal)))
            {
                /* Gönderilen ölçütlerden biri DEĞİLSE reddedilir: bu alan
                   analizin kapsamını genişletmek için kullanılamaz. */
                return Fail("criterionSlug, gönderilen ölçütlerden biri olmalıdır.");
            }

            categoryIds = [.. resolution.Value!.CriterionByCategoryId
                .Where(pair => string.Equals(pair.Value, focus, StringComparison.Ordinal))
                .Select(pair => pair.Key)];

            if (categoryIds.Count == 0)
            {
                return Fail("Seçilen ölçüt hiçbir kategoriyi kapsamıyor.");
            }
        }

        var validatedRender = render.Value!;

        var parameters = new Dictionary<string, string>
        {
            ["SERVICE"] = "WMS",
            ["VERSION"] = WmsVersion,
            ["REQUEST"] = "GetMap",
            ["LAYERS"] = $"{_options.Workspace}:{_options.AnalysisPoiLayer}",
            ["STYLES"] = _options.AnalysisPoiPointStyle,
            ["CRS"] = TargetCrs,
            /* Biçimlendirici YİNE DE çağrılır: eksen sırası kararı tek bir
               yerde kalır. CRS:84 için kanonik XY döner — takas yok. */
            ["BBOX"] = WmsBboxFormatter.Format(WmsVersion, TargetCrs, validatedRender),
            ["WIDTH"] = validatedRender.Width.ToString(CultureInfo.InvariantCulture),
            ["HEIGHT"] = validatedRender.Height.ToString(CultureInfo.InvariantCulture),
            ["FORMAT"] = PngMediaType,
            ["TRANSPARENT"] = "true",
            /* Süzgeç, özetin ve ısı haritasının kullandığı YÜKLEMİN CQL
               karşılığıdır: örtüdeki noktalar, sayılan ve ısıtılan kümenin
               birebir aynısıdır. */
            ["CQL_FILTER"] = BuildCqlFilter(analysis.Target, categoryIds)
        };

        using var content = new FormUrlEncodedContent(parameters);
        using var requestMessage = new HttpRequestMessage(
            HttpMethod.Post,
            new Uri($"{_options.BaseUrl.TrimEnd('/')}/wms", UriKind.Absolute))
        {
            Content = content
        };

        HttpResponseMessage response;

        try
        {
            response = await _httpClient.SendAsync(
                requestMessage,
                HttpCompletionOption.ResponseHeadersRead,
                cancellationToken);
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            _logger.LogError("GeoServer konum analizi isteği zaman aşımına uğradı.");
            return ServiceResult<LocationAnalysisImage>.Timeout(
                "GeoServer konum analizi isteği zaman aşımına uğradı.");
        }
        catch (HttpRequestException exception)
        {
            _logger.LogError(exception, "GeoServer konum analizi isteğine ulaşılamadı.");
            return ServiceResult<LocationAnalysisImage>.Upstream(
                "GeoServer konum analizi servisine ulaşılamadı.");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError(
                    "GeoServer konum analizi isteği başarısız. StatusCode: {StatusCode}",
                    (int)response.StatusCode);

                return ServiceResult<LocationAnalysisImage>.Upstream(
                    "GeoServer konum analizi görüntüsü üretilemedi.");
            }

            /* GeoServer hatayı 200 + XML olarak da döndürebilir. İçerik türü VE
               PNG imzası birlikte denetlenir; bir ServiceExceptionReport asla
               image/png diye istemciye iletilmez. */
            if (!IsPng(response.Content.Headers.ContentType))
            {
                _logger.LogError(
                    "GeoServer konum analizi yanıt türü geçersiz. ContentType: {ContentType}",
                    response.Content.Headers.ContentType?.ToString() ?? "(missing)");

                return ServiceResult<LocationAnalysisImage>.Upstream(
                    "GeoServer geçerli bir PNG yanıtı döndürmedi.");
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);

            if (!bytes.AsSpan().StartsWith(PngSignature))
            {
                _logger.LogError("GeoServer konum analizi yanıtında PNG imzası bulunamadı.");

                return ServiceResult<LocationAnalysisImage>.Upstream(
                    "GeoServer geçerli bir PNG yanıtı döndürmedi.");
            }

            /* BOŞ SONUÇ BİR HATA DEĞİLDİR. Seçilen alanda hiç eşleşen POI
               yoksa GeoServer tamamen saydam ama geçerli bir PNG döndürür ve
               bu 200 ile iletilir: "burada aradığın kategorilerden yok" da
               analizin geçerli bir cevabıdır. */
            return ServiceResult<LocationAnalysisImage>.Success(
                new LocationAnalysisImage { Content = bytes });
        }
    }

    /// <summary>
    /// Sunucunun ürettiği süzgeç: <b>kategori kümesi</b> ve <b>hedef alan</b>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// Özet ucundaki iki yüklemin CQL karşılığıdır ve aynı sırayla yazılır:
    /// önce kategori, sonra alan. Kimlikler <c>int</c> olarak biçimlenir —
    /// dizge birleştirmeye giren kullanıcı metni YOKTUR.
    /// </para>
    /// <para>
    /// Alan geometrisi doğrulanmış hedeften yeniden YAZILIR
    /// (<see cref="WKTWriter"/>); istemcinin gönderdiği ham WKT metni
    /// GeoServer'a hiçbir zaman ulaşmaz.
    /// </para>
    /// </remarks>
    private static string BuildCqlFilter(Geometry target, IReadOnlyCollection<int> categoryIds)
    {
        var ids = string.Join(
            ',',
            categoryIds.OrderBy(id => id).Select(id => id.ToString(CultureInfo.InvariantCulture)));

        var wkt = new WKTWriter().Write(target);

        return $"{CategoryAttribute} IN ({ids}) AND INTERSECTS(\"{GeometryAttribute}\",{wkt})";
    }

    private static ServiceResult<LocationAnalysisImage> Fail(string error) =>
        ServiceResult<LocationAnalysisImage>.Failure(error);

    private static bool IsPng(MediaTypeHeaderValue? contentType) =>
        string.Equals(contentType?.MediaType, PngMediaType, StringComparison.OrdinalIgnoreCase);
}
