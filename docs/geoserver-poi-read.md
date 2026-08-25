# GeoServer POI read layer and per-category styles

Phase 3A added the **read model** and a single-category style proof of concept;
Phase 3B generates the **complete artifact set** — 44 per-category styles, the
composite `poi_all` style, and 44 local icons — from the canonical taxonomy.

Neither phase changes application behaviour: no WMS proxy, no frontend layer,
no search, no `GetFeatureInfo`, and no database migration exist yet.

> **This SQL is a GeoServer SQL View, not a database view.**
> It is typed into GeoServer's *Configure new SQL view* form and lives in
> GeoServer's catalog. Nothing here creates a `CREATE VIEW` in PostgreSQL, and
> **no EF Core migration corresponds to it.** The database schema is untouched.

## GeoServer resource settings

Identical to the existing drawing read layers — same instance, same workspace,
same store:

- GeoServer: `http://localhost:8080/geoserver`
- Workspace: `geoworkspace`
- Namespace: `http://geoworkspace.local`
- PostGIS store: `staj_postgis`
- Database/schema: `staj_db` / `public`
- Layer name: `poi_read`
- Declared/native CRS: `EPSG:4326`
- Coordinate decimals: `15`
- SQL parameters: **none** (the query is static and contains no view parameters)
- SQL escaping option: **disabled** (nothing to escape — no parameters)

GeoServer SQL Views are read-only. No WFS-T path, database view, table,
migration, or application credential is created.

## `geoworkspace:poi_read`

- Geometry column/type: `coordinate` / `Point`
- SRID: `4326`
- Identifier: `id`

```sql
SELECT
    p.id,
    p.isim,
    p.coordinate,
    c.id AS kategori_id,
    c.name AS kategori_adi,
    c.slug AS kategori_slug,
    c.icon_key,
    c.color_hex
FROM public.poi AS p
INNER JOIN public.poi_category AS c
    ON c.id = p.kategori_id
WHERE
    p.is_deleted = false
    AND p.is_active = true
    AND c.is_deleted = false
    AND c.is_active = true
```

### Why the identifiers are unquoted

The drawing views quote their columns (`d."Id"`, `d."Geometry"`) because
`tbl_point` and friends were created with PascalCase names. `poi` and
`poi_category` are snake_case throughout (`PoiConfiguration` maps `Name → isim`,
`CategoryId → kategori_id`), so PostgreSQL's default case folding already
resolves them and quoting would be noise. Verified against
`information_schema.columns` and `geometry_columns`:

| Column | Type |
| --- | --- |
| `poi.id` | `integer` |
| `poi.isim` | `character varying` |
| `poi.kategori_id` | `integer` |
| `poi.coordinate` | `geometry(Point, 4326)` |
| `poi.is_active` / `poi.is_deleted` | `boolean` |
| `poi_category.name` / `.slug` / `.icon_key` / `.color_hex` | `character varying` |

### Exposed fields, and what is deliberately absent

The view exposes exactly what the map needs to draw and label a point.
`mesai_saatleri`, `user_id`, `created_date`, and `modified_date` are **not
exposed**: working hours and ownership are attributes of the record, answered
by the authenticated application API, not by a rendering layer. A WMS image
cannot enforce ownership rules, so the safest thing a presentation layer can do
is not carry the fields those rules protect.

### Why the `WHERE` clause mirrors the EF global query filter

`PoiCategoryConfiguration` and `PoiConfiguration` both declare
`HasQueryFilter(x => !x.IsDeleted && x.IsActive)`. The view repeats that on
**both** tables, so the WMS image and the REST API can never disagree about
what is visible — a POI hidden in the app cannot reappear on the map, and an
inactive category takes its POIs off the map with it.

`INNER JOIN` (not `LEFT JOIN`) is deliberate: `poi.kategori_id` is `NOT NULL`
with a `RESTRICT` foreign key, so a POI without a category cannot exist. A
`LEFT JOIN` would invent a state the schema forbids and produce rows with a
null `kategori_slug` that no category style could match.

