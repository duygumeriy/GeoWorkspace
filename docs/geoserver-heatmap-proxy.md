# Secure GeoServer heatmap proxy

The heatmap read path is deliberately backend-owned:

```text
Frontend
→ GET /api/heatmap/image
→ authenticated CurrentUser
→ inventory.analysis permission
→ effective geographic authorization
→ server-generated CQL_FILTER
→ GeoServer WMS
→ geoworkspace:tbl_point_heatmap
→ point_density_heatmap / vec:Heatmap
→ image/png
```

The public endpoint accepts only `bbox`, `width`, and `height`. Its CRS is fixed
to `EPSG:3857`. The frontend never controls the user ID, CQL/ECQL, geographic
WKT, GeoServer URL, workspace, layer, style, format, transparency, service, or
request operation.

The backend always applies this owner/status filter:

```text
inserted_user_id=<authenticated user ID> AND is_deleted=false AND is_active=true
```

`is_deleted=false` is retained as defense in depth even though the Phase 2 SQL
view already excludes deleted records. For a restricted user, the backend adds
an `INTERSECTS("Geometry", <effective Polygon/MultiPolygon WKT>)` predicate.
The geometry comes only from `IGeographicAuthorizationService`, preserving
direct-user precedence, role-area union, and unrestricted semantics.

The backend sends WMS 1.3.0 parameters with `POST
application/x-www-form-urlencoded`. This was verified against local GeoServer
3.0.1 and avoids URL-length failure for legitimate large authorization
geometries. It never falls back to an unfiltered request.

Responses are accepted only when GeoServer returns a successful `image/png`
whose payload has the PNG signature. The browser response is raw PNG with
`Cache-Control: private, no-store`; upstream failures never become blank PNGs.

GeoServer runtime catalog resources currently live outside Git under the local
GeoServer data directory. The repository has no established deployment format
for those resources, and `.geoserver-stage` contains no managed files or
automation. A future reproducibility phase should define a reviewed,
environment-neutral export/deployment convention rather than copying runtime
catalog XML with machine-specific IDs into this repository.

## Frontend analysis interface

The map exposes **Isı Haritası Analizi** only when the caller's live effective
permission set contains `inventory.analysis`. It uses the existing authenticated
API client to request `/api/heatmap/image` and installs the returned PNG Blob as
an OpenLayers image layer over the current `EPSG:3857` view extent. The layer is
above basemaps and the geographic-scope overlay, but below drawing vectors, so
the existing WFS-backed selection, editing, translation, and popup paths remain
unchanged.

The frontend does not contact GeoServer directly and has no layer, style,
filter, user ID, or authorization-geometry authority. It sends only viewport
`bbox`, bounded `width`, and bounded `height`. Superseded viewport requests are
cancelled, Blob URLs are revoked when replaced or removed, and opacity changes
are presentation-only.

The visible legend is a normalized relative-density scale from `0` to `1`, not
an absolute point count. Its color stops match the server style exactly:
transparent, `#2C7BB6`, `#00A6CA`, `#F9D057`, and `#D7191C`. A valid fully
transparent PNG is therefore a successful zero-density result. This read path
does not mutate application or spatial data.
