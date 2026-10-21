import 'dotenv/config';
process.env.TZ = 'Asia/Ho_Chi_Minh';
import { decryptRequest, encryptResponse } from './encryption.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import { MongoClient } from 'mongodb';
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface Player {
  firstPlayCode?: string;
  firstPlayScore?: number;
  firstPlayedAt?: Date;
  sessionId?: string;
  _id: string;
  browserId: string;
  username: string;
  usernameKey: string;
  highestScore: number;
  createdAt: Date;
  updatedAt: Date;
}
if (process.env.NODE_ENV === 'production' && !process.env.MONGODB_URI) {
  throw new Error('MONGODB_URI is required in production. Set it in Temps environment variables; localhost points to this container, not MongoDB.');
}
const client = new MongoClient(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 10000 });
console.log('[startup] Connecting to MongoDB');
try { await client.connect(); }
catch (error) {
  console.error('[startup] MongoDB connection failed. Check MONGODB_URI, credentials, network access and Atlas IP allowlist.');
  throw error;
}
const players = client.db(process.env.MONGODB_DATABASE || 'cargo_game').collection<Player>('players');
await players.createIndex({ usernameKey: 1 }, { unique: true });
await players.createIndex({ browserId: 1 });
await players.createIndex({ firstPlayCode: 1 }, { unique: true, sparse: true });
await players.createIndex({ firstPlayScore: -1, firstPlayedAt: 1, _id: 1 });
await players.createIndex({ highestScore: -1, createdAt: 1, _id: 1 });
const app = express();
app.get('/health', (_req, res) => { res.status(200).json({ status: 'ok' }); });
const adminSessions = new Map<string, number>();
const adminAuth = (req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  const configured = process.env.ADMIN_PASSWORD;
  if (!configured) { res.status(503).send('Chưa cấu hình ADMIN_PASSWORD.'); return; }
  const now = Date.now();
  for (const [token, expires] of adminSessions) if (expires <= now) adminSessions.delete(token);
  const cookie = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('cargo_admin='))?.slice(12);
  if (cookie && /^[a-f0-9]{64}$/.test(cookie) && (adminSessions.get(hash(cookie)) || 0) > now) { next(); return; }
  const authorization = req.get('Authorization');
  if (authorization?.startsWith('Basic ')) {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    if (separator >= 0 && username === 'admin' && timingSafeEqual(Buffer.from(hash(password)), Buffer.from(hash(configured)))) {
      const token = randomBytes(32).toString('hex');
      adminSessions.set(hash(token), now + 8 * 60 * 60 * 1000);
      res.cookie('cargo_admin', token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 8 * 60 * 60 * 1000 });
      next(); return;
    }
  }
  res.setHeader('WWW-Authenticate', 'Basic realm="Cargo Admin", charset="UTF-8"');
  res.status(401).json({ error: 'Vui lòng đăng nhập quản trị.' });
};
app.use('/api/admin', adminAuth);
app.get(['/admin', '/admin.html'], adminAuth, (_req, res) => {
  res.sendFile(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../static/admin.html'));
});
app.disable('x-powered-by');
app.use('/api/admin', express.json({ limit: '4kb' }));
app.use('/api', (req, res, next) => {
  if (req.path.startsWith('/admin/')) next();
  else encryptResponse(req, res, next);
});
app.use('/api', express.raw({ type: 'application/octet-stream', limit: '8kb' }));
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && !req.path.startsWith('/admin/')) decryptRequest(req, res, next);
  else next();
});
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
function identity(req: Request): string | null {
  const token = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith('cargo_player='))?.slice(13);
  return token && /^[a-f0-9]{64}$/.test(token) ? hash(token) : null;
}
const publicPlayer = (p: Player) => ({ username: p.username, highestScore: p.firstPlayScore ?? p.highestScore,
  firstPlayCode: p.firstPlayCode, firstPlayScore: p.firstPlayScore });
const route = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res).catch(next); };

app.get('/api/player', route(async (req, res) => {
  const id = identity(req);
  const player = id ? await players.findOne({ sessionId: id }) : null;
  res.json({ player: player ? publicPlayer(player) : null });
}));

app.get('/api/leaderboard', route(async (req, res) => {
  const id = identity(req);
  const top = await players.find({ firstPlayScore: { $exists: true } }, { projection: { username: 1, firstPlayScore: 1 } })
    .sort({ firstPlayScore: -1, firstPlayedAt: 1, _id: 1 }).limit(10).toArray();
  const current = id ? await players.findOne({ sessionId: id }) : null;
  res.json({
    players: top.map((p, index) => ({
      rank: index + 1, username: p.username, highestScore: p.firstPlayScore, isYou: p._id === current?._id
    }))
  });
}));

