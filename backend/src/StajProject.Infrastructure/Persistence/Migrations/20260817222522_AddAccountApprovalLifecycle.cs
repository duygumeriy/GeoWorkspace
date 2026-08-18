using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace StajProject.Infrastructure.Persistence.Migrations
{
    /// <inheritdoc />
    public partial class AddAccountApprovalLifecycle : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "account_status",
                table: "users",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "approved_at",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "approved_by_user_id",
                table: "users",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "rejected_at",
                table: "users",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "rejected_by_user_id",
                table: "users",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "rejection_reason",
                table: "users",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            /* --- Mevcut kayıtların taşınması -----------------------------------
               Kolonun varsayılanı en kısıtlı durumdur (0 = PendingEmailVerification);
               bu, YENİ kayıtlar için doğrudur ama devralınan satırlara olduğu
               gibi uygulanırsa hâlihazırda çalışan her kullanıcı kilitlenirdi.
               Bu yüzden durum, satırın mevcut alanlarından deterministik olarak
               türetilir:

                 is_active = false                 -> 3 (Suspended)
                     Yönetici bu hesabı bilinçli olarak pasifleştirmişti;
                     erişimi kapalı kalmaya devam eder.

                 is_active = true, EmailConfirmed  -> 2 (Active)
                     Onay akışından ÖNCE meşru şekilde giriş yapabilen hesaplar.
                     Onaylanmış sayılırlar; kimse kilitlenmez.
                     approved_at / approved_by_user_id null bırakılır: bu
                     hesaplar bir onay sürecinden geçmedi, devralındı.

                 is_active = true, doğrulanmamış   -> 0 (PendingEmailVerification)
                     Bu hesaplar zaten giriş yapamıyordu (login e-posta
                     doğrulaması istiyor), dolayısıyla bir erişim kaybı yok.
                     Adreslerini doğruladıklarında yeni akışa göre yönetici
                     onayına düşerler.

               Tek bir CASE ifadesi kullanılır: kovalar birbirini dışlar ve
               sıralamaya bağlı bir sonuç oluşmaz. Hiçbir satır SİLİNMEZ. */
            migrationBuilder.Sql("""
                UPDATE users
                SET account_status = CASE
                    WHEN is_active = FALSE THEN 3
                    WHEN "EmailConfirmed" = TRUE THEN 2
                    ELSE 0
                END;
                """);

            migrationBuilder.CreateIndex(
                name: "IX_users_account_status",
                table: "users",
                column: "account_status");

            migrationBuilder.CreateIndex(
                name: "IX_users_approved_by_user_id",
                table: "users",
                column: "approved_by_user_id");

            migrationBuilder.CreateIndex(
                name: "IX_users_rejected_by_user_id",
                table: "users",
                column: "rejected_by_user_id");

            migrationBuilder.AddForeignKey(
                name: "FK_users_users_approved_by_user_id",
                table: "users",
                column: "approved_by_user_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_users_users_rejected_by_user_id",
                table: "users",
                column: "rejected_by_user_id",
                principalTable: "users",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_users_users_approved_by_user_id",
                table: "users");

            migrationBuilder.DropForeignKey(
                name: "FK_users_users_rejected_by_user_id",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_users_account_status",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_users_approved_by_user_id",
                table: "users");

            migrationBuilder.DropIndex(
                name: "IX_users_rejected_by_user_id",
                table: "users");

            migrationBuilder.DropColumn(
                name: "account_status",
                table: "users");

            migrationBuilder.DropColumn(
                name: "approved_at",
                table: "users");

            migrationBuilder.DropColumn(
                name: "approved_by_user_id",
                table: "users");

            migrationBuilder.DropColumn(
                name: "rejected_at",
                table: "users");

            migrationBuilder.DropColumn(
                name: "rejected_by_user_id",
                table: "users");

            migrationBuilder.DropColumn(
                name: "rejection_reason",
                table: "users");
        }
    }
}
