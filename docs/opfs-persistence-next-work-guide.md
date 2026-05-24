# DuckDB-Wasm OPFS 持久化下一步工作指导

更新时间：2026-05-24 21:40 CST

## 当前推进顺序

下一步以“可发布、可消费、可复验”为目标，不再把非 loadable Chrome 卡死和 wasm 体积优化混进 OPFS 功能闭环。

执行顺序：

1. 使用最新绿色 `Main` commit 创建 `keepdb-browser-v0.1.0-rc.2`。
2. 等待 `.github/workflows/keepdb-browser.yml` 产出 `@keepdb/duckdb-wasm-browser` tarball。
3. 下载 GitHub artifact 到 `/tmp/keepdb-browser-run-<runId>/`。
4. 在 `/Users/benz/Codes/Lesson/duckdb-wasm-web` 安装 tarball 并执行 `pnpm verify:opfs`。
5. 记录 run id、commit、tarball、manifest size、OPFS 验收输出。
6. 只在该闭环通过后，再进入 wasm 体积优化阶段。

成功指标仍以消费项目输出为准：

```text
OPFS_DB_REOPEN_OK
REOPEN_WRITE_OK
SQL_PANEL_OK
REMOTE_IMPORT_OK orders=40, items=80, inventory=8
PUBLISHED_READ_OK
```

## 最新进展

主 `Main` workflow 已恢复绿色：

```text
runId=26361798785
commit=23d868cc81b1dea93b28879498a05df9995ab591
conclusion=success
```

本次 CI 处理结论：

- `keepdb-browser-*` tag 不再触发主 npm 发布路径。
- `scripts/npm_version.sh` 和 `scripts/build_duckdb_badge.sh` 只匹配正式 `v[0-9]*` tag，避免专用 browser tag 污染版本号。
- non-loadable `Js / Libraries` 的 Chrome/coverage 在 Chrome 148 上会 `Executed 0 of 194 DISCONNECTED`，已默认跳过。
- `Js / Libraries (loadable version)` 和 `Js / Libraries (loadable version) - Deploy` 的 Chrome/Node 仍通过，作为浏览器 CI 信号。

P0 浏览器验收脚本已在消费项目落地：

```text
/Users/benz/Codes/Lesson/duckdb-wasm-web/scripts/verify-opfs-persistence.mjs
```

运行命令：

```bash
cd /Users/benz/Codes/Lesson/duckdb-wasm-web
pnpm verify:opfs
```

最近一次通过结果：

```text
package=@duckdb/duckdb-wasm file:/tmp/duckdb-wasm-pack-26322240868/duckdb-duckdb-wasm-1.11.0.tgz
runId=26322240868
duckdbWasmCommit=未确认
OPFS_DB_REOPEN_OK OK marker=1,ok, test.db size=536576
REOPEN_WRITE_OK OK rows=2, test.db size=798720
SQL_PANEL_OK OK rows=2, latestId=2, test.db size=1060864
REMOTE_IMPORT_OK OK orders=40, items=80, inventory=8, test.db size=1585152
PUBLISHED_READ_OK OK published=keepdb.publish.v1.db, rows=3, size=536576, run=26322240868
```

P1 发布版 manifest 已在消费项目中扩展并纳入自动验收。manifest 现在包含 `schemaVersion`、`accessMode`、`duckdbWasmPackage`、`duckdbWasmCommit`、`artifactRunId`、`tables`、`checkpointAt`、`publishedAt`，读侧会校验 manifest size 与 OPFS 物理文件大小一致。

P2 artifact 下载和 pack 脚本已在 duckdb-wasm fork 落地：

```text
/Users/benz/Codes/Githubs/keepdb/packages/keepdb-duckdb-wasm/scripts/pack-duckdb-wasm-artifact.sh
```

运行方式：

```bash
cd /Users/benz/Codes/Githubs/keepdb/packages/keepdb-duckdb-wasm
scripts/pack-duckdb-wasm-artifact.sh 26322240868
```

脚本已通过 `bash -n` 语法检查和 `--help` 输出检查。未在本轮重新下载 artifact 和 rebuild，避免重复触发耗时构建。

GitHub Actions run `26322240868` 当前状态已复核：

