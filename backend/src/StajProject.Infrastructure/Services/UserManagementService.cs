using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>
/// <see cref="IUserManagementService"/> implementasyonu. Rol işlemleri
/// Identity'nin <see cref="UserManager{TUser}"/> API'si üzerinden yapılır;
/// user_roles tablosuna elle yazılmaz.
/// </summary>
public class UserManagementService : IUserManagementService
{
    /// <summary>
    /// Rol/durum değişikliklerini serileştiren advisory lock anahtarı.
    /// <para>
    /// Son aktif Admin koruması "önce say, sonra değiştir" şeklinde çalışır ve
    /// bu iki adım arasında başka bir istek araya girerse iki eşzamanlı istek
    /// iki farklı Admin'i düşürüp sistemi adminsiz bırakabilirdi. PostgreSQL
    /// transaction-scoped advisory lock'u tüm rol/durum mutasyonlarını sıraya
    /// sokarak bu yarışı imkânsız kılar; kilit transaction bitince kendiliğinden
    /// bırakılır.
    /// </para>
    /// </summary>
    private const long RoleMutationLockKey = 8314927001L;

    private readonly AppDbContext _dbContext;
    private readonly UserManager<User> _userManager;
    private readonly ILogger<UserManagementService> _logger;

    public UserManagementService(
        AppDbContext dbContext,
        UserManager<User> userManager,
        ILogger<UserManagementService> logger)
    {
        _dbContext = dbContext;
        _userManager = userManager;
        _logger = logger;
    }

    /* --- Okuma --------------------------------------------------------------- */

    public async Task<IReadOnlyList<AdminUserListItem>> GetUsersAsync(CancellationToken cancellationToken = default) =>
        await BuildUserQuery()
            .OrderBy(u => u.Id)
            .ToListAsync(cancellationToken);

    public async Task<ServiceResult<AdminUserDetail>> GetUserAsync(int userId, CancellationToken cancellationToken = default)
    {
        var item = await BuildUserQuery()
            .SingleOrDefaultAsync(u => u.Id == userId, cancellationToken);

        return item is null
            ? ServiceResult<AdminUserDetail>.NotFound("Kullanıcı bulunamadı.")
            : ServiceResult<AdminUserDetail>.Success(ToDetail(item));
    }

    /* --- Rol değişikliği ------------------------------------------------------ */

    public async Task<ServiceResult<AdminUserDetail>> ChangeRoleAsync(
        int userId,
        UpdateUserRoleRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default)
    {
        if (!ApplicationRoles.TryParse(request.Role, out var targetRole))
        {
            return ServiceResult<AdminUserDetail>.Failure(
                $"Geçersiz rol. Yalnızca şu roller atanabilir: {string.Join(", ", ApplicationRoles.All)}.");
        }

        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        await AcquireRoleMutationLockAsync(cancellationToken);

        var user = await FindManageableUserAsync(userId, cancellationToken);

        if (user is null)
        {
            return ServiceResult<AdminUserDetail>.NotFound("Kullanıcı bulunamadı.");
        }

        var currentRoles = await _userManager.GetRolesAsync(user);
        var currentRole = currentRoles.FirstOrDefault();

        if (string.Equals(currentRole, targetRole, StringComparison.Ordinal) && currentRoles.Count == 1)
        {
            // Değişiklik yok: gereksiz yazma ve audit log üretme.
            await transaction.CommitAsync(cancellationToken);
            return await ReloadAsync(userId, cancellationToken);
        }

        // Admin'likten düşürülüyorsa sistemin adminsiz kalmadığını doğrula.
        if (IsLosingActiveAdmin(user, currentRoles, targetRole))
        {
            var guard = await GuardLastActiveAdminAsync(userId, actingUserId, cancellationToken);
            if (guard is not null)
            {
                return guard;
            }
        }

        /* Tek primary role kuralı: yeni rol eklenmeden önce mevcut application
           role'lerinin TAMAMI kaldırılır; kullanıcıda asla iki application role
           birden kalmaz. */
        var rolesToRemove = currentRoles.Where(r => ApplicationRoles.All.Contains(r)).ToArray();

        if (rolesToRemove.Length > 0)
        {
            var removal = await _userManager.RemoveFromRolesAsync(user, rolesToRemove);
            if (!removal.Succeeded)
            {
                return Failed<AdminUserDetail>("Rol kaldırılamadı.", removal);
            }
        }

        var assignment = await _userManager.AddToRoleAsync(user, targetRole);
        if (!assignment.Succeeded)
        {
            return Failed<AdminUserDetail>("Rol atanamadı.", assignment);
        }

        await transaction.CommitAsync(cancellationToken);

        // Audit: kim, kimin rolünü, neden değiştirdi. Token/şifre/e-posta yok.
        _logger.LogInformation(
            "Rol değişikliği: acting UserId={ActingUserId} target UserId={TargetUserId} {OldRole} -> {NewRole}",
            actingUserId,
            userId,
            currentRole ?? "(yok)",
            targetRole);

        return await ReloadAsync(userId, cancellationToken);
    }

    /* --- Aktif/pasif ---------------------------------------------------------- */

