import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createPrivateKey, createPublicKey, randomBytes } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const run = (command, args, env = process.env) => execFileSync(command, args, { cwd: root, env, stdio: 'inherit' });
try {
  execFileSync('cargo', ['--version'], { stdio: 'ignore' });
  execFileSync('rustup', ['--version'], { stdio: 'ignore' });
} catch {
  console.error('Install Rust with rustup from https://rustup.rs, then run npm run dev again.');
  process.exit(1);
}

// Reuse keys across dev restarts; regenerate only when missing or explicitly changed.
const keyFile = process.env.API_RSA_PRIVATE_KEY_FILE || path.join(root, 'build-keys/private.pem');
if (process.env.API_RSA_PRIVATE_KEY) {
  run(process.execPath, ['scripts/generate-keys.mjs']);
} else if (!existsSync(keyFile)) {
  if (process.env.API_RSA_PRIVATE_KEY_FILE) throw new Error(`Private key file not found: ${keyFile}`);
  run(process.execPath, ['scripts/generate-keys.mjs']);
}
const privateKey = createPrivateKey(process.env.API_RSA_PRIVATE_KEY?.replace(/\\n/g, '\n') || readFileSync(keyFile));
const publicFile = path.join(root, 'encrypt_modunel', 'dev-public.der');
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
if (!existsSync(publicFile) || !readFileSync(publicFile).equals(publicKey)) await writeFile(publicFile, publicKey);

run('rustup', ['target', 'add', 'wasm32-unknown-unknown']);
await mkdir('build-keys', { recursive: true });
const responseFile = path.resolve(process.env.API_RESPONSE_KEY_FILE || 'build-keys/response.key');
if (!existsSync(responseFile)) {
  if (process.env.API_RESPONSE_KEY_FILE) throw new Error(`Response key file not found: ${responseFile}`);
  await writeFile(responseFile, randomBytes(32), { mode: 0o600 });
}
let installed = '';
try { installed = execFileSync('wasm-bindgen', ['--version'], { encoding: 'utf8' }).trim(); } catch {}
if (installed !== 'wasm-bindgen 0.2.100') {
  run('cargo', ['install', 'wasm-bindgen-cli', '--version', '0.2.100', '--locked', '--force']);
}
run('cargo', ['build', '--locked', '--manifest-path', 'encrypt_modunel/Cargo.toml', '--release', '--target', 'wasm32-unknown-unknown'], {
  ...process.env, CARGO_PUBLIC_KEY_FILE: publicFile, CARGO_RESPONSE_KEY_FILE: responseFile
});
run('wasm-bindgen', ['encrypt_modunel/target/wasm32-unknown-unknown/release/encrypt_modunel.wasm', '--target', 'web', '--out-dir', 'static/wasm']);
console.log('WASM and matching server keys ready.');
