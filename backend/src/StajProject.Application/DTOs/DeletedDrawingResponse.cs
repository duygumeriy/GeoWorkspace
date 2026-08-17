namespace StajProject.Application.DTOs;

/// <summary>
/// Çöp Kutusu listesinde tek bir silinmiş kayıt.
/// </summary>
/// <remarks>
/// <para>
/// Kaydın kendisi <see cref="DrawingResponse"/> olarak taşınır — ayrı bir "silinmiş
/// çizim" gövdesi tanımlanmaz. Çöp Kutusu aynı kaydı gösterir, farklı bir kaydı
/// değil: ad, stil, metadata ve WKT normal listeyle birebir aynı sözleşmeden
/// okunur, dolayısıyla geri yüklenen çizim haritada göründüğü gibi çöp kutusunda
/// da görünür.
/// </para>
/// <para>
/// Sarmalayıcının eklediği iki alan, listenin ihtiyaç duyduğu ve
/// <see cref="DrawingResponse"/> içinde bulunmayan tek bilgidir: kaydın hangi
/// tabloda olduğu (<see cref="Type"/>, geri yükleme isteği bunu ister) ve ne
/// zaman silindiği (<see cref="DeletedAt"/>).
/// </para>
/// </remarks>
public class DeletedDrawingResponse
{
    /// <summary>point | line | polygon. Geri yükleme isteğinin taşıdığı türle aynı yazım.</summary>
    public string Type { get; set; } = string.Empty;

    /// <summary>
    /// UTC silinme zamanı. Çöp Kutusu sıralaması bu alana dayanır;
    /// <c>ModifiedDate</c> bunun yerine kullanılamaz — kaydın son düzenlenme
    /// zamanı silinme zamanı değildir.
    /// </summary>
    public DateTime? DeletedAt { get; set; }

    /// <summary>Kaydın normal listelerdeki gövdesiyle aynı gövde.</summary>
    public DrawingResponse Drawing { get; set; } = new();
}
