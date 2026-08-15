namespace StajProject.Domain.Common;

/// <summary>
/// Çizim kategorilerinin <b>tek tanımı</b>. Backend doğrulaması, EF kolon
/// uzunluğu ve frontend'in gösterdiği seçenekler hep buradaki listeye dayanır;
/// kategori adları başka hiçbir dosyada string olarak tekrar edilmez.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden enum değil?</b> Kategoriler kullanıcıya görünen Türkçe etiketlerdir
/// ve veritabanında okunabilir kalmaları istenir (rapor/SQL tarafında
/// <c>'Çalışma Alanı'</c>, <c>3</c>'ten iyidir). Enum'a çevirmek ayrıca mevcut
/// satırlar için bir sayı↔metin eşlemesi taşımayı gerektirirdi. Bunun yerine
/// değerler sabit bir küme olarak burada durur ve
/// <see cref="Normalize"/> girişini bu kümeye oturtur.
/// </para>
/// <para>
/// Kategori <b>opsiyoneldir</b>: boş/null "kategori yok" demektir ve geçerlidir.
/// </para>
/// </remarks>
public static class DrawingCategories
{
    public const string General = "Genel";
    public const string Inventory = "Envanter";
    public const string WorkArea = "Çalışma Alanı";
    public const string Boundary = "Sınır";
    public const string Route = "Rota";
    public const string ReferencePoint = "Referans Noktası";
    public const string Other = "Diğer";

    /// <summary>Frontend'in de gösterdiği sıra; UI ile birebir aynıdır.</summary>
    public static readonly IReadOnlyList<string> All =
    [
        General,
        Inventory,
        WorkArea,
        Boundary,
        Route,
        ReferencePoint,
        Other
    ];

    /// <summary>EF <c>HasMaxLength</c> ile aynı sınır; en uzun değere göre seçildi.</summary>
    public const int MaxLength = 64;

    /// <summary>
    /// Girişi bilinen kategorilerden birine oturtur.
    /// </summary>
    /// <returns>
    /// Kanonik kategori adı; boş/null giriş için <c>null</c> ("kategori yok").
    /// Bilinmeyen bir değer için <c>false</c> döner.
    /// </returns>
    /// <remarks>
    /// Karşılaştırma kültüre duyarsız ve büyük/küçük harf farkını yok sayar:
    /// client "genel" gönderse de veritabanına daima kanonik <c>"Genel"</c> yazılır,
    /// böylece gruplama ve filtreleme tek bir yazımla çalışır.
    /// </remarks>
    public static bool TryNormalize(string? value, out string? normalized)
    {
        var trimmed = (value ?? string.Empty).Trim();

        if (trimmed.Length == 0)
        {
            normalized = null;
            return true;
        }

        foreach (var category in All)
        {
            if (string.Equals(category, trimmed, StringComparison.OrdinalIgnoreCase))
            {
                normalized = category;
                return true;
            }
        }

        normalized = null;
        return false;
    }
}
