# @keepdb/duckdb-wasm-browser

KeepDB browser-focused DuckDB-Wasm runtime.

This package is intentionally separate from `@duckdb/duckdb-wasm`:

- It ships a single browser runtime target.
- It keeps the OPFS database persistence patch path.
- It is validated by the KeepDB OPFS browser suite before being promoted.
- It is not intended to replace the full upstream DuckDB-Wasm package.

## Included Assets

```text
dist/index.js
dist/duckdb-browser.mjs
dist/duckdb-browser.d.ts
dist/types/
dist/worker.js
dist/wasm/duckdb.wasm
dist/build-manifest.json
```

The first implementation can use either:

- `duckdb-keepdb-browser.wasm` from the `keepdb-browser-opfs` C++ profile, when present.
- The validated `duckdb-eh.wasm` runtime as a fallback.

Further size reduction must happen in the C++ profile without removing OPFS database persistence.

## Usage

```ts
import { AsyncDuckDB, ConsoleLogger, createKeepDBBrowserBundle } from '@keepdb/duckdb-wasm-browser';

const bundle = createKeepDBBrowserBundle();
const worker = new Worker(bundle.mainWorker);
const db = new AsyncDuckDB(new ConsoleLogger(), worker);

await db.instantiate(bundle.mainModule);
await db.open({ path: 'opfs://test.db' });
```

## Validation Contract

The package is only considered valid when the consuming browser project proves:

- OPFS physical database file `size > 0`.
- `FORCE CHECKPOINT` plus `flushFiles()` persists the database.
- Current worker can be terminated and a new worker can reopen the same OPFS DB.
- Reopened DB can continue writing and checkpointing.
- Published DB can be consumed through a `READ_ONLY` manifest path.

KeepDB release validation is performed from the consuming project, using the GitHub artifact tarball:

```bash
cd /Users/benz/Codes/Lesson/duckdb-wasm-web
pnpm add /tmp/keepdb-browser-run-<runId>/keepdb-duckdb-wasm-browser-<version>.tgz
pnpm build
pnpm verify:opfs
```

Required success markers:

```text
OPFS_DB_REOPEN_OK
REOPEN_WRITE_OK
SQL_PANEL_OK
REMOTE_IMPORT_OK
PUBLISHED_READ_OK
```
