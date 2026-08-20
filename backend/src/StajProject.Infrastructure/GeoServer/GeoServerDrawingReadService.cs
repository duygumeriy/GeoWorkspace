using System.Globalization;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Application.Options;
using StajProject.Domain.Common;

namespace StajProject.Infrastructure.GeoServer;

/// <summary>
/// Üç normal çizim katmanını WFS 2.0.0 GeoJSON olarak okur. Sahiplik ve durum
/// yüklemi GeoServer/PostGIS tarafında çalışır; backend yalnızca mevcut API
/// sözleşmesine eşler ve son Id sırasını garanti eder.
/// </summary>
public sealed class GeoServerDrawingReadService : IGeoServerDrawingReadService
{
    private const string WfsVersion = "2.0.0";
    private const string OutputFormat = "application/json";
    private const string TargetCrs = "EPSG:4326";
    private static readonly GeometryFactory GeometryFactory = new(new PrecisionModel(), 4326);
    private static readonly WKTWriter WktWriter = new();

    private readonly HttpClient _httpClient;
    private readonly GeoServerOptions _options;
    private readonly ILogger<GeoServerDrawingReadService> _logger;

    public GeoServerDrawingReadService(
        HttpClient httpClient,
        GeoServerOptions options,
        ILogger<GeoServerDrawingReadService> logger)
    {
        _httpClient = httpClient;
        _options = options;
        _logger = logger;
    }

    public async Task<IReadOnlyList<DrawingResponse>> GetDrawingsAsync(
        DrawingKind kind,
        int currentUserId,
        CancellationToken cancellationToken)
    {
        var requestUri = BuildRequestUri(kind, currentUserId);

        using var response = await _httpClient.GetAsync(
            requestUri,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);

        if (!response.IsSuccessStatusCode)
        {
            _logger.LogError(
                "GeoServer WFS çizim okuması başarısız. DrawingKind: {DrawingKind}, StatusCode: {StatusCode}",
                kind,
                (int)response.StatusCode);
        }

        response.EnsureSuccessStatusCode();

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);

        if (document.RootElement.ValueKind != JsonValueKind.Object
            || !document.RootElement.TryGetProperty("features", out var features)
            || features.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException("GeoServer GeoJSON yanıtında geçerli bir features dizisi yok.");
        }

        var drawings = new List<DrawingResponse>(features.GetArrayLength());

        foreach (var feature in features.EnumerateArray())
        {
            drawings.Add(MapFeature(feature, kind));
        }

