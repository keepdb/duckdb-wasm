import { createGzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm, stat, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { execFileSync } from 'node:child_process';

const usage = () => {
    console.log(`Usage:
  node scripts/analyze-keepdb-browser-wasm.mjs <package.tgz|package-dir|duckdb.wasm> [--json]

Examples:
  node scripts/analyze-keepdb-browser-wasm.mjs /tmp/keepdb-browser-run-26367485075/keepdb-duckdb-wasm-browser-0.1.0.tgz
  node scripts/analyze-keepdb-browser-wasm.mjs packages/keepdb-duckdb-wasm-browser/dist --json`);
};

const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');
const input = args.find(arg => !arg.startsWith('--'));

if (args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(0);
}

if (!input) {
    usage();
    process.exit(2);
}

const requireCommand = name => {
    try {
        execFileSync(name, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    } catch {
        throw new Error(`Missing required command: ${name}. Install wabt first, for example: brew install wabt`);
    }
};

const gzipSize = async file => {
    const temp = `${file}.gz-size`;
    await pipeline(createReadStream(file), createGzip({ level: 9 }), createWriteStream(temp));
    const size = (await stat(temp)).size;
    await rm(temp, { force: true });
    return size;
};

const shellQuote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

const firstExisting = async candidates => {
    for (const candidate of candidates) {
        try {
            await stat(candidate);
            return candidate;
        } catch {
            // keep looking
        }
    }
    return null;
};

const resolveInput = async inputPath => {
    const absolute = path.resolve(inputPath);
    const info = await stat(absolute);
    let cleanup = async () => {};
    let root = absolute;

    if (info.isFile() && absolute.endsWith('.tgz')) {
        const tempDir = await mkdtemp(path.join(os.tmpdir(), 'keepdb-browser-wasm-analysis-'));
        execFileSync('tar', ['-xzf', absolute, '-C', tempDir], { stdio: ['ignore', 'ignore', 'inherit'] });
        root = path.join(tempDir, 'package');
        cleanup = async () => rm(tempDir, { recursive: true, force: true });
    }

    if (info.isFile() && absolute.endsWith('.wasm')) {
        return {
            cleanup,
            root: path.dirname(absolute),
            wasm: absolute,
            worker: null,
            browserModule: null,
            manifest: null,
        };
    }

    const wasm = await firstExisting([
        path.join(root, 'dist', 'wasm', 'duckdb.wasm'),
        path.join(root, 'wasm', 'duckdb.wasm'),
        path.join(root, 'duckdb.wasm'),
    ]);
    if (!wasm) {
        throw new Error(`Cannot find dist/wasm/duckdb.wasm under ${root}`);
    }

    return {
        cleanup,
        root,
        wasm,
        worker: await firstExisting([path.join(root, 'dist', 'worker.js'), path.join(root, 'worker.js')]),
        browserModule: await firstExisting([
            path.join(root, 'dist', 'duckdb-browser.mjs'),
            path.join(root, 'duckdb-browser.mjs'),
        ]),
        manifest: await firstExisting([path.join(root, 'dist', 'build-manifest.json'), path.join(root, 'build-manifest.json')]),
    };
};

const parseSections = text => {
    const sections = [];
    const pattern =
        /^\s*(\w+)\s+start=0x([0-9a-f]+)\s+end=0x([0-9a-f]+)\s+\(size=0x([0-9a-f]+)\)(?:\s+count:\s+(\d+))?/gim;
    for (const match of text.matchAll(pattern)) {
        sections.push({
            name: match[1],
            start: parseInt(match[2], 16),
            end: parseInt(match[3], 16),
            bytes: parseInt(match[4], 16),
            count: match[5] ? Number(match[5]) : null,
        });
    }
    return sections;
};

const exportNameFromLine = line => {
    const match = line.match(/-> "([^"]+)"/);
    return match ? match[1] : null;
};

const importNameFromLine = line => {
    const match = line.match(/<([^>]+)> <- ([^ ]+)/);
    if (!match) return null;
    return match[2] || match[1];
};

const keywordCountsForNames = names => ({
    duckdbWebC: names.filter(name => name.includes('duckdb_web_')).length,
    duckdbWebCpp: names.filter(name => name.includes('duckdb3web')).length,
    duckdb: names.filter(name => name.includes('duckdb')).length,
    arrow: names.filter(name => name.includes('arrow')).length,
    parquet: names.filter(name => name.toLowerCase().includes('parquet')).length,
    json: names.filter(name => name.toLowerCase().includes('json')).length,
    rttiOrVtable: names.filter(name => /(^|[.])_ZT[ISV]/.test(name)).length,
    emscripten: names.filter(name => name.includes('emscripten') || name.includes('__em')).length,
});

const collectNamedSectionStats = (wasmPath, sectionName, nameFromLine) => {
    const command = [
        'wasm-objdump -x',
        shellQuote(wasmPath),
        `| awk '/${sectionName}\\[/{in_section=1; next} in_section && /^[[:space:]]*[A-Za-z]+\\[/{exit} in_section && /^ - /{print}'`,
    ].join(' ');
    const output = execFileSync('sh', ['-c', command], {
        encoding: 'utf8',
        maxBuffer: 256 * 1024 * 1024,
    });
    const lines = output.split('\n').filter(Boolean);
    const names = lines.map(nameFromLine).filter(Boolean);

    return {
        count: lines.length,
        keywordCounts: keywordCountsForNames(names),
        firstNames: names.slice(0, 30),
        duckdbWebNames: names.filter(name => name.includes('duckdb_web_')).slice(0, 80),
    };
};

const formatBytes = value => `${value.toLocaleString('en-US')} bytes`;

requireCommand('wasm-objdump');

const resolved = await resolveInput(input);
try {
    const wasmBytes = (await stat(resolved.wasm)).size;
    const wasmGzipBytes = await gzipSize(resolved.wasm);
    const header = execFileSync('wasm-objdump', ['-h', resolved.wasm], { encoding: 'utf8' });
    const sections = parseSections(header);
    const imports = collectNamedSectionStats(resolved.wasm, 'Import', importNameFromLine);
    const exports = collectNamedSectionStats(resolved.wasm, 'Export', exportNameFromLine);
    const exportSection = sections.find(section => section.name === 'Export');
    const importSection = sections.find(section => section.name === 'Import');
    imports.declaredCount = importSection?.count ?? null;
    exports.declaredCount = exportSection?.count ?? null;
    const workerBytes = resolved.worker ? (await stat(resolved.worker)).size : null;
    const workerGzipBytes = resolved.worker ? await gzipSize(resolved.worker) : null;
    const browserModuleBytes = resolved.browserModule ? (await stat(resolved.browserModule)).size : null;
    const browserModuleGzipBytes = resolved.browserModule ? await gzipSize(resolved.browserModule) : null;
    const manifest = resolved.manifest ? JSON.parse(await readFile(resolved.manifest, 'utf8')) : null;
    const packageEntries = [];

    try {
        for (const entry of await readdir(resolved.root, { recursive: true, withFileTypes: true })) {
            if (entry.isFile()) {
                packageEntries.push(path.relative(resolved.root, path.join(entry.parentPath, entry.name)));
            }
        }
    } catch {
        // readdir recursive is diagnostic only.
    }

    const report = {
        input: path.resolve(input),
        root: resolved.root,
        manifest,
        files: {
            wasm: { path: resolved.wasm, bytes: wasmBytes, gzipBytes: wasmGzipBytes },
            worker: resolved.worker ? { path: resolved.worker, bytes: workerBytes, gzipBytes: workerGzipBytes } : null,
            browserModule: resolved.browserModule
                ? { path: resolved.browserModule, bytes: browserModuleBytes, gzipBytes: browserModuleGzipBytes }
                : null,
        },
        wasm: {
            sections,
            imports,
            exports,
        },
        packageEntries: packageEntries.slice(0, 200),
    };

    if (jsonOutput) {
        console.log(JSON.stringify(report, null, 2));
    } else {
        console.log('KeepDB browser wasm analysis');
        console.log(`input=${report.input}`);
        if (manifest?.sourceRunId) console.log(`sourceRunId=${manifest.sourceRunId}`);
        if (manifest?.duckdbWasmCommit) console.log(`duckdbWasmCommit=${manifest.duckdbWasmCommit}`);
        console.log(`wasm=${formatBytes(wasmBytes)} gzip=${formatBytes(wasmGzipBytes)}`);
        if (workerBytes != null) console.log(`worker=${formatBytes(workerBytes)} gzip=${formatBytes(workerGzipBytes)}`);
        if (browserModuleBytes != null) {
            console.log(`browserModule=${formatBytes(browserModuleBytes)} gzip=${formatBytes(browserModuleGzipBytes)}`);
        }
        console.log('');
        console.log('Wasm sections:');
        for (const section of sections) {
            const count = section.count == null ? '' : ` count=${section.count}`;
            console.log(`- ${section.name}: ${formatBytes(section.bytes)}${count}`);
        }
        console.log('');
        console.log(`imports=${imports.declaredCount ?? imports.count}`);
        console.log(`import keyword counts=${JSON.stringify(imports.keywordCounts)}`);
        console.log('');
        console.log(`exports=${exports.declaredCount ?? exports.count}`);
        console.log(`export keyword counts=${JSON.stringify(exports.keywordCounts)}`);
        if (exports.duckdbWebNames.length) {
            console.log(`duckdbWebExports=${exports.duckdbWebNames.join(', ')}`);
        }
    }
} finally {
    await resolved.cleanup();
}
