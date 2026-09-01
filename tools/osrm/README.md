# Local OSRM development servers

The backend uses OSRM's Route service to turn ordered stops and journey
waypoints into a road-following `LineString`. OSRM is a development dependency
only: the API starts without Docker or any running container, and the browser
never calls OSRM directly.

The compose setup uses the MLD pipeline and the pinned image
`ghcr.io/project-osrm/osrm-backend:v5.27.1`. It has portable defaults and can be
customized through a local `tools/osrm/.env` file.

## Why three servers

The product supports exactly three travel profiles — **driving**, **walking**
and **cycling**. Each needs its own server:

**OSRM bakes the travel profile into the dataset during `osrm-extract`.** By the
time `osrm-routed` is serving requests the profile is already fixed, and the
profile segment in the request URL (`/route/v1/walking/...`) is **ignored**. So a
car-preprocessed server answers a walking request with driving geometry — same
roads, same turn restrictions, same speeds.

That is why the backend treats walking and cycling as genuinely unavailable
unless a *separately preprocessed* server is configured for them. It will not
serve driving geometry under another profile's name, and it will not fake a
duration with a multiplier: a different profile changes the **route**, not just
the speed.

| Profile | Lua profile | Data directory | Default port | Compose service |
|---|---|---|---|---|
| driving | `car.lua` | `./data` | `OSRM_HOST_PORT` — **5001** here (compose default 5000) | `osrm-routed` |
| walking | `foot.lua` | `./data/walking` | 5002 | `osrm-walking` |
| cycling | `bicycle.lua` | `./data/cycling` | 5003 | `osrm-cycling` |

The driving port is intentionally **not fixed** — it has always been driven by
`OSRM_HOST_PORT`, and this project's local setup uses 5001 (both `.env.example`
and the tracked development backend config agree on that value). The
optional profiles default to 5002/5003 so they stay clear of driving under
either value. Compose does not reject duplicate published ports when resolving
configuration; only the container start fails, so the defaults must be
collision-free by construction.

All three read the **same source `.osm.pbf`**; only the generated `.osrm*`
artifacts differ. The driving service keeps its original name, port and data
directory, so an already-prepared driving dataset needs no re-extraction and
Smart Transport route generation is unaffected. Walking and cycling are purely
additive and entirely optional.

## 1. Obtain an OpenStreetMap PBF

