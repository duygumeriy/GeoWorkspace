using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations;

[DbContext(typeof(AppDbContext))]
[Migration("20260826170000_AddSmartTransportFoundation")]
public partial class AddSmartTransportFoundation : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "transport_route",
            columns: table => new
            {
                id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                color_hex = table.Column<string>(type: "character varying(7)", maxLength: 7, nullable: false),
                is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                is_deleted = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                created_date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                modified_date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_transport_route", x => x.id);
                table.CheckConstraint("ck_transport_route_color_hex", "color_hex ~ '^#[0-9A-F]{6}$'");
            });

        migrationBuilder.CreateTable(
            name: "transport_stop",
            columns: table => new
            {
                id = table.Column<int>(type: "integer", nullable: false)
                    .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                route_id = table.Column<int>(type: "integer", nullable: false),
                name = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                coordinate = table.Column<Point>(type: "geometry(Point,4326)", nullable: false),
                sequence_order = table.Column<int>(type: "integer", nullable: false),
                is_active = table.Column<bool>(type: "boolean", nullable: false, defaultValue: true),
                is_deleted = table.Column<bool>(type: "boolean", nullable: false, defaultValue: false),
                created_date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                modified_date = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
            },
            constraints: table =>
            {
                table.PrimaryKey("PK_transport_stop", x => x.id);
                table.CheckConstraint("ck_transport_stop_sequence_order_positive", "sequence_order > 0");
                table.ForeignKey(
                    name: "FK_transport_stop_transport_route_route_id",
                    column: x => x.route_id,
                    principalTable: "transport_route",
                    principalColumn: "id",
                    onDelete: ReferentialAction.Restrict);
            });

        migrationBuilder.CreateIndex(
            name: "IX_transport_stop_coordinate",
            table: "transport_stop",
            column: "coordinate")
            .Annotation("Npgsql:IndexMethod", "gist");

        migrationBuilder.CreateIndex(
            name: "IX_transport_stop_route_id",
            table: "transport_stop",
            column: "route_id");

        migrationBuilder.CreateIndex(
            name: "IX_transport_stop_route_id_sequence_order",
            table: "transport_stop",
            columns: new[] { "route_id", "sequence_order" });
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "transport_stop");
        migrationBuilder.DropTable(name: "transport_route");
    }
}