    public async Task<ServiceResult<AdminUserDetail>> ChangeStatusAsync(
        int userId,
        UpdateUserStatusRequest request,
        int actingUserId,
        CancellationToken cancellationToken = default)
    {
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        await AcquireRoleMutationLockAsync(cancellationToken);

        var user = await FindManageableUserAsync(userId, cancellationToken);

        if (user is null)
        {
            return ServiceResult<AdminUserDetail>.NotFound("Kullanıcı bulunamadı.");
        }

        if (user.IsActive == request.IsActive)
        {
            await transaction.CommitAsync(cancellationToken);
            return await ReloadAsync(userId, cancellationToken);
        }

        // Pasifleştirme, son aktif Admin'i devre dışı bırakıyorsa engellenir.
        if (!request.IsActive && user.IsActive && await _userManager.IsInRoleAsync(user, ApplicationRoles.Admin))
        {
            var guard = await GuardLastActiveAdminAsync(userId, actingUserId, cancellationToken);
            if (guard is not null)
            {
                return guard;
            }
        }

        user.IsActive = request.IsActive;

        var update = await _userManager.UpdateAsync(user);
        if (!update.Succeeded)
        {
            return Failed<AdminUserDetail>("Kullanıcı durumu güncellenemedi.", update);
        }

        await transaction.CommitAsync(cancellationToken);

        _logger.LogInformation(
            "Hesap durumu değişikliği: acting UserId={ActingUserId} target UserId={TargetUserId} IsActive={IsActive}",
            actingUserId,
            userId,
            request.IsActive);

        return await ReloadAsync(userId, cancellationToken);
    }

    /* --- Yardımcılar ---------------------------------------------------------- */

    /// <summary>
    /// Rol/durum mutasyonlarını sıraya sokar. Transaction commit/rollback
    /// olduğunda kilit otomatik bırakılır.
    /// </summary>
    private Task AcquireRoleMutationLockAsync(CancellationToken cancellationToken) =>
        _dbContext.Database.ExecuteSqlRawAsync(
            "SELECT pg_advisory_xact_lock({0})",
            [RoleMutationLockKey],
            cancellationToken);

    private Task<User?> FindManageableUserAsync(int userId, CancellationToken cancellationToken) =>
        _userManager.Users.SingleOrDefaultAsync(u => u.Id == userId && !u.IsDeleted, cancellationToken);

    private static bool IsLosingActiveAdmin(User user, IList<string> currentRoles, string targetRole) =>
        user.IsActive
        && currentRoles.Contains(ApplicationRoles.Admin)
        && !string.Equals(targetRole, ApplicationRoles.Admin, StringComparison.Ordinal);

    /// <summary>
    /// Hedef kullanıcı dışında en az bir aktif Admin kalmıyorsa 409 döner.
    /// Kural hem başkası hem de kişinin kendisi için aynıdır: sistemin son
    /// Admin'i hiçbir koşulda kendini kilitleyemez.
    /// </summary>
    private async Task<ServiceResult<AdminUserDetail>?> GuardLastActiveAdminAsync(
        int targetUserId,
        int actingUserId,
        CancellationToken cancellationToken)
    {
        var admins = await _userManager.GetUsersInRoleAsync(ApplicationRoles.Admin);

        var otherActiveAdmins = admins.Count(a => a.Id != targetUserId && a.IsActive && !a.IsDeleted);

        if (otherActiveAdmins > 0)
        {
            return null;
        }

        _logger.LogWarning(
            "Son aktif Admin koruması devreye girdi: acting UserId={ActingUserId} target UserId={TargetUserId}",
            actingUserId,
            targetUserId);

        return ServiceResult<AdminUserDetail>.Conflict(
            targetUserId == actingUserId
                ? "Sistemdeki son aktif yöneticisiniz; kendi yönetici yetkinizi kaldıramaz veya hesabınızı pasifleştiremezsiniz. Önce başka bir aktif yönetici tanımlayın."
                : "Bu kullanıcı sistemdeki son aktif yönetici. Önce başka bir aktif yönetici tanımlayın.");
    }

    /// <summary>
    /// Kullanıcıları tek sorguda primary role'leriyle projekte eder
    /// (kullanıcı başına ayrı rol sorgusu yapılmaz).
    /// </summary>
    private IQueryable<AdminUserListItem> BuildUserQuery() =>
        _dbContext.Users
            .AsNoTracking()
            .Where(u => !u.IsDeleted)
            .Select(u => new AdminUserListItem
            {
                Id = u.Id,
                Username = u.UserName!,
                Email = u.Email,
                Role = (from userRole in _dbContext.UserRoles
                        join role in _dbContext.Roles on userRole.RoleId equals role.Id
                        where userRole.UserId == u.Id
                        select role.Name).FirstOrDefault(),
                IsActive = u.IsActive,
                EmailConfirmed = u.EmailConfirmed,
                TwoFactorEnabled = u.TwoFactorEnabled,
                LockoutEnd = u.LockoutEnd,
                ModifiedDate = u.ModifiedDate
            });

    private async Task<ServiceResult<AdminUserDetail>> ReloadAsync(int userId, CancellationToken cancellationToken) =>
        await GetUserAsync(userId, cancellationToken);

    private static AdminUserDetail ToDetail(AdminUserListItem item) => new()
    {
        Id = item.Id,
        Username = item.Username,
        Email = item.Email,
        Role = item.Role,
        IsActive = item.IsActive,
        EmailConfirmed = item.EmailConfirmed,
        TwoFactorEnabled = item.TwoFactorEnabled,
        LockoutEnd = item.LockoutEnd,
        ModifiedDate = item.ModifiedDate
    };

    private static ServiceResult<T> Failed<T>(string message, IdentityResult result) =>
        ServiceResult<T>.Failure($"{message} {string.Join(" ", result.Errors.Select(e => e.Description))}".Trim());
}
