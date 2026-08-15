using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Çizim kayıtlarını gerçek Identity kullanıcısına bağlar.
    /// </summary>
    /// <remarks>
    /// <para>
    /// EF'in ürettiği varsayılan hâl (<c>nullable: false, defaultValue: 0</c>)
    /// bilinçli olarak değiştirilmiştir: mevcut satırlar <c>0</c> ile
    /// doldurulsaydı foreign key ilk anda ihlal edilir, kabul edilse bile tüm
    /// devralınan çizimler var olmayan bir kullanıcıya bağlanmış olurdu.
    /// </para>
    /// <para>
    /// Bunun yerine aşamalı ve doğrulanabilir bir yol izlenir:
    /// kolonu nullable ekle → legacy <c>CreatedBy</c> kullanıcı adından
    /// backfill et → eşleşmeyen kayıt kalmadığını DOĞRULA → NOT NULL yap →
    /// index + foreign key ekle.
    /// </para>
    /// <para>
    /// Eşleştirme <c>users.NormalizedUserName</c> üzerinden <b>tam eşleşme</b>
    /// ile yapılır (Identity'nin kendi normalizasyonu: büyük harf). Bulanık
    /// eşleştirme veya "ilk kullanıcı / id 1 / mevcut admin" gibi tahminler
    /// kasıtlı olarak yapılmaz — yanlış kullanıcıya sahiplik atamak, veri
    /// kaybından daha sinsi bir hatadır. Eşleşmeyen kayıt varsa migration
    /// açık bir mesajla durur ve hiçbir şey değiştirmez.
    /// </para>
    /// Geometry, ad, stil kolonları ve spatial (GiST) index'ler bu migration'da
    /// hiç değiştirilmez; kayıt silinmez.
    /// </remarks>
    public partial class AddDrawingOwnership : Migration
    {
        private static readonly string[] DrawingTables = ["tbl_point", "tbl_line", "tbl_polygon"];

        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1) Kolonu önce NULLABLE ekle: mevcut satırlar sahte bir değer almaz.
            foreach (var table in DrawingTables)
            {
                migrationBuilder.AddColumn<int>(
                    name: "CreatedByUserId",
                    table: table,
                    type: "integer",
                    nullable: true);
            }

            // 2) Legacy CreatedBy kullanıcı adından backfill (tam eşleşme).
            foreach (var table in DrawingTables)
            {
                migrationBuilder.Sql($"""
                    UPDATE "{table}" AS d
                    SET "CreatedByUserId" = u."Id"
                    FROM users AS u
                    WHERE u."NormalizedUserName" = upper(btrim(d."CreatedBy"));
                    """);
            }

            // 3) DOĞRULAMA: eşleşmeyen kayıt varsa migration burada durur.
            //    Böylece tahmin yürütmek yerine sorun görünür hâle gelir.
            migrationBuilder.Sql("""
                DO $$
                DECLARE
                    orphans int;
                    sample  text;
                BEGIN
                    SELECT count(*) INTO orphans FROM (
                        SELECT 1 FROM tbl_point   WHERE "CreatedByUserId" IS NULL
                        UNION ALL
                        SELECT 1 FROM tbl_line    WHERE "CreatedByUserId" IS NULL
                        UNION ALL
                        SELECT 1 FROM tbl_polygon WHERE "CreatedByUserId" IS NULL
                    ) AS missing;

                    IF orphans > 0 THEN
                        SELECT string_agg(DISTINCT c, ', ') INTO sample FROM (
                            SELECT "CreatedBy" AS c FROM tbl_point   WHERE "CreatedByUserId" IS NULL
                            UNION
                            SELECT "CreatedBy"      FROM tbl_line    WHERE "CreatedByUserId" IS NULL
                            UNION
                            SELECT "CreatedBy"      FROM tbl_polygon WHERE "CreatedByUserId" IS NULL
                        ) AS names;

                        RAISE EXCEPTION
                            'AddDrawingOwnership durduruldu: % çizim kaydinin CreatedBy degeri bir Identity kullanicisiyla eslesmiyor (eslesmeyen kullanici adlari: %). Sahiplik tahmin edilmez; once bu kullanicilari olusturun veya kayitlari duzeltin.',
                            orphans, coalesce(sample, '-');
                    END IF;
                END $$;
                """);

            // 4) Artık her satırın geçerli bir sahibi var: NOT NULL yapılabilir.
            foreach (var table in DrawingTables)
            {
                migrationBuilder.AlterColumn<int>(
                    name: "CreatedByUserId",
                    table: table,
                    type: "integer",
                    nullable: false,
                    oldClrType: typeof(int),
                    oldType: "integer",
                    oldNullable: true);
            }

            // 5) Sahibe göre arama ve FK doğrulaması için index.
            foreach (var table in DrawingTables)
            {
                migrationBuilder.CreateIndex(
                    name: $"IX_{table}_CreatedByUserId",
                    table: table,
                    column: "CreatedByUserId");
            }

            /* 6) Foreign key — Restrict.
                  Kullanıcı silinmesi çizimleri SİLMEZ; pasifleştirilen bir
                  kullanıcının çizimleri haritada kalır ve Admin tarafından
                  yönetilebilir. */
            foreach (var table in DrawingTables)
            {
                migrationBuilder.AddForeignKey(
                    name: $"FK_{table}_users_CreatedByUserId",
                    table: table,
                    column: "CreatedByUserId",
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            }
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Legacy CreatedBy kolonu hiç kaldırılmadığı için geri alma
            // kayıpsızdır: sahiplik bilgisi kullanıcı adı olarak yerinde kalır.
            foreach (var table in DrawingTables)
            {
                migrationBuilder.DropForeignKey(name: $"FK_{table}_users_CreatedByUserId", table: table);
                migrationBuilder.DropIndex(name: $"IX_{table}_CreatedByUserId", table: table);
                migrationBuilder.DropColumn(name: "CreatedByUserId", table: table);
            }
        }
    }
}
