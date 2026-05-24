# @keepdb/duckdb-wasm-browser 发布指导

更新时间：2026-05-24 22:58 CST

## 标准工作流

`@keepdb/duckdb-wasm-browser` 的发布与消费必须走 GitHub artifact 闭环，不以本机 `dist/` 或同 worker 查询成功作为验收依据。

标准流程：

1. 在 `keepdb-duckdb-wasm` 仓库创建专用 tag，格式为 `keepdb-browser-v<version>` 或 `keepdb-browser-v<version>-rc.<n>`。
2. GitHub Actions 执行 `.github/workflows/keepdb-browser.yml`，生成 `keepdb-duckdb-wasm-browser` artifact。
3. 下载 artifact 中的 `keepdb-duckdb-wasm-browser-<version>.tgz` 和 `build-manifest.json`。
4. 在消费项目 `/Users/benz/Codes/Lesson/duckdb-wasm-web` 通过 tarball 安装：

```bash
pnpm add /tmp/keepdb-browser-run-<runId>/keepdb-duckdb-wasm-browser-<version>.tgz
```

5. 在消费项目执行：

```bash
pnpm build
pnpm verify:opfs
```

6. 验收输出必须同时包含：

```text
OPFS_DB_REOPEN_OK
REOPEN_WRITE_OK
SQL_PANEL_OK
REMOTE_IMPORT_OK orders=40, items=80, inventory=8
PUBLISHED_READ_OK
```

其中 `OPFS_DB_REOPEN_OK`、`REOPEN_WRITE_OK` 和 `PUBLISHED_READ_OK` 必须证明 OPFS 物理文件 `size > 0`，并且包含 worker terminate 后新 worker reopen 可读、reopen 后可继续写入的链路。

不满足以上任一项时，不允许把包标记为可消费版本。

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

最新已通过真实源码构建 run：

```text
runId=26363804188
tag=keepdb-browser-v0.1.0-rc.2
commit=54bf2caf0a430acfe2ae8a19e721ed1107db6773
```

上一轮通过 run：

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

当前 `rc.2` 真实源码构建结果：

```text
/tmp/keepdb-browser-run-26363804188/keepdb-duckdb-wasm-browser-0.1.0.tgz
artifact tgz size=7.9 MiB
wasm=35846333 bytes
wasm gzip=8077411 bytes
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
git tag keepdb-browser-v0.1.0-rc.2
git push origin keepdb-browser-v0.1.0-rc.2
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
pnpm add /tmp/keepdb-browser-run-26363804188/keepdb-duckdb-wasm-browser-0.1.0.tgz
```

验证：

```bash
pnpm build
pnpm verify:opfs
```

最新 `rc.2` 已通过输出：

```text
package=@keepdb/duckdb-wasm-browser file:/tmp/keepdb-browser-run-26363804188/keepdb-duckdb-wasm-browser-0.1.0.tgz
runId=26363804188
duckdbWasmCommit=54bf2caf0a430acfe2ae8a19e721ed1107db6773
OPFS_DB_REOPEN_OK OK marker=1,ok, test.db size=536576
REOPEN_WRITE_OK OK rows=2, test.db size=798720
SQL_PANEL_OK OK rows=2, latestId=2, test.db size=1060864
REMOTE_IMPORT_OK OK orders=40, items=80, inventory=8, test.db size=1585152
PUBLISHED_READ_OK OK published=keepdb.publish.v1.db, rows=3, size=536576, run=26363804188
```

说明：这组输出来自真实 GitHub artifact，不是本机 simulation。

## 发布判断

发布前必须满足：

- tarball 内包含 `dist/build-manifest.json`。
- manifest 记录 `sourceRunId`、`duckdbWasmCommit`、wasm size、gzip size。
- 消费项目使用 `@keepdb/duckdb-wasm-browser` 跑通 `pnpm verify:opfs`。
- OPFS DB 文件必须真实落盘，不能只看同 worker 查询成功。
- 主 `Main` workflow 至少要在当前分支有一条绿色验证记录。当前已恢复通过：

```text
runId=26361798785
commit=23d868cc81b1dea93b28879498a05df9995ab591
conclusion=success
```

说明：普通 non-loadable `Js / Libraries` 的 Chrome/coverage 在 Chrome 148 上出现 `Executed 0 of 194 DISCONNECTED`，已默认跳过；`Js / Libraries (loadable version)` 和 deploy 的 Chrome/Node 仍作为浏览器 CI 信号继续运行。

## 下一步

当前已确认：`keepdb-browser-v0.1.0-rc.2` 真实源码构建 artifact 可被消费项目使用，OPFS 完整验收通过，但 wasm 体积仍未降低。下一阶段把体积优化作为独立任务处理，重点查 C++/Wasm 链接输入和 extension config 实际裁剪效果。
