using StajProject.Application.Common;
using StajProject.Domain.Common;

namespace StajProject.Application.Drawings;

/// <summary>
/// Çizimin kullanıcı metadata'sını (açıklama, kategori, etiketler) doğrular ve
/// kanonik hâle getirir.
/// <para>
/// Ad doğrulaması <see cref="DrawingAttributeValidator"/>, renk doğrulaması
/// <c>DrawingStyleValidator</c> içinde kalır; bu sınıf yalnızca AŞAMA-2 ile
/// eklenen üç alanı üstlenir. Üçü de opsiyoneldir — gönderilmemesi hata değildir.
/// </para>
/// </summary>
/// <remarks>
/// <b>PATCH semantiği.</b> Update yolunda alanların üç ayrı anlamı vardır ve
/// ayrım kasıtlıdır:
/// <list type="bullet">
/// <item><c>null</c> — alan gönderilmedi, <b>mevcut değer korunur</b>.</item>
/// <item>boş metin / boş liste — kullanıcı alanı <b>temizledi</b>.</item>
/// <item>dolu değer — doğrulanıp yazılır.</item>
/// </list>
/// Bu olmadan "açıklamayı sil" ile "açıklamaya dokunma" birbirinden ayırt
/// edilemezdi.
/// </remarks>
public static class DrawingMetadataValidator
{
    /// <summary>EF mapping'indeki <c>HasMaxLength</c> ile aynı sınır.</summary>
    public const int MaxDescriptionLength = 2000;

    /// <summary>Kayıt başına en fazla etiket sayısı.</summary>
    public const int MaxTagCount = 10;

    /// <summary>Tek bir etiketin en fazla uzunluğu.</summary>
    public const int MaxTagLength = 40;

    /// <summary>
    /// Açıklamayı kırpar ve uzunluğunu kontrol eder.
    /// </summary>
    /// <returns>Kırpılmış açıklama; boş girdi için <c>null</c> (kolon boş kalır).</returns>
    public static ServiceResult<string?> ValidateDescription(string? description)
    {
        var trimmed = (description ?? string.Empty).Trim();

        if (trimmed.Length == 0)
        {
            // Boş metin ile null arasında veritabanında fark yaratmıyoruz:
            // "açıklama yok" tek bir şekilde temsil edilir.
            return ServiceResult<string?>.Success(null);
        }

        return trimmed.Length > MaxDescriptionLength
            ? ServiceResult<string?>.Failure($"description en fazla {MaxDescriptionLength} karakter olabilir.")
            : ServiceResult<string?>.Success(trimmed);
    }

    /// <summary>
    /// Kategoriyi bilinen kümeye oturtur. Bilinmeyen değer reddedilir — böylece
    /// gruplama ve filtreleme sabit bir küme üzerinde çalışır.
    /// </summary>
    public static ServiceResult<string?> ValidateCategory(string? category)
    {
        if (DrawingCategories.TryNormalize(category, out var normalized))
        {
            return ServiceResult<string?>.Success(normalized);
        }

        return ServiceResult<string?>.Failure(
            $"Geçersiz kategori. Şunlardan biri olmalıdır: {string.Join(", ", DrawingCategories.All)}.");
    }

    /// <summary>
    /// Etiket listesini temizler: kırpar, boşları atar, büyük/küçük harf duyarsız
    /// tekilleştirir ve sayı/uzunluk sınırlarını uygular.
    /// </summary>
    /// <remarks>
    /// Tekilleştirme ilk yazımı korur: kullanıcı <c>["Ankara", "ankara"]</c>
    /// gönderdiğinde sonuç <c>["Ankara"]</c> olur. Sayı sınırı
    /// <b>tekilleştirmeden SONRA</b> uygulanır, aksi hâlde aynı etiketi on kez
    /// yazan bir istek sınıra takılır ve kullanıcı nedenini anlamazdı.
    /// </remarks>
    public static ServiceResult<List<string>> ValidateTags(IEnumerable<string?>? tags)
    {
        if (tags is null)
        {
            return ServiceResult<List<string>>.Success([]);
        }

        var unique = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var tag in tags)
        {
            var trimmed = (tag ?? string.Empty).Trim();

            // Boş etiket sessizce düşer: kullanıcı arayüzde yanlışlıkla boş bir
            // chip oluşturduğunda tüm isteği reddetmek gereksiz sert olurdu.
            if (trimmed.Length == 0)
            {
                continue;
            }

            if (trimmed.Length > MaxTagLength)
            {
                return ServiceResult<List<string>>.Failure(
                    $"Etiketler en fazla {MaxTagLength} karakter olabilir: \"{trimmed}\".");
            }

            if (seen.Add(trimmed))
            {
                unique.Add(trimmed);
            }
        }

        return unique.Count > MaxTagCount
            ? ServiceResult<List<string>>.Failure($"En fazla {MaxTagCount} etiket eklenebilir.")
            : ServiceResult<List<string>>.Success(unique);
    }
}
