# DuckDB-Wasm OPFS 持久化补丁中期盘点

更新时间：2026-05-23 13:11 CST

## 结论

本轮补丁已经把浏览器 OPFS 数据库文件从“同 worker 内存态看似可写”推进到“物理 `test.db` 非空、worker terminate 后可重开读回、已有 DB 重开后可继续写入并 checkpoint”的可验证状态。

当前推荐交付判断：

- `loadable` 构建链路可用：GitHub Actions run `26322240868` 的 `Js / Libraries (loadable version)` 和 deploy 成功。
- 消费项目 `/Users/benz/Codes/Lesson/duckdb-wasm-web` 已接入基于 run `26322240868` 三个 loadable Wasm artifact 重新打包的 tarball。
- 页面核心验收通过：重开续写、SQL 面板连续写入、发布版只读消费均通过。
- 普通 `Js / Libraries` CI 仍失败，但失败原因是 Chrome Headless 30 分钟无消息、`Executed 0 of 194 DISCONNECTED`，不是 OPFS 断言失败，也没有 `File is not opened in write mode`。

## 已修复问题

### 1. 真实 OPFS DB 文件落盘

早期失败现象：

```text
OPFS_PHYSICAL_FILE_EMPTY at after flushFiles: test.db size=0
Buffering missing file: opfs:/test.db
```

修复后验收要求：

- 写入后执行 `FORCE CHECKPOINT`。
- 调用 `db.flushFiles()`。
- 通过 OPFS API 检查 `test.db size > 0`。
- terminate 当前 worker。
- 新 worker 打开同一个 `opfs://test.db` 后读回 marker。

当前页面验收已证明 `test.db` 不再是长期 `0 bytes`。

### 2. 已有 OPFS DB 重开后继续写入

用户 SQL 曾触发：

```text
TransactionContext Error: Failed to commit: File is not opened in write mode
```

根因：

- `FilePageBuffer::FileRef::ReOpen(FileOpenFlags flags)` 重新打开了底层写句柄。
- 但缓存对象里的 `file_->file_flags` 没有同步更新。
- commit 阶段仍按旧 flag 判断该文件不是写模式。

修复提交：

```text
f8e27718 fix: reopen buffered files with write flags
```

关键修复位置：

```cpp
void FilePageBuffer::FileRef::ReOpen(FileOpenFlags flags) {
    DEBUG_TRACE();
    auto file_guard = Lock(Exclusive);
    auto new_handle = buffer_.filesystem->OpenFile(file_->path, flags);
    std::swap(new_handle, file_->handle);
    file_->file_flags = flags;
    file_->file_size = buffer_.filesystem->GetFileSize(*file_->handle);
}
```

### 3. 过期测试预期已更新

修复后，“读后再写同一路径”不应继续期待 `File is not opened in write mode`。因此同步更新测试预期：

```text
06133b40 test: allow write after cached read
```

该提交把旧用例从“期待失败”改为“覆盖写入后读回新内容”，同时规避 GitHub push protection 对测试 fixture 中 AWS secret 样式字符串的误报。

## 当前消费项目验收结果

消费项目：

```text
/Users/benz/Codes/Lesson/duckdb-wasm-web
```

当前依赖：

```text
@duckdb/duckdb-wasm = file:/tmp/duckdb-wasm-pack-26322240868/duckdb-duckdb-wasm-1.11.0.tgz
```

该 tarball 由 GitHub Actions run `26322240868` 的三个 loadable Wasm artifacts 生成：

- `wasm-mvp-loadable`
- `wasm-eh-loadable`
- `wasm-coi-loadable`

本地只执行 JS bundle 和 `pnpm pack`，用于消费项目验证。

### 页面验收

Vite：

```text
http://localhost:5173/
```

已通过：

| 验收项 | 结果 |
|---|---|
| 重开续写 | `rows=2`, `test.db size=798720` |
| 用户 SQL 第一次执行 | `rows=1`, `test.db size=798720` |
| 用户 SQL 第二次执行 | `rows=2`, `test.db size=1060864` |
| 远程 Parquet 入库 | `orders=40`, `items=80`, `inventory=8` |
| 发布版只读消费 | `published=keepdb.publish.v1.db`, `rows=3`, `size=536576` |

用户 SQL：

```sql
CREATE TABLE IF NOT EXISTS keepdb_sql_notes (
    id INTEGER,
    note VARCHAR,
    created_at TIMESTAMP
);

INSERT INTO keepdb_sql_notes
SELECT COALESCE(max(id), 0) + 1, 'sql-panel', now()
FROM keepdb_sql_notes;

SELECT *
FROM keepdb_sql_notes
ORDER BY id DESC
LIMIT 10;
```

连续执行两次后，结果行数递增，`test.db` 物理文件大小递增。

## 推荐的 OPFS 消费模型

OPFS 不应按普通本地 FS 的多进程/多连接任意读写模型使用。当前建议采用两种消费模式。

### 模式 A：单 writer 串行服务

同一个 Web app 内，所有 SQL 都进入一个 dedicated DuckDB worker：

- `CREATE / INSERT / COPY / FORCE CHECKPOINT / flushFiles` 串行执行。
- 查询也可以走同一个 worker。
- 避免页面多个位置同时打开同一个 `opfs://test.db` 写句柄。

该模式适合普通单页应用。

### 模式 B：发布版只读消费

写侧负责生成新版本 DB：

