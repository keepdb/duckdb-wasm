################################################################################
# KeepDB browser OPFS extension config
################################################################################
#
# Goal:
#   Keep the browser OPFS database persistence path and remote Parquet ingestion,
#   while avoiding extension side modules that are not part of the first KeepDB
#   browser runtime contract.
#
# Required by current verification:
#   - read_parquet('https://...')
#   - OPFS database open/checkpoint/flush/reopen path from the web filesystem
#
# Explicitly excluded from this profile for size:
#   - json
#   - autocomplete
#   - icu
#   - tpcds
#   - tpch

duckdb_extension_load(parquet DONT_LINK)