## Per-category styles

The assignment requires *"Her bir POI kategorisi için GeoServer'da ayrı bir
Style (SLD)"* — **one separately named style per category.** That is taken
literally: there are **44 styles named `poi_<slug>`**, one for every canonical
taxonomy entry, all committed under `geoserver/styles/`.

They are **generated**, not hand-written. The single source of truth is
`PoiCategoryTaxonomy.All`
(`backend/src/StajProject.Domain/Common/PoiCategoryTaxonomy.cs`), which already
carries every category's `Slug`, `Name`, `ParentSlug`, `IconKey` and
`ColorHex` and is already covered by tests. This document deliberately does
**not** reproduce the taxonomy table — a copy here would be a second truth that
drifts the first time a category is added.

### The generator

```bash
# regenerate every SLD + SVG from the canonical taxonomy
dotnet run --project backend/tools/StajProject.GeoServerStyleGenerator -- generate

# fail (exit 1) if any committed artifact is missing, stale, or orphaned
dotnet run --project backend/tools/StajProject.GeoServerStyleGenerator -- check
```

`backend/tools/StajProject.GeoServerStyleGenerator` is a **developer tool**. It
is not registered in DI, never runs at API startup, and touches no database,
no network, and no GeoServer instance. Its only input is the Domain taxonomy;
its only output is files in this repository. Output is deterministic — running
`generate` twice writes nothing the second time.

### Generated-file ownership

Every generated artifact carries this marker in its leading comment:

```
GENERATED FILE — DO NOT EDIT MANUALLY
Source: PoiCategoryTaxonomy.All
Generator: StajProject.GeoServerStyleGenerator
```

**Edit the taxonomy, then regenerate — never edit these files by hand.**

The marker is also how `generate` decides what it may delete. Stale cleanup
removes only files that *carry the marker* and are no longer in the plan;
matching on filename alone could delete a hand-authored `poi_*.sld`. The
drawing presentation styles (`drawing_point_presentation.sld` and siblings) do
not carry the marker and are therefore untouchable by the generator — asserted
by a test.

### What each category style contains

Four rules, all carrying the same category filter — three marker scale bands
plus one label rule:

| Rule | Scale | Effect |
| --- | --- | --- |
| `<slug>-marker-very-far` | `MinScaleDenominator` 1000000 | 20 px marker |
| `<slug>-marker-medium` | 150000 … 1000000 | 24 px marker |
| `<slug>-marker-near` | `MaxScaleDenominator` 150000 | 30 px marker |
| `<slug>-label` | `MaxScaleDenominator` 25000 | `isim` above the marker |

The bands are the shared contract for **every** category — this document does
not restate the taxonomy, only the scale rules all 44 styles obey.

**Why three bands.** Phase 3A shipped two (16 px / 24 px at the 1:150000 split)
and live testing found both ends wanting: at the Türkiye-wide view a 16 px badge
was too small to read, and zooming in barely changed the marker, so getting
closer did not make a POI feel more prominent. Phase 5B keeps the live-verified
1:150000 threshold and *adds* a second one at 1:1000000, raising the far end to
20 px and the near end to 30 px. The middle value stays 24 px because it is the
only size that was verified against a live GeoServer.

GeoServer's default scale computation uses EPSG:3857 metres without a latitude
correction, so the thresholds land on stable zoom levels: ≥ 1:1000000 is about
z9 and out, 1:150000–1:1000000 is about z10–z11, and < 1:150000 is z12 and in.
30 px is a deliberate ceiling — larger badges start colliding with each other
before the labels do.

The marker bands neither overlap nor leave a gap: the medium rule carries
*both* bounds, so exactly one marker rule matches at any scale. An overlap
would draw each POI twice (a thick, blurred badge); a gap would make POIs
vanish over a range of scales.

At roughly 1:15K a POI shows icon **and** name; at roughly 1:29K the icon
remains and the name disappears. Those two observations are the live-verified
anchor for the 25000 threshold — in Web Mercator it sits between z14 (≈1:35000)
and z15 (≈1:17000), i.e. neighbourhood level. Labelling at every scale would
produce an unreadable text cloud at city view.

