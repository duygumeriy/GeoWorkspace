namespace StajProject.Application.Activity;

/// <summary>
/// Yazılmak üzere hazırlanmış tek bir aktivite kaydı.
/// </summary>
/// <remarks>
/// Entity'den ayrı bir tip olması bilinçlidir: kaydı ÜRETEN katman (API
/// filtresi) ile SAKLAYAN katman (Infrastructure) arasındaki sözleşme budur.
/// Filtreye doğrudan bir EF entity'si verdirmek, sunum katmanını persistence
/// modeline bağlardı.
/// </remarks>
/// <param name="Action">Kanonik işlem kodu (bkz. ActivityActionCatalog).</param>
/// <param name="ResourceType">Etkilenen kaynağın türü.</param>
/// <param name="ResourceId">Etkilenen kaynağın kimliği; yoksa <c>null</c>.</param>
/// <param name="HttpMethod">İsteğin HTTP metodu.</param>
/// <param name="Path">İstek yolu — query string HARİÇ.</param>
/// <param name="StatusCode">İşlemin HTTP sonucu.</param>
/// <param name="Details">Ek bağlam (JSON); sır İÇEREMEZ.</param>
/// <param name="ClientIp">İsteğin geldiği adres; bilinmiyorsa <c>null</c>.</param>
public sealed record ActivityLogEntry(
    string Action,
    string? ResourceType,
    string? ResourceId,
    string HttpMethod,
    string Path,
    int StatusCode,
    string? Details,
    string? ClientIp);
