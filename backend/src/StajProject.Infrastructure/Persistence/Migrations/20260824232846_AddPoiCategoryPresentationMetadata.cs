using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// POI kategorilerine sunum metadatası ekler: <c>slug</c> (teknik kimlik),
    /// <c>icon_key</c> ve <c>color_hex</c>.
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Dört adım ZORUNLUDUR, bir tercih değildir.</b> EF'in ürettiği
    /// varsayılan biçim <c>slug</c>'ı tek adımda <c>NOT NULL DEFAULT ''</c>
    /// olarak eklerdi; bu, mevcut BÜTÜN satırlara aynı boş değeri yazar ve
    /// hemen ardından kurulan tekillik indeksi ikinci satırda göçü
    /// patlatırdı. Kolon önce NULL kabul ederek eklenir, doldurulur, sonra
    /// sıkılaştırılır.
    /// </para>
    /// <para>
    /// <b>Hiçbir satır SİLİNMEZ, hiçbir kimlik DEĞİŞMEZ.</b> Kimlikler 1–5
    /// arası satırlar yerinde güncellenir: <c>id</c> ve <c>parent_id</c>
    /// korunur, <c>poi.kategori_id</c>'ye dokunulmaz. Yeniden adlandırma
    /// yerine silip yeniden oluşturmak, <c>ON DELETE RESTRICT</c> yüzünden
    /// zaten reddedilirdi (ID 1 ve 4'e bağlı POI'ler vardır) ve yeni kimlikler
    /// üretilmesi tüm FK bağlarının yeniden yazılmasını gerektirirdi.
    /// </para>
    /// </remarks>
    public partial class AddPoiCategoryPresentationMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            /* --- ADIM 1: kolonlar, önce NULL kabul ederek --------------------- */

            migrationBuilder.AddColumn<string>(
                name: "slug",
                table: "poi_category",
                type: "character varying(80)",
                maxLength: 80,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "icon_key",
                table: "poi_category",
                type: "character varying(50)",
                maxLength: 50,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "color_hex",
                table: "poi_category",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            /* --- ADIM 2: doğrulanmış mevcut beş satır ------------------------- */

            /* Her güncelleme İKİ koşulla korunur:

               - `slug IS NULL`  : göç yalnızca henüz kimliği olmayan satıra
                                   yazar,
               - `name = '<beklenen ad>'` : satırın gerçekten beklenen kategori
                                   olduğunu doğrular.

               İkinci koşul kritiktir. Bu göç, DOĞRULANMIŞ bir yerel taban
               üzerine yazılmıştır; başka bir ortamda `id = 1` bambaşka bir
               kategori olabilir. Yalnızca kimliğe bakan bir UPDATE, o ortamda
               ilgisiz bir kategoriyi sessizce "Yeme-İçme Yerleri" yapardı.
               Ad tutmazsa satır ADIM 3'teki teknik yedeğe düşer ve ADI
               DEĞİŞMEZ. */

            migrationBuilder.Sql(
                """
                UPDATE poi_category
                SET name = 'Yeme-İçme Yerleri',
                    slug = 'yeme-icme',
                    icon_key = 'utensils',
                    color_hex = '#F97316'
                WHERE id = 1 AND slug IS NULL AND name = 'Yeme-İçme';
                """);

            migrationBuilder.Sql(
                """
                UPDATE poi_category
                SET name = 'Kafe',
                    slug = 'kafe',
                    icon_key = 'coffee',
                    color_hex = '#F97316'
                WHERE id = 2 AND slug IS NULL AND name = 'kafe';
                """);

            migrationBuilder.Sql(
                """
                UPDATE poi_category
                SET name = 'Restoran',
                    slug = 'restoran',
                    icon_key = 'utensils-crossed',
                    color_hex = '#F97316'
                WHERE id = 3 AND slug IS NULL AND name = 'restoran';
                """);

            migrationBuilder.Sql(
                """
                UPDATE poi_category
                SET name = 'Eğlence Yerleri',
                    slug = 'eglence-yerleri',
                    icon_key = 'party-popper',
                    color_hex = '#EC4899'
                WHERE id = 4 AND slug IS NULL AND name = 'Eğlence';
                """);

            /* ID 5'in ADI ZATEN DOĞRUDUR; yalnızca metadata eklenir. */
            migrationBuilder.Sql(
                """
                UPDATE poi_category
                SET slug = 'konser-alani',
                    icon_key = 'music',
                    color_hex = '#EC4899'
                WHERE id = 5 AND slug IS NULL AND name = 'Konser Alanı';
                """);

            /* --- ADIM 3: bilinmeyen mevcut satırlar için teknik yedek --------- */

            /* Başka bir ortamda yönetici tarafından elle oluşturulmuş
               kategoriler bulunabilir. Bunlar slug'sız kalırsa ADIM 4'teki
               NOT NULL göçü patlatır.

               NEDEN `category-<id>` VE NEDEN ADDAN TÜRETİLMİŞ BİR SLUG DEĞİL:
               slug üretimi Türkçe'ye duyarlı bir katlama gerektirir
               (`PoiCategorySlug`) ve göç SQL'i uygulama C# yardımcılarını
               çağıramaz. Aynı kuralı SQL içinde yeniden yazmak, iki ayrı ve
               kaçınılmaz olarak ayrışacak bir gerçek kaynağı üretirdi;
               eksik/yanlış bir transliterasyon ise kalıcı ve DEĞİŞMEZ bir
               teknik kimlik olarak veritabanına yazılırdı.

               `category-<id>` bunun yerine üç şeyi birden garanti eder:
               deterministiktir, `id` tekil olduğu için ÇAKIŞAMAZ ve kanonik
               taksonominin hiçbir slug'ıyla karışmaz. Slug zaten teknik bir
               kimliktir — okunabilir olması bir gereklilik değildir.

               Bu satırların ADI, ÜSTÜ ve metadatası DEĞİŞTİRİLMEZ: kanonik
               taksonomiye atanmazlar, `icon_key` ve `color_hex` NULL kalır ve
               render tarafı yedeğe düşer. */
            migrationBuilder.Sql(
                """
                UPDATE poi_category
                SET slug = 'category-' || id
                WHERE slug IS NULL;
                """);

            /* --- ADIM 4: sıkılaştırma ---------------------------------------- */

            migrationBuilder.AlterColumn<string>(
                name: "slug",
                table: "poi_category",
                type: "character varying(80)",
                maxLength: 80,
                nullable: false,
                oldClrType: typeof(string),
                oldType: "character varying(80)",
                oldMaxLength: 80,
                oldNullable: true);

            /* KÜRESEL tekillik: kapsam parent DEĞİL, indeks kısmi DEĞİL.
               Pasif/silinmiş satırlar da dâhildir — emekliye ayrılmış bir
               kategorinin teknik kimliği yeniden kullanılamaz. */
            migrationBuilder.CreateIndex(
                name: "IX_poi_category_slug",
                table: "poi_category",
                column: "slug",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_poi_category_slug",
                table: "poi_category");

            /* ADIM 2'deki yeniden adlandırmalar geri alınır — ama YALNIZCA
               satır hâlâ göçün yazdığı adı taşıyorsa. Bir yönetici o kategoriyi
               sonradan yeniden adlandırdıysa, geri alma onun kararını
               ezmez. */

            migrationBuilder.Sql(
                """
                UPDATE poi_category SET name = 'Yeme-İçme'
                WHERE id = 1 AND name = 'Yeme-İçme Yerleri';
                """);

            migrationBuilder.Sql(
                """
                UPDATE poi_category SET name = 'kafe'
                WHERE id = 2 AND name = 'Kafe';
                """);

            migrationBuilder.Sql(
                """
                UPDATE poi_category SET name = 'restoran'
                WHERE id = 3 AND name = 'Restoran';
                """);

            migrationBuilder.Sql(
                """
                UPDATE poi_category SET name = 'Eğlence'
                WHERE id = 4 AND name = 'Eğlence Yerleri';
                """);

            /* ID 5'in adı Up içinde değiştirilmedi; geri alınacak bir şey yok. */

            migrationBuilder.DropColumn(
                name: "color_hex",
                table: "poi_category");

            migrationBuilder.DropColumn(
                name: "icon_key",
                table: "poi_category");

            migrationBuilder.DropColumn(
                name: "slug",
                table: "poi_category");
        }
    }
}
