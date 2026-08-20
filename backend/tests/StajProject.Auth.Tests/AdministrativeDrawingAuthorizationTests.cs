using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using NSubstitute;
using StajProject.Api.Authorization;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;

namespace StajProject.Auth.Tests;

public class AdministrativeDrawingAuthorizationTests
{
    [Theory]
    [InlineData(ApplicationRoles.Admin, true)]
    [InlineData(GisRoles.Administrator, true)]
    [InlineData(GisRoles.GisEditor, false)]
    [InlineData(GisRoles.Viewer, false)]
    public async Task Only_administrative_roles_can_manage_another_owners_drawing(
        string role,
        bool expected)
    {
        var requirement = DrawingOperationRequirement.Manage;
        var drawing = Substitute.For<IStyledDrawingFeature>();
        drawing.CreatedByUserId.Returns(99);
        var principal = new ClaimsPrincipal(new ClaimsIdentity(
            [new Claim(ClaimTypes.NameIdentifier, "7"), new Claim(ClaimTypes.Role, role)],
            "test"));
        var context = new AuthorizationHandlerContext([requirement], principal, drawing);

        await new DrawingAuthorizationHandler().HandleAsync(context);

        Assert.Equal(expected, context.HasSucceeded);
    }
}
