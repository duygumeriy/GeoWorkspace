using System.Globalization;
using System.Net.Http.Headers;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;

namespace StajProject.Infrastructure.GeoServer;

/// <summary>
/// Kullanıcıya özel nokta yoğunluğunu sabit bir WMS GetMap isteğiyle üretir.
/// İstemciden gelen hiçbir metin CQL, layer, style veya workspace'e eklenmez.
/// </summary>
public sealed class GeoServerHeatmapService : IGeoServerHeatmapService
{
    internal const int MinimumDimension = 64;
    internal const int MaximumDimension = 2048;
    internal const long MaximumPixels = 4_194_304;
    internal const double WebMercatorLimit = 20_037_508.342789244;

    private const string TargetCrs = "EPSG:3857";
    private const string PngMediaType = "image/png";
    private static readonly byte[] PngSignature = [137, 80, 78, 71, 13, 10, 26, 10];

    private readonly HttpClient _httpClient;
    private readonly GeoServerOptions _options;
    private readonly ICurrentUserService _currentUser;
    private readonly IGeographicAuthorizationService _geographicAuthorization;
    private readonly ILogger<GeoServerHeatmapService> _logger;

    public GeoServerHeatmapService(
        HttpClient httpClient,
        GeoServerOptions options,
        ICurrentUserService currentUser,
        IGeographicAuthorizationService geographicAuthorization,
        ILogger<GeoServerHeatmapService> logger)
    {
        _httpClient = httpClient;
        _options = options;
        _currentUser = currentUser;
        _geographicAuthorization = geographicAuthorization;
        _logger = logger;
    }

