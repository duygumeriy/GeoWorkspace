using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using NSubstitute;
using StajProject.Application.Common;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;
using StajProject.Infrastructure.Services;

namespace StajProject.Auth.Tests;

public class GisRegressionTests
{
    [Fact]
    public async Task Authenticated_drawing_ownership_soft_delete_restore_and_spatial_analysis_still_work()
    {
        var options = new DbContextOptionsBuilder<AppDbContext>()
            .UseInMemoryDatabase($"gis-regression-{Guid.NewGuid():N}")
            .ConfigureWarnings(warnings => warnings.Ignore(InMemoryEventId.TransactionIgnoredWarning))
            .Options;
        await using var db = new AppDbContext(options);
        db.Users.Add(new User
        {
            Id = 11,
            UserName = "drawing-owner",
            EmailConfirmed = true,
            IsActive = true
        });
        await db.SaveChangesAsync();

        var owner = Substitute.For<ICurrentUserService>();
        owner.UserId.Returns(11);
        owner.UserName.Returns("drawing-owner");
        var ownerAuthorization = AuthorizationFor(owner);
        var drawings = new DrawingService(
            db,
            owner,
            ownerAuthorization,
            new GeographicAuthorizationService(db),
            new DatabaseDrawingReadService(db));

        var point = await drawings.CreatePointAsync(
            Create("POINT (30 40)", "Point"),
            CancellationToken.None);
        var line = await drawings.CreateLineAsync(
            Create("LINESTRING (29 39, 31 41)", "Line"),
            CancellationToken.None);
        var polygon = await drawings.CreatePolygonAsync(
            Create("POLYGON ((28 38, 32 38, 32 42, 28 42, 28 38))", "Polygon"),
            CancellationToken.None);

        Assert.True(point.IsSuccess);
        Assert.True(line.IsSuccess);
        Assert.True(polygon.IsSuccess);
        Assert.All([point.Value!, line.Value!, polygon.Value!], item => Assert.Equal(11, item.CreatedByUserId));

        var otherUser = Substitute.For<ICurrentUserService>();
        otherUser.UserId.Returns(12);
        otherUser.UserName.Returns("other-user");
        var forbiddenDrawings = new DrawingService(
            db,
            otherUser,
            AuthorizationFor(otherUser),
            new GeographicAuthorizationService(db),
            new DatabaseDrawingReadService(db));
        var forbiddenDelete = await forbiddenDrawings.DeleteAsync(
            DrawingKind.Point,
            point.Value!.Id,
            CancellationToken.None);
        Assert.False(forbiddenDelete.IsSuccess);
        Assert.Equal(ServiceErrorKind.Forbidden, forbiddenDelete.ErrorKind);

        var deleted = await drawings.DeleteAsync(DrawingKind.Point, point.Value.Id, CancellationToken.None);
        Assert.True(deleted.IsSuccess);
        Assert.Empty(await drawings.GetPointsAsync(CancellationToken.None));

        var restored = await drawings.RestoreAsync(new BulkRestoreRequest
        {
            Items = [new BulkDrawingItem { Type = "point", Id = point.Value.Id }]
        }, CancellationToken.None);
        Assert.True(restored.IsSuccess);
        Assert.Equal(11, restored.Value!.Items.Single().Drawing.CreatedByUserId);
        Assert.Single(await drawings.GetPointsAsync(CancellationToken.None));

        // Analiz kapsamı doğrulanmış kimlikten gelir: sahibin kendi envanteri.
        var analysis = new SpatialAnalysisService(db, owner);
        var counts = await analysis.CountIntersectionsAsync(new IntersectionAnalysisRequest
        {
            Wkt = "POLYGON ((27 37, 33 37, 33 43, 27 43, 27 37))",
            ExcludePolygonId = polygon.Value!.Id
        }, CancellationToken.None);
        Assert.True(counts.IsSuccess);
        Assert.Equal(1, counts.Value!.PointCount);
        Assert.Equal(1, counts.Value.LineCount);
        Assert.Equal(0, counts.Value.PolygonCount);
        Assert.Equal(2, counts.Value.TotalCount);
    }

    private static IDrawingAuthorizationService AuthorizationFor(ICurrentUserService currentUser)
    {
        var authorization = Substitute.For<IDrawingAuthorizationService>();
        authorization.CanManageAsync(Arg.Any<IStyledDrawingFeature>())
            .Returns(call => call.Arg<IStyledDrawingFeature>().CreatedByUserId == currentUser.UserId);
        authorization.CanManageAllAsync(Arg.Any<IEnumerable<IStyledDrawingFeature>>())
            .Returns(call => call.Arg<IEnumerable<IStyledDrawingFeature>>()
                .All(drawing => drawing.CreatedByUserId == currentUser.UserId));
        return authorization;
    }

    private static CreateDrawingRequest Create(string wkt, string name) => new()
    {
        Wkt = wkt,
        Name = name,
        Style = new DrawingStyleDto { StrokeColor = "#3366FF" }
    };
}