        return drawings.OrderBy(drawing => drawing.Id).ToList();
    }

    internal Uri BuildRequestUri(DrawingKind kind, int currentUserId)
    {
        var layer = kind switch
        {
            DrawingKind.Point => _options.PointLayer,
            DrawingKind.Line => _options.LineLayer,
            DrawingKind.Polygon => _options.PolygonLayer,
            _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Bilinmeyen çizim türü.")
        };

        // currentUserId doğrulanmış backend bağlamından gelen int'tir. Filtreye
        // istemciden gelen metin veya serbest CQL parçası hiçbir zaman eklenmez.
        var cqlFilter = string.Create(
            CultureInfo.InvariantCulture,
            $"inserted_user_id={currentUserId} AND is_deleted=false AND is_active=true");

        var parameters = new Dictionary<string, string>
        {
            ["service"] = "WFS",
            ["version"] = WfsVersion,
            ["request"] = "GetFeature",
            ["typeNames"] = $"{_options.Workspace}:{layer}",
            ["outputFormat"] = OutputFormat,
            ["srsName"] = TargetCrs,
            // Bu GeoServer örneğinde yalnızca küçük harfli yazım çalışıyor.
            ["cql_filter"] = cqlFilter,
            ["sortBy"] = "Id A"
        };

        var query = string.Join(
            "&",
            parameters.Select(pair =>
                $"{Uri.EscapeDataString(pair.Key)}={Uri.EscapeDataString(pair.Value)}"));

        var endpoint = new Uri($"{_options.BaseUrl.TrimEnd('/')}/ows", UriKind.Absolute);
        var builder = new UriBuilder(endpoint) { Query = query };
        return builder.Uri;
    }

    private static DrawingResponse MapFeature(JsonElement feature, DrawingKind kind)
    {
        if (feature.ValueKind != JsonValueKind.Object
            || !feature.TryGetProperty("properties", out var properties)
            || properties.ValueKind != JsonValueKind.Object)
        {
            throw new InvalidDataException("GeoServer GeoJSON feature properties alanı geçersiz.");
        }

        var geometry = ReadGeometry(feature, kind);
        var defaults = DrawingStyleDefaults.For(kind);
        var strokeColor = ReadRequiredString(properties, "StrokeColor");
        var strokeWidth = ReadRequiredInt32(properties, "StrokeWidth");

        return new DrawingResponse
        {
            Id = ReadRequiredInt32(properties, "Id"),
            Wkt = WktWriter.Write(geometry),
            Name = ReadRequiredString(properties, "Name"),
            Description = ReadNullableString(properties, "description"),
            Category = ReadNullableString(properties, "category"),
            Tags = ReadTags(properties),
            Style = new DrawingStyleDto
            {
                StrokeColor = string.IsNullOrWhiteSpace(strokeColor) ? defaults.StrokeColor : strokeColor,
                StrokeWidth = strokeWidth == 0 ? defaults.StrokeWidth : strokeWidth,
                FillColor = ReadNullableString(properties, "FillColor") ?? defaults.FillColor,
                FillOpacity = ReadNullableDouble(properties, "FillOpacity") ?? defaults.FillOpacity,
                PointRadius = kind is DrawingKind.Point
                    ? ReadNullableInt32(properties, "PointRadius") ?? defaults.PointRadius
                    : defaults.PointRadius,
                LineStyle = ReadNullableString(properties, "LineStyle") ?? defaults.LineStyle
            },
            CreatedDate = ReadRequiredDateTime(properties, "inserted_date"),
            ModifiedDate = ReadRequiredDateTime(properties, "modified_date"),
            CreatedBy = ReadRequiredString(properties, "CreatedBy"),
            CreatedByUserId = ReadRequiredInt32(properties, "inserted_user_id")
        };
    }

    private static Geometry ReadGeometry(JsonElement feature, DrawingKind kind)
    {
        if (!feature.TryGetProperty("geometry", out var geometry)
            || geometry.ValueKind != JsonValueKind.Object
            || !geometry.TryGetProperty("type", out var typeElement)
            || typeElement.ValueKind != JsonValueKind.String
            || !geometry.TryGetProperty("coordinates", out var coordinates))
        {
            throw new InvalidDataException("GeoServer GeoJSON feature geometry alanı geçersiz.");
        }

        var actualType = typeElement.GetString();
        var expectedType = kind switch
        {
            DrawingKind.Point => "Point",
            DrawingKind.Line => "LineString",
            DrawingKind.Polygon => "Polygon",
            _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Bilinmeyen çizim türü.")
        };

        if (!string.Equals(actualType, expectedType, StringComparison.Ordinal))
        {
            throw new InvalidDataException(
                $"GeoServer geometry türü geçersiz. Beklenen: {expectedType}, Gelen: {actualType ?? "null"}.");
        }

        return kind switch
        {
            DrawingKind.Point => GeometryFactory.CreatePoint(ReadCoordinate(coordinates)),
            DrawingKind.Line => GeometryFactory.CreateLineString(ReadCoordinates(coordinates)),
            DrawingKind.Polygon => ReadPolygon(coordinates),
            _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, "Bilinmeyen çizim türü.")
        };
    }

    private static Polygon ReadPolygon(JsonElement coordinates)
    {
        if (coordinates.ValueKind != JsonValueKind.Array || coordinates.GetArrayLength() == 0)
        {
            throw new InvalidDataException("GeoServer Polygon koordinatları geçersiz.");
        }

        var rings = coordinates.EnumerateArray()
            .Select(ring => GeometryFactory.CreateLinearRing(ReadCoordinates(ring)))
            .ToArray();

        return GeometryFactory.CreatePolygon(rings[0], rings.Skip(1).ToArray());
    }

    private static Coordinate[] ReadCoordinates(JsonElement coordinates)
    {
        if (coordinates.ValueKind != JsonValueKind.Array)
        {
            throw new InvalidDataException("GeoServer koordinat dizisi geçersiz.");
        }

        return coordinates.EnumerateArray().Select(ReadCoordinate).ToArray();
    }

    private static Coordinate ReadCoordinate(JsonElement coordinate)
    {
        if (coordinate.ValueKind != JsonValueKind.Array || coordinate.GetArrayLength() < 2)
        {
            throw new InvalidDataException("GeoServer koordinatı en az iki sayı içermelidir.");
        }

        var values = coordinate.EnumerateArray().Take(2).ToArray();

        if (values.Any(value => value.ValueKind is not JsonValueKind.Number))
        {
            throw new InvalidDataException("GeoServer koordinat değerleri sayı olmalıdır.");
        }

        return new Coordinate(values[0].GetDouble(), values[1].GetDouble());
    }

    private static List<string> ReadTags(JsonElement properties)
    {
        if (!properties.TryGetProperty("tags_json", out var element))
        {
            throw new InvalidDataException("GeoServer tags_json alanı eksik.");
        }

        if (element.ValueKind == JsonValueKind.Null)
        {
            return [];
        }

        if (element.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException("GeoServer tags_json alanı metin olmalıdır.");
        }

        try
        {
            return JsonSerializer.Deserialize<List<string>>(element.GetString()!) ?? [];
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("GeoServer tags_json alanı geçerli bir JSON dizisi değil.", exception);
        }
    }

    private static string ReadRequiredString(JsonElement properties, string name)
    {
        if (!properties.TryGetProperty(name, out var element)
            || element.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException($"GeoServer {name} alanı eksik veya geçersiz.");
        }

        return element.GetString()!;
    }

    private static string? ReadNullableString(JsonElement properties, string name)
    {
        if (!properties.TryGetProperty(name, out var element))
        {
            throw new InvalidDataException($"GeoServer {name} alanı eksik.");
        }

        if (element.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        if (element.ValueKind != JsonValueKind.String)
        {
            throw new InvalidDataException($"GeoServer {name} alanı geçersiz.");
        }

        return element.GetString();
    }

    private static int ReadRequiredInt32(JsonElement properties, string name)
    {
        if (!properties.TryGetProperty(name, out var element)
            || element.ValueKind != JsonValueKind.Number
            || !element.TryGetInt32(out var value))
        {
            throw new InvalidDataException($"GeoServer {name} alanı eksik veya geçersiz.");
        }

        return value;
    }

    private static int? ReadNullableInt32(JsonElement properties, string name)
    {
        if (!properties.TryGetProperty(name, out var element))
        {
            throw new InvalidDataException($"GeoServer {name} alanı eksik.");
        }

        if (element.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        if (element.ValueKind != JsonValueKind.Number || !element.TryGetInt32(out var value))
        {
            throw new InvalidDataException($"GeoServer {name} alanı geçersiz.");
        }

        return value;
    }

    private static double? ReadNullableDouble(JsonElement properties, string name)
    {
        if (!properties.TryGetProperty(name, out var element))
        {
            throw new InvalidDataException($"GeoServer {name} alanı eksik.");
        }

        if (element.ValueKind == JsonValueKind.Null)
        {
            return null;
        }

        if (element.ValueKind != JsonValueKind.Number || !element.TryGetDouble(out var value))
        {
            throw new InvalidDataException($"GeoServer {name} alanı geçersiz.");
        }

        return value;
    }

    private static DateTime ReadRequiredDateTime(JsonElement properties, string name)
    {
        if (!properties.TryGetProperty(name, out var element)
            || element.ValueKind != JsonValueKind.String
            || !element.TryGetDateTime(out var value))
        {
            throw new InvalidDataException($"GeoServer {name} alanı eksik veya geçersiz.");
        }

        return value.ToUniversalTime();
    }
}
