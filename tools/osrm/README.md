# Local OSRM development server

The backend uses OSRM's Route service to turn explicitly ordered transport
stops into a road-following `LineString`. OSRM is a development dependency only:
the API can start without Docker or a running OSRM container, and the browser
never calls OSRM directly.

The compose setup uses the MLD pipeline and the pinned image
`ghcr.io/project-osrm/osrm-backend:v5.27.1`. It has portable defaults and can be
customized through a local `tools/osrm/.env` file.

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
OSRM_HOST_PORT=5000
```

- `OSRM_DATA_DIR` is the directory containing the PBF and generated OSRM files.
  A relative path is resolved from `tools/osrm/` when the documented commands
  are run there.
- `OSRM_DATASET` is the basename only, without `.osm.pbf` or `.osrm`.
- `OSRM_HOST_PORT` is the host port; OSRM continues to listen on port `5000`
  inside the container.

The `.env` file is ignored by Git. `.env.example` is the tracked, machine-neutral
template. The defaults also work without creating `.env`.

## 3. Prepare the MLD routing data

From `tools/osrm/`, run these commands in order:

```bash
docker compose -f docker-compose.osrm.yml run --rm osrm-extract
docker compose -f docker-compose.osrm.yml run --rm osrm-partition
docker compose -f docker-compose.osrm.yml run --rm osrm-customize
```

`osrm-extract` uses OSRM's bundled `car.lua`. `osrm-partition` and
`osrm-customize` then produce the MLD artifacts consumed by `osrm-routed`.
Preparation can take time and requires sufficient Docker memory and disk.

If the PBF changes, rerun all three commands so the generated files match it.

## 4. Start and verify OSRM

```bash
docker compose -f docker-compose.osrm.yml up -d osrm-routed
```

With the default host port, verify the Route service with a Samsun-area request:

```bash
curl 'http://localhost:5000/route/v1/driving/36.3300,41.2867;36.3360,41.2790?overview=full&geometries=geojson&steps=false'
```

A healthy response has `"code":"Ok"` and at least one route. Route coordinates
are always `longitude,latitude`.

## 5. Configure the backend URL

Tracked backend configuration defaults to:

```text
Osrm:BaseUrl=http://localhost:5000
Osrm:Profile=driving
Osrm:TimeoutSeconds=30
```

If the default host port is already occupied, set a different local port in
`tools/osrm/.env`, for example:

```dotenv
OSRM_HOST_PORT=5001
```

Then override the backend through standard ASP.NET Core configuration when
starting it:

```bash
Osrm__BaseUrl=http://localhost:5001 dotnet run --project backend/src/StajProject.Api
```

No custom environment parsing is used. The OSRM URL and profile remain
server-side configuration and are never supplied by the browser.

## Stop or remove the container

```bash
docker compose -f docker-compose.osrm.yml stop osrm-routed
docker compose -f docker-compose.osrm.yml down
```

`down` removes the container and network, but not bind-mounted files in
`OSRM_DATA_DIR`. Remove those local artifacts manually only when intentionally
rebuilding the dataset.
