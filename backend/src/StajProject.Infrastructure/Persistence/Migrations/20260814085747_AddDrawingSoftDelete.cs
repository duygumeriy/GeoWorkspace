using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDrawingSoftDelete : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "tbl_polygon",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DeletedByUserId",
                table: "tbl_polygon",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDeleted",
                table: "tbl_polygon",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "tbl_point",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DeletedByUserId",
                table: "tbl_point",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDeleted",
                table: "tbl_point",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<DateTime>(
                name: "DeletedAt",
                table: "tbl_line",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DeletedByUserId",
                table: "tbl_line",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsDeleted",
                table: "tbl_line",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateIndex(
                name: "IX_tbl_polygon_DeletedByUserId",
                table: "tbl_polygon",
                column: "DeletedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_tbl_point_DeletedByUserId",
                table: "tbl_point",
                column: "DeletedByUserId");

            migrationBuilder.CreateIndex(
                name: "IX_tbl_line_DeletedByUserId",
                table: "tbl_line",
                column: "DeletedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_tbl_line_users_DeletedByUserId",
                table: "tbl_line",
                column: "DeletedByUserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_tbl_point_users_DeletedByUserId",
                table: "tbl_point",
                column: "DeletedByUserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_tbl_polygon_users_DeletedByUserId",
                table: "tbl_polygon",
                column: "DeletedByUserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tbl_line_users_DeletedByUserId",
                table: "tbl_line");

            migrationBuilder.DropForeignKey(
                name: "FK_tbl_point_users_DeletedByUserId",
                table: "tbl_point");

            migrationBuilder.DropForeignKey(
                name: "FK_tbl_polygon_users_DeletedByUserId",
                table: "tbl_polygon");

            migrationBuilder.DropIndex(
                name: "IX_tbl_polygon_DeletedByUserId",
                table: "tbl_polygon");

            migrationBuilder.DropIndex(
                name: "IX_tbl_point_DeletedByUserId",
                table: "tbl_point");

            migrationBuilder.DropIndex(
                name: "IX_tbl_line_DeletedByUserId",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "DeletedByUserId",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "IsDeleted",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "DeletedByUserId",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "IsDeleted",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "DeletedAt",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "DeletedByUserId",
                table: "tbl_line");

            migrationBuilder.DropColumn(
                name: "IsDeleted",
                table: "tbl_line");
        }
    }
}
