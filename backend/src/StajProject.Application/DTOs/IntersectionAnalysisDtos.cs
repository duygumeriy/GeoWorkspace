namespace StajProject.Application.DTOs;

/// <summary>
/// POST /api/analysis/intersections gövdesi.
/// <para>
/// Geometry, çizim endpoint'leriyle aynı sözleşmeyi kullanır: EPSG:4326 WKT.
/// Analiz için gönderilen geometry kaydedilmez; yalnızca sorgu parametresidir.
/// </para>
/// </summary>
public class IntersectionAnalysisRequest
{
    /// <summary>EPSG:4326 WKT. Yalnızca POLYGON kabul edilir.</summary>
    public string Wkt { get; set; } = string.Empty;

    /// <summary>
    /// Sayımdan çıkarılacak poligon kaydı. Yeni kaydedilmiş bir poligon kendi
    /// analizini çalıştırdığında kendisini envanter olarak saymasın diye
    /// gönderilir. Geçici analiz aracında null'dır.
    /// </summary>
    public int? ExcludePolygonId { get; set; }
}

/// <summary>
/// Kesişim analizi sonucu. Envanter, kayıtlı çizim kayıtlarının tamamıdır
/// (tbl_point + tbl_line + tbl_polygon); kırılım da bu üç tabloya karşılık gelir.
/// </summary>
public class IntersectionAnalysisResponse
{
    public int TotalCount { get; set; }

    public int PointCount { get; set; }

    public int LineCount { get; set; }

    public int PolygonCount { get; set; }
}