- run 结论：`failure`
- head commit：`06133b40577d97e44bc2be2b545614463da65d8c`
- `Js / Libraries (loadable version)`：成功
- `Js / Libraries (loadable version) - Deploy`：成功
- `Js / Libraries`：失败，失败步骤是 `Test @duckdb/duckdb-wasm on Chrome`

该状态仍不改变本轮 OPFS 交付判断：可消费产物来自 loadable 链路，且消费项目自动化验收已通过。普通 `Js / Libraries` 需要作为独立 CI 稳定性问题继续排查。

`@keepdb/duckdb-wasm-browser` 专用包已开始落地：

```text
packages/keepdb-duckdb-wasm-browser
scripts/build-keepdb-browser-package.mjs
.github/workflows/keepdb-browser.yml
```

第一版 profile 为 `keepdb-browser-opfs`，使用已验证的 `eh` runtime 作为单目标 browser 包：

```text
dist/wasm/duckdb.wasm
dist/worker.js
dist/build-manifest.json
```

当前本地构建结果：

```text
wasm=35846333 bytes gzip=8077422 bytes
worker=775748 bytes gzip=189495 bytes
package size=8.3 MB
unpacked size=36.7 MB
```

这一步先完成“专用包边界 + 专用 workflow + manifest + artifact”闭环。

`keepdb-browser-opfs` C++ minimal profile 入口已新增：

```text
extension_config_keepdb_browser.cmake
scripts/wasm_build_keepdb_browser.sh
packages/duckdb-wasm/src/bindings/bindings_browser_keepdb.ts
packages/duckdb-wasm/src/targets/duckdb-browser-keepdb.worker.ts
```

`KEEPDB_BROWSER_ONLY=1` browser-only 打包路径已落地在 `packages/duckdb-wasm/bundle.mjs`，源码构建路径不再要求 mvp/eh/coi/node/test 全量产物。`.github/workflows/keepdb-browser.yml` 在不传 `source_run_id` 时会使用该模式打包专用 browser dist。

真实源码构建 run `26352262478` 已通过，触发 tag 为 `keepdb-browser-v0.1.0-rc.1`，提交为 `2f1a72de2f41fdb8772f04b2de84154ed9aeafc1`。artifact 中的 manifest 确认：

```text
target=keepdb-browser-eh
wasm source=packages/duckdb-wasm/dist/duckdb-keepdb-browser.wasm
worker source=packages/duckdb-wasm/dist/duckdb-browser-keepdb.worker.js
wasm=35846333 bytes
wasm gzip=8077407 bytes
```

结论：源码构建、browser-only dist、专用 npm 包和消费验收已打通；但 wasm 体积没有低于 fallback `eh`，精简目标未完成。下一步应继续查 C++/Wasm 链接输入，而不是继续改 JS 包装层。

消费项目已切换到本地 tarball 并通过同一套 OPFS 验收：

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

本轮还修复了 `@keepdb/duckdb-wasm-browser` 包内 JS sourcemap 注释残留问题，避免 `worker.js` 在 Vite/开发服务器中引用不存在的 `duckdb-browser-keepdb.worker.js.map`。

专用 tag 发布方式：

```bash
git tag keepdb-browser-v0.1.0
git push origin keepdb-browser-v0.1.0
```

或者手动触发 `.github/workflows/keepdb-browser.yml`。传入 `source_run_id=26322240868` 时，workflow 会下载 `wasm-*-loadable` artifacts 并打包 fallback 包；不传 `source_run_id` 时，workflow 会从源码构建 `duckdb-keepdb-browser.wasm`，使用 `extension_config_keepdb_browser.cmake` 只保留当前验证必需的 Parquet 扩展入口。



## 目标

把当前已经验证可用的 OPFS 数据库持久化补丁，推进到“可复跑、可交接、可发布消费”的状态。

本阶段不再以新增页面 demo 为主，重点是把验证和交付流程固定下来，避免再次出现“同 worker 看似写入成功，实际 OPFS 物理文件为空”的假阳性。

## 当前基线

已通过的事实：

