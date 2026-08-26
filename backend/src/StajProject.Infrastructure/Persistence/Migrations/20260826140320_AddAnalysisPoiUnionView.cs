using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Konum analizinin TEK mantıksal veri kümesi: <c>analysis_poi</c> (açık
    /// veri) + aktif ve silinmemiş <c>poi</c> (uygulama envanteri).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Neden veritabanında.</b> Birleşimin İKİ tüketicisi vardır ve biri
    /// EF değildir: konum analizinin bütün okuma yolları (özet, ölçüt
    /// kırılımı, raster, nokta listesi, isabet testi) ile GeoServer'ın
    /// <c>analysis_poi_read</c> SQL View'ı. Birleşimi C# tarafında
    /// <c>Concat</c> ile kurmak, GeoServer'ın onu ayrıca ve ELLE tekrar
    /// yazmasını gerektirirdi — iki tanım zamanla ayrışır ve ayrışma sessiz
    /// olur: özet ile haritadaki noktalar farklı kümelere bakmaya başlar.
    /// </para>
    /// <para>
    /// <b><c>UNION ALL</c>, <c>UNION</c> değil.</b> İki kaynak arasında
    /// paylaşılan güvenilir bir dış kimlik YOKTUR (<c>analysis_poi</c>
    /// <c>source</c>+<c>external_id</c> taşır, <c>poi</c> hiç taşımaz), bu
    /// yüzden "aynı kayıt" ancak bulanık bir eşleştirmeyle tahmin edilebilirdi.
    /// <c>UNION</c> yalnızca SATIRIN TAMAMI aynı olduğunda tekilleştirir ve
    /// kimlikler zaten farklı olduğu için burada hiçbir şey yapmaz — yani
    /// maliyeti (sıralama/hash) öder, faydası olmaz.
    /// </para>
    /// <para>
    /// <b>Kimlik kaynakla birlikte kurulur.</b> <c>poi.id</c> ve
    /// <c>analysis_poi.id</c> ayrı identity dizileridir ve çakışırlar;
    /// <c>feature_id</c> (<c>"app:42"</c> / <c>"osm:42"</c>) birleşimdeki tek
    /// tekil kimliktir. GeoServer SQL View'ının identifier'ı da budur.
    /// </para>
    /// <para>
    /// <b>İndeksler KULLANILABİLİR kalır.</b> PostgreSQL <c>UNION ALL</c>
    /// view'larını düzleştirir ve <c>WHERE</c> yüklemlerini kollara iter;
    /// <c>ST_Intersects</c> her iki taban tablonun kendi GiST indeksinden
    /// (<c>IX_analysis_poi_coordinate</c>, <c>IX_poi_coordinate</c>),
    /// <c>category_id = ANY(...)</c> ise kategori indekslerinden yararlanır.
    /// View bu yüzden ayrı bir MATERIALIZED kopya değildir: bayatlamaz,
    /// yenilenmesi gerekmez ve yeni eklenen bir POI bir sonraki analizde
    /// ANINDA görünür.
    /// </para>
    /// <para>
    /// <b>Uygulama POI'sinin süzgeci taban sözleşmenin AYNISIDIR:</b>
    /// <c>is_deleted = false AND is_active = true</c> — EF global query
    /// filter'ı ve <c>poi_read</c> SQL View'ı ile birebir. Sahiplik yüklemi
    /// YOKTUR: POI ortak bir envanterdir ve projenin hiçbir okuma yolu onu
    /// sahibine göre süzmez.
    /// </para>
    /// </remarks>
    public partial class AddAnalysisPoiUnionView : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql(
                """
                CREATE OR REPLACE VIEW analysis_poi_union AS
                SELECT
                    'osm:' || a.id::text AS feature_id,
                    'analysis'::text     AS source_kind,
                    a.id                 AS source_id,
                    a.name::text         AS name,
                    a.category_id        AS category_id,
                    a.coordinate         AS coordinate,
                    a.source::text       AS source
                FROM analysis_poi AS a
                UNION ALL
                SELECT
                    'app:' || p.id::text AS feature_id,
                    'app'::text          AS source_kind,
                    p.id                 AS source_id,
                    p.isim::text         AS name,
                    p.kategori_id        AS category_id,
                    p.coordinate         AS coordinate,
                    'app'::text          AS source
                FROM poi AS p
                WHERE p.is_deleted = false
                  AND p.is_active = true;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.Sql("DROP VIEW IF EXISTS analysis_poi_union;");
        }
    }
}
