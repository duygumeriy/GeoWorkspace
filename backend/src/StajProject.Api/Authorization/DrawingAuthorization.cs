using System.Globalization;
using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Api.Authorization;

/// <summary>
/// Bir çizim üzerinde yapılacak işlem türü. Şu an tek bir mutation
/// gereksinimi var; geometry edit (move/scale/vertex) eklendiğinde aynı
/// handler'a yeni bir requirement eklemek yeterli olacak.
/// </summary>
public sealed class DrawingOperationRequirement : IAuthorizationRequirement
{
    private DrawingOperationRequirement(string name) => Name = name;

    public string Name { get; }

    /// <summary>Kaydı değiştirme veya silme.</summary>
    public static readonly DrawingOperationRequirement Manage = new(nameof(Manage));
}

/// <summary>
/// Çizim mutation kuralının <b>tek</b> tanımı:
/// <c>Admin OR drawing.CreatedByUserId == current user id</c>.
/// </summary>
/// <remarks>
/// Karar yalnızca doğrulanmış token'daki kimlik/rol ile kaydın veritabanındaki
/// sahibine bakılarak verilir. Client'ın gönderdiği hiçbir alan
/// (<c>createdBy</c>, <c>createdByUserId</c>, <c>ownerId</c> …) hesaba katılmaz.
/// </remarks>
public class DrawingAuthorizationHandler
    : AuthorizationHandler<DrawingOperationRequirement, IStyledDrawingFeature>
{
    protected override Task HandleRequirementAsync(
        AuthorizationHandlerContext context,
        DrawingOperationRequirement requirement,
        IStyledDrawingFeature resource)
    {
        if (context.User.Identity?.IsAuthenticated != true)
        {
            return Task.CompletedTask;
        }

        // Admin her kaydı yönetebilir.
        if (context.User.IsInRole(ApplicationRoles.Admin))
        {
            context.Succeed(requirement);
            return Task.CompletedTask;
        }

        // Sahiplik: token'daki kimlik ile kaydın veritabanındaki sahibi.
        var raw = context.User.FindFirstValue(ClaimTypes.NameIdentifier);

        if (int.TryParse(raw, NumberStyles.Integer, CultureInfo.InvariantCulture, out var userId)
            && userId == resource.CreatedByUserId)
        {
            context.Succeed(requirement);
        }

        return Task.CompletedTask;
    }
}

/// <summary>
/// <see cref="IDrawingAuthorizationService"/>'in ASP.NET Core authorization
/// altyapısına bağlanan uygulaması. Servis katmanı HttpContext'i tanımadan
/// karar sorabilsin diye buradadır.
/// </summary>
public class DrawingAuthorizationService : IDrawingAuthorizationService
{
    private readonly IAuthorizationService _authorization;
    private readonly IHttpContextAccessor _httpContextAccessor;

    public DrawingAuthorizationService(
        IAuthorizationService authorization,
        IHttpContextAccessor httpContextAccessor)
    {
        _authorization = authorization;
        _httpContextAccessor = httpContextAccessor;
    }

    public async Task<bool> CanManageAsync(IStyledDrawingFeature drawing)
    {
        var user = _httpContextAccessor.HttpContext?.User;

        if (user is null)
        {
            return false;
        }

        var result = await _authorization.AuthorizeAsync(user, drawing, DrawingOperationRequirement.Manage);

        return result.Succeeded;
    }

    public async Task<bool> CanManageAllAsync(IEnumerable<IStyledDrawingFeature> drawings)
    {
        foreach (var drawing in drawings)
        {
            if (!await CanManageAsync(drawing))
            {
                // Tek bir kayıt bile yetkisizse toplu işlem hiç başlamaz.
                return false;
            }
        }

        return true;
    }
}
