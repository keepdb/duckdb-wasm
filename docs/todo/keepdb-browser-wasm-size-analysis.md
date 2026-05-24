# KeepDB Browser Wasm 体积分析与优化路线

更新时间：2026-05-25

## 目标

在不破坏 OPFS 数据库持久化、远程 Parquet 入库和发布库只读消费验收的前提下，找到 `@keepdb/duckdb-wasm-browser` 首次加载体积的真实缩减点。

当前不以删除 JS export 或继续微调 `duckdb_web_*` C API 列表作为主方向：`rc.5` 已证明该方向只能产生 KB 级收益。

## 可复跑诊断命令

依赖：

```bash
brew install wabt
```

针对 GitHub artifact tarball：

```bash
cd /Users/benz/Codes/Githubs/keepdb/packages/keepdb-duckdb-wasm
node scripts/analyze-keepdb-browser-wasm.mjs \
  /tmp/keepdb-browser-run-26367485075/keepdb-duckdb-wasm-browser-0.1.0.tgz
```

需要机器可读结果时：

```bash
node scripts/analyze-keepdb-browser-wasm.mjs \
  /tmp/keepdb-browser-run-26367485075/keepdb-duckdb-wasm-browser-0.1.0.tgz \
  --json > /tmp/keepdb-browser-rc5-wasm-analysis.json
```

后续 `.github/workflows/keepdb-browser.yml` 产出的 artifact 将直接包含：

```text
build-manifest.json
wasm-analysis.json
extension-wasm/*.wasm
extension-wasm/*.analysis.json
```

`extension-wasm/` 只在源码构建路径存在，用来记录本次 CI 构建出的本地 loadable extension wasm，避免拿公网 extension 误判导出需求。

## rc.5 诊断基线

来源：

```text
tag=keepdb-browser-v0.1.0-rc.5
runId=26367485075
commit=15d5c2ecdf99d22b856cf06363a64d29f56e0820
```

文件体积：

| 文件 | raw bytes | gzip bytes |
| --- | ---: | ---: |
| `dist/wasm/duckdb.wasm` | 32,945,449 | 7,957,674 |
| `dist/worker.js` | 544,821 | 129,472 |
| `dist/duckdb-browser.mjs` | 32,077 | 诊断脚本本地口径为 8,343 |

wasm section：

| Section | bytes | 数量 |
| --- | ---: | ---: |
| `Code` | 23,778,243 | 57,529 functions |
| `Export` | 6,329,868 | 65,029 exports |
| `Data` | 2,570,315 | 1 segment |
| `Global` | 123,542 | 16,125 globals |
| `Elem` | 66,298 | 1 segment |

导出命名特征抽样统计：

| 特征 | 导出数量 |
| --- | ---: |
| `duckdb_web_*` C API | 27 |
| 包含 `duckdb3web` | 796 |
| 包含 `arrow` | 6,561 |
| 包含 `json` | 464 |
| 包含 `parquet` | 23 |
| RTTI / vtable (`_ZTI*`、`_ZTS*`、`_ZTV*`) | 9,427 |

## 当前判断

1. `duckdb.wasm` 的主要体积由 `Code` 段和动态链接暴露面共同构成；仅 `Export` 段就约 6.0 MiB。
2. 当前 `MAIN_MODULE=2 + exported_list.txt` 仍保留了大量 C++/Arrow/RTTI 导出；过滤 18 个未消费 C API 并不能触及主因。
3. Arrow 查询结果转换路径仍属于消费项目必需能力，不能在没有替代结果协议和回归验收的情况下删除。
4. `read_parquet('https://...')` 是当前验收项，因此 Parquet loadable extension 链路不能直接移除。
5. 公网 `https://extensions.duckdb.org/v1.5.3/wasm_eh/parquet.duckdb_extension.wasm` 可下载，但它的 imports 与 rc.5 主 wasm 不能直接对齐；本项目下一步必须使用同一次 GitHub source build 产出的 extension wasm 做导出集合推导。

## 下一实验

优先级按收益可能性和风险排序：

1. 从下一次 `keepdb-browser` source build artifact 的 `extension-wasm/*.analysis.json` 读取实际 Parquet side module imports。
2. 生成“实际 Parquet side module imports + KeepDB 必需 C API”的最小导出集合，和当前从主模块导出反推的 `exported_list.txt` 对比。
3. 如果最小导出集合能成功链接并通过消费项目完整 OPFS 验收，测量 `Export` 段和 gzip 变化。
4. 在导出面收窄仍不足时，再分析 `duckdb_web` 源码列表中 JSON insert、CSV insert、UDF 等未被 KeepDB 消费的路径是否能用 profile 开关排除。
5. 不在本阶段删除 Arrow result path；这需要先设计新的 query result 协议，否则会直接破坏 `AsyncDuckDBConnection.query()` 消费方式。

每个候选版本仍必须执行：

```bash
cd /Users/benz/Codes/Lesson/duckdb-wasm-web
pnpm build
pnpm verify:opfs
```

通过标记必须保持：

```text
OPFS_DB_REOPEN_OK
REOPEN_WRITE_OK
SQL_PANEL_OK
REMOTE_IMPORT_OK orders=40, items=80, inventory=8
PUBLISHED_READ_OK
```
