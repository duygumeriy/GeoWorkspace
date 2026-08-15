namespace StajProject.Domain.Common;

/// <summary>
/// Sistem durum takibi yapılan entity'ler. <see cref="ModifiedDate"/> alanı
/// AppDbContext.SaveChanges içinde UTC olarak damgalanır.
/// </summary>
public interface IAuditableEntity
{
    bool IsDeleted { get; set; }

    bool IsActive { get; set; }

    DateTime ModifiedDate { get; set; }
}
