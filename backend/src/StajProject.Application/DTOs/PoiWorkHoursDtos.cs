namespace StajProject.Application.DTOs;

/// <summary>
/// Haftalık mesai programının API sözleşmesi.
/// </summary>
/// <remarks>
/// <para>
/// <b>Ham JSON metni istemciye ASLA verilmez.</b> Veritabanında değer bir
/// <c>jsonb</c> kolonunda durur (<c>Poi.WorkHoursJson</c>), ama sözleşme
/// yapılandırılmış bu tiptir: metin dönseydi her istemci kendi ayrıştırıcısını
/// yazmak zorunda kalır ve saklama biçimi sessizce bir API sözleşmesine
/// dönüşürdü.
/// </para>
/// <para>
/// Yedi gün ayrı property'dir, sözlük değil: gün kümesi sabittir ve tip
/// üzerinden görünür olması, "monday" ile "Monday" arasındaki yazım
/// belirsizliğini baştan kaldırır.
/// </para>
/// </remarks>
public class PoiWorkHoursDto
{
    public PoiWorkHoursDayDto? Monday { get; set; }

    public PoiWorkHoursDayDto? Tuesday { get; set; }

    public PoiWorkHoursDayDto? Wednesday { get; set; }

    public PoiWorkHoursDayDto? Thursday { get; set; }

    public PoiWorkHoursDayDto? Friday { get; set; }

    public PoiWorkHoursDayDto? Saturday { get; set; }

    public PoiWorkHoursDayDto? Sunday { get; set; }
}

/// <summary>Tek bir günün programı.</summary>
/// <remarks>
/// <para>
/// <b>Dört ayrı durum vardır.</b> Günün hiç gönderilmemesi (<c>null</c>) "bu
/// gün için bilgi yok" demektir ve <see cref="Closed"/> ile
/// karıştırılmamalıdır — "bilinmiyor" ile "kapalı" farklı şeylerdir ve arayüz
/// ikisini farklı göstermelidir. Kalan üçü: kapalı, kesintisiz açık
/// (<see cref="Open24Hours"/>) ve saatli aralık.
/// </para>
/// <para>
/// <see cref="Open"/> / <see cref="Close"/> <c>HH:mm</c> biçiminde, 24 saatlik
/// gösterimdedir. <see cref="Closed"/> ya da <see cref="Open24Hours"/> true
/// iken ikisi de anlamsızdır ve saklanmaz.
/// </para>
/// </remarks>
public class PoiWorkHoursDayDto
{
    public bool Closed { get; set; }

    /// <summary>
    /// Gün kesintisiz açık mı.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Neden eşit saatlerle temsil edilmiyor.</b> "00:00 – 00:00" yazmak,
    /// süresi olmayan bir aralıkla 24 saati aynı veriye sıkıştırmak olurdu ve
    /// hangisinin kastedildiği bir daha hiçbir yerden anlaşılamazdı. Eşit
    /// açılış/kapanış GEÇERSİZ kalır; 24 saat açık olmak kendi açık bayrağını
    /// taşır.
    /// </para>
    /// <para>
    /// <b>Alanı taşımayan eski satırlar geçerlidir</b> ve <c>false</c> olarak
    /// okunur: <c>work_hours</c> bir <c>jsonb</c> kolonudur, yeni bir özellik
    /// eklemek şema değişikliği gerektirmez.
    /// </para>
    /// <para>
    /// <see cref="Closed"/> ile aynı anda true olamaz; çelişkili gövde
    /// reddedilir.
    /// </para>
    /// </remarks>
    public bool Open24Hours { get; set; }

    /// <summary>
    /// <c>HH:mm</c>. <see cref="Closed"/> ya da <see cref="Open24Hours"/> true
    /// ise <c>null</c>.
    /// </summary>
    public string? Open { get; set; }

    /// <summary>
    /// <c>HH:mm</c>. <see cref="Closed"/> ya da <see cref="Open24Hours"/> true
    /// ise <c>null</c>.
    /// </summary>
    public string? Close { get; set; }
}
