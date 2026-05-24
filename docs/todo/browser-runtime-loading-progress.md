# Browser Runtime Loading Progress 待办

更新时间：2026-05-25

## 背景

当前 `@keepdb/duckdb-wasm-browser` rc.4 核心下载体积：

```text
duckdb.wasm 原始大小：32,949,431 bytes
duckdb.wasm gzip：约 7,959,048 bytes
worker.js 原始大小：548,132 bytes
worker.js gzip：约 129,825 bytes
```

放到 CDN 后，首次访问用户通常仍需要下载约 `8.1 MB` 压缩资源，并额外等待 Wasm 编译、实例化和 OPFS DB 打开。

## 判断

需要封装 loading/progress 接口。这个体积在普通 4G、弱网或低端设备上不会是瞬时加载。

粗略下载耗时：

| 网络环境 | 典型带宽 | 下载时间估算 |
|---|---:|---:|
| 慢 3G / 弱网 | 1 Mbps | 65-90 秒 |
| 普通 4G 边缘 | 5 Mbps | 13-18 秒 |
| 正常 4G | 10 Mbps | 6-9 秒 |
| 好 4G / 普通 Wi-Fi | 30 Mbps | 2-4 秒 |
| 好 Wi-Fi / 5G | 100 Mbps | 0.7-1.5 秒 |

移动端还可能额外增加 `0.5-3 秒` Wasm 编译/实例化时间。

## 建议 API

第一版先做阶段式 progress：

```ts
await createKeepDB({
    onProgress(event) {
        console.log(event.stage, event.loaded, event.total, event.percent);
    },
});
```

阶段建议：

```text
downloading-runtime
compiling-wasm
opening-opfs-db
checkpointing
restoring
ready
```

## 实施顺序

1. 先在 `@keepdb/duckdb-wasm-browser` 增加 `createKeepDB()` 薄封装。
2. 第一版只提供阶段级 progress，至少覆盖下载开始、实例化开始、OPFS open、ready。
3. 第二版再实现字节级下载进度：由封装层自己 `fetch(wasmUrl)`，读取 stream 后传给 `db.instantiate()`。
4. 消费项目 `/Users/benz/Codes/Lesson/duckdb-wasm-web` 增加 loading UI 验证。

## 注意

直接把 wasm URL 传给 `db.instantiate()` 时，通常只能得到开始/完成状态，不能稳定得到字节级下载进度。字节级 progress 需要封装层接管 wasm 下载。
