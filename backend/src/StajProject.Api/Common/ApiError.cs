namespace StajProject.Api.Common;

/// <summary>
/// API'nin tek tip hata gövdesi.
/// </summary>
/// <remarks>
/// <para>
/// <c>message</c> alanı bilinçli olarak korunmuştur: mevcut frontend hata
/// okuyucusu (<c>readApiError</c>) bu alana bakar, dolayısıyla ortak formata
/// geçiş istemci tarafında hiçbir şeyi kırmaz. Diğer alanlar eklemedir.
/// </para>
/// <para>
/// <c>traceId</c> sunucu loguyla istemcide görülen hatayı eşleştirmek içindir;
/// hassas bilgi taşımaz. Stack trace ve exception detayı bu gövdeye <b>asla</b>
/// konmaz — beklenmeyen hataların detayı yalnızca sunucu logunda kalır.
/// </para>
/// </remarks>
public sealed class ApiError
{
    public int StatusCode { get; init; }

    /// <summary>Kullanıcıya gösterilebilir tek satır mesaj.</summary>
    public string Message { get; init; } = string.Empty;

    /// <summary>Alan bazlı doğrulama hataları; yoksa boş dizi.</summary>
    public IReadOnlyList<string> Errors { get; init; } = [];

    /// <summary>İsteğin sunucu logundaki karşılığını bulmaya yarar.</summary>
    public string TraceId { get; init; } = string.Empty;

    public static ApiError Create(int statusCode, string message, string traceId, IReadOnlyList<string>? errors = null) =>
        new()
        {
            StatusCode = statusCode,
            Message = message,
            Errors = errors ?? [],
            TraceId = traceId
        };
}
