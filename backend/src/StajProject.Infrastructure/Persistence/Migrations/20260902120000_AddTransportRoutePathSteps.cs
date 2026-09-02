using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations;

/// <summary>
/// Paylaşılan hattın OTORİTER seyir manevraları.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden bir tablo gerekti.</b> <c>transport_route_path</c> yalnızca
/// geometri ve toplam ölçüleri saklıyordu; hiçbir yerde manevra verisi yoktu.
/// Navigasyonu istemcide geometriden çıkarmak (açılara bakıp "sağa dön"
/// demek) yanlış talimat üretirdi; her tick'te ya da her gözlemci için
/// yeniden yönlendirme yapmak ise aynı hattın navigasyonunu dış bir servise
/// ve o servisin o anki sürümüne bağlardı. Adımlar bu yüzden yolun üretildiği
/// anda, yolla AYNI kayıt işleminde yazılır.
/// </para>
/// <para>
/// <b>Yol satırına dokunulmadı.</b> Mevcut sütunlar, kısıtlar ve tekil indeks
/// olduğu gibi kalır; bu göç yalnızca ekler.
/// </para>
/// </remarks>
[DbContext(typeof(AppDbContext))]
[Migration("20260902120000_AddTransportRoutePathSteps")]
public partial class AddTransportRoutePathSteps : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "transport_route_path_step",
            columns: table => new
            {
                id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                path_id = table.Column<int>(type: "integer", nullable: false),
                sequence = table.Column<int>(type: "integer", nullable: false),
                maneuver_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                maneuver_modifier = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: true),
                name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: true),
                distance_meters = table.Column<double>(type: "double precision", nullable: false),
                duration_seconds = table.Column<double>(type: "double precision", nullable: false),
                start_distance_meters = table.Column<double>(type: "double precision", nullable: false),
                end_distance_meters = table.Column<double>(type: "double precision", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_transport_route_path_step", x => x.id);
                table.CheckConstraint("ck_transport_route_path_step_sequence_nonnegative", "sequence >= 0");
                table.CheckConstraint("ck_transport_route_path_step_distance_nonnegative", "distance_meters >= 0");
                table.CheckConstraint("ck_transport_route_path_step_duration_nonnegative", "duration_seconds >= 0");
                table.CheckConstraint(
                    "ck_transport_route_path_step_bounds_ordered",
                    "end_distance_meters >= start_distance_meters");

                /* CASCADE: adım YOLUN türetilmiş verisidir. Yol silinip
                   adımları kalsaydı, hiçbir geometriye ait olmayan manevralar
                   birikirdi. Yolun rotaya olan RESTRICT ilişkisi değişmez. */
                table.ForeignKey(
                    name: "FK_transport_route_path_step_transport_route_path_path_id",
                    column: x => x.path_id,
                    principalTable: "transport_route_path",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Cascade);
            });

        /* Sıra YOL BAŞINA tekildir: aynı numarayı taşıyan iki adım,
           "3 numaralı adım" sorusuna iki cevap verirdi. */
        migrationBuilder.CreateIndex(
            name: "IX_transport_route_path_step_path_id_sequence",
            table: "transport_route_path_step",
            columns: ["path_id", "sequence"],
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "transport_route_path_step");
    }
}
