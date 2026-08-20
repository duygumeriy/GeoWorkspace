namespace StajProject.Domain.Common;

/// <summary>
/// Historical legacy role names retained only for migration and reserved-name safety.
/// </summary>
public static class ApplicationRoles
{
    public const string Admin = "Admin";

    public const string User = "User";

    /// <summary>
    /// Tombstones prevent the retired names from being recreated as custom roles.
    /// They are not provisioned, assignable, or granted runtime semantics.
    /// </summary>
    public static readonly IReadOnlyList<string> Retired = [Admin, User];
}
