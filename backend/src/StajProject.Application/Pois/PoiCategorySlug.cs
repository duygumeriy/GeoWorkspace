using System.Globalization;
using System.Text;
using StajProject.Domain.Entities;

namespace StajProject.Application.Pois;

/// <summary>
/// Kategori slug'ının <b>tek üretim noktası</b>: Türkçe'ye duyarlı katlama,
/// ASCII indirgeme ve kanonik biçim doğrulaması.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı ve saf bir sınıf.</b> Aynı kural iki yerde gerekir — kategori
/// oluşturma yolu ve taksonomi kataloğunun doğrulanması. Servisin içine
/// gömülseydi, katalogdaki bir slug'ın gerçekten üretilebilir bir slug olup
/// olmadığı hiçbir zaman sınanamazdı.
/// </para>
/// <para>
/// <b>Türkçe katlama AÇIKÇA yazılır, Unicode normalizasyonuna bırakılmaz.</b>
/// Bu, sessiz bir hata sınıfını kapatır: <c>ı</c> ve <c>ğ</c> Unicode'da
/// birleşik-imli karakterler DEĞİLDİR, dolayısıyla NFD ayrıştırması onları
/// çözmez ve <c>[a-z0-9]</c> süzgecinde tamamen kaybolurlardı —
/// <c>"Alışveriş"</c> sessizce <c>"alveri"</c> olurdu.
/// Ayrıca <c>char.ToLowerInvariant('İ')</c> <c>i + U+0307</c> üretir; açık
/// eşleme bunu da baştan engeller.
/// </para>
/// <para>
/// <b>Katlamadan SONRA</b> kalan aksanlı Latin harfleri (<c>é</c>, <c>â</c>)
/// NFD ayrıştırmasıyla taban harfe indirgenir. İki katman bilinçlidir: açık
/// eşleme Türkçe'yi doğru yapar, NFD geri kalanını kurtarır.
/// </para>
/// </remarks>
public static class PoiCategorySlug
{
    /// <summary>Entity/EF sınırıyla aynı.</summary>
    public const int MaxLength = PoiCategory.MaxSlugLength;

    /// <summary>
    /// Türkçe karakterlerin ASCII karşılıkları. Büyük harfler de AÇIKÇA
    /// listelenir; küçültme sonrası eşlemeye güvenmek, <c>İ</c> için yanlış
    /// sonuç verirdi.
    /// </summary>
    private static readonly Dictionary<char, char> TurkishFolding = new()
    {
        ['ı'] = 'i', ['I'] = 'i', ['İ'] = 'i', ['i'] = 'i',
        ['ğ'] = 'g', ['Ğ'] = 'g',
        ['ü'] = 'u', ['Ü'] = 'u',
        ['ş'] = 's', ['Ş'] = 's',
        ['ö'] = 'o', ['Ö'] = 'o',
        ['ç'] = 'c', ['Ç'] = 'c'
    };

    /// <summary>
    /// Görünen addan slug üretir.
    /// </summary>
    /// <returns>
    /// Üretilebildiyse <c>true</c> ve kanonik slug; addan hiçbir ASCII
    /// harf/rakam çıkmadıysa <c>false</c>.
    /// </returns>
    /// <remarks>
    /// <b>Sessizce boş slug ÜRETMEZ.</b> Yalnızca noktalama ya da yalnızca
    /// desteklenmeyen bir yazı sisteminden oluşan bir ad (<c>"---"</c>,
    /// <c>"…"</c>) boş bir teknik kimliğe indirgenirdi; boş slug ise bir kimlik
    /// değildir ve tekillik kısıtında ilk satırdan sonra her şeyi kilitlerdi.
    /// Bu durumda üretim BAŞARISIZ olur ve çağıran doğrulama hatası döndürür.
    /// </remarks>
    public static bool TryCreate(string? name, out string slug)
    {
        slug = string.Empty;

        if (string.IsNullOrWhiteSpace(name))
        {
            return false;
        }

        var folded = Fold(name.Trim());
        var builder = new StringBuilder(folded.Length);

        foreach (var character in folded)
        {
            if (character is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                builder.Append(character);
            }
            else if (builder.Length > 0 && builder[^1] != '-')
            {
                /* Desteklenmeyen her şey (boşluk, noktalama, kalan harfler) tek
                   bir tireye indirgenir; ardışık olanlar tek tire olarak kalır
                   çünkü son karakter zaten tire ise yenisi eklenmez. Baştaki
                   tireler ise hiç yazılmaz (builder boşken atlanır). */
                builder.Append('-');
            }
        }

        var candidate = builder.ToString().TrimEnd('-');

        if (candidate.Length > MaxLength)
        {
            /* Ad 150 karaktere kadar olabilir, slug 80. Kesme deterministiktir
               ve kesme sonucu bir tirede bitebileceği için yeniden budanır.
               Kesmenin ürettiği olası bir çakışma sessizce -2 eklenerek
               GİZLENMEZ; çağıran tekillik denetiminde açık bir çakışma hatası
               döndürür. */
            candidate = candidate[..MaxLength].TrimEnd('-');
        }

        if (candidate.Length == 0)
        {
            return false;
        }

        slug = candidate;

        return true;
    }

    /// <summary>
    /// Değer kanonik slug biçiminde mi:
    /// <c>^[a-z0-9]+(?:-[a-z0-9]+)*$</c> ve en fazla <see cref="MaxLength"/>.
    /// </summary>
    /// <remarks>
    /// Üretim yolundan geçmeyen değerleri (katalog sabitleri, veritabanından
    /// okunan eski satırlar) sınamak için vardır. Elle yazılmış bir regex
    /// yerine açık bir tarama kullanılır — kural üç cümlelik ve okunabilir.
    /// </remarks>
    public static bool IsCanonical(string? value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > MaxLength)
        {
            return false;
        }

        // Tire ile başlayamaz/bitemez ve iki tire yan yana gelemez.
        if (value[0] == '-' || value[^1] == '-')
        {
            return false;
        }

        for (var index = 0; index < value.Length; index++)
        {
            var character = value[index];

            if (character is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                continue;
            }

            if (character != '-' || value[index - 1] == '-')
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Türkçe açık eşleme + NFD aksan ayrıştırması + küçük harf.
    /// </summary>
    private static string Fold(string value)
    {
        var mapped = new StringBuilder(value.Length);

        foreach (var character in value)
        {
            mapped.Append(
                TurkishFolding.TryGetValue(character, out var folded)
                    ? folded
                    : char.ToLowerInvariant(character));
        }

        // Kalan aksanlı Latin harfleri (é, â, ñ) taban harfe indirgenir.
        var decomposed = mapped.ToString().Normalize(NormalizationForm.FormD);
        var stripped = new StringBuilder(decomposed.Length);

        foreach (var character in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(character) != UnicodeCategory.NonSpacingMark)
            {
                stripped.Append(character);
            }
        }

        return stripped.ToString();
    }
}
