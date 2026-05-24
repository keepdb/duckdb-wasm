#!/usr/bin/env bash

PROJECT_ROOT="$(cd $(dirname "$BASH_SOURCE[0]") && cd .. && pwd)" &> /dev/null
BADGEGEN=${PROJECT_ROOT}/node_modules/.bin/badge

cd ${PROJECT_ROOT}/submodules/duckdb
DESCRIBE=`git describe --tags --match 'v[0-9]*' --long 2>/dev/null || true`
if [[ -n "${DESCRIBE}" ]] ; then
    VERSION=`git describe --tags --match 'v[0-9]*' --abbrev=0 | tr -d "v"`
    DEV=`echo "${DESCRIBE}" | cut -f2 -d-`
else
    VERSION="0.0.0"
    DEV=`git rev-list --count HEAD 2>/dev/null || echo 0`
fi

BADGE_LABEL_COLOR="#555"
BADGE_VALUE_COLOR="#007ec6"

if [[ "${DEV}" = "0" ]] ; then
    ${BADGEGEN} duckdb "v${VERSION}"  ${BADGE_VALUE_COLOR} ${BADGE_LABEL_COLOR}
else 
    ${BADGEGEN} duckdb "v${VERSION}-dev${DEV}" ${BADGE_VALUE_COLOR} ${BADGE_LABEL_COLOR}
fi