Label styling is deliberately unchanged apart from the vertical offset: bold
12 px, `Noto Sans` → `DejaVu Sans` → `SansSerif`, offset `(0, 19)`, white halo
radius 2 at 0.85 opacity, and the GeoServer-specific
`conflictResolution` / `spaceAround` / `maxDisplacement` / `goodnessOfFit`
vendor options. The text colour is **derived** from the category's canonical
`ColorHex` by a deterministic darkening (×0.45), so there is no second
colour table to keep in sync.

### Matching is by slug, never by id or name

```xml
<ogc:PropertyIsEqualTo>
  <ogc:PropertyName>kategori_slug</ogc:PropertyName>
  <ogc:Literal>eczane</ogc:Literal>
</ogc:PropertyIsEqualTo>
```

A numeric id is environment-specific and would point at a different category in
another database. A display name is editable from the admin screen, so a rename
would silently orphan the rule. The slug is generated once, is globally unique,
and is immutable — that is precisely what it exists for. All three rules repeat
the filter; a rule missing it would paint that category's symbol on *every*
POI, which matters especially inside the composite style where rules sit side
by side.

**No category style contains `<ElseFilter/>`.** In the drawing styles that
element stops a feature vanishing when no rule matches; here it would make a
category style draw every POI regardless of category and defeat the
one-style-per-category requirement. Robustness lives one layer down instead
(see *Icons* below).

### `poi_all`

`geoserver/styles/poi_all.sld` renders **all 44 categories in one WMS request**,
each with its own icon, colour and label. It is generated from the same
taxonomy by the same template — there is no second hand-written 44-category
block.

**`poi_all` is additive. It does not replace the 44 per-category styles.** The
assignment's deliverable is the 44 separately named styles; `poi_all` exists
because a single WMS `GetMap` cannot name 44 styles, so it is the practical
path for real map presentation. Both are committed, and a test asserts both
exist.

### Icons

GeoServer cannot render a React component, so each `icon_key` needs a static
local asset. There are **44 distinct icon keys** for 44 categories — currently a
one-to-one mapping — and therefore 44 files under `geoserver/icons/`:

```
geoserver/icons/<icon-key>.svg      e.g. pill.svg, coffee.svg, factory.svg
```

referenced from the styles as `./icons/<icon-key>.svg`, which GeoServer
resolves relative to its styles directory.

Each icon is a badge: a white casing ring (contrast on both light and dark
basemaps), a disc in the category's canonical colour, and a white glyph. The
geometry is hand-written in this repository — semantically equivalent to the
frontend's Lucide key, but with **no runtime dependency** on Lucide and nothing
fetched at render time. Every icon uses only `svg`, `g`, `path`, `circle`,
`rect`, `line`, `polyline`, `polygon`; there is no script, no `<image>`, no
`<use>`, no embedded style block, no remote URL, no `data:` and no base64. A
test enforces this.

The category colour is **baked into** the SVG, which is correct only while each
`icon_key` maps to a single colour. The generator verifies that invariant and
**fails loudly** if two categories ever share an icon key with different
colours, telling you to switch to GeoServer's parametric SVG substitution
(`fill="param(fill,#RRGGBB)"`). A silently wrong colour would be far more
expensive than a noisy build failure.

**Fallback:** each rule places a `<Mark>` *after* the `<ExternalGraphic>` in the
same `<Graphic>`. SLD 1.0 falls back to it when the external resource cannot be
loaded, so a missing or misnamed icon degrades to a plain disc in the category
colour instead of making POIs disappear.

### Drift protection

`GeoServerPoiStyleArtifactTests` in the backend test project asserts that:

- every canonical slug has exactly one committed `poi_<slug>.sld`,
- no stale generator-owned artifact remains,
- committed artifacts equal deterministic generator output byte for byte,
- every referenced icon file exists and every approved icon key has geometry,
- every category style filters on `kategori_slug` only, three times, with its
  own slug, and never references `kategori_id` or `kategori_adi`,
