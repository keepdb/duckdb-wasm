# DuckDB-Wasm OPFS 数据库持久化实现指导

## 标准工作流程：GitHub CI 打包 + duckdb-wasm-web 消费

本任务默认采用以下闭环作为标准交付流程：

1. 在 `keepdb-duckdb-wasm` fork 的 `fix/opfs-persistence-patch` 分支提交 OPFS 持久化修复。
2. push 到 GitHub 后触发 CI，由 GitHub Actions 完成 C++ → WASM 编译和 TS bundle 打包。
3. CI 成功后下载 `duckdb-wasm-packages.zip` artifact。
4. 将 artifact 解压到 duckdb-wasm fork 的 `packages/` 目录，确认包含最新的 `packages/duckdb-wasm/dist/` 产物。
5. 在消费项目 `/Users/benz/Codes/Lesson/duckdb-wasm-web` 中替换/指向该构建产物。
6. 在 `/Users/benz/Codes/Lesson/duckdb-wasm-web` 中验证 OPFS 持久化闭环：`open("opfs://test.db")` → 写入 → `FORCE CHECKPOINT` → `flushFiles()` → `terminate()` → 刷新或新 worker 重开 → 读回数据。
7. 每次验证必须记录 commit、CI run id、artifact 名称、消费项目验证命令和结果。

本地构建只作为调试加速手段；最终可消费产物以 GitHub CI artifact 为准。若 artifact 过期或 CI 失败，需要重新 push 触发可下载的新 artifact，不能把失败 run 当作交付产物。

### duckdb-wasm-web 验证一致性

`/Users/benz/Codes/Lesson/duckdb-wasm-web` 是最终消费验证项目，必须使用统一的“完整验证”链路，不能再用同 worker 查询成功作为通过依据。

完整验证必须执行以下步骤：

1. 清空 OPFS 中的 `test.db` 和 `test.db.wal`。
2. 打开 `opfs://test.db`。
3. 写入固定 marker：`keepdb_marker(id=1, value='ok')`。
4. 执行 `FORCE CHECKPOINT`。
5. 执行 `db.flushFiles()`。
6. 通过 OPFS API 检查 `test.db` 物理文件，要求 `size > 0`。
7. `terminate()` 当前 DuckDB worker。
8. 新建 worker，重新打开同一个 `opfs://test.db`。
9. 查询 `keepdb_marker`，要求返回 `id=1`、`value='ok'`。
10. 重开后再次检查 `test.db`，要求 `size > 0`。

最终通过时页面必须显示：

```text
OPFS_DB_REOPEN_OK
marker=1,ok
```

失败时如果出现以下信息，说明仍然没有真实写入 OPFS 物理 DB 文件：

```text
OPFS_PHYSICAL_FILE_EMPTY at after flushFiles: test.db size=0
Buffering missing file: opfs:/test.db
```

这种失败是有效失败，不能绕过。它证明查询结果来自内存/缓冲路径，而不是可刷新重开的 OPFS DB 文件。

## 背景

目标是让浏览器里的 DuckDB-Wasm 支持以下闭环：

1. 通过 `db.open({ path: "opfs://test.db", accessMode: READ_WRITE })` 打开 OPFS 数据库。
2. 执行建表、写入、`CHECKPOINT` 或 `FORCE CHECKPOINT`。
3. 关闭连接、flush、terminate worker。
4. 刷新页面或新建 worker 后再次打开同一个 `opfs://test.db`。
5. 能读回之前写入的表和数据。

当前官方实现对 OPFS 外部文件读写有部分支持，但对"数据库文件 + WAL + checkpoint + reopen"的完整持久化链路没有打通。`DuckDBOPFSConfig.fileHandling` 只控制 SQL 文本中 `'opfs://...'` 外部文件的自动/手动注册，不能修复数据库文件本体的 checkpoint 落盘问题。

## 成功标准

最小验收用例必须通过：

```ts
await db.open({
  path: "opfs://test.db",
  accessMode: DuckDBAccessMode.READ_WRITE
});

const conn = await db.connect();
await conn.query("CREATE TABLE keepdb_marker AS SELECT 1 AS id, 'ok' AS value");
await conn.query("FORCE CHECKPOINT");
await conn.close();
await db.flushFiles();
await db.terminate();

const worker2 = new Worker(bundle.mainWorker);
const db2 = new AsyncDuckDB(logger, worker2);
await db2.instantiate(bundle.mainModule, bundle.pthreadWorker);
await db2.open({
  path: "opfs://test.db",
  accessMode: DuckDBAccessMode.READ_WRITE
});

const conn2 = await db2.connect();
const result = await conn2.query("SELECT * FROM keepdb_marker");
```

