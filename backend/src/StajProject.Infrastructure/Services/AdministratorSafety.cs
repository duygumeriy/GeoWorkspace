using Microsoft.EntityFrameworkCore;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Infrastructure.Services;

/// <summary>Shared usable-administrator invariant and mutation serialization.</summary>
internal static class AdministratorSafety
{
    private const long MutationLockKey = 8314927001L;

    public static Task AcquireMutationLockAsync(
        AppDbContext dbContext,
        CancellationToken cancellationToken) =>
        dbContext.Database.IsNpgsql()
            ? dbContext.Database.ExecuteSqlRawAsync(
                "SELECT pg_advisory_xact_lock({0})",
                [MutationLockKey],
                cancellationToken)
            : Task.CompletedTask;

    public static async Task<bool> HasUsableAdministratorAsync(
        AppDbContext dbContext,
        IEffectivePermissionService effectivePermissions,
        CancellationToken cancellationToken,
        int? excludedUserId = null)
    {
        var candidateIds = await (
            from user in dbContext.Users.AsNoTracking()
            join userRole in dbContext.UserRoles.AsNoTracking() on user.Id equals userRole.UserId
            join role in dbContext.Roles.AsNoTracking() on userRole.RoleId equals role.Id
            where !user.IsDeleted
                && user.IsActive
                && user.AccountStatus == AccountStatus.Active
                && (!excludedUserId.HasValue || user.Id != excludedUserId.Value)
                && AdministrativeRoleSemantics.RoleNames.Contains(role.Name!)
            select user.Id)
            .Distinct()
            .ToArrayAsync(cancellationToken);

        foreach (var userId in candidateIds)
        {
            var codes = await effectivePermissions.GetEffectivePermissionCodesAsync(userId, cancellationToken);

            if (AdministrativeRoleSemantics.HasCriticalPermissions(codes))
            {
                return true;
            }
        }

        return false;
    }
}
