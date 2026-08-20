using Microsoft.EntityFrameworkCore;
using NetTopologySuite.Geometries;
using NetTopologySuite.IO;
using StajProject.Application.DTOs;
using StajProject.Application.Interfaces;
using StajProject.Domain.Common;
using StajProject.Domain.Entities;
using StajProject.Infrastructure.Persistence;

namespace StajProject.Auth.Tests;

/// <summary>
/// Existing mutation-focused tests do not depend on a live GeoServer. This
/// deterministic test adapter preserves their former in-memory read assertions;
/// dedicated GeoServerDrawingReadService tests cover the production HTTP path.
/// </summary>
internal sealed class DatabaseDrawingReadService(AppDbContext dbContext) : IGeoServerDrawingReadService
{
    private static readonly WKTWriter WktWriter = new();

    public Task<IReadOnlyList<DrawingResponse>> GetDrawingsAsync(
        DrawingKind kind,
        int currentUserId,
        CancellationToken cancellationToken) => kind switch
        {
            DrawingKind.Point => ReadAsync<PointFeature, Point>(kind, currentUserId, cancellationToken),
            DrawingKind.Line => ReadAsync<LineFeature, LineString>(kind, currentUserId, cancellationToken),
            DrawingKind.Polygon => ReadAsync<PolygonFeature, Polygon>(kind, currentUserId, cancellationToken),
            _ => throw new ArgumentOutOfRangeException(nameof(kind), kind, null)
        };

    private async Task<IReadOnlyList<DrawingResponse>> ReadAsync<TEntity, TGeometry>(
        DrawingKind kind,
        int currentUserId,
        CancellationToken cancellationToken)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        var entities = await dbContext.Set<TEntity>()
            .AsNoTracking()
            .Include(entity => entity.CreatedByUser)
            .UserMapScope(currentUserId)
            .OrderBy(entity => entity.Id)
            .ToListAsync(cancellationToken);

        return entities.Select(entity => Map<TEntity, TGeometry>(entity, kind)).ToList();
    }

    private static DrawingResponse Map<TEntity, TGeometry>(TEntity entity, DrawingKind kind)
        where TEntity : class, IDrawingFeature<TGeometry>
        where TGeometry : Geometry
    {
        var style = DrawingStyleReader.Read(entity, kind);

        return new DrawingResponse
        {
            Id = entity.Id,
            Wkt = WktWriter.Write(entity.Geometry),
            Name = entity.Name,
            Description = entity.Description,
            Category = entity.Category,
            Tags = [.. entity.Tags ?? []],
            Style = new DrawingStyleDto
            {
                StrokeColor = style.StrokeColor,
                StrokeWidth = style.StrokeWidth,
                FillColor = style.FillColor,
                FillOpacity = style.FillOpacity,
                PointRadius = style.PointRadius,
                LineStyle = style.LineStyle
            },
            CreatedDate = entity.CreatedDate,
            ModifiedDate = entity.ModifiedDate,
            CreatedBy = entity.CreatedByUser?.UserName ?? entity.CreatedBy,
            CreatedByUserId = entity.CreatedByUserId
        };
    }
}
