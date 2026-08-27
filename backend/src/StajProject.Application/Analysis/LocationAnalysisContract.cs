using NetTopologySuite.Geometries;
using NetTopologySuite.Operation.Union;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Pois;
using StajProject.Application.Spatial;

namespace StajProject.Application.Analysis;

/// <summary>Doğrulanmış tek bir ölçüt: kanonik slug + tam sayı ağırlık.</summary>
/// <remarks>
/// Kategori KİMLİĞİ burada yoktur: çözümleme veritabanına bakar ve bu saf
/// katman veritabanı bilmez. Sıra, istekteki sıradır — sonuç kırılımı da aynı
/// sırayla döner.
/// </remarks>
public sealed record ValidatedLocationCriterion(string CategorySlug, int Weight);

/// <summary>
/// Doğrulanmış konum analizi isteği: birleştirilmiş hedef + ölçütler.
/// </summary>
/// <param name="Target">
/// Tüm parçaların birleşimi. Tek parça için Polygon, kopuk parçalar için
/// MultiPolygon olur; ikisi de tek bir mekânsal yüklem olarak kullanılır.
/// </param>
/// <param name="PartCount">Gönderilen parça sayısı; sonucun özetinde raporlanır.</param>
public sealed record ValidatedLocationAnalysisRequest(
    Geometry Target,
    int PartCount,
    IReadOnlyList<ValidatedLocationCriterion> Criteria,
    string? AdministrativeTargetType,
    string? AdministrativeTargetKey);

/// <summary>
/// Konum analizi isteğinin <b>saf</b> doğrulaması: hedef geometri ve ölçüt
/// kuralları. Veritabanına hiç gitmeden karar verilebilen her şey buradadır.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı ve saf bir sınıf.</b> <see cref="BulkRequestValidator"/> ile
/// aynı gerekçe: bu kurallar geçmeden hiçbir veritabanı işlemi başlamaz,
/// dolayısıyla hatalı bir istek ne sorgu açar ne de PostGIS'e ulaşır. Ayrıca
/// kural kümesi, bir veritabanı kurmadan doğrudan sınanabilir.
/// </para>
/// <para>
/// <b>Kategorilerin VARLIĞI burada sınanmaz.</b> Slug'ın kanonik BİÇİMDE
/// olması saf bir kuraldır ve buradadır; o slug'ın gerçekten var olup
/// olmadığı bir veri sorusudur ve servise aittir. İkisini karıştırmak, saf
/// katmanı veritabanına bağlardı.
/// </para>
/// </remarks>
public static class LocationAnalysisValidator
{
    /// <summary>Ödevin alt sınırı: tek kategori bir "ağırlıklandırma" değildir.</summary>
    public const int MinCriteria = 2;

    /// <summary>Ödevin üst sınırı.</summary>
    public const int MaxCriteria = 5;

    /// <summary>Ağırlıkların zorunlu toplamı.</summary>
    public const int RequiredWeightTotal = 100;

    /// <summary>
    /// Tek istekte kabul edilen en fazla alan parçası.
    /// </summary>
    /// <remarks>
    /// <b>Sayı uydurulmamıştır.</b> Uygulamayla paketlenen sınır veri kümesinde
    /// en çok parçaya sahip seçim Marmara bölgesidir (6 poligon); illerde
    /// en yüksek değer 4'tür. 32, bu gerçek en büyüğün beş katından fazla
    /// pay bırakır ve yine de tek bir isteğin sınırsız sayıda poligon
    /// birleştirmesini engeller.
    /// <para>
    /// <b>Köşe sayısına sınır KONMAZ.</b> Projede bugün hiçbir uç (çizim
    /// oluşturma, envanter analizi, coğrafi alan kaydetme) köşe sayısını
    /// sınırlamaz; yalnızca buraya bir sınır koymak, aynı riski taşıyan
    /// mevcut uçları olduğu gibi bırakırken yeni ucu keyfî biçimde farklı
    /// kılardı. Bu, proje geneli bir karardır ve tek başına burada
    /// alınmamalıdır.
    /// </para>
    /// </remarks>
    public const int MaxAreaParts = 32;

