using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations;

/// <summary>
/// Kullanıcıya ÖZEL, yeniden kullanılabilir kişisel yolculuk TANIMLARI.
/// </summary>
/// <remarks>
/// <para>
/// <b>Ne saklanır.</b> Yalnızca niyet: kip, profil, hat referansı ve sıralı
/// geçiş noktaları. Çalıştırma kimliği, ilerleme, anlık konum, güzergah
/// geometrisi ya da manevra verisi için KOLON YOKTUR — bunlar çalışma zamanı
/// çıktısıdır ve her yeniden kullanımda taze üretilir.
/// </para>
/// <para>
/// <b>Paylaşılan ulaşım verisine dokunulmaz.</b> <c>transport_route</c>,
/// <c>transport_stop</c> ve <c>transport_route_path</c> tabloları bu göçte
/// DEĞİŞMEZ; kişisel kayıttan onlara yabancı anahtar da kurulmaz, çünkü
/// kişisel bir kayıt ortak verinin yaşam döngüsünü kısıtlamamalıdır.
/// </para>
/// <para>
/// <b>Yumuşak silme yoktur.</b> Kaydedilmiş yolculuk için çöp kutusu ya da
/// geri yükleme ucu bulunmaz; <c>is_deleted</c> kolonu hiç okunmayacak ölü
/// veri olurdu. Silme gerçek silmedir ve noktalar CASCADE ile gider.
/// </para>
/// </remarks>
[DbContext(typeof(AppDbContext))]
[Migration("20260903120000_AddSavedJourneys")]
public partial class AddSavedJourneys : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "saved_journey",
            columns: table => new
            {
                id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                user_id = table.Column<int>(type: "integer", nullable: false),
                name = table.Column<string>(type: "character varying(120)", maxLength: 120, nullable: false),
                mode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                profile = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                route_id = table.Column<int>(type: "integer", nullable: true),
                route_display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                is_favorite = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                created_date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                modified_date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_saved_journey", x => x.id);
                table.CheckConstraint("ck_saved_journey_name_not_blank", "length(btrim(name)) > 0");
                table.CheckConstraint(
                    "ck_saved_journey_mode_supported",
                    "mode IN ('routeFull', 'routeSegment', 'waypoints')");
                table.CheckConstraint(
                    "ck_saved_journey_profile_supported",
                    "profile IN ('driving', 'walking', 'cycling')");

                /* Hat kimliği KİPE bağlıdır: rota tabanlı kipler onsuz
                   anlamsızdır, serbest kip ise bir hatta ait değildir. */
                table.CheckConstraint(
                    "ck_saved_journey_route_matches_mode",
                    "(mode = 'waypoints' AND route_id IS NULL) OR (mode <> 'waypoints' AND route_id IS NOT NULL)");
                table.CheckConstraint(
                    "ck_saved_journey_route_id_positive",
                    "route_id IS NULL OR route_id > 0");

                /* POI sahipliğiyle AYNI davranış: kullanıcı kaydı silinmeye
                   çalışıldığında kaydedilmiş yolculuk korunur. */
                table.ForeignKey(
                    name: "FK_saved_journey_users_user_id",
                    column: x => x.user_id,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "saved_journey_point",
            columns: table => new
            {
                id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                saved_journey_id = table.Column<int>(type: "integer", nullable: false),
                sequence = table.Column<int>(type: "integer", nullable: false),
                source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                reference_id = table.Column<int>(type: "integer", nullable: false),
                display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_saved_journey_point", x => x.id);
                table.CheckConstraint("ck_saved_journey_point_sequence_nonnegative", "sequence >= 0");
                table.CheckConstraint(
                    "ck_saved_journey_point_source_supported",
                    "source IN ('transportStop', 'poi')");
                table.CheckConstraint("ck_saved_journey_point_reference_positive", "reference_id > 0");

                /* CASCADE: nokta yolculuğun PARÇASIDIR; tanım gidince onunla
                   gider. `reference_id` çok biçimlidir (durak ya da POI) ve bu
                   yüzden yabancı anahtar TAŞIMAZ. */
                table.ForeignKey(
                    name: "FK_saved_journey_point_saved_journey_saved_journey_id",
                    column: x => x.saved_journey_id,
                    principalTable: "saved_journey",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        /* Listenin okunduğu indeks: sahibin kayıtları, önce favoriler, sonra en
           son değiştirilen. */
        migrationBuilder.CreateIndex(
            name: "IX_saved_journey_user_id_is_favorite_modified_date",
            table: "saved_journey",
            columns: ["user_id", "is_favorite", "modified_date"]);

        /* Sıra YOLCULUK BAŞINA tekildir. */
        migrationBuilder.CreateIndex(
            name: "IX_saved_journey_point_saved_journey_id_sequence",
            table: "saved_journey_point",
            columns: ["saved_journey_id", "sequence"],
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "saved_journey_point");
        migrationBuilder.DropTable(name: "saved_journey");
    }
}