    public async Task<ServiceResult<HeatmapImage>> GetHeatmapAsync(
        HeatmapRequest request,
        CancellationToken cancellationToken)
    {
        var render = Validate(request);

        if (!render.IsSuccess)
        {
            return ServiceResult<HeatmapImage>.Failure(render.Error!);
        }

        var userId = _currentUser.UserId;

        if (!_currentUser.IsAuthenticated || userId is null)
        {
            return ServiceResult<HeatmapImage>.Forbidden("Kimliği doğrulanmış kullanıcı çözümlenemedi.");
        }

        var geographic = await _geographicAuthorization.GetEffectiveAuthorizationAsync(
            userId.Value,
            cancellationToken);
        var cqlFilter = BuildCqlFilter(userId.Value, geographic);
        var validated = render.Value!;

        var parameters = new Dictionary<string, string>
        {
            ["SERVICE"] = "WMS",
            ["VERSION"] = "1.3.0",
            ["REQUEST"] = "GetMap",
            ["LAYERS"] = $"{_options.Workspace}:{_options.HeatmapLayer}",
            ["STYLES"] = _options.HeatmapStyle,
            ["CRS"] = TargetCrs,
            ["BBOX"] = validated.Bbox,
            ["WIDTH"] = validated.Width.ToString(CultureInfo.InvariantCulture),
            ["HEIGHT"] = validated.Height.ToString(CultureInfo.InvariantCulture),
            ["FORMAT"] = PngMediaType,
            ["TRANSPARENT"] = "true",
            ["CQL_FILTER"] = cqlFilter
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
            _logger.LogError("GeoServer heatmap isteği zaman aşımına uğradı.");
            return ServiceResult<HeatmapImage>.Timeout("GeoServer heatmap isteği zaman aşımına uğradı.");
        }
        catch (HttpRequestException exception)
        {
            _logger.LogError(exception, "GeoServer heatmap isteğine ulaşılamadı.");
            return ServiceResult<HeatmapImage>.Upstream("GeoServer heatmap servisine ulaşılamadı.");
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                _logger.LogError(
                    "GeoServer heatmap isteği başarısız. StatusCode: {StatusCode}",
                    (int)response.StatusCode);
                return ServiceResult<HeatmapImage>.Upstream("GeoServer heatmap görüntüsü üretilemedi.");
            }

            if (!IsPng(response.Content.Headers.ContentType))
            {
                _logger.LogError(
                    "GeoServer heatmap yanıt türü geçersiz. ContentType: {ContentType}",
                    response.Content.Headers.ContentType?.ToString() ?? "(missing)");
                return ServiceResult<HeatmapImage>.Upstream("GeoServer geçerli bir PNG yanıtı döndürmedi.");
            }

            var bytes = await response.Content.ReadAsByteArrayAsync(cancellationToken);

            if (!bytes.AsSpan().StartsWith(PngSignature))
            {
                _logger.LogError("GeoServer heatmap yanıtında PNG imzası bulunamadı.");
                return ServiceResult<HeatmapImage>.Upstream("GeoServer geçerli bir PNG yanıtı döndürmedi.");
            }

            return ServiceResult<HeatmapImage>.Success(new HeatmapImage { Content = bytes });
        }
    }

    private static ServiceResult<ValidatedRender> Validate(HeatmapRequest? request)
    {
        if (request is null)
        {
            return ServiceResult<ValidatedRender>.Failure("Heatmap render parametreleri zorunludur.");
        }

        var parts = request.Bbox.Split(',', StringSplitOptions.None);

        if (parts.Length != 4)
        {
            return ServiceResult<ValidatedRender>.Failure("bbox tam olarak dört sayı içermelidir.");
        }

        var coordinates = new double[4];

        for (var index = 0; index < parts.Length; index++)
        {
            if (!double.TryParse(
                    parts[index],
                    NumberStyles.Float,
                    CultureInfo.InvariantCulture,
                    out coordinates[index])
                || !double.IsFinite(coordinates[index])
                || Math.Abs(coordinates[index]) > WebMercatorLimit)
            {
                return ServiceResult<ValidatedRender>.Failure(
                    "bbox geçerli EPSG:3857 koordinatlarından oluşmalıdır.");
            }
        }

        if (coordinates[0] >= coordinates[2] || coordinates[1] >= coordinates[3])
        {
            return ServiceResult<ValidatedRender>.Failure("bbox minimum değerleri maksimumlardan küçük olmalıdır.");
        }

        if (request.Width is < MinimumDimension or > MaximumDimension
            || request.Height is < MinimumDimension or > MaximumDimension)
        {
            return ServiceResult<ValidatedRender>.Failure(
                $"width ve height {MinimumDimension} ile {MaximumDimension} arasında olmalıdır.");
        }

        var pixelCount = (long)request.Width * request.Height;

        if (pixelCount > MaximumPixels)
        {
            return ServiceResult<ValidatedRender>.Failure(
                $"Heatmap görüntüsü en fazla {MaximumPixels} piksel olabilir.");
        }

        return ServiceResult<ValidatedRender>.Success(new ValidatedRender(
            string.Join(',', coordinates.Select(value => value.ToString("G17", CultureInfo.InvariantCulture))),
            request.Width,
            request.Height));
    }

    private static string BuildCqlFilter(
        int userId,
        Application.Geographic.EffectiveGeographicAuthorization geographic)
    {
        var ownerAndStatus = string.Create(
            CultureInfo.InvariantCulture,
            $"inserted_user_id={userId} AND is_deleted=false AND is_active=true");

        if (!geographic.IsRestricted)
        {
            return ownerAndStatus;
        }

        var area = geographic.AllowedArea
            ?? throw new InvalidOperationException("Kısıtlı coğrafi yetkinin geometry değeri yok.");

        if (area.IsEmpty || area is not (Polygon or MultiPolygon) || area.SRID is not (0 or 4326))
        {
            throw new InvalidOperationException("Heatmap coğrafi yetkisi geçerli bir EPSG:4326 Polygon/MultiPolygon değil.");
        }

        var wkt = new WKTWriter().Write(area);
        return $"{ownerAndStatus} AND INTERSECTS(\"Geometry\",{wkt})";
    }

    private static bool IsPng(MediaTypeHeaderValue? contentType) =>
        string.Equals(contentType?.MediaType, PngMediaType, StringComparison.OrdinalIgnoreCase);

    private sealed record ValidatedRender(string Bbox, int Width, int Height);
}
