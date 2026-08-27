namespace StajProject.Domain.Common;

/// <summary>
/// Bir coğrafi yetki alanının NASIL oluşturulduğu.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bu alan geometrik yetkilendirmede KULLANILMAZ.</b> "Bu kullanıcı buraya
/// çizebilir mi" sorusunun tek cevabı saklanan poligonun kendisidir. Kaynak
/// bilgisi yönetim sunumuna ek olarak konum analizinin idari hedef kataloğunda
/// açık il/bölge atamasını korur; katalogdan seçilen geometri yine saklanan
/// etkin poligona karşı <c>Covers</c> denetiminden geçer.
/// </para>
/// <para>
/// <b>Sayısal değerler saklanır ve DEĞİŞTİRİLEMEZ</b> — <see cref="AccountStatus"/>
/// ile aynı sözleşme. Mevcut satırların anlamı bu sıralamaya bağlıdır.
/// </para>
/// </remarks>
public enum GeographicAreaSource
{
    /// <summary>Yönetici tarafından harita üzerinde serbestçe çizilmiş alan.</summary>
    ManualPolygon = 0,

    /// <summary>Bir il sınırından üretilmiş alan. Anahtar için bkz. SourceKey.</summary>
    Province = 1,

    /// <summary>Coğrafi bölge seçiminden üretilmiş alan.</summary>
    Region = 2,

    /// <summary>Elle girilen koordinat listesinden üretilmiş alan.</summary>
    Coordinates = 3
}