- no category style contains `<ElseFilter/>`,
- `poi_all` covers every canonical category exactly three times and no unknown
  slug,
- the drawing presentation styles are not generator-owned,
- generated SVGs contain no active or remote content.

The tests read the filesystem only; they never write. If a category is added to
the taxonomy and the artifacts are not regenerated, they fail — which is the
point. `-- check` gives the same answer from the command line with a non-zero
exit code, suitable for CI.


## Manual installation (GeoServer 3.0.1)

Nothing below is automated. The runtime catalog lives outside Git, as
`geoserver/README.md` and `docs/geoserver-heatmap-proxy.md` already record.

### A. Create the SQL View

1. Open `http://localhost:8080/geoserver` and log in as an administrator.
2. **Data → Stores → `staj_postgis`**.
3. **Configure new SQL view…**
4. **SQL view name:** `poi_read`
5. Paste the SQL from the block above verbatim. Leave **Guess geometry type and
   srid** unchecked and add no parameters.
6. Press **Refresh** next to *Attributes* so GeoServer reads the column list.
7. In the **Attributes** grid set the `coordinate` row to type **Point**, SRID
   **4326**.
8. In the **Identifier** section tick **`id`**. (Without an identifier GeoServer
   cannot produce stable feature ids.)
9. **Save.**

### B. Publish the layer

10. The *New Layer* form opens. Set **Declared SRS** to `EPSG:4326` and
    **SRS handling** to *Force declared*.
11. **Compute from data** for the Native Bounding Box, then **Compute from
    native bounds** for the Lat/Lon Bounding Box.
12. Under *Publishing → WFS/WMS Settings*, set the number of decimals to `15`
    to match the existing drawing layers.
13. **Save.**

### C. Install the icons (44 files)

14. The styles reference `./icons/<icon-key>.svg`, which GeoServer resolves
    relative to its **styles** directory, so all icons go in one place:

    ```
    <GEOSERVER_DATA_DIR>/styles/icons/
    ```

    Confirm the data directory under **About & Status → Server Status → Data
    directory** (a Homebrew install is typically
    `/opt/homebrew/var/geoserver/data_dir`).

15. Copy them with the helper — **dry run by default**, so it prints what it
    would do and writes nothing until you add `--apply`:

    ```bash
    GEOSERVER_DATA_DIR=/opt/homebrew/var/geoserver/data_dir ./geoserver/sync-icons.sh
    GEOSERVER_DATA_DIR=/opt/homebrew/var/geoserver/data_dir ./geoserver/sync-icons.sh --apply
    ```

    It copies `*.svg` only, into `styles/icons/` only, and **never deletes**
    anything at the destination — that directory may hold icons this repository
    does not know about. It takes no credentials.

    Equivalent by hand:

    ```bash
    mkdir -p "$GEOSERVER_DATA_DIR/styles/icons"
    cp geoserver/icons/*.svg "$GEOSERVER_DATA_DIR/styles/icons/"
    ```

### D. Register the styles (45 styles)

Style registration is **manual**. See *Why bulk REST registration is deferred*
below.

16. **Data → Styles → Add a new style**.
17. **Name:** exactly the style's `<NamedLayer><Name>` — `poi_all`, or
    `poi_<slug>` for a category style. **Workspace:** leave **global**, matching
    the existing `drawing_*_presentation` and `point_density_heatmap`
    convention (the backend sends style names unqualified).
18. **Format:** `SLD 1.0.0`. Paste the file contents, press **Validate**, then
    **Apply/Submit**.
19. Repeat for each style you need. **Register `poi_all` first** — it is the one
    the map will actually use, and it alone is enough to see every category
    render. The 44 per-category styles satisfy the assignment's
    one-style-per-category requirement and can be registered as needed.
20. Optionally attach them to the layer as *additional* styles:
    **Data → Layers → `geoworkspace:poi_read` → Publishing → Additional
    Styles**. Do **not** change the layer's *default* style — later phases name
    the style explicitly in the WMS `STYLES` parameter, exactly as the drawing
    presentation path already does.

