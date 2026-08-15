using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDrawingStyleAndMetadata : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "CreatedBy",
                table: "tbl_polygon",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedDate",
                table: "tbl_polygon",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<string>(
                name: "FillColor",
                table: "tbl_polygon",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "FillOpacity",
                table: "tbl_polygon",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LineStyle",
                table: "tbl_polygon",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ModifiedDate",
                table: "tbl_polygon",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<string>(
                name: "StrokeColor",
                table: "tbl_polygon",
                type: "character varying(7)",
                maxLength: 7,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "StrokeWidth",
                table: "tbl_polygon",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "CreatedBy",
                table: "tbl_point",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedDate",
                table: "tbl_point",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<string>(
                name: "FillColor",
                table: "tbl_point",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "FillOpacity",
                table: "tbl_point",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LineStyle",
                table: "tbl_point",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ModifiedDate",
                table: "tbl_point",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<int>(
                name: "PointRadius",
                table: "tbl_point",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "StrokeColor",
                table: "tbl_point",
                type: "character varying(7)",
                maxLength: 7,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "StrokeWidth",
                table: "tbl_point",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "CreatedBy",
                table: "tbl_line",
                type: "character varying(100)",
                maxLength: 100,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<DateTime>(
                name: "CreatedDate",
                table: "tbl_line",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<string>(
                name: "FillColor",
                table: "tbl_line",
                type: "character varying(7)",
                maxLength: 7,
                nullable: true);

            migrationBuilder.AddColumn<double>(
                name: "FillOpacity",
                table: "tbl_line",
                type: "double precision",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "LineStyle",
                table: "tbl_line",
                type: "character varying(16)",
                maxLength: 16,
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "ModifiedDate",
                table: "tbl_line",
                type: "timestamp with time zone",
                nullable: false,
                defaultValue: new DateTime(1, 1, 1, 0, 0, 0, 0, DateTimeKind.Unspecified));

            migrationBuilder.AddColumn<string>(
                name: "StrokeColor",
                table: "tbl_line",
                type: "character varying(7)",
                maxLength: 7,
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "StrokeWidth",
                table: "tbl_line",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            // --- Mevcut kayıtların backfill'i -------------------------------
            // AddColumn yukarıda NOT NULL kolonları CLR placeholder'ı ile
            // doldurur (StrokeColor '', StrokeWidth 0, CreatedDate 0001-01-01).
            // Bunlar geçerli stil değildir; DrawingStyleDefaults ile aynı
            // varsayılanlara çekilir. Tek kullanıcı 'admin' olduğu için
            // migration öncesi kayıtların sahibi odur.
            migrationBuilder.Sql("""
                UPDATE tbl_point SET
                    "StrokeColor"  = '#6D4AFF',
                    "StrokeWidth"  = 3,
                    "FillColor"    = '#7C5CFF',
                    "PointRadius"  = 7,
                    "CreatedDate"  = now(),
                    "ModifiedDate" = now(),
                    "CreatedBy"    = 'admin';

                UPDATE tbl_line SET
                    "StrokeColor"  = '#6D4AFF',
                    "StrokeWidth"  = 3,
                    "LineStyle"    = 'solid',
                    "CreatedDate"  = now(),
                    "ModifiedDate" = now(),
                    "CreatedBy"    = 'admin';

                UPDATE tbl_polygon SET
                    "StrokeColor"  = '#6D4AFF',
                    "StrokeWidth"  = 3,
                    "FillColor"    = '#7C5CFF',
                    "FillOpacity"  = 0.25,
                    "LineStyle"    = 'solid',
                    "CreatedDate"  = now(),
                    "ModifiedDate" = now(),
                    "CreatedBy"    = 'admin';
                """);

            // --- Backfill için kullanılan DEFAULT'ların kaldırılması ---------
            // Varsayılan stil uygulamada (DrawingStyleDefaults) tek noktada
            // durur; DB'de ikinci bir kaynak bırakılmaz. Bu sayede şema, EF
            // model snapshot'ı ile birebir aynı kalır.
            migrationBuilder.Sql("""
                ALTER TABLE tbl_point
                    ALTER COLUMN "StrokeColor"  DROP DEFAULT,
                    ALTER COLUMN "StrokeWidth"  DROP DEFAULT,
                    ALTER COLUMN "CreatedDate"  DROP DEFAULT,
                    ALTER COLUMN "ModifiedDate" DROP DEFAULT,
                    ALTER COLUMN "CreatedBy"    DROP DEFAULT;

                ALTER TABLE tbl_line
                    ALTER COLUMN "StrokeColor"  DROP DEFAULT,
                    ALTER COLUMN "StrokeWidth"  DROP DEFAULT,
                    ALTER COLUMN "CreatedDate"  DROP DEFAULT,
                    ALTER COLUMN "ModifiedDate" DROP DEFAULT,
                    ALTER COLUMN "CreatedBy"    DROP DEFAULT;

                ALTER TABLE tbl_polygon
                    ALTER COLUMN "StrokeColor"  DROP DEFAULT,
                    ALTER COLUMN "StrokeWidth"  DROP DEFAULT,
                    ALTER COLUMN "CreatedDate"  DROP DEFAULT,
                    ALTER COLUMN "ModifiedDate" DROP DEFAULT,
                    ALTER COLUMN "CreatedBy"    DROP DEFAULT;
                """);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CreatedBy",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "CreatedDate",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "FillColor",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "FillOpacity",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "LineStyle",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "ModifiedDate",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "StrokeColor",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "StrokeWidth",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "CreatedBy",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "CreatedDate",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "FillColor",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "FillOpacity",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "LineStyle",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "ModifiedDate",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "PointRadius",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "StrokeColor",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "StrokeWidth",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "CreatedBy",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "CreatedDate",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "FillColor",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "FillOpacity",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "LineStyle",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "ModifiedDate",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "StrokeColor",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "StrokeWidth",
                table: "tbl_line");
        }
    }
}