验收时还需要确认 OPFS 中 `test.db` 的物理文件大小不再长期保持 `0 bytes`。

## 当前已知问题

### 1. zero-byte OPFS handle 必须注册 ✅ 已修复

文件：`packages/duckdb-wasm/src/bindings/bindings_base.ts`

新建数据库和 WAL 文件初始大小通常是 `0 bytes`。原代码 `handle.getSize()` 条件会导致 `opfs://test.db` 和 `opfs://test.db.wal` 不被注册。

修改：`prepareFileHandle` 和 `prepareDBFileHandle` 两个路径移除 `handle.getSize()` 条件判断，改为 `if (!fromCached)`。

### 2. C++ `FileSync` 不能继续 no-op ✅ 已修复

文件：

- `lib/src/io/web_filesystem.cc` — C++ bridge
- `packages/duckdb-wasm/src/bindings/runtime_browser.ts` — JS runtime

**C++ 层**：`WebFileSystem::FileSync` 通过 `static_cast<WebFileHandle &>(handle)` 获取 `file_id_`，调用 `duckdb_web_fs_file_sync(file_id)` 传递到 JS runtime。

```cpp
void WebFileSystem::FileSync(duckdb::FileHandle &handle) {
    auto &file_hdl = static_cast<WebFileHandle &>(handle);
    duckdb_web_fs_file_sync(file_hdl.file_->file_id_);
}
```

**JS 层**：`syncFile` 对 `BROWSER_FSACCESS` 协议的文件调用 `handle.flush()`。

```ts
syncFile: (mod: DuckDBModule, fileId: number) => {
    const file = BROWSER_RUNTIME.getFileInfo(mod, fileId);
    if (file?.dataProtocol === DuckDBDataProtocol.BROWSER_FSACCESS) {
        const handle: FileSystemSyncAccessHandle = BROWSER_RUNTIME._files?.get(file.fileName);
        if (handle) {
            handle.flush();
        }
    }
},
```

**完整调用链**：`DuckDB C++ CHECKPOINT` → `WebFileSystem::FileSync(handle)` → `duckdb_web_fs_file_sync(file_id)` → WASM import → `runtime_browser.syncFile(mod, fileId)` → `handle.flush()` → OPFS 落盘。

### 3. `RemoveFile` 不能继续空实现 ✅ 已修复

文件：

- `lib/src/io/web_filesystem.cc` — C++ bridge
- `packages/duckdb-wasm/src/bindings/runtime_browser.ts` — JS runtime

**C++ 层**：

1. 新增 `duckdb_web_fs_file_remove` bridge 函数（通过 `RT_FN` 宏注册）。
2. `RemoveFile` 清理 `files_by_name_`、`files_by_url_`，然后调 JS bridge。

```cpp
void WebFileSystem::RemoveFile(const std::string &filename, optional_ptr<FileOpener> opener) {
    std::unique_lock<LightMutex> fs_guard{fs_mutex_};
    files_by_name_.erase(filename);
    files_by_url_.erase(filename);
    duckdb_web_fs_file_remove(filename.c_str(), filename.size());
}
```

**JS 层**：flush + close handle、清理 `_files`/`_fileInfoCache`/`_preparedHandles`。

**同步/异步矛盾**：`removeFile` 是 WASM 同步 import，但 OPFS `removeEntry()` 是异步 API。当前实现采用"延迟异步清理"策略：同步阶段 close handle + 清理内存映射，路径推入 `_pendingDeletes` 队列等待后续消费。

⚠️ `_pendingDeletes` 目前**没有消费者**。需要在 `flushFiles`、`dropFiles` 或 `terminate` 时新增异步清理逻辑。见阶段 3。

### 4. `moveFile` registry bug ✅ 已修复

文件：`packages/duckdb-wasm/src/bindings/runtime_browser.ts`

原代码 `BROWSER_RUNTIME._files!.delete(handle)` 按 value 删除，应该是按 key 删除。

修改：`delete(handle)` → `delete(from)`。

### 5. `closeFile` OPFS 容错 ✅ 已修复

文件：`packages/duckdb-wasm/src/bindings/runtime_browser.ts`

原代码在找不到 OPFS handle 时 throw，改为静默跳过。`closeFile` 只做 flush 不做 close（保留 handle 供后续复用），`dropFile` 才做 close。

## 未完成项（阶段 3）

### OPFS 物理 rename 的同步/异步矛盾

