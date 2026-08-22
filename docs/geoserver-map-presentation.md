# WMS presentation + WFS interaction

Phase 5 completes the assignment's rendering requirement — *"verilerin haritadaki
genel gösterimlerinde WMS, çizim/etkileşim işlemlerinde ise WFS katman yapısını
tercih edin"* — without replacing WFS. The two paths run side by side and each
owns exactly one job.

## The four paths

```text
NORMAL DISPLAY (general presentation)
React / OpenLayers
→ GET /api/map/presentation/{point|line|polygon}
→ authenticated CurrentUser
→ drawings.view permission
→ server-generated owner/status CQL
→ GeoServer WMS
→ geoworkspace:tbl_*_read SQL Views
→ drawing_*_presentation SLD
→ image/png
→ OpenLayers ImageLayer

INTERACTION (identity, selection, editing)
React
→ GET /api/drawings/{points|lines|polygons}
→ GeoServer WFS 2.0.0
→ geoworkspace:tbl_*_read SQL Views
→ GeoJSON
→ OpenLayers VectorSource
→ Select / Popup / Modify / Translate / box + polygon selection

WRITES
React
→ ASP.NET DrawingsController
→ DrawingService
→ EF Core / PostGIS

HEATMAP (unchanged, Phase 3/4)
React
→ GET /api/heatmap/image
→ GeoServer WMS
→ geoworkspace:tbl_point_heatmap
→ point_density_heatmap / vec:Heatmap
→ image/png
```

**There is no WFS-T.** GeoServer is read-only in this application; every write
goes through the application's own endpoints and EF Core/PostGIS. The SQL views
are `SELECT`-only and no GeoServer admin credential is given to the app.

**The frontend never controls** the GeoServer URL, the workspace, a layer name,
a style name, a CQL/ECQL fragment, the current-user identity, an owner ID, the
CRS, the format, or the WMS service/request operation. It sends a viewport and
nothing else.

## Public endpoint contract

```text
GET /api/map/presentation/point
GET /api/map/presentation/line
GET /api/map/presentation/polygon

query: bbox, width, height     (nothing else is read)
CRS:   fixed EPSG:3857
auth:  Bearer token + drawings.view
200:   image/png, Cache-Control: private, no-store
400:   invalid bbox / dimensions (GeoServer is never called)
403:   missing permission, or no resolvable authenticated identity
502:   upstream failure or a non-PNG answer
504:   upstream timeout
```

The geometry type is **not** a bound parameter — it is a separate action per
type, each carrying its own fixed `DrawingKind`. This is the same shape the
existing `/api/drawings/points|lines|polygons` endpoints use, and it means no
client-supplied string can ever become a catalog name. `bbox` is parsed into
four finite EPSG:3857 doubles and **re-emitted** from those numbers, so the raw
client text never reaches GeoServer.

## Permission

Normal drawing display uses **`drawings.view`** — the same permission the WFS
list endpoints require. The map itself opens with `map.view`; seeing the drawing
*data* is a separate capability, and the display of that data is the same
capability as the data. `inventory.analysis` is deliberately **not** required:
looking at your own drawings is not an analysis feature. Authorization is by
permission code only, so custom roles and direct user grants work unchanged and
the retired `Admin`/`User` roles remain no bypass.

## Server-generated filter

```text
inserted_user_id=<authenticated user ID> AND is_deleted=false AND is_active=true
```

Identical to the normal WFS read. The ID comes only from `ICurrentUserService`.
`is_deleted=false` is kept as defense in depth even though the Phase 2 view
already excludes deleted rows.

**Normal reads are not geographically narrowed.** That difference is deliberate
and is preserved exactly: owner/status filtering applies to normal drawing
reads, while geographic-scope filtering applies only to the heatmap analysis.
Adding `INTERSECTS` here would silently hide a user's own drawings.

## One request per geometry type

