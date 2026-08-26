# GeoServer presentation styles

`styles/` holds the SLD source for the **normal drawing presentation** styles
used by `GET /api/map/presentation/{point|line|polygon}` (Phase 5), and for the
**per-category POI styles** (Phase 3A onward).

| File | GeoServer style name | Applied to |
| --- | --- | --- |
| `drawing_point_presentation.sld` | `drawing_point_presentation` | `geoworkspace:tbl_point_read` |
| `drawing_line_presentation.sld` | `drawing_line_presentation` | `geoworkspace:tbl_line_read` |
| `drawing_polygon_presentation.sld` | `drawing_polygon_presentation` | `geoworkspace:tbl_polygon_read` |
| `poi_<slug>.sld` (44 files) | `poi_<slug>` | `geoworkspace:poi_read` |
| `poi_all.sld` | `poi_all` | `geoworkspace:poi_read` |
| `analysis_poi_points.sld` | `analysis_poi_points` | `geoworkspace:analysis_poi_read` |

**The `poi_*` styles and every file in `icons/` are GENERATED.** Do not edit
them by hand — change `PoiCategoryTaxonomy.All` and regenerate:

```bash
dotnet run --project backend/tools/StajProject.GeoServerStyleGenerator -- generate
dotnet run --project backend/tools/StajProject.GeoServerStyleGenerator -- check
```

`check` exits non-zero when a committed artifact is missing, stale, or
orphaned; `GeoServerPoiStyleArtifactTests` asserts the same thing from the test
suite. The `drawing_*` and `analysis_poi_points` styles above are
**hand-authored** and carry no generated marker, so the generator's stale-file
cleanup can never touch them.

**`analysis_weighted_heatmap` is gone.** The Location Analysis weighted density
surface is no longer produced by GeoServer: the assignment's model normalises
*each criterion's* density surface before the weights combine them, and
`vec:Heatmap` makes a single pass over all features and normalises only the
final surface — the equation cannot be expressed as an SLD. The surface is now
computed in the backend from the same PostGIS rows the summary counts. The
style file, its 48 `env` weight slots and the `GeoServer:AnalysisHeatmapStyle`
setting were removed together; see
[`docs/location-analysis-heatmap.md`](../docs/location-analysis-heatmap.md).

`analysis_poi_points` still needs the `analysis_poi_read` SQL View, which does
not exist by default and whose definition **changed** in this phase (it now
reads the `analysis_poi_union` view so the overlay shows application POIs too).
The exact SQL and the manual steps are in the same document.

## `analysis_poi_points` — NOT REGISTERED YET

`analysis_poi_points` backs the server-rendered analysis POI overlay raster. It
draws `geoworkspace:analysis_poi_read` with a point symbolizer and **no**
rendering transformation: it is a presentation, not a density calculation.

The overlay and the weighted heatmap must always show the same rows, and they
still do — but through a **shared database view** rather than a shared WMS
layer. `analysis_poi_read` now selects from `analysis_poi_union`, which is the
same union (`analysis_poi` + active, non-deleted `poi`) the backend reads for
the summary counts, the vector point list and the heatmap raster.

The style is committed here but **is not in the running catalog**. Until it is
registered, `POST /api/analysis/location/points/image` returns 502 and the
overlay reports an upstream error; the weighted heatmap is unaffected.

Register it once per instance (Admin → Styles → Add a new style):

1. Workspace `geoworkspace`, name `analysis_poi_points`, format `SLD 1.0`.
2. Paste the contents of `styles/analysis_poi_points.sld` and **Apply**.

`analysis_poi_read` does **not** need a new default style — the backend always
names the style explicitly in the `STYLES` parameter, so registering the style
is the only step.

There is one style per canonical category — the assignment requires *"Her bir
POI kategorisi için GeoServer'da ayrı bir Style (SLD)"*. `poi_all` renders all
44 in a single WMS request and is **additive**: it does not replace the 44
per-category styles.

`icons/` holds the static vector assets the POI styles reference through
`ExternalGraphic`. GeoServer cannot render a React/Lucide component, so each
`icon_key` in the canonical taxonomy has a local SVG (44 distinct keys today).
Same convention as `styles/`: **source in Git, installed manually per
instance.**

Install icons by copying them into the data directory's styles folder, keeping
the `icons/` subfolder so the styles' relative `./icons/<name>.svg` paths
resolve:

```
<GEOSERVER_DATA_DIR>/styles/icons/<icon-key>.svg
```

`./sync-icons.sh` does this for all 44 at once. It is **dry run by default**,
takes no credentials, needs only `GEOSERVER_DATA_DIR`, and never deletes
anything at the destination:

