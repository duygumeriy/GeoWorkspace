namespace StajProject.Application.Pois;

/// <summary>
/// POI aramasının sınırları ve desen kaçışı — <b>tek tanım</b>.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden ayrı ve saf bir sınıf.</b> Aynı sayılar üç yerde gerekir: servis
/// doğrulaması, testler ve istemcinin "iki karakterden kısa sorguda istek
/// gönderme" kuralı. Servisin içine gömülselerdi, testler kendi kopyalarını
/// taşır ve sınır değiştiğinde sessizce ayrışırlardı.
/// <see cref="StajProject.Application.Rendering.WmsRenderContract"/> ile aynı
/// yaklaşım.
/// </para>
/// </remarks>
public static class PoiSearchContract
{
    /// <summary>
    /// Anlamlı bir aramanın en kısa hâli.
    /// </summary>
    /// <remarks>
    /// Tek karakterlik bir sorgu envanterin neredeyse tamamıyla eşleşir:
    /// kullanıcıya yardımcı olmaz, buna karşılık her tuş vuruşunda tabloyu
    /// taratır. İstemci de bu sınırın altında istek AÇMAZ.
    /// </remarks>
    public const int MinimumQueryLength = 2;

    /// <summary>
    /// Kabul edilen en uzun sorgu.
    /// </summary>
    /// <remarks>
    /// <c>Poi.MaxNameLength</c> 200'dür; 100 karakter her gerçek adı bulmaya
    /// fazlasıyla yeter ve sınırsız uzunlukta bir desenin sunucuya
    /// gönderilmesini engeller.
    /// </remarks>
    public const int MaximumQueryLength = 100;

    /// <summary>Otomatik tamamlama listesinin doğal boyu.</summary>
    public const int DefaultLimit = 8;

    public const int MinimumLimit = 1;

    /// <summary>
    /// Üst sınır. Arama kutusu bir dışa aktarma ucu DEĞİLDİR; sayfalanmamış
    /// büyük bir sonuç kümesi bu sözleşmenin cevaplamadığı bir sorudur.
    /// </summary>
    public const int MaximumLimit = 20;

    /// <summary>
    /// <c>ILIKE ... ESCAPE</c> için kaçış karakteri.
    /// </summary>
    /// <remarks>
    /// Ters bölü seçilir çünkü PostgreSQL'in <c>LIKE</c> varsayılanıdır;
    /// yine de <c>ESCAPE</c> ile AÇIKÇA bildirilir, böylece davranış
    /// <c>standard_conforming_strings</c> gibi sunucu ayarlarına bağlı kalmaz.
    /// </remarks>
    public const string LikeEscapeCharacter = "\\";

    /// <summary>
    /// Kullanıcı metnini <c>LIKE</c> deseni olarak GÜVENLİ hâle getirir.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Bu bir SQL enjeksiyonu savunması değildir</b> — parametreleştirme onu
    /// zaten karşılar. Buradaki sorun anlamsal: kullanıcının yazdığı <c>%</c>
    /// ve <c>_</c> birer joker operatöre dönüşürse, tek bir <c>%</c> bütün
    /// envanteri döndürür ve <c>a_b</c> beklenmedik kayıtlarla eşleşir. Kullanıcı
    /// bir desen değil, ARADIĞI METNİ yazar.
    /// </para>
    /// <para>
    /// Kaçış karakterinin KENDİSİ önce kaçırılır; sonra jokerler. Sıra ters
    /// olsaydı, eklenen ters bölüler ikinci geçişte yeniden kaçırılırdı.
    /// </para>
    /// </remarks>
    public static string EscapeLikePattern(string value) => value
        .Replace(LikeEscapeCharacter, LikeEscapeCharacter + LikeEscapeCharacter, StringComparison.Ordinal)
        .Replace("%", LikeEscapeCharacter + "%", StringComparison.Ordinal)
        .Replace("_", LikeEscapeCharacter + "_", StringComparison.Ordinal);
}