`MoveFile` 当前只能同步调用 JS runtime。OPFS 目录级 rename 没有同步 API，常规路径需要异步 directory handle。可选方案：

1. **预注册策略**
   在 `prepareDBFileHandle(dbPath)` 里预先注册数据库主文件、WAL 文件、常见临时/移动目标文件。这样 `moveFile` 只移动已经打开的 `FileSystemSyncAccessHandle` registry，并在后续 flush/close 时完成写入。

2. **copy-truncate 策略**
   如果 source 和 target 都有 sync access handle，则在同步 `moveFile` 中读取 source 内容、写入 target、flush target、truncate/close source，然后更新 registry。这个方案不是真正原子 rename，但对单 worker PoC 更可控。

3. **延迟异步清理策略**
   `removeFile` 同步阶段只 close handle 和标记 pending delete，下一次显式 `flushFiles`、`dropFiles`、`terminate` 前执行异步清理。这个需要新增 worker request，不能只把路径塞进 `_pendingDeletes` 而没人消费。

建议优先做方案 2，原因是它最容易验证"刷新后重开可读"。等 PoC 通过后再评估是否需要更接近原子 rename 的方案。

### `_pendingDeletes` 需要消费者

当前 `removeFile` 将路径推入 `_pendingDeletes` 但没有代码消费它。需要在 `flushFiles`、`dropFiles` 或 `terminate` 的异步上下文中执行：

```ts
const opfsRoot = await navigator.storage.getDirectory();
for (const path of globalThis.DUCKDB_RUNTIME._pendingDeletes || []) {
    await opfsRoot.removeEntry(path);
}
globalThis.DUCKDB_RUNTIME._pendingDeletes = [];
```

### RemoveFile 的 `files_by_id_` 清理

当前 C++ `RemoveFile` 清理了 `files_by_name_` 和 `files_by_url_`，但没有清理 `files_by_id_`。如果 checkpoint 流程中存在通过 file_id 查找的场景，可能需要补充。

## 已实施的完整改动清单

### Commit 1: `a30d536d` — TS 层 patch

| 文件 | 改动 |
|------|------|
| `bindings_base.ts` | 移除 `handle.getSize()` 条件（`prepareFileHandle` + `prepareDBFileHandle` 两处） |
| `runtime_browser.ts` | `syncFile` 实现 flush |
| `runtime_browser.ts` | `moveFile` 修正 `delete(from)` bug |
| `runtime_browser.ts` | `removeFile` 实现 OPFS handle 清理 |
| `runtime_browser.ts` | `closeFile` 缺 handle 时不 throw |

### Commit 2: `ec19c807` — C++ 层 patch

| 文件 | 改动 |
|------|------|
| `web_filesystem.cc` | `FileSync` 调用 `duckdb_web_fs_file_sync(file_id)` |
| `web_filesystem.cc` | `RemoveFile` 清理 registry + 调用 `duckdb_web_fs_file_remove` |
| `web_filesystem.cc` | 新增 `duckdb_web_fs_file_remove` bridge 函数 |

## 需要重点观察的文件

- `lib/src/io/web_filesystem.cc`
  - `WebFileSystem::MoveFile`
  - `WebFileSystem::RemoveFile`
  - `WebFileSystem::FileSync`
  - `WebFileSystem::FileExists`
  - `WebFileSystem::OpenFile`

- `lib/js-stubs.js`
  - `duckdb_web_fs_file_sync`
  - `duckdb_web_fs_file_move`
  - `duckdb_web_fs_file_remove`

- `packages/duckdb-wasm/src/bindings/runtime_browser.ts`
  - `prepareFileHandles`
  - `prepareDBFileHandle`
  - `openFile`
  - `syncFile`
  - `closeFile`
  - `moveFile`
  - `removeFile`

- `packages/duckdb-wasm/src/bindings/bindings_base.ts`
  - `prepareFileHandle`
  - `prepareDBFileHandle`
  - `flushFiles`
  - `dropFiles`

- `packages/duckdb-wasm/src/parallel/worker_dispatcher.ts`
  - `OPEN`
  - `DROP_FILES`
  - `FLUSH_FILES`

- `packages/duckdb-wasm/test/opfs.test.ts`
  - `Load Existing DB File`
  - `Copy CSV to OPFS + Load CSV`

## 必须补充的测试

### 1. OPFS DB reopen

去掉 `Load Existing DB File` 测试里的 `return; //FIXME`，并让它真正断开、terminate、新建 worker、重开数据库、读取表。

### 2. zero-byte DB 创建

