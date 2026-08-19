using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Coğrafi yetki alanlarını hedef başına ÇOK satıra açar (Phase 9).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Tablo DÜŞÜRÜLMEZ, satırlar SİLİNMEZ.</b> Yürürlükteki kurulumlarda
    /// elle tanımlanmış gerçek yetki alanları vardır; bu geçiş tamamen
    /// EKLEMELİDİR. Yeni kolonlar önce boş bırakılır, mevcut satırlar
    /// doldurulur, ancak ondan sonra NOT NULL yapılır — tersi sıra, tek satırı
    /// olan bir veritabanında bile geçişi başarısız kılardı.
    /// </para>
    /// <para>
    /// <b>Poligonlara DOKUNULMAZ.</b> <c>area</c> kolonu bu geçişte hiç
    /// yazılmaz: mevcut bir alanın geometrisi bit düzeyinde aynı kalır.
    /// Değişen tek şey, o satırın artık yanına kardeş satırlar alabilmesidir.
    /// </para>
    /// <para>
    /// <b>Kaldırılan kısıt.</b> Eski kısmi UNIQUE indeksler ("hedef başına en
    /// fazla bir satır") düşürülür ve yerlerine aynı kolonlar üzerinde normal
    /// indeksler gelir. İndeksler korunur çünkü çizim yolu her istekte
    /// "bu hedefin alanları" sorgusunu çalıştırır; kaldırmak onu tablo
    /// taramasına düşürürdü. GiST mekânsal indeks ise hiç dokunulmadan kalır.
    /// </para>
    /// </remarks>
    public partial class ExpandGeographicAuthorizationsToMultipleAreas : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            /* 1) Teklik kısıtını kaldır. Bu ADIM ÖNCE gelmelidir: kolonlar
                  eklendikten sonra bile ikinci bir satır yazılamazdı. */
            migrationBuilder.DropIndex(
                name: "IX_geographic_authorizations_role_id",
                table: "geographic_authorizations");

            migrationBuilder.DropIndex(
                name: "IX_geographic_authorizations_user_id",
                table: "geographic_authorizations");

            /* 2) Yeni kolonlar ÖNCE NULL kabul ederek eklenir. Doğrudan NOT
                  NULL + DEFAULT eklemek, kalıcı bir sütun varsayılanı bırakır
                  ve ileride adı unutulmuş bir INSERT'ün sessizce boş adlı bir
                  alan yazmasına izin verirdi. */
            migrationBuilder.AddColumn<string>(
                name: "name",
                table: "geographic_authorizations",
                type: "character varying(120)",
                maxLength: 120,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "source_type",
                table: "geographic_authorizations",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "source_key",
                table: "geographic_authorizations",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            /* 3) Mevcut satırların geriye dönük doldurulması.

                  Var olan her alan, tanımı gereği yöneticinin harita üzerinde
                  serbestçe çizdiği bir alandır (Phase 8B'de başka bir giriş
                  yolu yoktu), dolayısıyla kaynağı ManualPolygon = 0'dır.
                  Adı uydurulmaz; ne olduğunu dürüstçe söyleyen nötr bir ad
                  verilir ve yönetici dilediğinde değiştirir.

                  WHERE koşulları sayesinde tekrar çalıştırmak zararsızdır. */
            migrationBuilder.Sql(
                "UPDATE geographic_authorizations SET name = 'Mevcut alan' WHERE name IS NULL;");

            migrationBuilder.Sql(
                "UPDATE geographic_authorizations SET source_type = 0 WHERE source_type IS NULL;");

            // 4) Ancak dolduruldukları için NOT NULL yapılabilirler.
            migrationBuilder.AlterColumn<string>(
                name: "name",
                table: "geographic_authorizations",
                type: "character varying(120)",
                maxLength: 120,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(120)",
                oldMaxLength: 120,
                oldNullable: true);

            migrationBuilder.AlterColumn<int>(
                name: "source_type",
                table: "geographic_authorizations",
                type: "integer",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer",
                oldNullable: true);

            /* 5) Aynı kolonlar üzerinde artık BENZERSİZ OLMAYAN indeksler.
                  Kısmi filtre korunur: kolonlardan biri her satırda NULL'dur
                  ve filtresiz bir indeks o yarıyı boşuna taşırdı. */
            migrationBuilder.CreateIndex(
                name: "IX_geographic_authorizations_role_id",
                table: "geographic_authorizations",
                column: "role_id",
                filter: "role_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_geographic_authorizations_user_id",
                table: "geographic_authorizations",
                column: "user_id",
                filter: "user_id IS NOT NULL");
        }

        /// <summary>
        /// Geri alma. <b>Veri kaybı olmadan her zaman mümkün DEĞİLDİR</b> ve
        /// olmamalıdır: bir hedefe ikinci alan eklendikten sonra teklik
        /// indeksini geri koymak, o alanlardan birini silmeyi gerektirirdi.
        /// Böyle bir durumda geri alma, sessizce alan silmek yerine indeks
        /// çakışmasıyla BAŞARISIZ olur — güvenli olan davranış budur.
        /// </summary>
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_geographic_authorizations_role_id",
                table: "geographic_authorizations");

            migrationBuilder.DropIndex(
                name: "IX_geographic_authorizations_user_id",
                table: "geographic_authorizations");

            migrationBuilder.DropColumn(
                name: "name",
                table: "geographic_authorizations");

            migrationBuilder.DropColumn(
                name: "source_key",
                table: "geographic_authorizations");

            migrationBuilder.DropColumn(
                name: "source_type",
                table: "geographic_authorizations");

            migrationBuilder.CreateIndex(
                name: "IX_geographic_authorizations_role_id",
                table: "geographic_authorizations",
                column: "role_id",
                unique: true,
                filter: "role_id IS NOT NULL");

            migrationBuilder.CreateIndex(
                name: "IX_geographic_authorizations_user_id",
                table: "geographic_authorizations",
                column: "user_id",
                unique: true,
                filter: "user_id IS NOT NULL");
        }
    }
}