- GitHub Actions run `26322240868` 的 `Js / Libraries (loadable version)` 和 deploy 成功。
- 消费项目 `/Users/benz/Codes/Lesson/duckdb-wasm-web` 已使用 run `26322240868` 三个 loadable artifacts 重新打包出的 tarball。
- 浏览器页面已验证：
  - `opfs://test.db` 物理文件非空。
  - terminate worker 后新 worker 可重开读回。
  - 已有 DB 重开后可继续写入、checkpoint、再次读回。
  - SQL 面板连续执行写入不会再报 `File is not opened in write mode`。
  - 远程 Parquet 可入库并 checkpoint。
  - 发布版 DB 可用 `READ_ONLY` 方式消费。

已修复的关键提交：

- `f8e27718 fix: reopen buffered files with write flags`
- `06133b40 test: allow write after cached read`

仍需单独处理的事实：

- 普通 `Js / Libraries` CI 仍失败，但当前日志是 Chrome Headless/Karma 卡死：`Executed 0 of 194 DISCONNECTED`，未出现 OPFS 断言失败。
- 消费项目当前依赖仍指向 `/tmp/duckdb-wasm-pack-26322240868/duckdb-duckdb-wasm-1.11.0.tgz`，不是长期稳定发布方式。

## 工作顺序

建议按以下顺序推进，前一项没有完成前不要扩大范围：

1. 固化浏览器验收脚本。
2. 固化发布版只读消费模型。
3. 排查普通 `Js / Libraries` CI 卡死。
4. 脚本化 GitHub artifact 下载和 pack 流程。
5. 扩展发布 manifest 和一致性校验。
6. 打包 `@keepdb/duckdb-wasm-browser` 专用浏览器包。
7. 再考虑上游 PR 或长期 npm/canary 发布。

## P0：固化浏览器验收脚本

目标：每次替换 duckdb-wasm 构建产物后，用一个可复跑命令判断补丁是否真实有效。

实施位置：

```text
/Users/benz/Codes/Lesson/duckdb-wasm-web
```

建议产物：

```text
scripts/verify-opfs-persistence.mjs
```

当前状态：已完成。脚本通过 Playwright 调用页面暴露的 `window.keepdbOPFS.runFullOPFSValidationSuite()`，不会依赖 DOM 文案判断通过与否。

建议使用 Playwright 或现有浏览器自动化能力，自动执行页面上的验证按钮或直接调用页面暴露的验证函数。

必须覆盖的验收项：

| 验收项 | 必须证明 |
|---|---|
| 清空 OPFS 后完整写入 | `test.db size > 0` |
| worker terminate 后重开 | 新 worker 可读回 marker |
| 重开续写 | 已有 DB reopen 后 `INSERT` + `FORCE CHECKPOINT` 成功 |
| SQL 面板连续执行 | 同一段建表/插入/查询 SQL 连续两次行数递增 |
| 远程 Parquet 入库 | `orders=40`、`items=80`、`inventory=8` |
| 发布版只读消费 | `READ_ONLY` 打开发布 DB，读回行数，写入被拒绝 |

脚本输出必须包含：

```text
commit=<duckdb-wasm commit>
runId=<github actions run id>
package=<tarball path or package version>
OPFS_DB_REOPEN_OK test.db size=<bytes>
REOPEN_WRITE_OK rows=<n> test.db size=<bytes>
SQL_PANEL_OK rows=<n> test.db size=<bytes>
REMOTE_IMPORT_OK orders=40 items=80 inventory=8 test.db size=<bytes>
PUBLISHED_READ_OK current=<db name> rows=<n> size=<bytes>
```

失败时必须保留以下信息：

- 页面 console error。
- 当前依赖的 `@duckdb/duckdb-wasm` 解析路径。
- OPFS `test.db` 和 `test.db.wal` 文件大小。
- DuckDB worker 是否被 terminate 后重建。

通过标准：

- 验收脚本连续跑 3 次通过。
- 每次都从清空 OPFS 开始。
- 每次都包含 worker terminate 后新 worker reopen。
- 不能只用同 worker 查询结果作为通过依据。

## P1：固化发布版只读消费模型

目标：把 OPFS 使用方式收敛为“写侧串行生成，读侧只读消费”，避免把 OPFS 当普通本地 FS 做多方共享读写。

写侧流程：

