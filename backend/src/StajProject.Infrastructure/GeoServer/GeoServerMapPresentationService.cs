using System.Globalization;
using System.Net.Http.Headers;
using Microsoft.Extensions.Logging;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Application.Rendering;
using StajProject.Domain.Common;

namespace StajProject.Infrastructure.GeoServer;

/// <summary>
/// Kalıcı çizimlerin normal görünümünü tek bir sabit WMS GetMap isteğiyle
/// üretir.
/// </summary>
/// <remarks>
/// <para>
/// <b>Tür başına tek katman.</b> Üç katman tek bir istekte birleştirilmez.
/// Çok katmanlı bir WMS isteğinde <c>CQL_FILTER</c>'ın katmanlara nasıl
/// dağıtıldığı sunucu sürümüne bağlıdır; tek filtrenin sessizce yalnızca ilk
/// katmana uygulandığı bir durumda diğer iki katman FİLTRESİZ dönerdi — yani
/// başka kullanıcıların çizimleri görüntüye girerdi. Tek katmanlı istekte bu
/// belirsizlik yapısal olarak yoktur: bir istek, bir katman, bir filtre.
/// Katmanların üst üste gelme sırası tarayıcıda z-index ile kurulur.
/// </para>
/// <para>
/// <b>İstemci hiçbir katalog adını belirlemez.</b> <paramref name="kind"/>
/// controller'ın sabit action'ından gelir ve burada backend'in kendi ayarına
/// çevrilir; layer, style, workspace, format ve CRS istemciye hiç sorulmaz.
/// </para>
/// <para>
/// <b>Coğrafi kapsam bilinçli olarak UYGULANMAZ.</b> Normal çizim okuması
/// sahiplik/durum filtrelidir ama coğrafi kapsam filtreli DEĞİLDİR — mevcut
/// WFS okumasının anlamı budur ve sunum katmanı onu birebir izler. Coğrafi
/// kapsam yalnızca ısı haritası analizinin sorusudur.
/// </para>
/// </remarks>
public sealed class GeoServerMapPresentationService : IGeoServerMapPresentationService
{
    private const string TargetCrs = "EPSG:3857";
    private const string PngMediaType = "image/png";
    private static readonly byte[] PngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

    private readonly HttpClient _httpClient;
    private readonly GeoServerOptions _options;
    private readonly ICurrentUserService _currentUser;
    private readonly ILogger<GeoServerMapPresentationService> _logger;

    public GeoServerMapPresentationService(
        HttpClient httpClient,
        GeoServerOptions options,
        ICurrentUserService currentUser,
        ILogger<GeoServerMapPresentationService> logger)
    {
        _httpClient = httpClient;
        _options = options;
        _currentUser = currentUser;
        _logger = logger;
    }

    public async Task<ServiceResult<MapPresentationImage>> GetPresentationAsync(
        DrawingKind kind,
        MapPresentationRequest request,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return ServiceResult<MapPresentationImage>.Failure("Harita sunum parametreleri zorunludur.");
        }

        var render = WmsRenderContract.Validate(request.Bbox, request.Width, request.Height);

        if (!render.IsSuccess)
        {
            return ServiceResult<MapPresentationImage>.Failure(render.Error!);
        }

        var userId = _currentUser.UserId;

        if (!_currentUser.IsAuthenticated || userId is null)
        {
            return ServiceResult<MapPresentationImage>.Forbidden(
                "Kimliği doğrulanmış kullanıcı çözümlenemedi.");
        }

        var (layer, style) = Resources(kind);

