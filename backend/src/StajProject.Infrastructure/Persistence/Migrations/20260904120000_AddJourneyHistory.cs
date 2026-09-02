using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations;

/// <summary>
/// SONA ERMİŞ kişisel yolculuk çalıştırmalarının değişmez tutanağı.
/// </summary>
/// <remarks>
/// <para>
/// <b>Kaydedilmiş yolculuklardan (Faz 7) AYRI tablolardır.</b> Orada
/// yeniden kullanılabilir bir niyet saklanır ve kullanıcı onu adlandırır,
/// yeniden adlandırır, siler. Burada olmuş bir şeyin kaydı vardır: adı,
/// süresi, mesafesi ve sonucu kullanıcı tarafından değiştirilemez. İki kavramı
/// tek tabloya sıkıştırmak, "yeniden adlandırdım" ile "geçmişi değiştirdim"
/// arasındaki farkı yok ederdi.
/// </para>
/// <para>
/// <b>Çalışma zamanı için kolon YOKTUR.</b> Anlık koordinat, güncel manevra,
/// varış tahmini, takip durumu ya da kanal üyeliği burada saklanamaz — satır
/// zaten yalnızca çalıştırma bittikten sonra yazılır.
/// </para>
/// <para>
/// <b>Canlı veriye yabancı anahtar YOKTUR.</b> <c>route_id</c> ve
/// <c>reference_id</c> birer tarihsel işarettir; geçmiş, işaret ettiği
/// hattın/durağın/POI'nin silinmesini engellememeli ve onlar silindikten sonra
/// da okunabilir kalmalıdır. Paylaşılan ulaşım tabloları bu göçte DEĞİŞMEZ.
/// </para>
/// </remarks>
[DbContext(typeof(AppDbContext))]
[Migration("20260904120000_AddJourneyHistory")]
public partial class AddJourneyHistory : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "journey_history",
            columns: table => new
            {
                id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                user_id = table.Column<int>(type: "integer", nullable: false),
                simulation_id = table.Column<Guid>(type: "uuid", nullable: false),
                mode = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                profile = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                terminal_status = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                started_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                ended_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                distance_meters = table.Column<double>(type: "double precision", nullable: false),
                duration_seconds = table.Column<double>(type: "double precision", nullable: false),
                covered_distance_meters = table.Column<double>(type: "double precision", nullable: false),
                route_id = table.Column<int>(type: "integer", nullable: true),
                route_display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                created_date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_journey_history", x => x.id);
                table.CheckConstraint(
                    "ck_journey_history_mode_supported",
                    "mode IN ('routeFull', 'routeSegment', 'waypoints')");
                table.CheckConstraint(
                    "ck_journey_history_profile_supported",
                    "profile IN ('driving', 'walking', 'cycling')");

                /* YALNIZCA terminal durumlar: çalışan bir yolculuk geçmiş
                   değildir ve bu tabloda satırı olamaz. */
                table.CheckConstraint(
                    "ck_journey_history_terminal_status_supported",
                    "terminal_status IN ('Completed', 'Cancelled')");
                table.CheckConstraint("ck_journey_history_ends_after_it_starts", "ended_at >= started_at");
                table.CheckConstraint("ck_journey_history_distance_nonnegative", "distance_meters >= 0");
                table.CheckConstraint("ck_journey_history_duration_nonnegative", "duration_seconds >= 0");
                table.CheckConstraint(
                    "ck_journey_history_covered_distance_nonnegative",
                    "covered_distance_meters >= 0");
                table.CheckConstraint("ck_journey_history_route_id_positive", "route_id IS NULL OR route_id > 0");

                /* POI ve kaydedilmiş yolculuk sahipliğiyle AYNI davranış:
                   kullanıcı kaydı silinmeye çalışıldığında geçmiş korunur. */
                table.ForeignKey(
                    name: "FK_journey_history_users_user_id",
                    column: x => x.user_id,
                    principalTable: "users",
                    principalColumn: "Id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateTable(
            name: "journey_history_point",
            columns: table => new
            {
                id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                journey_history_id = table.Column<int>(type: "integer", nullable: false),
                sequence = table.Column<int>(type: "integer", nullable: false),
                source = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                reference_id = table.Column<int>(type: "integer", nullable: false),
                display_name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_journey_history_point", x => x.id);
                table.CheckConstraint("ck_journey_history_point_sequence_nonnegative", "sequence >= 0");
                table.CheckConstraint(
                    "ck_journey_history_point_source_supported",
                    "source IN ('transportStop', 'poi')");
                table.CheckConstraint("ck_journey_history_point_reference_positive", "reference_id > 0");

                /* CASCADE: nokta kaydın PARÇASIDIR. `reference_id` çok
                   biçimlidir (durak ya da POI) ve tarihsel bir işaret olduğu
                   için yabancı anahtar TAŞIMAZ. */
                table.ForeignKey(
                    name: "FK_journey_history_point_journey_history_journey_history_id",
                    column: x => x.journey_history_id,
                    principalTable: "journey_history",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        /* BİR ÇALIŞTIRMA, BİR KAYIT. Uygulama katmanı zaten tek terminal
           kazananı garanti eder; bu indeks o garantinin bir gün gevşemesi
           hâlinde mükerrer — hatta çelişkili — bir tutanağı veritabanı
           düzeyinde imkânsız kılar. */
        migrationBuilder.CreateIndex(
            name: "IX_journey_history_simulation_id",
            table: "journey_history",
            column: "simulation_id",
            unique: true);

        /* Listenin okunduğu indeks: sahibin kayıtları, en son biten en üstte. */
        migrationBuilder.CreateIndex(
            name: "IX_journey_history_user_id_ended_at",
            table: "journey_history",
            columns: ["user_id", "ended_at"]);

        /* Sıra KAYIT BAŞINA tekildir. */
        migrationBuilder.CreateIndex(
            name: "IX_journey_history_point_journey_history_id_sequence",
            table: "journey_history_point",
            columns: ["journey_history_id", "sequence"],
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "journey_history_point");
        migrationBuilder.DropTable(name: "journey_history");
    }
}