清空 OPFS 后打开 `opfs://test.db`，确认 `test.db` 和 `test.db.wal` 能被注册，即使初始大小是 `0 bytes`。

### 3. checkpoint 后文件大小

写入一张小表后执行：

```sql
FORCE CHECKPOINT;
```

然后通过 OPFS API 检查 `test.db` size。不能只检查查询结果，因为同一个 worker 内可能读到缓存。

### 4. 新 worker 重开

同一个页面内新建 worker 还不够，最好再加一次页面刷新后的人工验证。自动测试里至少要 `terminate()` 旧 worker，再创建新 worker。

### 5. COPY OPFS 文件

保留 `COPY (...) TO 'opfs://file.csv'` 测试，但必须验证物理文件 size 和重新注册后的读取结果。

## 验证命令

首次构建前需要初始化子模块：

```bash
git submodule update --init --recursive
make apply_patches
```

开发构建可优先使用：

```bash
make wasm_dev
yarn workspace @duckdb/duckdb-wasm build:debug
yarn workspace @duckdb/duckdb-wasm test:chrome
```

如果本机没有 Emscripten，`Makefile` 会尝试使用 `docker compose run duckdb-wasm-ci`。首次构建耗时可能较长。

### 通过 GitHub CI 构建

分支 `fix/opfs-persistence-patch` push 后自动触发。CI 会编译 C++ → WASM，然后 bundle TS。构建完成后下载 `duckdb-wasm-packages.zip` artifact，解压到 `packages/` 即可使用。

## 不建议的方向

- 不要只改 `DuckDBOPFSConfig.fileHandling`。它只影响 SQL 文本里的 OPFS 外部文件引用，不影响数据库文件本体落盘。
- 不要只在 TS `syncFile` 里 flush。如果 C++ `FileSync` 仍然 no-op，这个 flush 不会被 checkpoint 关键路径调用。
- 不要只改 `_files` map 的 key。刷新页面后 map 消失，必须确认 OPFS 物理文件真的有内容。
- 不要把 `_pendingDeletes` 当成完成删除。除非有明确的异步消费点，否则它只是未完成任务队列。
- 不要用同一个 worker 内查询成功作为持久化证明。同 worker 可能读到内存状态。

## 建议后续交付顺序

1. ~~补 zero-byte handle 注册。~~ ✅
2. ~~补 C++ `FileSync` 调 JS `syncFile`。~~ ✅
3. ~~补 JS `syncFile` flush。~~ ✅
4. ~~补 C++ `RemoveFile` registry 清理和 JS remove 调用。~~ ✅
5. ~~修正 JS `moveFile` registry bug。~~ ✅
6. 实现同步可验证的 OPFS `moveFile` 策略（copy-truncate 方案）。
7. 实现 `_pendingDeletes` 异步消费者。
8. 跑通 `Load Existing DB File` 测试（移除 `return; //FIXME`）。
9. 回到 KeepDB PoC 页面验证 `FORCE CHECKPOINT -> terminate -> reopen`。

## 当前判断

这不是 DuckDB SQL 层问题，也不是 Nuxt/KeepDB 调用方式问题。核心问题在 duckdb-wasm 的 WebFileSystem bridge：C++ 文件系统接口、Emscripten JS stubs、浏览器 OPFS runtime 三层没有完整承接数据库文件持久化语义。

已完成的部分打通了 checkpoint flush 和文件删除的关键路径。下一步的核心挑战是 `moveFile` 的 OPFS 物理 rename（同步/异步矛盾），以及验证 "刷新后重开可读" 的完整闭环。

短期目标应是先做 PoC 级 fork，证明单 worker、单数据库、Chrome OPFS 下可以稳定 checkpoint/reopen。验证通过后，再考虑多 worker、异常退出、跨浏览器和上游 PR。

---

## 工作记录（2026-05-22）

### 当日成果

分支 `fix/opfs-persistence-patch`，共 10 个 commit，CI 构建 3 次成功（多次失败后修正）。

最终成功的 CI run：`26269678078`（commit `a4a965eb`），187/194 测试通过。7 个失败均为 OPFS 专用测试，与路径规范化问题相关。

### 完整 commit 链

