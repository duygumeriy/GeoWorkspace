using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using StajProject.Domain.Entities;

namespace StajProject.Infrastructure.Persistence.Configurations;

/// <summary>
/// Aktivite kaydı tablosu. Adlandırma projenin kendi sözleşmesini sürdürür:
/// küçük harfli tablo adı, snake_case kolonlar.
/// </summary>
public class ActivityLogConfiguration : IEntityTypeConfiguration<ActivityLog>
{
    public void Configure(EntityTypeBuilder<ActivityLog> builder)
    {
        builder.ToTable("activity_logs");

        builder.HasKey(x => x.Id);

        /* Aktör için YABANCI ANAHTAR YOKTUR ve bilinçli olarak yoktur. Kayıt
           bir denetim izidir: kullanıcı satırı gerçekten silinirse geçmiş
           kaybolmamalı, Cascade ile temizlenmemeli, Restrict ile de kullanıcı
           silmeyi engellememelidir. Kimlik ve ad birlikte saklandığı için
           kayıt kendi başına okunabilir kalır. */
        builder.Property(x => x.ActorUserId).HasColumnName("actor_user_id");

        builder.Property(x => x.ActorUsername)
            .HasColumnName("actor_username")
            .HasMaxLength(ActivityLog.MaxUsernameLength);

        builder.Property(x => x.Action)
            .HasColumnName("action")
            .IsRequired()
            .HasMaxLength(ActivityLog.MaxActionLength);

        builder.Property(x => x.ResourceType)
            .HasColumnName("resource_type")
            .HasMaxLength(ActivityLog.MaxResourceTypeLength);

        builder.Property(x => x.ResourceId)
            .HasColumnName("resource_id")
            .HasMaxLength(ActivityLog.MaxResourceIdLength);

        builder.Property(x => x.HttpMethod)
            .HasColumnName("http_method")
            .IsRequired()
            .HasMaxLength(ActivityLog.MaxHttpMethodLength);

        builder.Property(x => x.Path)
            .HasColumnName("path")
            .IsRequired()
            .HasMaxLength(ActivityLog.MaxPathLength);

        builder.Property(x => x.StatusCode).HasColumnName("status_code").IsRequired();

        builder.Property(x => x.OccurredAt)
            .HasColumnName("occurred_at")
            .IsRequired()
            .HasColumnType("timestamp with time zone");

        builder.Property(x => x.Details)
            .HasColumnName("details")
            .HasMaxLength(ActivityLog.MaxDetailsLength);

        builder.Property(x => x.ClientIp)
            .HasColumnName("client_ip")
            .HasMaxLength(ActivityLog.MaxClientIpLength);

        /* Listeleme her zaman EN YENİDEN başlar; indeks o sıralamada tanımlıdır
           ki sayfalama bir sıralama taramasına dönüşmesin. */
        builder.HasIndex(x => x.OccurredAt).IsDescending();

        // "Bu kullanıcı ne yaptı" ve "bu işlem kimler tarafından yapıldı"
        // filtreleri için; ikisi de yönetim ekranının sunduğu daraltmalardır.
        builder.HasIndex(x => x.ActorUserId);
        builder.HasIndex(x => x.Action);
    }
}
