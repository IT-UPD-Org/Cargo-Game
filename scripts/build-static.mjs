import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile, rename } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import JavaScriptObfuscator from 'javascript-obfuscator';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist/static');
const cli = path.join(path.dirname(require.resolve('google-closure-compiler/package.json')), 'cli.js');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'cargo-static-'));

async function compile(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (entry.name !== 'wasm') await compile(filename); continue; }
    if (!entry.name.endsWith('.js')) continue;
    let source = await readFile(filename, 'utf8');
    const hasWasmImport = source.includes('import("./wasm/encrypt_modunel.js")');
    if (hasWasmImport) source = source.replaceAll('import("./wasm/encrypt_modunel.js")', 'loadCargoWasm()');
    const obfuscated = JavaScriptObfuscator.obfuscate(source, {
      target: 'browser', compact: true, seed: 42,
      renameGlobals: false, renameProperties: false,
      controlFlowFlattening: false, deadCodeInjection: false,
      selfDefending: false, debugProtection: false,
      stringArray: true, stringArrayThreshold: 1,
      stringArrayEncoding: ['base64'],
      sourceMap: false,
      reservedStrings: ['.*\\.(jpg|jpeg|png|gif|webp|svg|wasm|css|html|js|woff2?|ttf|ico).*']
    }).getObfuscatedCode();
    const intermediate = path.join(temporary, 'input.js');
    await writeFile(intermediate, obfuscated);
    execFileSync(process.execPath, [cli,
      '--js', intermediate, '--js_output_file', filename,
      '--compilation_level', 'SIMPLE',
      '--language_in', 'ECMASCRIPT_NEXT', '--language_out', 'ECMASCRIPT_NEXT',
      '--warning_level', 'QUIET'
    ], { stdio: 'inherit' });
    if (hasWasmImport) {
      await writeFile(filename, 'function loadCargoWasm(){return import("./encrypt_modunel.js");}\n' + await readFile(filename, 'utf8'));
    }
    console.log(`Obfuscated and compiled: ${path.relative(output, filename)}`);
  }
}

async function randomizeAssets() {
  const files = [];
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await collect(file);
      else files.push(file);
    }
  }
  await collect(output);
  const names = new Map();
  for (const file of files.filter(file => !file.endsWith('.html'))) {
    const name = path.basename(file);
    if (!names.has(name)) names.set(name, `${randomBytes(8).toString('hex')}${path.extname(file)}`);
  }
  // Update HTML entry points and WASM loader imports before renaming files.
  for (const file of files.filter(file => /\.(html|js|css|json|map|svg|ts)$/.test(file))) {
    let content = await readFile(file, 'utf8');
    for (const [original, randomized] of names) content = content.replaceAll(original, randomized);
    await writeFile(file, content);
  }
  for (const file of files.filter(file => !file.endsWith('.html'))) {
    await rename(file, path.join(path.dirname(file), names.get(path.basename(file))));
  }
  console.log('Randomized asset filenames; HTML filenames preserved and references updated.');
  if (names.has('admin.html')) console.log(`Admin dashboard: /${names.get('admin.html')}`);
}

try {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(path.join(root, 'static'), output, { recursive: true });
  async function removeDevelopmentFiles(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await removeDevelopmentFiles(file);
      else if (/\.(ts|map)$/.test(entry.name)) await rm(file);
    }
  }
  await removeDevelopmentFiles(output);
  await build({ entryPoints: [path.join(root, 'static/game.js')], bundle: true,
    format: 'iife', platform: 'browser', target: 'es2020',
    external: ['./wasm/*'], outfile: path.join(output, 'game.js') });
  await build({ entryPoints: [path.join(root, 'static/admin.js')], bundle: true,
    format: 'iife', platform: 'browser', target: 'es2020',
    external: ['./wasm/*'], outfile: path.join(output, 'admin.js') });
  await rm(path.join(output, 'player.js'), { force: true });
  await rm(path.join(output, 'send-api.js'), { force: true });
  await compile(output);
  // Keep the generated ES-module exports intact while obfuscating the glue.
  const wasmDirectory = path.join(output, 'wasm');
  for (const entry of await readdir(wasmDirectory)) {
    const source = path.join(wasmDirectory, entry);
    const destination = path.join(output, entry);
    if (entry.endsWith('.js')) {
      const code = await readFile(source, 'utf8');
      await writeFile(destination, JavaScriptObfuscator.obfuscate(code, {
        target: 'browser', compact: true, renameGlobals: false,
        renameProperties: false, sourceMap: false, selfDefending: false,
        reservedStrings: ['.*\\.wasm.*']
      }).getObfuscatedCode());
    } else if (entry.endsWith('.wasm')) await cp(source, destination);
  }
  await rm(wasmDirectory, { recursive: true, force: true });
  await randomizeAssets();
  // Encode strings only after renaming assets, so URLs can still be rewritten.
  // Keep ES-module specifiers intact; encoding those would break module loading.
  for (const entry of await readdir(output)) {
    if (!entry.endsWith('.js')) continue;
    const filename = path.join(output, entry);
    const code = await readFile(filename, 'utf8');
    await writeFile(filename, JavaScriptObfuscator.obfuscate(code, {
      target: 'browser', compact: true, renameGlobals: false,
      renameProperties: false, selfDefending: false, sourceMap: false,
      stringArray: true, stringArrayThreshold: 1,
      stringArrayEncoding: ['base64'],
      stringArrayRotate: true, stringArrayShuffle: true,
      splitStrings: true, splitStringsChunkLength: 6
    }).getObfuscatedCode());
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