| Commit | 内容 | 状态 |
|--------|------|------|
| `a30d536d` | TS 层：zero-byte 注册、syncFile flush、moveFile bug、removeFile、closeFile 容错 | ✅ |
| `ec19c807` | C++ FileSync bridge + RemoveFile bridge + RT_FN 宏注册 | ✅ |
| `072455a6` | ESLint 修复（empty catch、unused variable） | ✅ |
| `c2709cd7` | **关键**：`base_exported_list.txt` 添加导出 + `js-stubs.js` 添加签名 | ✅ |
| `b6fb7c62` | bindings_base 双 key 注册（后回退） | ❌ 破坏测试 |
| `90c212b4` | removeFile instanceof 作用域限制 | ❌ 仍挂 |
| `962e2714` | 回退双 key，改 openFile fallback | ❌ 仍挂 |
| `a4a965eb` | typeof FileSystemSyncAccessHandle 保护 | ✅ 187/194 |
| `72d054b0` | C++ OpenFile fallback + inferDataProtocol 匹配 opfs:/ | ✅ 但 artifact 过期 |
| `a619389a` | 对称双 key 注册 + removeFile 清理双 key | 7 个 OPFS 测试失败 |

### 踩坑记录

#### 1. WASM 导出列表是独立配置

`base_exported_list.txt` 是给 Emscripten 的 `-s EXPORTED_FUNCTIONS` 参数用的。C++ 里通过 `RT_FN` 宏声明的函数**不会自动导出到 WASM**。必须在导出列表里手动添加。

这是 `test.db` 始终 0 bytes 的根因——C++ bridge 函数存在但 WASM 不暴露，JS runtime 永远收不到调用。

**教训**：改 C++ bridge 函数时，三件事必须同步：C++ 实现、`base_exported_list.txt` 导出声明、`js-stubs.js` 的 `__sig` 签名。

#### 2. `opfs://` 路径规范化

DuckDB C++ 核心在内部把 `opfs://test.db` 规范化为 `opfs:/test.db`（双斜杠变单斜杠）。这个规范化发生在 DuckDB 的 StorageManager 层，不是 web_filesystem.cc 能控制的。

这导致：
- JS 用 `opfs://test.db` 注册 handle 到 `_files` Map
- C++ 用 `opfs:/test.db` 查找 `files_by_name_`
- 两边 key 不匹配，C++ 创建新的文件条目（protocol 变成 `BROWSER_FILEREADER`）
- JS `openFile` 收到的 `dataProtocol` 是 2（FILEREADER）而不是 3（FSACCESS）

**修复方案**：三层对称注册（C++ fallback 查找 + JS 双 key + removeFile 双 key 清理）。但双 key 注册会导致 `createSyncAccessHandle` 冲突（同一个文件不能有两个 open handle）。

#### 3. `FileSystemSyncAccessHandle` 可能不存在于所有环境

Karma Chrome Headless 测试环境里 `FileSystemSyncAccessHandle` 可能不是全局可用的。`instanceof undefined` 会抛 TypeError。

**教训**：所有 `instanceof FileSystemSyncAccessHandle` 检查前必须加 `typeof FileSystemSyncAccessHandle !== 'undefined'` 保护。

#### 4. CI artifact 在 failure 时不保留

CI run 失败后 artifact 会被清理，无法下载。这导致每次失败的构建都无法拿到产物来本地调试。

**教训**：在确认基本功能通过后再推大的改动，或者在 CI workflow 里配置 artifact 保留策略。

#### 5. `removeFile` 对非 OPFS 文件的影响

`_files` Map 里不只存 OPFS handle，还存 Blob、Buffer 等。`removeFile` 不能无条件地对所有 handle 做 flush/close/delete。

**教训**：OPFS 相关操作必须严格限制在 `FileSystemSyncAccessHandle` 类型检查通过后执行。

### 当前卡点

`test.db` 和 `test.db.wal` 仍然是 0 bytes。原因是 `openFile` 走了 `case 2`（`BROWSER_FILEREADER`）而不是 `case 3`（`BROWSER_FSACCESS``），导致文件以错误的协议打开。写入操作走了内存缓冲路径，没有触达 OPFS handle。

路径规范化的修复（C++ OpenFile fallback）已经在 commit `72d054b0` 中实现，CI 也确认 C++ 侧能正确走到 `BROWSER_FSACCESS`。但 artifact 过期无法下载。

### 下一步方向

1. **获取包含 C++ OpenFile fallback 的 artifact**（commit `72d054b0` 或之后），验证 `Buffering missing file` 是否消失
2. **解决双 key 注册与 createSyncAccessHandle 冲突**：方案是在 `prepareFileHandles` 里先检查 `_preparedHandles`，避免对同一文件重复创建 handle
3. **考虑在 `registerFileHandle` 时不注册双 key，而是让所有 JS 查找点都做 fallback**（更安全但改动点多）
4. 或者**在 C++ 侧彻底解决路径规范化**：让 `RegisterFileURL` 存储时也规范化 key