The three layers are **not** bundled into a single multi-layer WMS request. How
a single `CQL_FILTER` is distributed across several layers is a server-version
detail; a version that applied it to the first layer only would return the other
two **unfiltered** — other people's drawings inside the image. One request, one
layer, one filter removes that question structurally, and the extra cost is two
HTTP requests that the browser was going to make in parallel anyway.

The stacking order is then a plain z-index in the browser, and a hidden layer
costs no request at all.

## Transport and validation

Backend → GeoServer is `POST application/x-www-form-urlencoded` to `/wms` with
WMS 1.3.0 parameters, the same transport Phase 3 verified against local
GeoServer 3.0.1. A response is accepted only when the status is successful, the
`Content-Type` is `image/png`, and the payload starts with the PNG signature.
An upstream failure never becomes a blank transparent PNG: a blank image is
indistinguishable from "you have no drawings", which would hide data loss.

Render-window validation (`bbox`, `width`, `height`, the 64–2048 side bounds and
the 4 194 304 pixel cap) lives in `WmsRenderContract` and is shared with the
heatmap, so the two cannot drift apart.

## Rendering layers in the browser

| z-index | Layer |
| --- | --- |
| 0–1 | basemap (tiles, labels) |
| 4 | geographic authorization boundary |
| 6 | heatmap raster |
| 7 / 8 / 9 | **presentation raster: polygon / line / point** |
| 10 | drawing vector layer (interaction) |
| 12 | pending, unsaved shape |
| 15 | inventory analysis polygon |
| 18 | analysis highlight |
| 20 | measurement, vertex overlay |
| 30 | location marker |

The presentation rasters sit **above** the heatmap because that is where the
drawings already were: the heatmap has always rendered below them, and putting
the drawings underneath would have let the density blobs paint over the user's
own shapes. Points draw last so a point is never buried inside a polygon it
sits in.

## Who draws what

Once a type's raster is on the map, that type's vector features stop drawing
their *normal* appearance and render **interaction-only**: a zero-alpha fill and
stroke at their real size. OpenLayers replaces fill and stroke colours during
its hit-detection pass, and `RegularShape` explicitly renders an extra
hit-detection image when a transparent fill is set, so the feature is invisible
and fully clickable. Returning *no* style would be wrong — that removes a
feature from hit detection entirely, which is exactly what the layer toggle
relies on to make a hidden layer unclickable.

Everything that is not normal persisted appearance stays client-rendered,
because none of it exists server-side:

- the selection halo and the selected feature's full style,
- the live style preview while the style panel is open,
- the pending, unsaved shape,
- a just-written feature that no image has caught up with yet,
- Modify handles, Translate, the vertex overlay,
- the measurement, inventory and analysis-highlight overlays.

If a raster is unavailable — no permission, GeoServer down, first request still
in flight — that type is simply not "active" and its features render normally,
exactly as before Phase 5. **The map is never blank because a rendering service
is down.**

## Refresh

The raster reloads on a debounced `moveend`/resize, with superseded requests
aborted, latest-request-wins, and every Blob URL revoked when replaced or
removed — the lifecycle Phase 4 already proved.

Beyond that, every **successful** map-visible mutation invalidates the image:
create, bulk create, metadata/geometry/style update, Modify, Translate, delete,
bulk delete, restore and bulk restore all pass through the workspace's persist
functions, which bump a version the raster hook watches. The refresh happens
*after* persistence, never before, and a failed write refreshes nothing.

A newly written feature keeps drawing itself as a vector until an image that
includes it arrives, so a saved drawing never blinks out of existence for the
length of one request.

## GeoServer resources

Three new global styles, sourced in `geoserver/styles/` — see
`geoserver/README.md` for what they reproduce, why the line and polygon styles
are rule matrices, and how to install them. No layer's *default* style is
changed, no SQL view is created or altered, and the heatmap layer, style and WPS
configuration are untouched.