    public static ServiceResult<ValidatedLocationAnalysisRequest> Validate(LocationAnalysisRequest? request)
    {
        if (request is null)
        {
            return Fail("İstek gövdesi zorunludur.");
        }

        var target = ValidateTarget(request.AreaWkts);

        if (!target.IsSuccess)
        {
            return Fail(target.Error!);
        }

        var criteria = ValidateCriteria(request.Criteria);

        if (!criteria.IsSuccess)
        {
            return Fail(criteria.Error!);
        }

        var administrativeTarget = ValidateAdministrativeTarget(
            request.AdministrativeTargetType,
            request.AdministrativeTargetKey);
        if (!administrativeTarget.IsSuccess)
        {
            return Fail(administrativeTarget.Error!);
        }

        return ServiceResult<ValidatedLocationAnalysisRequest>.Success(
            new ValidatedLocationAnalysisRequest(
                target.Value!,
                request.AreaWkts!.Count,
                criteria.Value!,
                administrativeTarget.Value.Type,
                administrativeTarget.Value.Key));
    }

    private static ServiceResult<(string? Type, string? Key)> ValidateAdministrativeTarget(
        string? type,
        string? key)
    {
        var normalizedType = string.IsNullOrWhiteSpace(type) ? null : type.Trim().ToLowerInvariant();
        var normalizedKey = string.IsNullOrWhiteSpace(key) ? null : key.Trim();

        if (normalizedType is null && normalizedKey is null)
        {
            return ServiceResult<(string?, string?)>.Success((null, null));
        }

        if (normalizedType is not ("province" or "region") || normalizedKey is null)
        {
            return ServiceResult<(string?, string?)>.Failure("Geçersiz idari analiz hedefi.");
        }

        return ServiceResult<(string?, string?)>.Success((normalizedType, normalizedKey));
    }

    /* --- Hedef alan ------------------------------------------------------------ */

    /// <summary>
    /// Parçaların tamamını doğrular ve TEK bir hedefe birleştirir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Kısmi başarı YOKTUR.</b> Bir parça geçersizse istek bütünüyle
    /// reddedilir. Geçersiz parçayı atlayıp kalanlarla devam etmek, kullanıcıya
    /// seçtiğinden DAHA KÜÇÜK bir alanın sonucunu doğru cevap gibi sunmak
    /// olurdu — ve bunu sessizce yapardı.
    /// </para>
    /// <para>
    /// Birleştirme <see cref="UnaryUnionOp"/> iledir; coğrafi yetki alanlarının
    /// çözümünde kullanılan işlecin aynısı. Kapsayan dikdörtgen ya da halkaları
    /// uç uca ekleme KULLANILMAZ: ikisi de hiçbir parçanın kapsamadığı yerleri
    /// hedefin içindeymiş gibi gösterirdi.
    /// </para>
    /// </remarks>
    private static ServiceResult<Geometry> ValidateTarget(List<string>? areaWkts)
    {
        if (areaWkts is null || areaWkts.Count == 0)
        {
            return ServiceResult<Geometry>.Failure("Analiz alanı zorunludur: en az bir poligon gönderin.");
        }

        if (areaWkts.Count > MaxAreaParts)
        {
            return ServiceResult<Geometry>.Failure(
                $"Analiz alanı en fazla {MaxAreaParts} parçadan oluşabilir. Gönderilen: {areaWkts.Count}.");
        }

        var parts = new List<Geometry>(areaWkts.Count);

        for (var index = 0; index < areaWkts.Count; index++)
        {
            /* Parça başına AYNI parser: tip, SRID, boşluk, koordinat aralığı ve
               kendisiyle kesişen halka denetimi tek yerde durur ve konum analizi
               için ikinci bir kopyası yazılmaz. */
            var parsed = WktGeometryParser.Parse<Polygon>(areaWkts[index]);

            if (!parsed.IsSuccess)
            {
                // Hangi parçanın hatalı olduğu söylenir; çok parçalı bir
                // seçimde "geçersiz poligon" tek başına yol göstermez.
                return ServiceResult<Geometry>.Failure($"Analiz alanı parçası {index + 1}: {parsed.Error}");
            }

            parts.Add(parsed.Value!);
        }

        var target = parts.Count == 1 ? parts[0] : UnaryUnionOp.Union(parts);

        if (target is null || target.IsEmpty)
        {
            return ServiceResult<Geometry>.Failure("Analiz alanı boş bir geometriye indirgendi.");
        }

        target.SRID = WktGeometryParser.Srid4326;

        return ServiceResult<Geometry>.Success(target);
    }

