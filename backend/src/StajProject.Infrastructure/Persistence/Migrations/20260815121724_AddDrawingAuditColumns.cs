using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddDrawingAuditColumns : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tbl_line_users_CreatedByUserId",
                table: "tbl_line");

            migrationBuilder.DropForeignKey(
                name: "FK_tbl_point_users_CreatedByUserId",
                table: "tbl_point");

            migrationBuilder.DropForeignKey(
                name: "FK_tbl_polygon_users_CreatedByUserId",
                table: "tbl_polygon");

            migrationBuilder.RenameColumn(
                name: "ModifiedDate",
                table: "tbl_polygon",
                newName: "modified_date");

            migrationBuilder.RenameColumn(
                name: "IsDeleted",
                table: "tbl_polygon",
                newName: "is_deleted");

            migrationBuilder.RenameColumn(
                name: "CreatedDate",
                table: "tbl_polygon",
                newName: "inserted_date");

            migrationBuilder.RenameColumn(
                name: "CreatedByUserId",
                table: "tbl_polygon",
                newName: "inserted_user_id");

            migrationBuilder.RenameIndex(
                name: "IX_tbl_polygon_CreatedByUserId",
                table: "tbl_polygon",
                newName: "IX_tbl_polygon_inserted_user_id");

            migrationBuilder.RenameColumn(
                name: "ModifiedDate",
                table: "tbl_point",
                newName: "modified_date");

            migrationBuilder.RenameColumn(
                name: "IsDeleted",
                table: "tbl_point",
                newName: "is_deleted");

            migrationBuilder.RenameColumn(
                name: "CreatedDate",
                table: "tbl_point",
                newName: "inserted_date");

            migrationBuilder.RenameColumn(
                name: "CreatedByUserId",
                table: "tbl_point",
                newName: "inserted_user_id");

            migrationBuilder.RenameIndex(
                name: "IX_tbl_point_CreatedByUserId",
                table: "tbl_point",
                newName: "IX_tbl_point_inserted_user_id");

            migrationBuilder.RenameColumn(
                name: "ModifiedDate",
                table: "tbl_line",
                newName: "modified_date");

            migrationBuilder.RenameColumn(
                name: "IsDeleted",
                table: "tbl_line",
                newName: "is_deleted");

            migrationBuilder.RenameColumn(
                name: "CreatedDate",
                table: "tbl_line",
                newName: "inserted_date");

            migrationBuilder.RenameColumn(
                name: "CreatedByUserId",
                table: "tbl_line",
                newName: "inserted_user_id");

            migrationBuilder.RenameIndex(
                name: "IX_tbl_line_CreatedByUserId",
                table: "tbl_line",
                newName: "IX_tbl_line_inserted_user_id");

            migrationBuilder.AddColumn<bool>(
                name: "is_active",
                table: "tbl_polygon",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_active",
                table: "tbl_point",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "is_active",
                table: "tbl_line",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            /* Geriye dönük tutarlılık: is_active kolonu bu migration'dan ÖNCE
               soft-delete edilmiş satırlara da true olarak eklenir (kolon
               varsayılanı budur). Bu satırlar "silinmiş ama aktif" gibi
               görünmemelidir — silme akışı artık iki işareti birlikte yazdığı
               için mevcut kayıtlar da aynı duruma çekilir.

               Yalnızca zaten silinmiş satırlara dokunur; aktif çizimlerin
               hiçbiri etkilenmez ve hiçbir satır kaldırılmaz. */
            migrationBuilder.Sql(
                "UPDATE tbl_point SET is_active = FALSE WHERE is_deleted = TRUE;");
            migrationBuilder.Sql(
                "UPDATE tbl_line SET is_active = FALSE WHERE is_deleted = TRUE;");
            migrationBuilder.Sql(
                "UPDATE tbl_polygon SET is_active = FALSE WHERE is_deleted = TRUE;");

            migrationBuilder.AddForeignKey(
                name: "FK_tbl_line_users_inserted_user_id",
                table: "tbl_line",
                column: "inserted_user_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_tbl_point_users_inserted_user_id",
                table: "tbl_point",
                column: "inserted_user_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_tbl_polygon_users_inserted_user_id",
                table: "tbl_polygon",
                column: "inserted_user_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_tbl_line_users_inserted_user_id",
                table: "tbl_line");

            migrationBuilder.DropForeignKey(
                name: "FK_tbl_point_users_inserted_user_id",
                table: "tbl_point");

            migrationBuilder.DropForeignKey(
                name: "FK_tbl_polygon_users_inserted_user_id",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "is_active",
                table: "tbl_polygon");

            migrationBuilder.DropColumn(
                name: "is_active",
                table: "tbl_point");

            migrationBuilder.DropColumn(
                name: "is_active",
                table: "tbl_line");

            migrationBuilder.RenameColumn(
                name: "modified_date",
                table: "tbl_polygon",
                newName: "ModifiedDate");

            migrationBuilder.RenameColumn(
                name: "is_deleted",
                table: "tbl_polygon",
                newName: "IsDeleted");

            migrationBuilder.RenameColumn(
                name: "inserted_user_id",
                table: "tbl_polygon",
                newName: "CreatedByUserId");

            migrationBuilder.RenameColumn(
                name: "inserted_date",
                table: "tbl_polygon",
                newName: "CreatedDate");

            migrationBuilder.RenameIndex(
                name: "IX_tbl_polygon_inserted_user_id",
                table: "tbl_polygon",
                newName: "IX_tbl_polygon_CreatedByUserId");

            migrationBuilder.RenameColumn(
                name: "modified_date",
                table: "tbl_point",
                newName: "ModifiedDate");

            migrationBuilder.RenameColumn(
                name: "is_deleted",
                table: "tbl_point",
                newName: "IsDeleted");

            migrationBuilder.RenameColumn(
                name: "inserted_user_id",
                table: "tbl_point",
                newName: "CreatedByUserId");

            migrationBuilder.RenameColumn(
                name: "inserted_date",
                table: "tbl_point",
                newName: "CreatedDate");

            migrationBuilder.RenameIndex(
                name: "IX_tbl_point_inserted_user_id",
                table: "tbl_point",
                newName: "IX_tbl_point_CreatedByUserId");

            migrationBuilder.RenameColumn(
                name: "modified_date",
                table: "tbl_line",
                newName: "ModifiedDate");

            migrationBuilder.RenameColumn(
                name: "is_deleted",
                table: "tbl_line",
                newName: "IsDeleted");

            migrationBuilder.RenameColumn(
                name: "inserted_user_id",
                table: "tbl_line",
                newName: "CreatedByUserId");

            migrationBuilder.RenameColumn(
                name: "inserted_date",
                table: "tbl_line",
                newName: "CreatedDate");

            migrationBuilder.RenameIndex(
                name: "IX_tbl_line_inserted_user_id",
                table: "tbl_line",
                newName: "IX_tbl_line_CreatedByUserId");

            migrationBuilder.AddForeignKey(
                name: "FK_tbl_line_users_CreatedByUserId",
                table: "tbl_line",
                column: "CreatedByUserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_tbl_point_users_CreatedByUserId",
                table: "tbl_point",
                column: "CreatedByUserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_tbl_polygon_users_CreatedByUserId",
                table: "tbl_polygon",
                column: "CreatedByUserId",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
