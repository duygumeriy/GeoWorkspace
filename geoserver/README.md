# GeoServer presentation styles (Phase 5)

`styles/` holds the SLD source for the three **normal drawing presentation**
styles used by `GET /api/map/presentation/{point|line|polygon}`.

| File | GeoServer style name | Applied to |
| --- | --- | --- |
| `drawing_point_presentation.sld` | `drawing_point_presentation` | `geoworkspace:tbl_point_read` |
| `drawing_line_presentation.sld` | `drawing_line_presentation` | `geoworkspace:tbl_line_read` |
| `drawing_polygon_presentation.sld` | `drawing_polygon_presentation` | `geoworkspace:tbl_polygon_read` |

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
