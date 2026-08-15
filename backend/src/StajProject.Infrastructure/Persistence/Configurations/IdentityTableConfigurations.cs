using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace StajProject.Infrastructure.Persistence.Configurations;

/* Identity'nin yardımcı tabloları. Varsayılan AspNet* adları yerine projenin
   mevcut küçük harfli tablo adlandırmasına (users, locations, tbl_point …)
   uydurulur. Kolon tanımlarına dokunulmaz — Identity'nin kendi mapping'i
   geçerli kalır, yalnızca tablo adı değişir.

   Roller AUTH-3'te kullanılacak; tablolar bu Phase'de boş kalır ama şema
   hazırdır, böylece rol eklemek yeni bir migration gerektirmez. */

public class RoleConfiguration : IEntityTypeConfiguration<IdentityRole<int>>
{
    public void Configure(EntityTypeBuilder<IdentityRole<int>> builder)
    {
        builder.ToTable("roles");

        builder.Property(x => x.Name).HasMaxLength(100);
        builder.Property(x => x.NormalizedName).HasMaxLength(100);
    }
}

public class UserRoleConfiguration : IEntityTypeConfiguration<IdentityUserRole<int>>
{
    public void Configure(EntityTypeBuilder<IdentityUserRole<int>> builder) =>
        builder.ToTable("user_roles");
}

public class UserClaimConfiguration : IEntityTypeConfiguration<IdentityUserClaim<int>>
{
    public void Configure(EntityTypeBuilder<IdentityUserClaim<int>> builder) =>
        builder.ToTable("user_claims");
}

public class UserLoginConfiguration : IEntityTypeConfiguration<IdentityUserLogin<int>>
{
    public void Configure(EntityTypeBuilder<IdentityUserLogin<int>> builder) =>
        builder.ToTable("user_logins");
}

public class UserTokenConfiguration : IEntityTypeConfiguration<IdentityUserToken<int>>
{
    public void Configure(EntityTypeBuilder<IdentityUserToken<int>> builder) =>
        builder.ToTable("user_tokens");
}

public class RoleClaimConfiguration : IEntityTypeConfiguration<IdentityRoleClaim<int>>
{
    public void Configure(EntityTypeBuilder<IdentityRoleClaim<int>> builder) =>
        builder.ToTable("role_claims");
}
