# GeoServer normal drawing read layers

Phase 10B keeps the browser contract at `/api/drawings/points`,
`/api/drawings/lines`, and `/api/drawings/polygons`. The backend reads the
following application-facing WFS layers; the original `tbl_point`, `tbl_line`,
and `tbl_polygon` layers remain unchanged.

## GeoServer resource settings

- GeoServer: `http://localhost:8080/geoserver`
- Workspace: `geoworkspace`
- Namespace: `http://geoworkspace.local`
- PostGIS store: `staj_postgis`
- Database/schema: `staj_db` / `public`
- WFS version and output: `2.0.0` / `application/json`
- Geometry key: `Id`
- Declared/native CRS: `EPSG:4326`
- Coordinate decimals: `15`
- SQL parameters: none
- SQL escaping option: disabled (the queries are static and contain no view parameters)

GeoServer SQL Views are read-only. No WFS-T path, database view, table,
migration, or application credential was created.

### `geoworkspace:tbl_point_read`

- Geometry column/type: `Geometry` / `Point`
- SRID: `4326`

```sql
SELECT
    d."Id",
    d."Name",
    d."Geometry",
    COALESCE(u."Username", d."CreatedBy") AS "CreatedBy",
    d.inserted_date,
    d."FillColor",
    d."FillOpacity",
    d."LineStyle",
    d.modified_date,
    d."PointRadius",
    d."StrokeColor",
    d."StrokeWidth",
    d.inserted_user_id,
    d.is_deleted,
    d.is_active,
    d.category,
    d.description,
    array_to_json(COALESCE(d.tags, '{}'::text[]))::text AS tags_json
FROM public.tbl_point d
LEFT JOIN public.users u ON u."Id" = d.inserted_user_id
```

### `geoworkspace:tbl_line_read`

- Geometry column/type: `Geometry` / `LineString`
- SRID: `4326`

```sql
SELECT
    d."Id",
    d."Name",
    d."Geometry",
    COALESCE(u."Username", d."CreatedBy") AS "CreatedBy",
    d.inserted_date,
    d."FillColor",
    d."FillOpacity",
    d."LineStyle",
    d.modified_date,
    d."StrokeColor",
    d."StrokeWidth",
    d.inserted_user_id,
    d.is_deleted,
    d.is_active,
    d.category,
    d.description,
    array_to_json(COALESCE(d.tags, '{}'::text[]))::text AS tags_json
FROM public.tbl_line d
LEFT JOIN public.users u ON u."Id" = d.inserted_user_id
```

### `geoworkspace:tbl_polygon_read`

- Geometry column/type: `Geometry` / `Polygon`
- SRID: `4326`

```sql
SELECT
    d."Id",
    d."Name",
    d."Geometry",
    COALESCE(u."Username", d."CreatedBy") AS "CreatedBy",
    d.inserted_date,
    d."FillColor",
    d."FillOpacity",
    d."LineStyle",
    d.modified_date,
    d."StrokeColor",
    d."StrokeWidth",
    d.inserted_user_id,
    d.is_deleted,
    d.is_active,
    d.category,
    d.description,
    array_to_json(COALESCE(d.tags, '{}'::text[]))::text AS tags_json
FROM public.tbl_polygon d
LEFT JOIN public.users u ON u."Id" = d.inserted_user_id
```

`COALESCE(u."Username", d."CreatedBy")` reproduces the existing response
mapping's current-username/legacy fallback. `tags_json` preserves PostgreSQL
`text[]` order and values; the backend maps a JSON null representation to the
existing empty-list fallback and treats a missing field as a malformed response.

## Production WFS query

The backend selects the layer by drawing kind and sends these fixed parameters:

```text
service=WFS
version=2.0.0
request=GetFeature
outputFormat=application/json
srsName=EPSG:4326
cql_filter=inserted_user_id=<authenticated-int-user-id> AND is_deleted=false AND is_active=true
sortBy=Id A
```

The parameter name must remain lowercase `cql_filter`; uppercase `CQL_FILTER`
was ignored by the verified GeoServer 3.0.1 instance. The user ID comes only
from the authenticated backend context, and no arbitrary filter fragment is
accepted from the client.

## Reproduction and verification

In GeoServer's `staj_postgis` store, choose **New SQL view**, use the stable
layer name and exact SELECT above, refresh attributes, mark `Id` as the
identifier, and set the geometry metadata and SRID shown above. Save both the
SQL view and its layer with EPSG:4326 and 15 coordinate decimals.

Verify each layer through WFS 2.0.0 `DescribeFeatureType` and `GetFeature`.
The GeoJSON payload must contain geometry plus `Id`, `Name`, `CreatedBy`,
`inserted_date`, `modified_date`, all style fields relevant to the type,
`inserted_user_id`, `is_deleted`, `is_active`, `category`, `description`, and
`tags_json`. Apply the lowercase filter above and `sortBy=Id A`; confirm only
the selected owner's active, non-deleted rows are returned in ascending order.
