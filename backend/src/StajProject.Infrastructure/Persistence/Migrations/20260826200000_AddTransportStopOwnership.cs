using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations;

/// <summary>
/// Ulaşım duraklarına POI convention'ındaki <c>user_id</c> sahipliğini ekler.
/// Mevcut satırlar bilinçli olarak NULL kalır; sahiplik tahmin edilmez.
/// </summary>
[DbContext(typeof(AppDbContext))]
[Migration("20260826200000_AddTransportStopOwnership")]
public partial class AddTransportStopOwnership : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.AddColumn<int>(
            name: "user_id",
            table: "transport_stop",
            type: "integer",
            nullable: true);

        migrationBuilder.CreateIndex(
            name: "IX_transport_stop_user_id",
            table: "transport_stop",
            column: "user_id");

        migrationBuilder.AddForeignKey(
            name: "FK_transport_stop_users_user_id",
            table: "transport_stop",
            column: "user_id",
            principalTable: "users",
            principalColumn: "Id",
            onDelete: ReferentialAction.Restrict);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropForeignKey(
            name: "FK_transport_stop_users_user_id",
            table: "transport_stop");

        migrationBuilder.DropIndex(
            name: "IX_transport_stop_user_id",
            table: "transport_stop");

        migrationBuilder.DropColumn(
            name: "user_id",
            table: "transport_stop");
    }
}