1. 写入临时发布 DB，例如 `opfs://keepdb.publish.next.db`。
2. 导入远程数据或业务数据。
3. 执行 `FORCE CHECKPOINT`。
4. 执行 `db.flushFiles()`。
5. 检查 DB 物理文件 `size > 0`。
6. terminate 写侧 worker。
7. 用新 worker `READ_ONLY` 重开临时发布 DB 并核对行数。
8. 校验通过后更新 manifest，把 `current` 指向新版本。

读侧流程：

1. 读取 manifest。
2. 只按 `manifest.current` 打开 DB。
3. 使用 `DuckDBAccessMode.READ_ONLY`。
4. 读侧禁止对当前发布 DB 执行写入、checkpoint、drop。

manifest 建议字段：

```json
{
  "schemaVersion": 1,
  "current": "keepdb.publish.v1.db",
  "size": 536576,
  "duckdbWasmCommit": "f8e27718",
  "artifactRunId": "26322240868",
  "tables": [
    { "name": "orders", "rows": 40 },
    { "name": "items", "rows": 80 },
    { "name": "inventory", "rows": 8 }
  ],
  "checkpointAt": "2026-05-23T00:00:00.000Z",
  "publishedAt": "2026-05-23T00:00:00.000Z"
}
```

通过标准：

- 写侧失败不会更新 manifest。
- manifest 指向的 DB 必须存在且 `size > 0`。
- 读侧使用 `READ_ONLY` 能读回所有声明表和行数。
- 读侧尝试写入必须失败，且失败不破坏已发布 DB。

## P1：排查普通 `Js / Libraries` CI 卡死

目标：把 CI 状态从“loadable 可交付，普通版未知卡死”收敛到可解释状态。

当前已知失败特征：

```text
Chrome Headless 148.0.0.0 ... Disconnected , because no message in 900000 ms
Chrome Headless 148.0.0.0: Executed 0 of 194 DISCONNECTED
```

排查顺序：

1. 单独 rerun 普通 `Js / Libraries` job。
2. 如果仍是 `Executed 0 of 194 DISCONNECTED`，先按 Karma/Chrome 启动问题处理。
3. 如果测试能开始执行，再看是否出现具体 OPFS 测试失败。
4. 只有出现具体失败用例后，才改 OPFS 逻辑。

判断边界：

- 没有进入任何测试前的 Chrome disconnect，不作为 OPFS 功能失败。
- 不能为了让 CI 绿而跳过 OPFS 持久化核心验收。
- 如果普通版 CI 持续 flaky，可以先记录为独立 CI 稳定性问题，但 loadable artifact 的浏览器验收仍要保留。

通过标准：

- 普通 `Js / Libraries` job 通过；或
- 有明确文档记录它是 CI 启动/环境问题，不影响 run `26322240868` loadable artifact 的 OPFS 验收结论。

## P2：脚本化 artifact 下载和 pack

目标：把“GitHub 打包 + duckdb-wasm-web 消费”变成固定命令，减少手工解压和 `/tmp` 路径误差。

建议在 duckdb-wasm fork 中新增：

```text
scripts/pack-duckdb-wasm-artifact.sh
```

当前状态：已完成脚本落地。脚本会下载 `wasm-mvp-loadable`、`wasm-eh-loadable`、`wasm-coi-loadable`，复制必要的 `duckdb-*.js` / `duckdb-*.wasm` 到 `packages/duckdb-wasm/src/bindings/`，执行 `yarn workspace @duckdb/duckdb-wasm build:release`，再用 `npm pack` 输出 tarball。

建议命令：

```bash
scripts/pack-duckdb-wasm-artifact.sh 26322240868
```

脚本职责：

1. 使用 `gh run download <run-id>` 下载 artifacts。
2. 校验必须存在：
   - `wasm-mvp-loadable`
   - `wasm-eh-loadable`
   - `wasm-coi-loadable`
3. 把 Wasm 产物放入 `packages/duckdb-wasm` 期望位置。
4. 执行 duckdb-wasm JS package build。
5. 执行 pack，输出到稳定目录：

```text
/tmp/duckdb-wasm-pack-<run-id>/duckdb-duckdb-wasm-1.11.0.tgz
```

6. 打印消费项目安装命令：

