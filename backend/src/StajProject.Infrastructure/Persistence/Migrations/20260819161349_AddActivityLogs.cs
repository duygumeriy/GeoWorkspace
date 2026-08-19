using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations
{
    /// <summary>
    /// Aktivite geçmişi tablosunu ekler (Phase 9).
    /// </summary>
    /// <remarks>
    /// <para>
    /// <b>Tamamen EKLEMELİDİR.</b> Var olan hiçbir tabloya, kolona ya da satıra
    /// dokunulmaz; yalnızca yeni bir tablo oluşturulur. Geri alma da yalnızca o
    /// tabloyu düşürür.
    /// </para>
    /// <para>
    /// <b>Aktör için yabancı anahtar YOKTUR</b> ve bilinçli olarak yoktur:
    /// kullanıcı satırı gerçekten silinirse denetim izi Cascade ile silinmemeli,
    /// Restrict ile de kullanıcı silmeyi engellememelidir. Kimlik ve o anki
    /// kullanıcı adı birlikte saklandığı için kayıt kendi başına okunabilir kalır.
    /// </para>
    /// <para>
    /// İndeksler ekranın gerçekten yaptığı üç işe karşılık gelir: en yeniden
    /// sıralama, aktöre göre daraltma ve işlem koduna göre daraltma.
    /// </para>
    /// </remarks>
    public partial class AddActivityLogs : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "activity_logs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    actor_user_id = table.Column<int>(type: "integer", nullable: true),
                    actor_username = table.Column<string>(type: "character varying(256)", maxLength: 256, nullable: true),
                    action = table.Column<string>(type: "character varying(128)", maxLength: 128, nullable: false),
                    resource_type = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    resource_id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true),
                    http_method = table.Column<string>(type: "character varying(10)", maxLength: 10, nullable: false),
                    path = table.Column<string>(type: "character varying(512)", maxLength: 512, nullable: false),
                    status_code = table.Column<int>(type: "integer", nullable: false),
                    occurred_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    details = table.Column<string>(type: "character varying(1024)", maxLength: 1024, nullable: true),
                    client_ip = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_activity_logs", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_activity_logs_action",
                table: "activity_logs",
                column: "action");

            migrationBuilder.CreateIndex(
                name: "IX_activity_logs_actor_user_id",
                table: "activity_logs",
                column: "actor_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_activity_logs_occurred_at",
                table: "activity_logs",
                column: "occurred_at",
                descending: new bool[0]);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "activity_logs");
        }
    }
}
