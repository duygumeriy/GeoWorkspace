using System.Collections.Generic;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDrawingMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "category",
                table: "tbl_polygon",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "description",
                table: "tbl_polygon",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<List<string>>(
                name: "tags",
                table: "tbl_polygon",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.AddColumn<string>(
                name: "category",
                table: "tbl_point",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "description",
                table: "tbl_point",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<List<string>>(
                name: "tags",
                table: "tbl_point",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");

            migrationBuilder.AddColumn<string>(
                name: "category",
                table: "tbl_line",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "description",
                table: "tbl_line",
                type: "character varying(2000)",
                maxLength: 2000,
                nullable: true);

            migrationBuilder.AddColumn<List<string>>(
                name: "tags",
                table: "tbl_line",
                type: "text[]",
                nullable: false,
                defaultValueSql: "'{}'::text[]");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "category",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "description",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "tags",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "category",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "description",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "tags",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "category",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "description",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "tags",
                table: "tbl_line");
        }
    }
}
