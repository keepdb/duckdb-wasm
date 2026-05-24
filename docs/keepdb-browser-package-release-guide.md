# @keepdb/duckdb-wasm-browser 发布指导

更新时间：2026-05-24 13:30 CST

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

CI 中不传 `source_run_id` 时，会构建 `duckdb-keepdb-browser.wasm`，再用 `KEEPDB_BROWSER_ONLY=1 yarn workspace @duckdb/duckdb-wasm build:release` 只打包 browser 主入口、专用 worker 和 `duckdb-keepdb-browser.wasm`。

已通过真实源码构建 run：

```text
runId=26352262478
tag=keepdb-browser-v0.1.0-rc.1
commit=2f1a72de2f41fdb8772f04b2de84154ed9aeafc1
```

结论：专用源码构建和消费验收已打通，但当前 `duckdb-keepdb-browser.wasm` 体积仍与 fallback `eh` 基本一致，尚未达到“精简版 wasm”的体积目标。

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

当前真实源码构建结果：

```text
/tmp/keepdb-browser-run-26352262478/keepdb-duckdb-wasm-browser-0.1.0.tgz
package size=8.3 MB
unpacked size=36.7 MB
wasm=35846333 bytes
wasm gzip=8077407 bytes
worker=775707 bytes
worker gzip=189464 bytes
wasm source=packages/duckdb-wasm/dist/duckdb-keepdb-browser.wasm
worker source=packages/duckdb-wasm/dist/duckdb-browser-keepdb.worker.js
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
pnpm add /tmp/keepdb-browser-run-26352262478/keepdb-duckdb-wasm-browser-0.1.0.tgz
```

验证：

```bash
pnpm build
pnpm verify:opfs
```

已通过输出：

```text
package=@keepdb/duckdb-wasm-browser file:/tmp/keepdb-browser-run-26352262478/keepdb-duckdb-wasm-browser-0.1.0.tgz
runId=26352262478
duckdbWasmCommit=2f1a72de2f41fdb8772f04b2de84154ed9aeafc1
OPFS_DB_REOPEN_OK OK marker=1,ok, test.db size=536576
REOPEN_WRITE_OK OK rows=2, test.db size=798720
SQL_PANEL_OK OK rows=2, latestId=2, test.db size=1060864
REMOTE_IMPORT_OK OK orders=40, items=80, inventory=8, test.db size=1585152
PUBLISHED_READ_OK OK published=keepdb.publish.v1.db, rows=3, size=536576, run=26352262478
```

说明：这组输出来自真实 GitHub artifact，不是本机 simulation。

## 发布判断

发布前必须满足：

- tarball 内包含 `dist/build-manifest.json`。
- manifest 记录 `sourceRunId`、`duckdbWasmCommit`、wasm size、gzip size。
- 消费项目使用 `@keepdb/duckdb-wasm-browser` 跑通 `pnpm verify:opfs`。
- OPFS DB 文件必须真实落盘，不能只看同 worker 查询成功。

## 下一步

当前已确认：真实源码构建 artifact 可被消费项目使用，OPFS 完整验收通过，但 wasm 体积未降低。下一步优化重点不是 JS package，而是继续收窄 C++/Wasm 链接输入，确认 extension config 是否实际减少 linked code，以及 Parquet/httpfs/loadable extension 组合是否仍把主要体积留在主 wasm。