### Why bulk REST registration is deferred

GeoServer exposes a REST API that could register all 45 styles in one pass. It
is **not** scripted here, deliberately: this repository contains no GeoServer
REST usage anywhere — the backend speaks only WMS/WFS `GET` — so there is no
verified endpoint shape, authentication mode, or payload contract to copy. A
script written from memory could silently create malformed styles or overwrite
existing ones on a live catalog.

The icon copy *is* scripted because it is plain file copying and was proven
live in Phase 3A. Bulk style registration stays manual until the REST contract
can be verified against the actual instance.

### E. Verify in Layer Preview

21. **Data → Layer Preview**, find `geoworkspace:poi_read`, open **OpenLayers**.
22. The preview uses the layer's *default* style, so name the style explicitly
    by appending to the preview URL:

    ```
    ...&STYLES=poi_all
    ...&STYLES=poi_eczane
    ```

23. With `poi_all`, confirm:
    - the layer draws without an exception report,
    - every POI shows a badge in **its own** category colour and glyph,
    - zooming in past roughly z15 makes the names appear above the markers,
    - zooming back out hides the names but keeps the markers,
    - markers grow 20 px → 24 px as you cross roughly 1:1000000 (about z9→z10),
      and 24 px → 30 px as you cross roughly 1:150000 (about z11→z12).
24. With `poi_eczane`, confirm the single-category contract still holds:
    only Eczane POIs draw, and POIs of every other category are absent.
25. Cross-check the attribute contract:

    ```
    http://localhost:8080/geoserver/geoworkspace/ows?service=WFS&version=2.0.0
      &request=GetFeature&typeNames=geoworkspace:poi_read
      &outputFormat=application/json&count=5
    ```

    The payload must contain `id`, `isim`, `kategori_id`, `kategori_adi`,
    `kategori_slug`, `icon_key`, `color_hex` and a `Point` geometry — and no
    `mesai_saatleri`, `user_id`, or audit columns.

## Real-data coverage

A test Eczane POI was created **through the application** during Phase 3A
verification, so `poi_eczane` renders live. Most of the other 43 categories
still have no POIs, which is expected: a category style with no matching rows
draws nothing, and a blank preview for such a category is correct behaviour,
not a broken style.

Use `poi_all` to see everything that does exist in one view.

To exercise a specific category, create a POI through the UI rather than with
SQL — `user_id`, `created_date` and `modified_date` are server-owned, and a
hand-written row can violate invariants the service layer guarantees:

1. Sign in as a user holding `poi.create`.
2. Open the map and start POI placement.
3. Click a location inside your geographic scope.
4. Give it a recognisable name.
5. Pick the target category in the picker.
6. Save, and confirm it appears in the POI layer and in *POI'lerim*.
7. Reload the GeoServer Layer Preview with `&STYLES=poi_all` — the marker
   should draw in that category's colour, and its name should appear once you
   zoom past roughly z15.

## Security boundary (unchanged)

```text
POI CRUD:          React → ASP.NET Core → EF Core → PostgreSQL/PostGIS
POI presentation:  React → authenticated backend proxy (poi.view)
                         → GeoServer WMS → geoworkspace:poi_read → PostGIS
POI search:        React → ASP.NET Core → PostgreSQL/PostGIS
```

Still true after this phase, and required to stay true:

- **No WFS-T.** GeoServer is read-only; every write goes through the
  application's own endpoints and EF Core.
- **The browser never receives** GeoServer credentials, database credentials,
  the GeoServer URL, the workspace, a store name, a layer name, a style name,
  or a CQL fragment. The future proxy sends a viewport and nothing else, as
  `docs/geoserver-map-presentation.md` already specifies for drawings.
- **The future POI WMS endpoint must gate on `poi.view`**, not reuse
  `drawings.view`.
- The SQL View is `SELECT`-only and takes no parameters, so there is no
  injection surface even server-side.
