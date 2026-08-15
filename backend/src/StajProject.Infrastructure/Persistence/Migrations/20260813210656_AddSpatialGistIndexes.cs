using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddSpatialGistIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateIndex(
                name: "IX_tbl_polygon_Geometry",
                table: "tbl_polygon",
                column: "Geometry")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "IX_tbl_point_Geometry",
                table: "tbl_point",
                column: "Geometry")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "IX_tbl_line_Geometry",
                table: "tbl_line",
                column: "Geometry")
                .Annotation("Npgsql:IndexMethod", "gist");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_tbl_polygon_Geometry",
                table: "tbl_polygon");

            migrationBuilder.DropIndex(
                name: "IX_tbl_point_Geometry",
                table: "tbl_point");

            migrationBuilder.DropIndex(
                name: "IX_tbl_line_Geometry",
                table: "tbl_line");
        }
    }
}
