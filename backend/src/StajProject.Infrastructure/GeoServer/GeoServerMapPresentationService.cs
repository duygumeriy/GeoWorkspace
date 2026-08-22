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
        var validated = render.Value!;

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
            ["TRANSPARENT"] = "true",
            ["CQL_FILTER"] = BuildCqlFilter(userId.Value)
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
            _logger.LogError("GeoServer sunum isteği zaman aşımına uğradı. DrawingKind: {DrawingKind}", kind);
            return ServiceResult<MapPresentationImage>.Timeout(
                "GeoServer harita sunum isteği zaman aşımına uğradı.");
        }
        catch (HttpRequestException exception)
        {
            _logger.LogError(exception, "GeoServer sunum isteğine ulaşılamadı. DrawingKind: {DrawingKind}", kind);
            return ServiceResult<MapPresentationImage>.Upstream("GeoServer harita sunum servisine ulaşılamadı.");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError(
                    "GeoServer sunum isteği başarısız. DrawingKind: {DrawingKind}, StatusCode: {StatusCode}",
                    kind,
                    (int)response.StatusCode);
                return ServiceResult<MapPresentationImage>.Upstream("GeoServer harita görüntüsü üretilemedi.");
            }

            if (!IsPng(response.Content.Headers.ContentType))
            {
                _logger.LogError(
                    "GeoServer sunum yanıt türü geçersiz. DrawingKind: {DrawingKind}, ContentType: {ContentType}",
                    kind,
                    response.Content.Headers.ContentType?.ToString() ?? "(missing)");
                return ServiceResult<MapPresentationImage>.Upstream(
                    "GeoServer geçerli bir PNG yanıtı döndürmedi.");
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);

            /* Boş/şeffaf bir PNG UYDURULMAZ: yukarı akış hatası, "hiç çizim yok"
               ile aynı görüntüye indirgenirse kullanıcı verisinin kaybolduğunu
               fark edemez. Geçersiz yanıt hata olarak yukarı çıkar. */
            if (!bytes.AsSpan().StartsWith(PngSignature))
            {
                _logger.LogError(
                    "GeoServer sunum yanıtında PNG imzası bulunamadı. DrawingKind: {DrawingKind}",
                    kind);
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
