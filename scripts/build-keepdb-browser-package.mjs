import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rm, copyFile, readFile, writeFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceDist = path.join(repoRoot, 'packages/duckdb-wasm/dist');
const packageRoot = path.join(repoRoot, 'packages/keepdb-duckdb-wasm-browser');
const outDir = path.join(packageRoot, 'dist');
const wasmDir = path.join(outDir, 'wasm');

const profile = 'keepdb-browser-opfs';
const sourceFiles = {
    browserModule: path.join(sourceDist, 'duckdb-browser.mjs'),
    browserTypes: path.join(sourceDist, 'duckdb-browser.d.ts'),
    typesDir: path.join(sourceDist, 'types/src'),
    worker: path.join(sourceDist, 'duckdb-browser-keepdb.worker.js'),
    wasm: path.join(sourceDist, 'duckdb-keepdb-browser.wasm'),
};

const copyDir = async (from, to) => {
    await rm(to, { recursive: true, force: true });
    await mkdir(to, { recursive: true });
    const entries = await import('node:fs/promises').then(fs => fs.readdir(from, { withFileTypes: true }));
    for (const entry of entries) {
        const source = path.join(from, entry.name);
        const target = path.join(to, entry.name);
        if (entry.isDirectory()) {
            await copyDir(source, target);
        } else if (entry.isFile()) {
            await copyFile(source, target);
        }
    }
};

const gzipSize = async file => {
    const temp = `${file}.gz-size`;
    await pipeline(createReadStream(file), createGzip({ level: 9 }), createWriteStream(temp));
    const size = (await stat(temp)).size;
    await rm(temp, { force: true });
    return size;
};

const copyJavaScriptWithoutSourceMapComment = async (from, to) => {
    const source = await readFile(from, 'utf8');
    await writeFile(to, source.replace(/\n\/\/# sourceMappingURL=.*\n?$/, '\n'));
};

const safeExec = command => {
    try {
        return execSync(command, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
        return '未确认';
    }
};

const requireFile = async file => {
    try {
        await stat(file);
    } catch {
        throw new Error(`Missing required source file: ${file}. Run "yarn workspace @duckdb/duckdb-wasm build:release" first.`);
    }
};

const fallbackWasm = path.join(sourceDist, 'duckdb-eh.wasm');
const fallbackWorker = path.join(sourceDist, 'duckdb-browser-eh.worker.js');
try {
    await stat(sourceFiles.wasm);
} catch {
    sourceFiles.wasm = fallbackWasm;
}
try {
    await stat(sourceFiles.worker);
} catch {
    sourceFiles.worker = fallbackWorker;
}

for (const file of [sourceFiles.browserModule, sourceFiles.browserTypes, sourceFiles.worker, sourceFiles.wasm]) {
    await requireFile(file);
}
await requireFile(sourceFiles.typesDir);

await rm(outDir, { recursive: true, force: true });
await mkdir(wasmDir, { recursive: true });

await copyJavaScriptWithoutSourceMapComment(sourceFiles.browserModule, path.join(outDir, 'duckdb-browser.mjs'));
await copyFile(sourceFiles.browserTypes, path.join(outDir, 'duckdb-browser.d.ts'));
await copyJavaScriptWithoutSourceMapComment(sourceFiles.worker, path.join(outDir, 'worker.js'));
await copyFile(sourceFiles.wasm, path.join(wasmDir, 'duckdb.wasm'));
await copyDir(sourceFiles.typesDir, path.join(outDir, 'types/src'));

const packageJson = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
const duckdbPackageJson = JSON.parse(await readFile(path.join(repoRoot, 'packages/duckdb-wasm/package.json'), 'utf8'));
const wasmPath = path.join(wasmDir, 'duckdb.wasm');
const workerPath = path.join(outDir, 'worker.js');
const wasmSize = (await stat(wasmPath)).size;
const workerSize = (await stat(workerPath)).size;
const wasmGzipSize = await gzipSize(wasmPath);
const workerGzipSize = await gzipSize(workerPath);
const gitCommit = safeExec('git rev-parse HEAD');
const gitDescribe = safeExec('git describe --tags --always --dirty');
const buildTime = new Date().toISOString();
const sourceRunId = process.env.KEEPDB_SOURCE_RUN_ID || process.env.GITHUB_RUN_ID || '未确认';

const manifest = {
    package: packageJson.name,
    version: packageJson.version,
    profile,
    target: path.basename(sourceFiles.wasm) === 'duckdb-keepdb-browser.wasm' ? 'keepdb-browser-eh' : 'browser-eh',
    sourceRunId,
    duckdbWasmPackage: duckdbPackageJson.name,
    duckdbWasmVersion: duckdbPackageJson.version,
    duckdbWasmCommit: gitCommit,
    gitDescribe,
    buildTime,
    files: {
        wasm: {
            path: 'dist/wasm/duckdb.wasm',
            source: path.relative(repoRoot, sourceFiles.wasm),
            bytes: wasmSize,
            gzipBytes: wasmGzipSize,
        },
        worker: {
            path: 'dist/worker.js',
            source: path.relative(repoRoot, sourceFiles.worker),
            bytes: workerSize,
            gzipBytes: workerGzipSize,
        },
    },
    requiredFeatures: [
        'opfs-db-persistence',
        'checkpoint-flush',
        'worker-terminate-reopen',
        'reopen-write',
        'published-readonly-consumption',
    ],
    validationCommand: 'pnpm verify:opfs',
};

await writeFile(
    path.join(outDir, 'index.js'),
    `export * from './duckdb-browser.mjs';

export const KEEPDB_BROWSER_PROFILE = ${JSON.stringify(profile)};
export const KEEPDB_BROWSER_MANIFEST = ${JSON.stringify(manifest, null, 4)};

export const createKeepDBBrowserBundle = (baseUrl = import.meta.url) => ({
    mainModule: new URL('./wasm/duckdb.wasm', baseUrl).href,
    mainWorker: new URL('./worker.js', baseUrl).href,
    pthreadWorker: null,
});
`,
);

await writeFile(
    path.join(outDir, 'index.d.ts'),
    `export * from './duckdb-browser';

export declare const KEEPDB_BROWSER_PROFILE: 'keepdb-browser-opfs';
export declare const KEEPDB_BROWSER_MANIFEST: ${JSON.stringify(manifest, null, 4)};
export declare const createKeepDBBrowserBundle: (baseUrl?: string) => {
    mainModule: string;
    mainWorker: string;
    pthreadWorker: null;
};
`,
);

await writeFile(path.join(outDir, 'build-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`Built ${packageJson.name}@${packageJson.version}`);
console.log(`profile=${profile}`);
console.log(`sourceRunId=${sourceRunId}`);
console.log(`wasm=${wasmSize} bytes gzip=${wasmGzipSize} bytes`);
console.log(`worker=${workerSize} bytes gzip=${workerGzipSize} bytes`);
