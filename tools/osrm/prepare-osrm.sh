#!/usr/bin/env bash
#
# Prepares one OSRM dataset per travel profile from the shared source PBF.
#
# WHY A SCRIPT. Each profile needs the same three steps (extract → partition →
# customize) against a different Lua profile and a different output directory.
# Written out per profile that is twelve README commands whose only differences
# are easy to mistype — and mixing two of them silently produces a dataset that
# routes with the wrong profile.
#
# It runs the project's existing compose services; it does not reimplement the
# pipeline and does not download map data.

set -euo pipefail

readonly HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly COMPOSE_FILE="${HERE}/docker-compose.osrm.yml"

# .env is optional: the compose defaults already work.
if [[ -f "${HERE}/.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "${HERE}/.env"; set +a
fi

readonly DATASET="${OSRM_DATASET:-turkey-latest}"
readonly DATA_DIR="${OSRM_DATA_DIR:-./data}"
readonly WALKING_DIR="${OSRM_WALKING_DATA_DIR:-./data/walking}"
readonly CYCLING_DIR="${OSRM_CYCLING_DATA_DIR:-./data/cycling}"

usage() {
  cat >&2 <<'USAGE'
Usage: ./prepare-osrm.sh <driving|walking|cycling|all>

Prepares the OSRM routing artifacts for one profile (or all three) from the
shared source PBF. Preparation is slow and memory-hungry; see README.md.
USAGE
  exit 2
}

# Resolves a possibly-relative configured directory against this script's
# directory, exactly as docker compose resolves relative volume paths.
absolute() {
  local path="$1"
  [[ "${path}" = /* ]] && printf '%s' "${path}" || printf '%s' "${HERE}/${path#./}"
}

fail() { printf 'error: %s\n' "$1" >&2; exit 1; }

# The output directory MUST NOT be the shared directory: osrm-extract writes
# beside its input, so a walking run pointed at the driving directory would
# overwrite the driving dataset in place.
assert_distinct_output() {
  local profile="$1" output="$2"
  local shared; shared="$(absolute "${DATA_DIR}")"
  [[ "$(absolute "${output}")" != "${shared}" ]] \
    || fail "${profile} output directory must differ from OSRM_DATA_DIR (${shared}); otherwise it would overwrite the driving dataset."
}

prepare() {
  local profile="$1" lua="$2" suffix="$3" output="$4"
  local source_pbf; source_pbf="$(absolute "${DATA_DIR}")/${DATASET}.osm.pbf"

  [[ -f "${source_pbf}" ]] || fail "source extract not found: ${source_pbf} (see README.md step 1)"

  if [[ -n "${suffix}" ]]; then
    assert_distinct_output "${profile}" "${output}"
    mkdir -p -- "$(absolute "${output}")"

    # Optional profiles copy the source PBF into their own directory for the
    # duration of extraction (see the compose file: /source is read-only and
    # osrm-extract writes beside its input). Budget the PBF's size again here,
    # transiently. A failed extraction leaves that copy behind; re-running
    # overwrites it.
    printf '    note: needs ~%s of extra free space during extraction\n' \
      "$(du -h -- "${source_pbf}" 2>/dev/null | cut -f1 || printf 'the PBF size')"
  fi

  printf '\n==> %s  (profile %s, output %s)\n' "${profile}" "${lua}" "${output}"

  # Re-running is safe: each step overwrites its own artifacts.
  local step
  for step in extract partition customize; do
    printf '    %s\n' "osrm-${step}${suffix:+ (${profile})}"
    docker compose -f "${COMPOSE_FILE}" run --rm "osrm-${step}${suffix}"
  done
}

main() {
  [[ $# -eq 1 ]] || usage
  command -v docker >/dev/null 2>&1 || fail 'docker is not on PATH.'

  case "$1" in
    driving) prepare driving car.lua ''         "${DATA_DIR}" ;;
    walking) prepare walking foot.lua '-walking' "${WALKING_DIR}" ;;
    cycling) prepare cycling bicycle.lua '-cycling' "${CYCLING_DIR}" ;;
    all)
      prepare driving car.lua ''          "${DATA_DIR}"
      prepare walking foot.lua '-walking' "${WALKING_DIR}"
      prepare cycling bicycle.lua '-cycling' "${CYCLING_DIR}"
      ;;
    *) usage ;;
  esac

  printf '\nDone. Start the servers with:\n'
  printf '  docker compose -f %q up -d osrm-routed osrm-walking osrm-cycling\n' "${COMPOSE_FILE}"
}

main "$@"