    /* --- Ölçütler --------------------------------------------------------------- */

    private static ServiceResult<IReadOnlyList<ValidatedLocationCriterion>> ValidateCriteria(
        List<LocationAnalysisCriterionRequest>? criteria)
    {
        var count = criteria?.Count ?? 0;

        if (count < MinCriteria || count > MaxCriteria)
        {
            return CriteriaFail(
                $"En az {MinCriteria}, en fazla {MaxCriteria} kategori ölçütü seçilmelidir. Gönderilen: {count}.");
        }

        var validated = new List<ValidatedLocationCriterion>(count);
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var total = 0;

        foreach (var criterion in criteria!)
        {
            if (criterion is null)
            {
                return CriteriaFail("Kategori ölçütü boş olamaz.");
            }

            /* Slug normalizasyonu: kanonik biçim zaten küçük harftir, bu yüzden
               kırpma + küçültme yeterlidir. Yeni bir kural UYDURULMAZ —
               kanoniklik denetimi slug'ın tek sahibinden (PoiCategorySlug)
               gelir. */
            var slug = criterion.CategorySlug?.Trim().ToLowerInvariant() ?? string.Empty;

            if (slug.Length == 0)
            {
                return CriteriaFail("Kategori slug'ı zorunludur.");
            }

            if (!PoiCategorySlug.IsCanonical(slug))
            {
                return CriteriaFail($"Geçersiz kategori slug'ı: '{criterion.CategorySlug}'.");
            }

            if (!seen.Add(slug))
            {
                /* Aynı kategoriyi iki kez ağırlıklandırmak belirsizdir: iki
                   ağırlık toplanır mı, sonuncusu mu geçerlidir? Soruyu
                   yanıtlamak yerine istek reddedilir. */
                return CriteriaFail($"Aynı kategori birden çok kez seçilemez: '{slug}'.");
            }

            if (criterion.Weight <= 0)
            {
                return CriteriaFail($"'{slug}' için ağırlık pozitif bir tam sayı olmalıdır.");
            }

            if (criterion.Weight > RequiredWeightTotal)
            {
                return CriteriaFail($"'{slug}' için ağırlık {RequiredWeightTotal} değerini aşamaz.");
            }

            total += criterion.Weight;
            validated.Add(new ValidatedLocationCriterion(slug, criterion.Weight));
        }

        if (total != RequiredWeightTotal)
        {
            return CriteriaFail(
                $"Ağırlıkların toplamı tam olarak {RequiredWeightTotal} olmalıdır. Gönderilen toplam: {total}.");
        }

        return ServiceResult<IReadOnlyList<ValidatedLocationCriterion>>.Success(validated);
    }

    private static ServiceResult<ValidatedLocationAnalysisRequest> Fail(string error) =>
        ServiceResult<ValidatedLocationAnalysisRequest>.Failure(error);

    private static ServiceResult<IReadOnlyList<ValidatedLocationCriterion>> CriteriaFail(string error) =>
        ServiceResult<IReadOnlyList<ValidatedLocationCriterion>>.Failure(error);
}
