import { readFileSync } from 'node:fs';
import { privateDecrypt, constants, createDecipheriv, createHash, createCipheriv, randomBytes } from 'node:crypto';
import type { RequestHandler } from 'express';

const privateKey = process.env.API_RSA_PRIVATE_KEY?.replace(/\\n/g, '\n') ||
  readFileSync(process.env.API_RSA_PRIVATE_KEY_FILE || 'build-keys/private.pem', 'utf8');
const seen = new Map<string, number>();
const responseKey = readFileSync(process.env.API_RESPONSE_KEY_FILE || 'build-keys/response.key');
if (responseKey.length !== 32) throw new Error('Response key must contain 32 bytes');
export const encryptResponse: RequestHandler = (req, res, next) => {
  res.json = (body: unknown) => {
    const iv = randomBytes(12);
    const encoder = createCipheriv('aes-256-gcm', responseKey, iv);
    encoder.setAAD(Buffer.from(`response:${req.originalUrl}`));
    const ciphertext = Buffer.concat([encoder.update(JSON.stringify(body), 'utf8'), encoder.final()]);
    return res.type('application/octet-stream').send(Buffer.concat([Buffer.from([1]), iv, ciphertext, encoder.getAuthTag()]));
  };
  next();
};
export const decryptRequest: RequestHandler = (req, res, next) => {
  try {
    const b = req.body;
    if (!Buffer.isBuffer(b) || b.length < 32 || b[0] !== 1) throw new Error();
    const size = b.readUInt16BE(1);
    if (size < 256 || size > 512 || b.length < 3 + size + 28) throw new Error();
    const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, b.subarray(3, 3 + size));
    const cipher = createDecipheriv('aes-256-gcm', key, b.subarray(3 + size, 15 + size));
    cipher.setAAD(Buffer.from(req.originalUrl));
    cipher.setAuthTag(b.subarray(b.length - 16));
    const data = JSON.parse(Buffer.concat([cipher.update(b.subarray(15 + size, b.length - 16)), cipher.final()]).toString('utf8'));
    const now = Date.now();
    if (!Number.isFinite(data.time) || Math.abs(now - data.time) > 120000 || typeof data.body !== 'object' || !data.body || Array.isArray(data.body)) throw new Error();
    const digest = createHash('sha256').update(b).digest('hex');
    for (const [id, expires] of seen) if (expires < now) seen.delete(id);
    if (seen.has(digest) || seen.size >= 10000) throw new Error();
    seen.set(digest, now + 240000);
    req.body = data.body;
    next();
  } catch { res.status(400).json({ error: 'Yêu cầu không hợp lệ hoặc đã hết hạn.' }); }
};