```bash
cd /Users/benz/Codes/Lesson/duckdb-wasm-web
pnpm add /tmp/duckdb-wasm-pack-26322240868/duckdb-duckdb-wasm-1.11.0.tgz
```

通过标准：

- 换一个 run id 后能重新生成 tarball。
- 消费项目安装后 `pnpm why @duckdb/duckdb-wasm` 能看到本次 tarball 来源。
- 浏览器验收脚本能读取并输出 run id。

## P2：扩展一致性校验

目标：让“读回数据”不只看行数，还能确认内容来源和版本。

建议增加：

- 每次写入带 `validation_run_id` 或固定 marker。
- 远程 Parquet 入库后记录表行数和关键聚合值。
- 发布 DB manifest 记录 commit、run id、表清单、行数、物理 size。
- 页面显示当前打开的 DB path、access mode、worker lifecycle。

远程数据校验建议：

```sql
SELECT count(*) AS orders FROM orders;
SELECT count(*) AS items FROM items;
SELECT count(*) AS inventory FROM inventory;
```

如果远程数据后续会变化，再补充内容 hash 或固定快照版本。当前只确认过以下路径可读：

```text
https://s.b680.com/pocs/oms/orders.parquet
https://s.b680.com/pocs/oms/items.parquet
https://s.b680.com/pocs/oms/inventory.parquet
```

## 不要做的事

- 不要把同 worker 查询成功当成 OPFS 持久化成功。
- 不要绕过 `FORCE CHECKPOINT` 和 `db.flushFiles()`。
- 不要在读侧继续打开 `READ_WRITE` 消费发布 DB。
- 不要为了规避 `File is not opened in write mode` 而每次删除重建数据库。
- 不要把 `/tmp` tarball 路径当长期交付方式。
- 不要在普通版 CI 尚未进入测试前，把 Chrome disconnect 误判成 OPFS 逻辑失败。

## 最终交付验收清单

交付前逐项确认：

- [ ] `docs/opfs-persistence-implementation-guide.md` 记录标准工作流和核心坑位。
- [ ] `docs/opfs-persistence-midterm-review.md` 记录当前补丁成果和已验收事实。
- [ ] `docs/opfs-persistence-next-work-guide.md` 记录下一步执行指导。
- [x] `/Users/benz/Codes/Lesson/duckdb-wasm-web` 有可复跑浏览器验收脚本。
- [x] 验收输出包含 run id 和 tarball/package 来源。
- [x] OPFS `test.db size > 0`。
- [x] terminate worker 后新 worker reopen 可读。
- [x] reopen 后继续写入 + checkpoint 成功。
- [x] SQL 面板连续执行成功。
- [x] 远程 Parquet 入库 + checkpoint 成功。
- [x] 发布版 `READ_ONLY` 消费成功。
- [x] 发布版 manifest 记录并校验 schema、run id、package、表清单、行数和物理 size。
- [x] artifact 下载和 pack 脚本已落地，并通过 shell 语法检查。
- [x] 普通 `Js / Libraries` CI 状态有明确结论：Chrome 测试步骤失败，loadable 链路成功。
- [x] `@keepdb/duckdb-wasm-browser` workspace、build script、GitHub workflow 已落地。
- [x] 消费项目已切到 `@keepdb/duckdb-wasm-browser` tarball 并通过完整 OPFS 验收。

## 常用命令

查看当前 fork 工作区：

```bash
cd /Users/benz/Codes/Githubs/keepdb/packages/keepdb-duckdb-wasm
git status --short
git log --oneline -n 12
```

查看消费项目依赖：

```bash
cd /Users/benz/Codes/Lesson/duckdb-wasm-web
pnpm why @duckdb/duckdb-wasm
```

启动消费项目：

```bash
cd /Users/benz/Codes/Lesson/duckdb-wasm-web
pnpm dev
```

查看 GitHub Actions run：

```bash
cd /Users/benz/Codes/Githubs/keepdb/packages/keepdb-duckdb-wasm
gh run view 26322240868 --log-failed
```

后续新增 artifact pack 脚本后：

```bash
cd /Users/benz/Codes/Githubs/keepdb/packages/keepdb-duckdb-wasm
scripts/pack-duckdb-wasm-artifact.sh 26322240868
```