1. 写入 `opfs://keepdb.publish.vN.db`。
2. `FORCE CHECKPOINT`。
3. `flushFiles()`。
4. 检查物理文件 `size > 0`。
5. terminate 写侧 worker。
6. 写 manifest，例如 `keepdb-manifest.json`。

读侧只按 manifest 打开已发布版本：

```ts
await db.open({
    path: `opfs://${manifest.current}`,
    accessMode: DuckDBAccessMode.READ_ONLY,
});
```

页面已经新增“发布消费”验证：

- 写侧发布 `keepdb.publish.v1.db`。
- 读侧 `READ_ONLY` 打开。
- 读回 3 行。
- 尝试写入被拒绝。

该模式适合多个页面、多个消费者或希望降低 OPFS 文件句柄冲突风险的场景。

## 当前仍需注意的问题

### 1. 普通 `Js / Libraries` CI 仍不稳定

run `26322240868` 状态：

- `Js / Libraries (loadable version)`：成功。
- `Js / Libraries (loadable version) - Deploy`：成功。
- `Js / Libraries`：失败。

失败日志关键点：

```text
Chrome Headless 148.0.0.0 ... Disconnected , because no message in 900000 ms.
Chrome Headless 148.0.0.0: Executed 0 of 194 DISCONNECTED
```

判断：

- 不是 OPFS 测试失败。
- 不是 `File is not opened in write mode`。
- 更像普通版 Chrome/Karma 启动或 worker 初始化卡死。

后续需要单独排查 CI 普通版稳定性，但不应把它和本轮 OPFS 功能验收混为一谈。

### 2. 当前消费项目依赖仍是本地 tarball

当前 tarball 已来自 GitHub Actions Wasm artifacts，但还不是正式 npm 包。

后续应优化为：

- artifact 下载和 pack 流程脚本化。
- 或发布内部 npm/canary tag。
- 消费项目通过固定版本或固定 artifact id 引用，减少 `/tmp` 路径依赖。

### 3. 发布版 manifest 仍是 PoC 级别

当前 `keepdb-manifest.json` 只记录：

- `current`
- `size`
- `publishedAt`

建议后续扩展：

- `schemaVersion`
- `duckdbWasmCommit`
- `artifactRunId`
- `tables`
- `rowCounts`
- `checkpointAt`
- `contentHash` 或 `etag`

这样读侧可以做更严格的一致性验证。

## 下一步优化方向

### P0：固化验证闭环

目标：让每次改动都能快速判断是否真实解决 OPFS 持久化。

建议：

- 把 `/Users/benz/Codes/Lesson/duckdb-wasm-web` 的浏览器验收脚本沉淀为可复跑命令。
- 固定验收项：
  - 清空 OPFS。
  - 完整验证。
  - 重开续写。
  - SQL 面板连续执行两次。
  - 远程 Parquet 入库。
  - 发布版只读消费。
- 输出 `test.db size`、行数、manifest 信息。

### P1：完善发布版消费模型

目标：把 OPFS 使用方式从“像普通 FS 一样共享读写”转为“写侧发布、读侧只读消费”。

建议：

- 支持版本化 DB：`keepdb.publish.v{n}.db`。
- manifest 原子切换。
- 保留上一版本用于回滚。
- 读侧只读打开，不直接写当前发布版本。
- 写侧失败时不更新 manifest。

### P1：CI 普通版 Chrome 卡死排查

目标：判断普通 `Js / Libraries` 失败是否由本补丁触发，还是既有 CI flaky。

建议：

- 单独 rerun `Js / Libraries`。
- 如果仍是 `Executed 0 of 194 DISCONNECTED`，优先检查 Karma/Chrome 启动配置和普通版 worker 加载。
- 若能进入测试并出现具体失败，再按失败用例处理。

### P2：artifact 消费流程脚本化

目标：减少手工下载、解压、pack 的人为误差。

建议新增脚本：

```text
scripts/pack-duckdb-wasm-artifact.sh <run-id>
```

功能：

1. 下载 `wasm-mvp-loadable`、`wasm-eh-loadable`、`wasm-coi-loadable`。
2. 解压到 `packages/duckdb-wasm/src/bindings/`。
3. 执行 `yarn workspace @duckdb/duckdb-wasm build:release`。
4. 输出 tarball 到 `/tmp/duckdb-wasm-pack-<run-id>/`。
5. 打印消费项目 `pnpm add` 命令。

### P2：文档和接口收敛

建议把当前页面验证能力拆成明确 API：

- `runOPFSPersistenceValidation`
- `runReopenWriteValidation`
- `runRemoteImportValidation`
- `runPublishedReadModelValidation`
- `runSqlExecution`

同时在文档中明确：

- `flushFiles()` 是验收必须步骤。
- OPFS 物理文件 `size > 0` 是验收必须指标。
- 同 worker 查询成功不能作为持久化成功依据。
- 发布版消费优先使用 `READ_ONLY`。

## 当前判断

这轮补丁已经解决用户当前遇到的核心错误：

```text
TransactionContext Error: Failed to commit: File is not opened in write mode
```

并且通过浏览器页面证明：

- 不是内存假阳性。
- 文件确实落到 OPFS。
- worker 重开可读。
- 重开后还能继续写。
- 远程数据可以落库并 checkpoint。
- 发布版只读消费模型可行。

下一阶段重点不是继续堆 SQL demo，而是把验证、发布和消费流程工程化。
