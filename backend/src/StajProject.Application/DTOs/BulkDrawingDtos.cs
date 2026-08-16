namespace StajProject.Application.DTOs;

/// <summary>
/// Toplu işlemlerde tek bir kaydı adresleyen çift: hangi tabloda (<c>type</c>)
/// hangi satır (<c>id</c>). Client tarafında bir seçim birden çok geometry
/// türünü kapsayabildiği için tür her item ile birlikte gelir.
/// </summary>
public class BulkDrawingItem
{
    /// <summary>point | line | polygon (büyük/küçük harf duyarsız).</summary>
    public string Type { get; set; } = string.Empty;

    public int Id { get; set; }

    /// <summary>
    /// Yalnızca bulk-style'da anlamlıdır. Doluysa istek gövdesindeki ortak
    /// <c>style</c> yerine bu kayda özel stil uygulanır — undo sırasında her
    /// kaydın kendi eski stiline dönebilmesi tek atomik çağrıyla bu sayede
    /// mümkün olur.
    /// </summary>
    public DrawingStyleDto? Style { get; set; }
}

/// <summary>POST /api/drawings/bulk-delete gövdesi.</summary>
public class BulkDeleteRequest
{
    public List<BulkDrawingItem> Items { get; set; } = [];
}

/// <summary>
/// POST /api/drawings/restore gövdesi — soft-delete edilmiş kayıtları geri açar.
/// </summary>
/// <remarks>
/// Yalnızca <b>hangi kaydın</b> geri açılacağını taşır (tür + id). Geometry,
/// ad, stil ve <b>sahiplik</b> sunucudaki mevcut satırdan gelir; client bu
/// bilgilerin hiçbirini gönderemez. Bu yüzden restore, "yeni kayıt oluşturma"
/// değil, sunucunun zaten bildiği bir kaydın durumunu değiştirmesidir.
/// </remarks>
public class BulkRestoreRequest
{
    public List<BulkDrawingItem> Items { get; set; } = [];
}

/// <summary>PATCH /api/drawings/bulk-style gövdesi.</summary>
public class BulkStyleRequest
{
    public List<BulkDrawingItem> Items { get; set; } = [];

    /// <summary>
    /// Tüm item'lara uygulanacak ortak stil. Yalnızca dolu alanlar uygulanır;
    /// null bırakılan alanlar kaydın mevcut değerini korur. Bir alan ilgili
    /// geometry türü için anlamsızsa (ör. Line + fillOpacity) sessizce atlanır.
    /// </summary>
    public DrawingStyleDto? Style { get; set; }
}

/// <summary>Toplu yeniden oluşturma (bulk delete undo) için tek kayıt.</summary>
public class BulkCreateItem
{
    public string Type { get; set; } = string.Empty;

    /// <summary>EPSG:4326 WKT.</summary>
    public string Wkt { get; set; } = string.Empty;

    public string? Name { get; set; }

    public DrawingStyleDto? Style { get; set; }

    /* Metadata tekil create ile aynı kurallara tabidir. Burada da taşınır ki
       toplu yeniden oluşturma, kaydın açıklamasını/kategorisini/etiketlerini
       sessizce düşürmesin. */

    public string? Description { get; set; }

    public string? Category { get; set; }

    public List<string>? Tags { get; set; }
}

/// <summary>POST /api/drawings/bulk-create gövdesi.</summary>
public class BulkCreateRequest
{
    public List<BulkCreateItem> Items { get; set; } = [];
}

/// <summary>Toplu yanıtlarda bir kaydın türü + tam gövdesi.</summary>
public class BulkDrawingResult
{
    public string Type { get; set; } = string.Empty;

    public DrawingResponse Drawing { get; set; } = new();
}

/// <summary>POST /api/drawings/bulk-delete yanıtı.</summary>
public class BulkDeleteResponse
{
    public int DeletedCount { get; set; }
}

/// <summary>
/// bulk-style ve bulk-create yanıtı. Sıra daima istek sırasıyla aynıdır; client
/// böylece kendi stabil anahtarlarını dönen kayıtlarla eşleştirebilir.
/// </summary>
public class BulkDrawingsResponse
{
    public int Count { get; set; }

    public List<BulkDrawingResult> Items { get; set; } = [];
}