Download a regional `.osm.pbf` extract from a provider such as
[Geofabrik](https://download.geofabrik.de/) and put it in the configured data
directory. With the defaults, the expected file is:

```text
tools/osrm/data/turkey-latest.osm.pbf
```

The PBF and generated routing artifacts are local, multi-gigabyte files and
must not be committed.

## 2. Configure the local dataset

Run from `tools/osrm/`:

```bash
cp .env.example .env
```

The available values are:

```dotenv
OSRM_DATA_DIR=./data
OSRM_DATASET=turkey-latest
OSRM_HOST_PORT=5001
OSRM_WALKING_HOST_PORT=5002
OSRM_CYCLING_HOST_PORT=5003
OSRM_WALKING_DATA_DIR=./data/walking
OSRM_CYCLING_DATA_DIR=./data/cycling
OSRM_OPTIONAL_EXTRACT_THREADS=4
```

- `OSRM_DATA_DIR` holds the source PBF and the generated **driving** files. A
  relative path is resolved from `tools/osrm/`.
- `OSRM_DATASET` is the basename only, without `.osm.pbf` or `.osrm`. All three
  profiles share this one source extract.
- `OSRM_*_HOST_PORT` are host ports; every container still listens on `5000`
  internally. Keep all three distinct — a collision is only discovered when the
  second container fails to start.
- `OSRM_WALKING_DATA_DIR` / `OSRM_CYCLING_DATA_DIR` **must not** equal
  `OSRM_DATA_DIR`. `osrm-extract` writes beside its input, so pointing a walking
  run at the driving directory would overwrite the driving dataset in place. The
  preparation script refuses to do this.
- `OSRM_OPTIONAL_EXTRACT_THREADS` caps the threads walking/cycling extraction
  uses (default 4). See the memory note in step 3. Driving ignores it.

The `.env` file is ignored by Git. `.env.example` is the tracked, machine-neutral
template. The defaults also work without creating `.env`.

## 3. Prepare the routing data

Preparation is per profile and is the slow part: it needs plenty of Docker
memory and disk, and takes a while on a country-sized extract.

**Memory.** `osrm-extract`'s peak usage scales with thread count, and the
edge-expansion stage is where it peaks. With 12 threads and a ~10 GB Docker
limit it was OOM-killed partway through — the log simply ends in `Killed`, with
no OSRM error. Walking and cycling therefore extract with
`OSRM_OPTIONAL_EXTRACT_THREADS` (default **4**) rather than every available
core: slower, but it fits. Raise it if Docker has more memory:

```bash
OSRM_OPTIONAL_EXTRACT_THREADS=8 ./prepare-osrm.sh walking
```

Driving keeps OSRM's own default and is not affected — its dataset is already
prepared and its pipeline is unchanged.

If an extraction is killed, the profile directory holds partial `.osrm*` files.
Nothing deletes them automatically; inspect them if useful, then re-run — each
step overwrites its own artifacts.

From `tools/osrm/`:

```bash
./prepare-osrm.sh driving     # car.lua      -> ./data
./prepare-osrm.sh walking     # foot.lua     -> ./data/walking
./prepare-osrm.sh cycling     # bicycle.lua  -> ./data/cycling
```

`./prepare-osrm.sh all` does all three back to back. Re-running is safe — each
step overwrites its own artifacts — and the script refuses to write a profile's
output over the shared driving directory.

Each run performs the project's existing three-step MLD pipeline with that
profile's Lua file: `osrm-extract`, then `osrm-partition`, then `osrm-customize`.
The equivalent compose calls are still available directly — driving:

```bash
docker compose -f docker-compose.osrm.yml run --rm osrm-extract
docker compose -f docker-compose.osrm.yml run --rm osrm-partition
docker compose -f docker-compose.osrm.yml run --rm osrm-customize
```

and the optional profiles, using the same services with a `-walking` /
`-cycling` suffix:

```bash
docker compose -f docker-compose.osrm.yml run --rm osrm-extract-walking
docker compose -f docker-compose.osrm.yml run --rm osrm-partition-walking
docker compose -f docker-compose.osrm.yml run --rm osrm-customize-walking
```

### How the optional profiles reach the shared PBF

Driving reads and writes one directory, so it mounts `OSRM_DATA_DIR` at `/data`
and nothing else. The optional profiles need the *source* from one place and
write their *output* to another, and those two container paths must not overlap:

| Mount | Container target | Mode |
|---|---|---|
| `OSRM_DATA_DIR` (shared source) | `/source` | read-only |
| `OSRM_WALKING_DATA_DIR` / `OSRM_CYCLING_DATA_DIR` | `/data` | writable |

An earlier version instead bind-mounted the single PBF file *inside* `/data`.
Docker Desktop's virtiofs rejects that nested mount outright — the container
fails to create with *"mountpoint is outside the rootfs"* before `osrm-extract`
ever runs. It is not a memory error, and no amount of Docker RAM fixes it.

Because `osrm-extract` writes its generated dataset **beside the input file**,
the input cannot sit on the read-only `/source` mount. The extract service
therefore copies the PBF into the writable profile directory, extracts, and
deletes the copy:

```text
cp /source/<dataset>.osm.pbf  /data/<dataset>.osm.pbf
osrm-extract -t "${OSRM_OPTIONAL_EXTRACT_THREADS:-4}" -p /opt/foot.lua /data/<dataset>.osm.pbf
rm -f /data/<dataset>.osm.pbf
```

That copy is transient — there is still only one downloaded PBF — but it does
need the PBF's size in free space again while extraction runs. A failed run
leaves the copy behind; re-running overwrites it.

If the PBF changes, rerun preparation for **every** profile you use, so all
datasets match the same source.

## 4. Start and verify the servers

```bash
docker compose -f docker-compose.osrm.yml up -d osrm-routed osrm-walking osrm-cycling
```

Start only the profiles you actually prepared — the backend copes with the
others being absent (see step 5).

Verify each with a Samsun-area request. The profile segment in the URL is
cosmetic; what answers is the dataset behind that **port**:

```bash
curl 'http://localhost:5001/route/v1/driving/36.3300,41.2867;36.3360,41.2790?overview=full&geometries=geojson'
curl 'http://localhost:5002/route/v1/walking/36.3300,41.2867;36.3360,41.2790?overview=full&geometries=geojson'
curl 'http://localhost:5003/route/v1/cycling/36.3300,41.2867;36.3360,41.2790?overview=full&geometries=geojson'
```

A healthy response has `"code":"Ok"` and at least one route. Coordinates are
always `longitude,latitude`.

A useful sanity check that the datasets really differ: the same pair of points
should generally return different `distance` / `duration` values across the
three ports. Identical figures on every port usually means two servers are
reading the same preprocessed dataset.

## 5. Backend configuration

Driving uses the existing `Osrm` section — the same one Smart Transport route
generation uses:

```text
Osrm:BaseUrl=http://localhost:5001
Osrm:Profile=driving
Osrm:TimeoutSeconds=30
```

These tracked development values already match the ports this project's compose
setup publishes, so `dotnet run` needs no extra environment setup.

Walking and cycling use `JourneyRouting`, already present in
`appsettings.Development.json`:

```text
JourneyRouting:Walking:BaseUrl=http://localhost:5002
JourneyRouting:Walking:Profile=walking
JourneyRouting:Cycling:BaseUrl=http://localhost:5003
JourneyRouting:Cycling:Profile=cycling
```

**Both sections are optional and independent of container health:**

| Situation | Behaviour |
|---|---|
| endpoint configured, server running | genuine routing for that profile |
| endpoint configured, server stopped | request fails with a safe "routing unavailable" error |
| section removed entirely | profile reported as unavailable; it cannot be selected |

The API therefore starts fine with no containers running at all. Nothing falls
back to driving in any of these cases.

If you run an engine on a different port, override it through standard
ASP.NET Core configuration — no custom parsing, and no tracked file needs
editing. This is optional customisation, not a required step:

```bash
Osrm__BaseUrl=http://localhost:6001 \
JourneyRouting__Walking__BaseUrl=http://localhost:6002 \
  dotnet run --project backend/src/StajProject.Api
```

Production ships no `Osrm` section at all, so there the address always comes
from configuration supplied at deployment.

The backend **refuses to start** if a walking or cycling `BaseUrl` equals
`Osrm:BaseUrl`, or if walking and cycling share one address. Either would mean a
single preprocessed dataset serving two profile names — exactly the mislabelling
this setup exists to prevent. These URLs and ports live only in configuration;
they never appear in application code and are never supplied by the browser.

## Stop or remove the containers

```bash
docker compose -f docker-compose.osrm.yml stop osrm-routed osrm-walking osrm-cycling
docker compose -f docker-compose.osrm.yml down
```

`down` removes the containers and network, but not bind-mounted files in
`OSRM_DATA_DIR` or the per-profile directories. Remove those local artifacts
manually only when intentionally rebuilding a dataset.