        return await RequestImageAsync(
            layer,
            style,
            /* Sahiplik/durum yüklemi. userId doğrulanmış backend bağlamından
               gelen bir int'tir; istemciden gelen hiçbir metin bu filtreye
               eklenmez. */
            BuildCqlFilter(userId.Value),
            render.Value!,
            $"DrawingKind: {kind}",
            cancellationToken);
    }

    /// <summary>
    /// POI envanterinin haritadaki genel gösterimi.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>CQL filtresi YOKTUR ve olmamalıdır.</b> Çizim sunumu kişinin KENDİ
    /// kayıtlarını gösterir ve bu yüzden sahiplik yüklemi taşır; POI ise
    /// <c>poi.view</c> taşıyan herkese açık ORTAK envanterdir —
    /// <c>PoiService.GetMapPoisAsync</c> de sahiplik yüklemi uygulamaz ve iki
    /// yolun aynı şeyi göstermesi gerekir. Silinmiş/pasif POI ve kategori
    /// elemesi <c>poi_read</c> SQL View'ının içindedir, dolayısıyla burada
    /// tekrar edilmesine de gerek yoktur.
    /// </para>
    /// <para>
    /// <b>Coğrafi kapsam da UYGULANMAZ</b> — POI okuma yolunda hiç
    /// uygulanmıyor; kapsam yalnızca YAZMA anının kuralıdır
    /// (<c>PoiService</c> create/move). Burada uygulamak, kullanıcının REST
    /// üzerinden görebildiği bir POI'nin haritada görünmemesi demek olurdu.
    /// </para>
    /// </remarks>
    public async Task<ServiceResult<MapPresentationImage>> GetPoiPresentationAsync(
        MapPresentationRequest request,
        CancellationToken cancellationToken)
    {
        if (request is null)
        {
            return ServiceResult<MapPresentationImage>.Failure("Harita sunum parametreleri zorunludur.");
        }

        /* Piksel oranı YALNIZCA POI yolunda okunur. Çizim sunumunda geometrinin
           kendisi coğrafidir ve ölçekten bağımsız aynı alanı kaplar; POI ise
           tamamen piksel tanımlı bir SEMBOLDÜR ve yoğunluk düzeltmesi olmadan
           küçülür. Çizim isteklerinin sorgusu bu yüzden birebir aynı kalır. */
        var render = WmsRenderContract.Validate(
            request.Bbox,
            request.Width,
            request.Height,
            request.PixelRatio);

        if (!render.IsSuccess)
        {
            return ServiceResult<MapPresentationImage>.Failure(render.Error!);
        }

        return await RequestImageAsync(
            _options.PoiLayer,
            _options.PoiStyle,
            cqlFilter: null,
            render.Value!,
            "Poi",
            cancellationToken);
    }

    /// <summary>
    /// WMS <c>GetMap</c> isteğinin TEK gövdesi: parametre kurulumu, gönderim,
    /// hata çevirisi ve PNG doğrulaması.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Katman ve style ÇAĞIRANDAN gelir, istekten değil.</b> İkisi de
    /// backend'in kendi ayarından okunur; istemcinin gönderdiği hiçbir metin bu
    /// parametrelere ulaşamaz. Aynı şekilde SERVICE, REQUEST, VERSION, CRS,
    /// FORMAT ve TRANSPARENT burada sabittir.
    /// </para>
    /// <para>
    /// <b>Sorgu dizesi ASLA istemciden kopyalanmaz</b> — parametreler tek tek
    /// ve açıkça kurulur, böylece tanınmayan bir anahtar GeoServer'a hiçbir
    /// yoldan geçemez.
    /// </para>
    /// </remarks>
    private async Task<ServiceResult<MapPresentationImage>> RequestImageAsync(
        string layer,
        string style,
        string? cqlFilter,
        ValidatedRender validated,
        string logContext,
        CancellationToken cancellationToken)
    {
        var parameters = new Dictionary<string, string>
        {
            ["SERVICE"] = "WMS",
            ["VERSION"] = "1.3.0",
            ["REQUEST"] = "GetMap",
            ["LAYERS"] = $"{_options.Workspace}:{layer}",
            ["STYLES"] = style,
            ["CRS"] = TargetCrs,
            ["BBOX"] = validated.Bbox,
            ["WIDTH"] = validated.Width.ToString(CultureInfo.InvariantCulture),
            ["HEIGHT"] = validated.Height.ToString(CultureInfo.InvariantCulture),
            ["FORMAT"] = PngMediaType,
            ["TRANSPARENT"] = "true"
        };

        // Filtresi olmayan sunum (POI) için anahtar HİÇ eklenmez.
        if (cqlFilter is not null)
        {
            parameters["CQL_FILTER"] = cqlFilter;
        }

        /* Çizim DPI'ı SUNUCUDA türetilir ve yalnızca yoğunluk bildirilmişse
           eklenir. İstemci FORMAT_OPTIONS'ı ne gönderebilir ne etkileyebilir:
           gönderdiği tek şey doğrulanmış bir sayıdır ve bu sözlük her istekte
           sıfırdan kurulur. */
        if (validated.RendererDpi is { } dpi)
        {
            parameters["FORMAT_OPTIONS"] = string.Create(CultureInfo.InvariantCulture, $"dpi:{dpi}");
        }

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
            _logger.LogError("GeoServer sunum isteği zaman aşımına uğradı. {LogContext}", logContext);
            return ServiceResult<MapPresentationImage>.Timeout(
                "GeoServer harita sunum isteği zaman aşımına uğradı.");
        }
        catch (HttpRequestException exception)
        {
            _logger.LogError(exception, "GeoServer sunum isteğine ulaşılamadı. {LogContext}", logContext);
            return ServiceResult<MapPresentationImage>.Upstream("GeoServer harita sunum servisine ulaşılamadı.");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError(
                    "GeoServer sunum isteği başarısız. {LogContext}, StatusCode: {StatusCode}",
                    logContext,
                    (int)response.StatusCode);
                return ServiceResult<MapPresentationImage>.Upstream("GeoServer harita görüntüsü üretilemedi.");
            }

            if (!IsPng(response.Content.Headers.ContentType))
            {
                _logger.LogError(
                    "GeoServer sunum yanıt türü geçersiz. {LogContext}, ContentType: {ContentType}",
                    logContext,
                    response.Content.Headers.ContentType?.ToString() ?? "(missing)");
                return ServiceResult<MapPresentationImage>.Upstream(
                    "GeoServer geçerli bir PNG yanıtı döndürmedi.");
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);

            /* Boş/şeffaf bir PNG UYDURULMAZ: yukarı akış hatası, "hiç kayıt yok"
               ile aynı görüntüye indirgenirse kullanıcı verisinin kaybolduğunu
               fark edemez. Geçersiz yanıt hata olarak yukarı çıkar. */
            if (!bytes.AsSpan().StartsWith(PngSignature))
            {
                _logger.LogError(
                    "GeoServer sunum yanıtında PNG imzası bulunamadı. {LogContext}",
                    logContext);
                return ServiceResult<MapPresentationImage>.Upstream(
                    "GeoServer geçerli bir PNG yanıtı döndürmedi.");
            }

            return ServiceResult<MapPresentationImage>.Success(new MapPresentationImage { Content = bytes });
        }
    }

    /// <summary>
    /// Geometry türü → backend'in kendi katman ve style adı. İstemciden gelen
    /// hiçbir metin bu eşlemeye giremez.
    /// </summary>
    private (string Layer, string Style) Resources(DrawingKind kind) => kind switch
    {
        DrawingKind.Point => (_options.PointLayer, _options.PointPresentationStyle),
        DrawingKind.Line => (_options.LineLayer, _options.LinePresentationStyle),
        DrawingKind.Polygon => (_options.PolygonLayer, _options.PolygonPresentationStyle),
        _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Bilinmeyen çizim türü.")
    };

    /// <summary>
    /// Normal WFS okumasıyla BİREBİR aynı sahiplik/durum yüklemi. userId
    /// doğrulanmış backend bağlamından gelen bir int'tir; istemciden gelen
    /// hiçbir metin bu filtreye eklenmez.
    /// </summary>
    private static string BuildCqlFilter(int userId) => string.Create(
        CultureInfo.InvariantCulture,
        $"inserted_user_id={userId} AND is_deleted=false AND is_active=true");

    private static bool IsPng(MediaTypeHeaderValue? contentType) =>
        string.Equals(contentType?.MediaType, PngMediaType, StringComparison.OrdinalIgnoreCase);
}
