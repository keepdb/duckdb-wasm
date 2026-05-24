#!/usr/bin/env bash

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null

# Prerelease everything else
DESCRIBE=`git describe --tags --match 'v[0-9]*' --long 2>/dev/null || true`
if [[ -n "${DESCRIBE}" ]] ; then
	echo "${DESCRIBE}"
	export VERSION=`git describe --tags --match 'v[0-9]*' --abbrev=0 | tr -d "v"`
	export DEV=`echo "${DESCRIBE}" | cut -f2 -d-`
else
	export VERSION=`node -p "require('${PROJECT_ROOT}/packages/duckdb-wasm/package.json').version"`
	export DEV=`git rev-list --count HEAD 2>/dev/null || echo 0`
fi
echo "VERSION=${VERSION}"
echo "DEV=${DEV}"

# Is release?
if [[ "${DEV}" = "0" ]] ; then
	for PKG in ${PROJECT_ROOT}/packages/* ; do
		if [[ "$(basename "${PKG}")" = "keepdb-duckdb-wasm-browser" ]] ; then
			continue
		fi
		cd ${PKG}
		npm version ${VERSION}
	done
else 
	for PKG in ${PROJECT_ROOT}/packages/* ; do
		if [[ "$(basename "${PKG}")" = "keepdb-duckdb-wasm-browser" ]] ; then
			continue
		fi
		cd ${PKG}
		npm version ${VERSION}
		npm version prerelease --preid="dev"${DEV}
	done
fi
echo "TAG=${TAG}"

cd ${PROJECT_ROOT}
node ${PROJECT_ROOT}/scripts/sync_versions.mjs
