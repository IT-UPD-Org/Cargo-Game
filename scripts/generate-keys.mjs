import { generateKeyPairSync, createPublicKey, createPrivateKey, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('build-keys', { recursive: true });
await writeFile('build-keys/response.key', randomBytes(32), { mode: 0o600 });
const privateKey = process.env.API_RSA_PRIVATE_KEY
  ? createPrivateKey(process.env.API_RSA_PRIVATE_KEY.replace(/\\n/g, '\n'))
  : generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
await writeFile('build-keys/private.pem', privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
await writeFile('build-keys/public.der', createPublicKey(privateKey).export({ type: 'spki', format: 'der' }));
