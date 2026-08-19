namespace StajProject.Domain.Entities;

/// <summary>
/// Sistemde yapılmış TEK bir anlamlı işlemin kalıcı kaydı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Bir istek izi (request trace) DEĞİLDİR.</b> Harita döşemeleri, listeleme
/// çağrıları ve genel olarak okuma istekleri buraya hiç girmez. Girselerdi
/// tablo günde on binlerce satırla dolar ve "kim neyi değiştirdi" sorusunun
/// cevabı gürültünün içinde kaybolurdu. Kaydedilen şey, sistemin durumunu
/// DEĞİŞTİRMEYE yönelik işlemlerdir.
/// </para>
/// <para>
/// <b>Hiçbir sır saklanmaz.</b> Parola, JWT, refresh token, 2FA secret,
/// kurtarma kodu, e-posta doğrulama token'ı ve Authorization başlığı buraya
/// ASLA yazılmaz. Bu bir söz değil, yapısal bir kısıttır: kaydı üreten filtre
/// istek GÖVDESİNDEN hiçbir metin okumaz (bkz. ActivityLogFilter), dolayısıyla
/// bir parola ya da WKT'nin buraya sızabileceği bir yol yoktur.
/// </para>
/// <para>
/// <b>Aktör adı ANLIK KOPYADIR.</b> <see cref="ActorUserId"/> yanında adın da
/// saklanması bilinçlidir: kullanıcı sonradan silinir ya da yeniden
/// adlandırılırsa, geçmiş kayıt "kim yaptı" sorusunu hâlâ yanıtlayabilmelidir.
/// Bir JOIN'e bağlanan kayıt, aktörüyle birlikte okunamaz hâle gelirdi.
/// </para>
/// </remarks>
public class ActivityLog
{
    public const int MaxActionLength = 128;
    public const int MaxUsernameLength = 256;
    public const int MaxResourceTypeLength = 64;
    public const int MaxResourceIdLength = 64;
    public const int MaxHttpMethodLength = 10;
    public const int MaxPathLength = 512;
    public const int MaxClientIpLength = 64;
    public const int MaxDetailsLength = 1024;

    public int Id { get; set; }

    /// <summary>
    /// İşlemi yapan kullanıcı. Kimlik daima doğrulanmış token'dan gelir,
    /// istek gövdesinden ASLA okunmaz.
    /// </summary>
    public int? ActorUserId { get; set; }

    /// <summary>İşlem anındaki kullanıcı adı — sonradan değişse bile korunur.</summary>
    public string? ActorUsername { get; set; }

    /// <summary>
    /// Kanonik işlem kodu (<c>geographic_area.create</c> gibi).
    /// </summary>
    /// <remarks>
    /// Rotadan ya da controller adından TÜRETİLMEZ; açık bir kayıt
    /// tablosundan okunur. Türetilseydi bir rotanın yeniden adlandırılması
    /// geçmiş kayıtlarla eşleşmeyen yeni bir kelime dağarcığı üretirdi.
    /// </remarks>
    public string Action { get; set; } = string.Empty;

    /// <summary>Etkilenen kaynağın türü (<c>user</c>, <c>role</c>, <c>drawing</c>).</summary>
    public string? ResourceType { get; set; }

    /// <summary>
    /// Etkilenen kaynağın kimliği. Metin olarak saklanır çünkü her kaynak
    /// türünün anahtarı tamsayı değildir.
    /// </summary>
    public string? ResourceId { get; set; }

    public string HttpMethod { get; set; } = string.Empty;

    /// <summary>İstek yolu. Query string DAHİL DEĞİLDİR: sır taşıyabilir.</summary>
    public string Path { get; set; } = string.Empty;

    /// <summary>
    /// İşlemin HTTP sonucu. Başarısız denemeler de kaydedilir — bir yetki
    /// reddi, başarılı bir işlem kadar anlamlı bir denetim olayıdır.
    /// </summary>
    public int StatusCode { get; set; }

    public DateTime OccurredAt { get; set; }

    /// <summary>
    /// İşleme dair ek bağlam (JSON). Yalnızca rota değerleri ve enum tipli
    /// alanlar girer; istek gövdesinden hiçbir METİN buraya ulaşmaz.
    /// </summary>
    public string? Details { get; set; }

    /// <summary>İsteğin geldiği adres; belirlenemezse <c>null</c>.</summary>
    public string? ClientIp { get; set; }
}
