#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'USAGE'
Usage:
  scripts/pack-duckdb-wasm-artifact.sh <github-actions-run-id>

Environment:
  OUT_DIR=/tmp/duckdb-wasm-pack-<run-id>
  CONSUMER_DIR=/Users/benz/Codes/Lesson/duckdb-wasm-web

This script downloads the loadable DuckDB-Wasm artifacts from a GitHub Actions
run, rebuilds the @duckdb/duckdb-wasm JS package, and writes a local npm tarball.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi

run_id="${1:-}"
if [[ -z "${run_id}" ]]; then
    usage >&2
    exit 2
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
consumer_dir="${CONSUMER_DIR:-/Users/benz/Codes/Lesson/duckdb-wasm-web}"
out_dir="${OUT_DIR:-/tmp/duckdb-wasm-pack-${run_id}}"
work_dir="${TMPDIR:-/tmp}/duckdb-wasm-artifacts-${run_id}"
artifact_dir="${work_dir}/artifacts"
bindings_dir="${repo_root}/packages/duckdb-wasm/src/bindings"

require_cmd() {
    if ! command -v "$1" >/dev/null 2>&1; then
        echo "Missing required command: $1" >&2
        exit 127
    fi
}

copy_artifact_file() {
    local file_name="$1"
    local source
    source="$(find "${artifact_dir}" -type f -name "${file_name}" | head -n 1)"
    if [[ -z "${source}" ]]; then
        echo "Missing artifact file: ${file_name}" >&2
        echo "Downloaded files:" >&2
        find "${artifact_dir}" -type f | sort >&2
        exit 1
    fi

    cp "${source}" "${bindings_dir}/${file_name}"
    echo "copied ${file_name}"
}

require_cmd gh
require_cmd yarn
require_cmd npm

cd "${repo_root}"
rm -rf "${work_dir}"
mkdir -p "${artifact_dir}" "${bindings_dir}" "${out_dir}"

echo "Downloading loadable artifacts from GitHub Actions run ${run_id}"
for artifact_name in wasm-mvp-loadable wasm-eh-loadable wasm-coi-loadable; do
    gh run download "${run_id}" --name "${artifact_name}" --dir "${artifact_dir}/${artifact_name}"
done

copy_artifact_file duckdb-mvp.js
copy_artifact_file duckdb-mvp.wasm
copy_artifact_file duckdb-eh.js
copy_artifact_file duckdb-eh.wasm
copy_artifact_file duckdb-coi.js
copy_artifact_file duckdb-coi.pthread.js
copy_artifact_file duckdb-coi.wasm

echo "Building @duckdb/duckdb-wasm release bundle"
rm -rf "${repo_root}/packages/duckdb-wasm/dist"
yarn workspace @duckdb/duckdb-wasm build:release

echo "Packing @duckdb/duckdb-wasm into ${out_dir}"
npm pack "${repo_root}/packages/duckdb-wasm" --pack-destination "${out_dir}" >/tmp/duckdb-wasm-pack-name.txt
tarball_name="$(tail -n 1 /tmp/duckdb-wasm-pack-name.txt)"
tarball_path="${out_dir}/${tarball_name}"

if [[ ! -f "${tarball_path}" ]]; then
    echo "Pack failed, tarball not found: ${tarball_path}" >&2
    exit 1
fi

cat <<EOF

TARBALL=${tarball_path}

Consumer install:
  cd ${consumer_dir}
  pnpm add ${tarball_path}
  DUCKDB_WASM_RUN_ID=${run_id} pnpm verify:opfs

EOF