app.post('/api/player', route(async (req, res) => {
  const { username, browserId } = req.body;
  if (typeof browserId !== 'string' || !/^[a-f0-9]{32}$/.test(browserId)) {
    res.status(400).json({ error: 'Mã trình duyệt không hợp lệ.' }); return;
  }
  const token = randomBytes(32).toString('hex');
  const setSession = () => res.cookie('cargo_player', token, {
    httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production',
    maxAge: 365 * 24 * 60 * 60 * 1000, path: '/'
  });
  const existing = await players.findOneAndUpdate({ browserId }, { $set: { sessionId: hash(token) } }, { returnDocument: 'after' });
  if (existing) { setSession(); res.json({ player: publicPlayer(existing) }); return; }
  if (username === undefined) { res.json({ player: null }); return; }
  if (typeof username !== 'string' || !/^[\p{L}\p{N}_ .-]{2,24}$/u.test(username.trim()) ||
    typeof browserId !== 'string' || !/^[a-f0-9]{32}$/.test(browserId)) {
    res.status(400).json({ error: 'Tên cần 2–24 ký tự: chữ, số, dấu cách, _, . hoặc -.' }); return;
  }
  const now = new Date();
  const player: Player = {
    _id: browserId, sessionId: hash(token), browserId, username: username.trim().normalize('NFC'),
    usernameKey: username.trim().normalize('NFC').toLocaleLowerCase('vi'),
    highestScore: 0, createdAt: now, updatedAt: now
  };
  try { await players.insertOne(player); }
  catch (error) {
    if ((error as { code?: number }).code === 11000) {
      res.status(409).json({ error: 'Tên này đã được sử dụng. Vui lòng chọn tên khác.' }); return;
    }
    throw error;
  }
  setSession();
  res.status(201).json({ player: publicPlayer(player) });
}));

app.post('/api/score', route(async (req, res) => {
  const id = identity(req);
  if (!id) { res.status(401).json({ error: 'Vui lòng nhập tên trước khi chơi.' }); return; }
  const { scores } = req.body;
  if (!Array.isArray(scores) || scores.length !== 3 || scores.some(s => !Number.isSafeInteger(s) || s < 0 || s > 100000000)) {
    res.status(400).json({ error: 'Điểm không hợp lệ.' }); return;
  }
  const updated = await players.findOne({ sessionId: id });
  if (!updated) { res.status(401).json({ error: 'Không tìm thấy người chơi.' }); return; }
  let player: Player = updated;
  if (!player.firstPlayCode) {
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const first = await players.findOneAndUpdate({ _id: player._id, firstPlayCode: { $exists: false } }, {
          $set: { firstPlayCode: String(randomInt(100000)).padStart(5, '0'), firstPlayScore: Math.max(...scores), highestScore: Math.max(...scores), firstPlayedAt: new Date(), updatedAt: new Date() }
        }, { returnDocument: 'after' });
        player = first || (await players.findOne({ _id: player._id }))!;
        break;
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
      }
    }
    if (!player.firstPlayCode) { res.status(503).json({ error: 'Chưa thể cấp mã. Vui lòng thử lưu lại.' }); return; }
  }
  res.json({ player: publicPlayer(player) });
}));

app.get('/api/admin/stats', route(async (_req, res) => {
  const entries = await players.find({ firstPlayScore: { $exists: true } }, {
    projection: { _id: 0, username: 1, firstPlayScore: 1, firstPlayedAt: 1, firstPlayCode: 1 }
  }).sort({ firstPlayedAt: 1, _id: 1 }).toArray();
  res.json({ points: entries.map(p => ({ username: p.username, code: p.firstPlayCode, score: p.firstPlayScore, playedAt: p.firstPlayedAt })), total: entries.length });
}));

app.post('/api/admin/lookup', route(async (req, res) => {
  const { code } = req.body;
  if (typeof code !== 'string' || !/^\d{5}$/.test(code)) {
    res.status(400).json({ error: 'Nhập mã gồm 5 chữ số.' }); return;
  }
  const player = await players.findOne({ firstPlayCode: code });
  if (!player) { res.status(404).json({ error: 'Không tìm thấy mã.' }); return; }
  res.json({ player: { ...publicPlayer(player), firstPlayedAt: player.firstPlayedAt } });
}));

app.delete('/api/admin/player/:code', route(async (req, res) => {
  const code = req.params.code;
  if (typeof code !== 'string' || !/^\d{5}$/.test(code)) {
    res.status(400).json({ error: 'Mã phải gồm 5 chữ số.' }); return;
  }
  const result = await players.deleteOne({ firstPlayCode: code });
  if (!result.deletedCount) { res.status(404).json({ error: 'Không tìm thấy người chơi.' }); return; }
  res.json({ deleted: true });
}));

app.use('/api', (_req, res) => { res.status(404).json({ error: 'Không tìm thấy API.' }); });
app.use(express.static(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../static')));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error(error);
  res.status(500).json({ error: 'Không thể kết nối máy chủ. Vui lòng thử lại.' });
});
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
const server = app.listen(port, '0.0.0.0', () => console.log(`[startup] Cargo game listening on 0.0.0.0:${port}`));
server.on('error', error => { console.error('[startup] HTTP listener failed:', error); process.exit(1); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  console.log(`[shutdown] Received ${signal}`);
  server.close(() => { void client.close().then(() => process.exit(0)); });
});
