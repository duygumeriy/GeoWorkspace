namespace StajProject.Domain.Common;

/// <summary>
/// Canonical administrative-role semantics.
/// </summary>
public static class AdministrativeRoleSemantics
{
    public static readonly IReadOnlyList<string> RoleNames = [GisRoles.Administrator];

    public static readonly IReadOnlySet<string> CriticalPermissionCodes =
        new HashSet<string>(StringComparer.Ordinal)
        {
            PermissionCodes.UsersView,
            PermissionCodes.UsersUpdate,
            PermissionCodes.RolesView,
            PermissionCodes.RolesUpdate,
            PermissionCodes.PermissionsView,
            PermissionCodes.PermissionsAssign
        };

    public static bool IsAdministrativeRole(string? roleName) =>
        RoleNames.Contains(roleName, StringComparer.Ordinal);

    public static bool HasAdministrativeRole(IEnumerable<string> roleNames) =>
        roleNames.Any(IsAdministrativeRole);

    public static bool HasCriticalPermissions(IEnumerable<string> permissionCodes) =>
        CriticalPermissionCodes.IsSubsetOf(permissionCodes);
}
