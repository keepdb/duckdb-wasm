# @keepdb/duckdb-wasm-browser 发布指导

更新时间：2026-05-24 12:45 CST

## 目标

为 KeepDB 浏览器 OPFS 持久化场景提供专用 DuckDB-Wasm browser 包。

包名：

```text
@keepdb/duckdb-wasm-browser
```

当前 profile：

```text
keepdb-browser-opfs
```

第一版本地 fallback 使用已验证的 `duckdb-browser-eh.worker.js` 和 `duckdb-eh.wasm`，只发布单目标 browser runtime。

当前已新增 C++ minimal profile 入口：

```text
extension_config_keepdb_browser.cmake
scripts/wasm_build_keepdb_browser.sh
packages/duckdb-wasm/src/bindings/bindings_browser_keepdb.ts
packages/duckdb-wasm/src/targets/duckdb-browser-keepdb.worker.ts
```

CI 中不传 `source_run_id` 时，会构建 `duckdb-keepdb-browser.wasm`，再用 `KEEPDB_BROWSER_ONLY=1 yarn workspace @duckdb/duckdb-wasm build:release` 只打包 browser 主入口、专用 worker 和 `duckdb-keepdb-browser.wasm`。本机当前 submodules 未初始化，因此本轮只能用 `eh` runtime 模拟源码构建后的文件形态；真实 minimal C++ wasm 体积仍需要通过 GitHub workflow 验证。

## 本地产物

构建：

```bash
cd /Users/benz/Codes/Githubs/keepdb/packages/keepdb-duckdb-wasm
KEEPDB_SOURCE_RUN_ID=26322240868 yarn workspace @keepdb/duckdb-wasm-browser build
```

打包：

```bash
npm pack ./packages/keepdb-duckdb-wasm-browser --pack-destination /tmp
```

当前本地 fallback/simulation 结果：

```text
/tmp/keepdb-duckdb-wasm-browser-0.1.0.tgz
package size=8.3 MB
unpacked size=36.7 MB
wasm=35846333 bytes
wasm gzip=8077422 bytes
worker=775695 bytes
worker gzip=189457 bytes
```

## GitHub Workflow

专用 workflow：

```text
.github/workflows/keepdb-browser.yml
```

手动触发参数：

```text
source_run_id=26322240868
```

tag 触发：

```bash
git tag keepdb-browser-v0.1.0
git push origin keepdb-browser-v0.1.0
```

workflow 职责：

1. 如果传入 `source_run_id`，下载 `wasm-mvp-loadable`、`wasm-eh-loadable`、`wasm-coi-loadable`，走 fallback artifact 打包。
2. 如果不传 `source_run_id`，使用 `extension_config_keepdb_browser.cmake` 从源码构建 `duckdb-keepdb-browser.wasm`。
3. 如果是源码构建路径，执行 `KEEPDB_BROWSER_ONLY=1 yarn workspace @duckdb/duckdb-wasm build:release`，避免要求 mvp/eh/coi/node/test 全量产物。
4. 执行 `yarn workspace @keepdb/duckdb-wasm-browser build`。
5. 执行 `npm pack ./packages/keepdb-duckdb-wasm-browser`。
6. 上传 `keepdb-duckdb-wasm-browser` artifact。

## 消费验证

消费项目：

```text
/Users/benz/Codes/Lesson/duckdb-wasm-web
```

安装本地 tarball：

```bash
pnpm add /tmp/keepdb-duckdb-wasm-browser-0.1.0.tgz
```

验证：

```bash
pnpm build
pnpm verify:opfs
```

已通过输出：

```text
package=@keepdb/duckdb-wasm-browser file:/tmp/keepdb-duckdb-wasm-browser-0.1.0.tgz
runId=local-browser-only-sim
duckdbWasmCommit=06133b40577d97e44bc2be2b545614463da65d8c
OPFS_DB_REOPEN_OK OK marker=1,ok, test.db size=536576
REOPEN_WRITE_OK OK rows=2, test.db size=798720
SQL_PANEL_OK OK rows=2, latestId=2, test.db size=1060864
REMOTE_IMPORT_OK OK orders=40, items=80, inventory=8, test.db size=1585152
PUBLISHED_READ_OK OK published=keepdb.publish.v1.db, rows=3, size=536576, run=local-browser-only-sim
```

说明：`local-browser-only-sim` 是本机把现有 `duckdb-eh.js/wasm` 临时复制为 `duckdb-keepdb-browser.js/wasm` 后验证 `KEEPDB_BROWSER_ONLY=1` 打包链路的结果，不代表 minimal profile 的最终体积。

## 发布判断

发布前必须满足：

- tarball 内包含 `dist/build-manifest.json`。
- manifest 记录 `sourceRunId`、`duckdbWasmCommit`、wasm size、gzip size。
- 消费项目使用 `@keepdb/duckdb-wasm-browser` 跑通 `pnpm verify:opfs`。
- OPFS DB 文件必须真实落盘，不能只看同 worker 查询成功。

## 下一步

触发一次不带 `source_run_id` 的 workflow，检查：

- `dist/build-manifest.json` 中 `target` 是否为 `keepdb-browser-eh`。
- `files.wasm.source` 是否为 `packages/duckdb-wasm/dist/duckdb-keepdb-browser.wasm`。
- wasm 是否低于当前 fallback `35,846,333 bytes`。
- 消费项目安装 artifact 后 `pnpm verify:opfs` 是否仍通过。
- GitHub workflow 日志中 browser dist 步骤是否显示 `KEEPDB_BROWSER_ONLY=true`。
