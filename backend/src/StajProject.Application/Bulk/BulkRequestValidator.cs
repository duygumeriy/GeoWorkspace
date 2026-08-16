using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Domain.Common;

namespace StajProject.Application.Bulk;

/// <summary>Doğrulanmış tek bir toplu-işlem hedefi.</summary>
public sealed record BulkTarget(DrawingKind Kind, int Id, DrawingStyleDto? Style);

/// <summary>Doğrulanmış tek bir toplu-oluşturma girdisi.</summary>
public sealed record BulkCreateTarget(
    DrawingKind Kind,
    string Wkt,
    string? Name,
    DrawingStyleDto? Style,
    string? Description,
    string? Category,
    List<string>? Tags);

/// <summary>
/// Toplu işlem isteklerinin gövdesini servise girmeden önce doğrular.
/// <para>
/// Buradaki kurallar tek noktadadır: tür beyaz listesi, pozitif id zorunluluğu,
/// yinelenen kayıt reddi ve makul bir üst batch sınırı. Bunlar geçmeden hiçbir
/// veritabanı işlemi başlatılmaz, dolayısıyla hatalı bir istek transaction bile
/// açmaz.
/// </para>
/// </summary>
public static class BulkRequestValidator
{
    /// <summary>Tek istekte işlenebilecek en fazla kayıt sayısı.</summary>
    public const int MaxBatchSize = 100;

    /// <summary>Client'tan kabul edilen tek geçerli tür kümesi.</summary>
    private static readonly IReadOnlyDictionary<string, DrawingKind> KindsByName =
        new Dictionary<string, DrawingKind>(StringComparer.OrdinalIgnoreCase)
        {
            ["point"] = DrawingKind.Point,
            ["line"] = DrawingKind.Line,
            ["polygon"] = DrawingKind.Polygon
        };

    /// <summary>API sözleşmesinde kullanılan küçük harfli tür adı.</summary>
    public static string NameOf(DrawingKind kind) => kind switch
    {
        DrawingKind.Point => "point",
        DrawingKind.Line => "line",
        _ => "polygon"
    };

    public static ServiceResult<IReadOnlyList<BulkTarget>> ValidateTargets(IReadOnlyList<BulkDrawingItem>? items)
    {
        var sizeError = ValidateSize(items?.Count ?? 0);

        if (sizeError is not null)
        {
            return ServiceResult<IReadOnlyList<BulkTarget>>.Failure(sizeError);
        }

        var targets = new List<BulkTarget>(items!.Count);
        // (tür, id) çifti tekildir; aynı kaydın iki kez gelmesi isteği reddeder,
        // aksi halde "kaç kayıt silindi" sayısı yanıltıcı olurdu.
        var seen = new HashSet<(DrawingKind, int)>();

        foreach (var item in items)
        {
            if (!KindsByName.TryGetValue((item.Type ?? string.Empty).Trim(), out var kind))
            {
                return ServiceResult<IReadOnlyList<BulkTarget>>.Failure(
                    $"type yalnızca şu değerlerden biri olabilir: {string.Join(", ", KindsByName.Keys)}.");
            }

            if (item.Id <= 0)
            {
                return ServiceResult<IReadOnlyList<BulkTarget>>.Failure("id pozitif bir tam sayı olmalıdır.");
            }

            if (!seen.Add((kind, item.Id)))
            {
                return ServiceResult<IReadOnlyList<BulkTarget>>.Failure(
                    $"Aynı kayıt birden fazla kez gönderildi ({NameOf(kind)} #{item.Id}).");
            }

            targets.Add(new BulkTarget(kind, item.Id, item.Style));
        }

        return ServiceResult<IReadOnlyList<BulkTarget>>.Success(targets);
    }

    public static ServiceResult<IReadOnlyList<BulkCreateTarget>> ValidateCreateTargets(IReadOnlyList<BulkCreateItem>? items)
    {
        var sizeError = ValidateSize(items?.Count ?? 0);

        if (sizeError is not null)
        {
            return ServiceResult<IReadOnlyList<BulkCreateTarget>>.Failure(sizeError);
        }

        var targets = new List<BulkCreateTarget>(items!.Count);

        foreach (var item in items)
        {
            if (!KindsByName.TryGetValue((item.Type ?? string.Empty).Trim(), out var kind))
            {
                return ServiceResult<IReadOnlyList<BulkCreateTarget>>.Failure(
                    $"type yalnızca şu değerlerden biri olabilir: {string.Join(", ", KindsByName.Keys)}.");
            }

            if (string.IsNullOrWhiteSpace(item.Wkt))
            {
                return ServiceResult<IReadOnlyList<BulkCreateTarget>>.Failure("wkt boş olamaz.");
            }

            // Metadata'nın İÇERİK doğrulaması (kategori kümesi, etiket sayısı)
            // servis katmanındaki DrawingMetadataValidator'a bırakılır; burada
            // yalnızca taşınır, böylece kural tek yerde kalır.
            targets.Add(new BulkCreateTarget(
                kind, item.Wkt, item.Name, item.Style, item.Description, item.Category, item.Tags));
        }

        return ServiceResult<IReadOnlyList<BulkCreateTarget>>.Success(targets);
    }

    private static string? ValidateSize(int count) => count switch
    {
        0 => "items en az bir kayıt içermelidir.",
        > MaxBatchSize => $"Tek istekte en fazla {MaxBatchSize} kayıt işlenebilir.",
        _ => null
    };
}
