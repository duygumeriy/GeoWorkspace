namespace StajProject.Domain.Common;

/// <summary>
/// Rollerin sınıflandırılması: hangileri sistem tarafından korunur, hangileri
/// yeni atamalara açıktır, hangilerinin yetkileri düzenlenebilir.
/// </summary>
/// <remarks>
/// <para>
/// <b>Neden veritabanı kolonu değil.</b> <c>IsSystem</c> / <c>IsLegacy</c> /
/// <c>IsAssignable</c> gibi alanlar şemaya eklenmedi: bunlar rolün adından
/// deterministik olarak türetilebilir ve kolon olarak saklanmaları, veritabanı
/// ile kod arasında sessizce çelişebilecek ikinci bir gerçek kaynağı
/// yaratırdı. Bir migration'a da gerek kalmaz.
/// </para>
/// <para>
/// <b>Üç sınıf vardır:</b>
/// <list type="bullet">
/// <item><b>Retired</b> (<c>Admin</c>, <c>User</c>) — isimleri yeniden
/// oluşturulamasın diye tutulan tombstone'lardır; provision edilmez ve
/// atanamazlar.</item>
/// <item><b>Kanonik</b> (<see cref="GisRoles.All"/>) — hedef görev profilleri.
/// Silinemez ve yeniden adlandırılamaz, ama yetki matrisleri dinamik olarak
/// düzenlenebilir; Phase 4'ün asıl amacı budur.</item>
/// <item><b>Özel</b> — yöneticinin tanımladığı roller. Her şey serbesttir.</item>
/// </list>
/// </para>
/// <para>
/// Karşılaştırmalar Identity'nin normalize edilmiş ad semantiğiyle uyumlu
/// olsun diye büyük/küçük harf duyarsızdır: Identity <c>"gis editor"</c> ile
/// <c>"GIS Editor"</c>'ü aynı rol sayar, dolayısıyla koruma kuralları da
/// aynı şekilde davranmalıdır — aksi hâlde farklı yazımla korumalı bir rol
/// taklit edilebilirdi.
/// </para>
/// </remarks>
public static class RoleCatalog
{
    /// <summary>Emekli rol adları. Yalnızca yeniden oluşturmayı engeller.</summary>
    public static readonly IReadOnlyList<string> Retired = ApplicationRoles.Retired;

    /// <summary>Hedef görev profilleri. Korunur, yetkileri düzenlenebilir.</summary>
    public static readonly IReadOnlyList<string> Canonical = GisRoles.All;

    /// <summary>Silinemeyen ve yeniden adlandırılamayan rollerin tamamı.</summary>
    public static readonly IReadOnlyList<string> Reserved = [.. Retired, .. Canonical];

    public static bool IsLegacy(string? roleName) => Contains(Retired, roleName);

    public static bool IsCanonical(string? roleName) => Contains(Canonical, roleName);

    /// <summary>Sistem tarafından korunan rol (legacy veya kanonik).</summary>
    public static bool IsReserved(string? roleName) => IsLegacy(roleName) || IsCanonical(roleName);

    /// <summary>Yöneticinin tanımladığı rol.</summary>
    public static bool IsCustom(string? roleName) =>
        !string.IsNullOrWhiteSpace(roleName) && !IsReserved(roleName);

    /// <summary>
    /// Rol YENİ atamalara açık mı? (onay ekranı ve rol değiştirme)
    /// </summary>
    /// <remarks>
    /// Legacy roller kapalıdır: yeni kullanıcıların geçiş köprüsüne eklenmesi,
    /// ileride yapılacak migrasyonu sürekli büyüyen bir hedefe dönüştürürdü.
    /// <b>Bu, mevcut kullanıcıların rolünü geçersiz kılmaz</b> — "tanınan rol"
    /// ile "yeni atanabilir rol" bilinçli olarak ayrı kavramlardır.
    /// </remarks>
    public static bool IsAssignable(string? roleName) =>
        !string.IsNullOrWhiteSpace(roleName) && !IsLegacy(roleName);

    /// <summary>Yalnızca özel roller yeniden adlandırılabilir.</summary>
    public static bool CanRename(string? roleName) => IsCustom(roleName);

    /// <summary>Yalnızca özel roller silinebilir (üstelik kullanıcısı yoksa).</summary>
    public static bool CanDelete(string? roleName) => IsCustom(roleName);

    /// <summary>
    /// Yetki matrisi düzenlenebilir mi? Emekli adlar hariç her rol için evet.
    /// </summary>
    /// <remarks>
    /// Emekli rol satırları migration uygulanana kadar salt okunurdur; yeniden
    /// yetkilendirilmez ve normal yönetim akışına geri alınamaz.
    /// </remarks>
    public static bool CanEditPermissions(string? roleName) =>
        !string.IsNullOrWhiteSpace(roleName) && !IsLegacy(roleName);

    /// <summary>
    /// Kanonik rolleri mantıksal sırasına, diğerlerini alfabetik sıraya göre
    /// yerleştiren sıralama anahtarı. Liste uçlarının deterministik olması
    /// için kullanılır.
    /// </summary>
    public static (int Group, int Index, string Name) SortKey(string roleName)
    {
        for (var i = 0; i < Canonical.Count; i++)
        {
            if (string.Equals(Canonical[i], roleName, StringComparison.OrdinalIgnoreCase))
            {
                return (0, i, roleName);
            }
        }

        return (1, 0, roleName);
    }

    private static bool Contains(IReadOnlyList<string> names, string? candidate) =>
        candidate is not null
        && names.Any(name => string.Equals(name, candidate.Trim(), StringComparison.OrdinalIgnoreCase));
}
