using StajProject.Domain.Entities;

namespace StajProject.Application.Pois;

/// <summary>
/// Kategori renginin <b>tek doğrulama ve normalleştirme noktası</b>.
/// Kanonik biçim <c>#RRGGBB</c>, harfler büyük.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden tek bir kanonik yazım.</b> <c>#ef4444</c> ile <c>#EF4444</c> aynı
/// rengi gösterir ama farklı METİNLERDİR. İkisi de saklanabilseydi, aynı
/// sektörün kategorileri gruplama/eşitlik karşılaştırmalarında iki ayrı değer
/// gibi davranır, ileride üretilecek SLD kuralları da aynı rengi iki kez
/// tanımlardı. Yazma anında büyük harfe normalize etmek bu ayrışmayı baştan
/// kapatır.
/// </para>
/// <para>
/// <b>Alfa kanalı YOKTUR ve istenmemektedir.</b> Kategori rengi bir KİMLİK
/// rengidir (simge dolgusu, efsane kutucuğu, arama satırı vurgusu); saydamlık
/// ise bir SUNUM kararıdır ve çizim tarafında zaten ayrı bir sayısal alan
/// olarak durur (<c>FillOpacity</c>). Buraya alfa eklemek, ikinci ve rakip bir
/// saydamlık kaynağı yaratırdı.
/// </para>
/// <para>
/// <b><c>#RGB</c> kısa yazımı REDDEDİLİR</b>, sessizce genişletilmez. Kısa
/// yazımı kabul edip açmak, kullanıcının yazdığından farklı bir değerin
/// saklanması demektir; reddetmek ise ne olduğunu açıkça söyler.
/// </para>
/// </remarks>
public static class PoiCategoryColor
{
    /// <summary>Entity/EF sınırıyla aynı: <c>#</c> + altı basamak.</summary>
    public const int Length = PoiCategory.ColorHexLength;

    /// <summary>
    /// Değeri doğrular ve kanonik biçime çevirir.
    /// </summary>
    /// <returns>
    /// Geçerliyse <c>true</c> ve büyük harfli <c>#RRGGBB</c>; aksi hâlde
    /// <c>false</c>.
    /// </returns>
    public static bool TryCanonicalize(string? value, out string canonical)
    {
        canonical = string.Empty;

        if (value is null)
        {
            return false;
        }

        var trimmed = value.Trim();

        /* Uzunluk denetimi TEK BAŞINA hem #RGB kısa yazımını (4) hem de
           #RRGGBBAA alfa yazımını (9) eler; ikisi için ayrı kural yazmaya gerek
           yoktur — kanonik biçim tam olarak yedi karakterdir. */
        if (trimmed.Length != Length || trimmed[0] != '#')
        {
            return false;
        }

        Span<char> buffer = stackalloc char[Length];
        buffer[0] = '#';

        for (var index = 1; index < Length; index++)
        {
            var character = trimmed[index];

            if (!char.IsAsciiHexDigit(character))
            {
                return false;
            }

            buffer[index] = char.ToUpperInvariant(character);
        }

        canonical = new string(buffer);

        return true;
    }
}