```bash
GEOSERVER_DATA_DIR=/opt/homebrew/var/geoserver/data_dir ./geoserver/sync-icons.sh
GEOSERVER_DATA_DIR=/opt/homebrew/var/geoserver/data_dir ./geoserver/sync-icons.sh --apply
```

Style **registration** stays manual — this repository has no verified GeoServer
REST contract to script against.

The POI read layer (`geoworkspace:poi_read`), the full SQL View definition, the
generator, the per-category style contract, and the deployment steps are
documented in [`docs/geoserver-poi-read.md`](../docs/geoserver-poi-read.md).

These files are **source**, not a deployment mechanism. As
`docs/geoserver-heatmap-proxy.md` already records, the GeoServer runtime catalog
lives outside Git and this repository still has no reviewed, environment-neutral
export convention. Checking the source in makes the styling reviewable and
reproducible without copying runtime catalog XML with machine-specific IDs.

## Install (once, per GeoServer instance)

1. GeoServer web UI → **Styles** → **Add a new style**.
2. Name: exactly the style name in the table above. Workspace: leave **global**
   (the backend sends the style name unqualified, matching the existing
   `point_density_heatmap` convention).
3. Format: **SLD 1.0.0**. Paste the file contents, press **Validate**, then
   **Apply/Submit**.
4. Repeat for all three.

The layers' *default* styles are **not** changed. The backend always names the
presentation style explicitly in the WMS `STYLES` parameter, so the existing
`tbl_*` and `tbl_*_read` layer configuration stays exactly as it was.

## What the styles reproduce

Every value is read from the record itself, so per-feature user styling
survives the move to WMS. Nulls and out-of-range values fall back to the
application defaults (`DrawingStyleDefaults` / `DEFAULT_STYLE`).

- **Point** — `PointRadius` (as `Size = radius × 2`), `FillColor`,
  `StrokeColor`, and an outline width of `min(StrokeWidth, round(PointRadius/2))`
  so a thick stroke can never swallow a small dot. This mirrors
  `createFeatureStyle()` in `frontend/src/map/featureStyle.js`.
- **Line** — `StrokeColor`, `StrokeWidth`, `LineStyle`.
- **Polygon** — `FillColor`, `FillOpacity`, `StrokeColor`, `StrokeWidth`,
  `LineStyle`.

## Why the line/polygon styles are rule matrices

SLD 1.0 `stroke-dasharray` takes a literal list of numbers — it does **not**
accept an expression, so the dash pattern cannot be computed from the record.
The dash patterns in this app also scale with stroke width (a 10px dashed line
would otherwise read as solid), so the pattern depends on *both* `LineStyle` and
`StrokeWidth`.

The styles therefore carry one rule per `LineStyle × StrokeWidth` combination
for the three dashed variants (`dashed`, `dotted`, `dashdot` × widths 1–12), with
the numbers taken verbatim from `lineDashFor()` in `featureStyle.js`. A final
`<ElseFilter/>` rule draws a solid stroke, which is what catches `solid`, a null
`LineStyle`, an unknown value, and any width outside 1–12. **A drawing can never
fall through to "no rule matched" and disappear.**

Only the four `LineStyle` values the application actually stores are mapped
(`DrawingStyleDefaults.LineStyles`); no pattern is invented for a value the
backend would reject.

## Known dependency to verify on install

The point style uses the GeoTools filter functions `if_then_else`, `isNull`,
`min` and `round` in dynamic symbolizers. If **Validate** rejects the
`stroke-width` expression on your GeoServer build, replace that expression with
the plain `StrokeWidth` property lookup — the only visible consequence is that a
very thick stroke on a very small point is no longer capped.

## POI style notes

Every `poi_*` style matches on `kategori_slug`, never on a category's numeric
id or display name: ids are environment-specific and names are editable from
the admin screen, while the slug is generated once and never changes.

The per-category styles deliberately carry **no `<ElseFilter/>`**. In the drawing styles that
element stops a feature from vanishing when no rule matches; in a per-category
POI style it would make the style draw *every* POI regardless of category and
defeat the one-style-per-category requirement. The equivalent robustness sits
one layer down instead: every rule places a `<Mark>` after its
`<ExternalGraphic>`, which SLD 1.0 falls back to when the SVG cannot be loaded,
so a missing icon file degrades to a plain red dot rather than an empty map.

The label rule uses the GeoServer-specific `<VendorOption>` elements
`conflictResolution`, `spaceAround`, `maxDisplacement` and `goodnessOfFit`.
These are not part of SLD 1.0; a build that does not recognise them ignores
them and the style stays valid. Removing them only costs label
de-confliction in dense areas.
