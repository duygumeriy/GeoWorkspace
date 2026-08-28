using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260827120000_AddTransportRoutePath")]
public partial class AddTransportRoutePath : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "transport_route_path",
            columns: table => new
            {
                id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                route_id = table.Column<int>(type: "integer", nullable: false),
                geometry = table.Column<LineString>(type: "geometry(LineString,4326)", nullable: false),
                distance_meters = table.Column<double>(type: "double precision", nullable: false),
                duration_seconds = table.Column<double>(type: "double precision", nullable: false),
                profile = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                generated_at = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                is_stale = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                last_failure_reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                modified_date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_transport_route_path", x => x.id);
                table.CheckConstraint("ck_transport_route_path_distance_nonnegative", "distance_meters >= 0");
                table.CheckConstraint("ck_transport_route_path_duration_nonnegative", "duration_seconds >= 0");
                table.ForeignKey(
                    name: "FK_transport_route_path_transport_route_route_id",
                    column: x => x.route_id,
                    principalTable: "transport_route",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateIndex(
            name: "IX_transport_route_path_route_id",
            table: "transport_route_path",
            column: "route_id",
            unique: true);
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "transport_route_path");
    }
}
