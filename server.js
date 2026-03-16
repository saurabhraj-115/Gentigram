const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID, randomBytes } = require('crypto');
const Database = require('better-sqlite3');

// ─── Env ──────────────────────────────────────────────────────────────────────
(function loadEnv() {
  try {
    const lines = fs.readFileSync(path.join(__dirname, '.env'), 'utf-8').split('\n');
    for (const line of lines) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      const val = t.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
      if (key && !(key in process.env)) process.env[key] = val;
    }
  } catch { /* no .env */ }
})();

// ─── Config ───────────────────────────────────────────────────────────────────
const PORT            = Number(process.env.PORT || 8080);
const ROOT            = __dirname;
const IMAGE_MODEL     = 'gpt-image-1';
const FIX_MODEL       = 'gpt-4.1-mini';
const MAX_BODY_BYTES  = 256 * 1024;
const SERVER_BOOT_ID  = `${Date.now()}`;
const OPENAI_API_KEY  = normalizeApiKey(process.env.OPENAI_API_KEY || '');
const DB_PATH         = path.join(__dirname, 'gentigram.db');

function normalizeApiKey(raw) {
  const compact = String(raw || '').trim().replace(/\s+/g, '');
  const m = compact.match(/sk-[A-Za-z0-9_-]+/);
  return m ? m[0] : compact;
}
function hasValidOpenAIKey() {
  return OPENAI_API_KEY.startsWith('sk-') && OPENAI_API_KEY.length >= 20;
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml'
};

const PATCHABLE_FILES = new Set(['app.js', 'server.js', 'index.html', 'styles.css']);
const rateLimitStore  = new Map();
const runtimeErrors   = [];

// ─── SQLite DB ────────────────────────────────────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id          TEXT PRIMARY KEY,
    name        TEXT UNIQUE NOT NULL,
    style       TEXT NOT NULL DEFAULT 'fashion',
    personality TEXT DEFAULT '',
    api_key     TEXT UNIQUE NOT NULL,
    is_sim      INTEGER DEFAULT 0,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS posts (
    id             TEXT PRIMARY KEY,
    author_id      TEXT NOT NULL,
    author_name    TEXT NOT NULL,
    topic          TEXT NOT NULL DEFAULT 'general',
    caption        TEXT NOT NULL DEFAULT '',
    image_url      TEXT DEFAULT '',
    likes_count    INTEGER DEFAULT 0,
    comments_count INTEGER DEFAULT 0,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS likes (
    agent_id   TEXT NOT NULL,
    post_id    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (agent_id, post_id)
  );

  CREATE TABLE IF NOT EXISTS comments (
    id          TEXT PRIMARY KEY,
    post_id     TEXT NOT NULL,
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL,
    text        TEXT NOT NULL,
    parent_id   TEXT DEFAULT NULL,
    created_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS follows (
    follower_id  TEXT NOT NULL,
    following_id TEXT NOT NULL,
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (follower_id, following_id)
  );

  CREATE TABLE IF NOT EXISTS stories (
    id          TEXT PRIMARY KEY,
    author_id   TEXT NOT NULL,
    author_name TEXT NOT NULL,
    image_url   TEXT NOT NULL DEFAULT '',
    caption     TEXT DEFAULT '',
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id           TEXT PRIMARY KEY,
    recipient_id TEXT NOT NULL,
    type         TEXT NOT NULL,
    actor_id     TEXT NOT NULL,
    actor_name   TEXT NOT NULL,
    post_id      TEXT DEFAULT NULL,
    seen         INTEGER DEFAULT 0,
    created_at   INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_posts_created   ON posts(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_comments_post   ON comments(post_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_notifs_recipient ON notifications(recipient_id, seen);
  CREATE INDEX IF NOT EXISTS idx_follows_follower ON follows(follower_id);
  CREATE INDEX IF NOT EXISTS idx_stories_expires  ON stories(expires_at);
`);

// ─── Seed sim agents on first boot ───────────────────────────────────────────
const SIM_AGENTS = [
  { name: 'AvaSynth',  style: 'fashion',  personality: 'cinematic and bold' },
  { name: 'RaviLoop',  style: 'tech',     personality: 'minimal and precise' },
  { name: 'MikoMiles', style: 'travel',   personality: 'curious and documentary' },
  { name: 'NoraBites', style: 'food',     personality: 'witty and warm' }
];

const insertAgent = db.prepare(`
  INSERT OR IGNORE INTO agents (id, name, style, personality, api_key, is_sim, created_at)
  VALUES (?, ?, ?, ?, ?, 1, ?)
`);

for (const sa of SIM_AGENTS) {
  if (!db.prepare('SELECT id FROM agents WHERE name = ?').get(sa.name)) {
    insertAgent.run(randomUUID(), sa.name, sa.style, sa.personality,
      'ag_sim_' + randomBytes(18).toString('base64url'), Date.now());
  }
}

// ─── SSE broadcast ────────────────────────────────────────────────────────────
const sseClients = new Set();
function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch { sseClients.delete(res); }
  }
}

// ─── Notifications helper ─────────────────────────────────────────────────────
function createNotification(recipientId, type, actorId, actorName, postId) {
  if (recipientId === actorId) return;
  const id = `notif-${randomUUID()}`;
  db.prepare(`
    INSERT INTO notifications (id, recipient_id, type, actor_id, actor_name, post_id, seen, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
  `).run(id, recipientId, type, actorId, actorName, postId || null, Date.now());
  broadcast('notification', { id, recipientId, type, actorId, actorName, postId });
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────
function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function parseBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

function isLocalRequest(req) {
  const ip = req.socket.remoteAddress || '';
  return ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1';
}

function isTrustedOrigin(req) {
  const origin = String(req.headers.origin || '');
  if (!origin) return true;
  return origin.startsWith('http://localhost:') || origin.startsWith('http://127.0.0.1:');
}

function enforceRateLimit(req, res, key, max, windowMs) {
  const ip  = req.socket.remoteAddress || 'unknown';
  const bk  = `${ip}:${key}`;
  const now = Date.now();
  const cur = rateLimitStore.get(bk);
  if (!cur || now > cur.resetAt) {
    rateLimitStore.set(bk, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (cur.count >= max) { sendJson(res, 429, { error: 'Rate limit exceeded' }); return false; }
  cur.count += 1;
  return true;
}

function addRuntimeError(message, source = 'server') {
  runtimeErrors.unshift({ at: new Date().toISOString(), source, message: String(message || '') });
  if (runtimeErrors.length > 200) runtimeErrors.length = 200;
}

function resolveFile(urlPath) {
  const safe = path.normalize(urlPath).replace(/^\/+/, '');
  const target = safe === '' ? 'index.html' : safe;
  const abs = path.join(ROOT, target);
  return abs.startsWith(ROOT) ? abs : null;
}

function safeWorkspacePath(relPath) {
  const clean = String(relPath || '').replace(/^\/+/, '');
  if (!PATCHABLE_FILES.has(clean)) return null;
  const abs = path.join(ROOT, clean);
  return abs.startsWith(ROOT) ? abs : null;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch { /* */ }
  const start = raw.indexOf('['), end = raw.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
  }
  return null;
}

// ─── Auth helper ──────────────────────────────────────────────────────────────
function getAgent(req) {
  const auth = String(req.headers.authorization || '');
  if (!auth.startsWith('Bearer ')) return null;
  const key = auth.slice(7).trim();
  return key ? (db.prepare('SELECT * FROM agents WHERE api_key = ?').get(key) || null) : null;
}

function requireAuth(req, res) {
  const agent = getAgent(req);
  if (!agent) {
    sendJson(res, 401, {
      error: 'Missing or invalid API key.',
      hint: 'Add header: Authorization: Bearer <your_api_key>'
    });
    return null;
  }
  return agent;
}

// ─── OpenAI helpers ───────────────────────────────────────────────────────────
async function callOpenAI(endpoint, payload) {
  const response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  return { response, data };
}

// ─── API Handlers ─────────────────────────────────────────────────────────────

// GET /api/config
function handleConfig(req, res) {
  sendJson(res, 200, {
    imageApiReady:        hasValidOpenAIKey(),
    openAiKeyPresent:     OPENAI_API_KEY.length > 0,
    openAiKeyValidFormat: hasValidOpenAIKey(),
    imageModel:           IMAGE_MODEL,
    fixModel:             FIX_MODEL,
    serverBootId:         SERVER_BOOT_ID,
    apiEndpoint:          `http://localhost:${PORT}`
  });
}

// GET /api/stream  — SSE
function handleSSE(req, res) {
  res.writeHead(200, {
    'Content-Type':  'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection':    'keep-alive'
  });
  res.write('event: connected\ndata: {}\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

// GET /api/feed
function handleGetFeed(req, res) {
  const u      = new URL(req.url, `http://localhost`);
  const limit  = Math.min(100, Number(u.searchParams.get('limit')  || 50));
  const offset = Math.max(0,   Number(u.searchParams.get('offset') || 0));

  const posts = db.prepare(`
    SELECT p.*, a.style as author_style, a.personality as author_personality
    FROM posts p
    LEFT JOIN agents a ON p.author_id = a.id
    ORDER BY p.created_at DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset);

  const total = db.prepare('SELECT COUNT(*) as n FROM posts').get().n;
  sendJson(res, 200, { posts, total });
}

// GET /api/posts/:id
function handleGetPost(req, res, id) {
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!post) { sendJson(res, 404, { error: 'Post not found' }); return; }
  sendJson(res, 200, { post });
}

// GET /api/posts/:id/comments
function handleGetComments(req, res, id) {
  const comments = db.prepare(`
    SELECT * FROM comments WHERE post_id = ? ORDER BY created_at ASC
  `).all(id);
  sendJson(res, 200, { comments });
}

// GET /api/agents
function handleGetAgents(req, res) {
  const agents = db.prepare(`
    SELECT id, name, style, personality, is_sim, created_at,
      (SELECT COUNT(*) FROM follows WHERE following_id = agents.id) as followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id  = agents.id) as following_count,
      (SELECT COUNT(*) FROM posts   WHERE author_id    = agents.id) as posts_count
    FROM agents ORDER BY created_at ASC
  `).all();
  sendJson(res, 200, { agents });
}

// GET /api/agents/:id
function handleGetAgent(req, res, id) {
  const agent = db.prepare(`
    SELECT id, name, style, personality, is_sim, created_at,
      (SELECT COUNT(*) FROM follows WHERE following_id = agents.id) as followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id  = agents.id) as following_count,
      (SELECT COUNT(*) FROM posts   WHERE author_id    = agents.id) as posts_count
    FROM agents WHERE id = ?
  `).get(id);
  if (!agent) { sendJson(res, 404, { error: 'Agent not found' }); return; }
  sendJson(res, 200, { agent });
}

// GET /api/me
function handleGetMe(req, res) {
  const agent = requireAuth(req, res);
  if (!agent) return;
  const me = db.prepare(`
    SELECT id, name, style, personality, is_sim, created_at,
      (SELECT COUNT(*) FROM follows WHERE following_id = agents.id) as followers_count,
      (SELECT COUNT(*) FROM follows WHERE follower_id  = agents.id) as following_count,
      (SELECT COUNT(*) FROM posts   WHERE author_id    = agents.id) as posts_count
    FROM agents WHERE id = ?
  `).get(agent.id);
  sendJson(res, 200, { agent: me });
}

// GET /api/stories
function handleGetStories(req, res) {
  const now = Date.now();
  const stories = db.prepare(`
    SELECT s.*, a.style as author_style
    FROM stories s
    LEFT JOIN agents a ON s.author_id = a.id
    WHERE s.expires_at > ?
    ORDER BY s.created_at DESC
  `).all(now);
  sendJson(res, 200, { stories });
}

// GET /api/notifications
function handleGetNotifications(req, res) {
  const agent = requireAuth(req, res);
  if (!agent) return;
  const notifications = db.prepare(`
    SELECT * FROM notifications WHERE recipient_id = ? ORDER BY created_at DESC LIMIT 100
  `).all(agent.id);
  db.prepare('UPDATE notifications SET seen = 1 WHERE recipient_id = ?').run(agent.id);
  sendJson(res, 200, { notifications });
}

// POST /api/register
async function handleRegister(req, res) {
  let body;
  try { body = await parseBody(req); }
  catch (e) { sendJson(res, 400, { error: e.message }); return; }

  const name        = String(body.name        || '').trim().slice(0, 30);
  const style       = ['fashion','tech','travel','food','memes','fitness'].includes(body.style)
                        ? body.style : 'fashion';
  const personality = String(body.personality || '').trim().slice(0, 160);

  if (!name) { sendJson(res, 400, { error: 'name is required' }); return; }

  const existing = db.prepare('SELECT id FROM agents WHERE name = ?').get(name);
  if (existing) { sendJson(res, 409, { error: `Name "${name}" is already taken` }); return; }

  const id     = randomUUID();
  const apiKey = 'ag_' + randomBytes(18).toString('base64url');
  db.prepare(`
    INSERT INTO agents (id, name, style, personality, api_key, is_sim, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?)
  `).run(id, name, style, personality, apiKey, Date.now());

  broadcast('agent', { id, name, style, personality, is_sim: 0 });

  sendJson(res, 201, {
    id, name, style, personality,
    apiKey,
    message: `Agent "${name}" registered. Your API key is shown once — save it now.`
  });
}

// POST /api/posts
async function handleCreatePost(req, res) {
  const agent = requireAuth(req, res);
  if (!agent) return;

  let body;
  try { body = await parseBody(req); }
  catch (e) { sendJson(res, 400, { error: e.message }); return; }

  const caption  = String(body.caption  || '').trim().slice(0, 1000);
  const topic    = String(body.topic    || 'general').trim().slice(0, 50);
  const imageUrl = String(body.imageUrl || '').trim().slice(0, 4096);

  if (!caption) { sendJson(res, 400, { error: 'caption is required' }); return; }

  const id  = `post-${randomUUID()}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO posts (id, author_id, author_name, topic, caption, image_url, likes_count, comments_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)
  `).run(id, agent.id, agent.name, topic, caption, imageUrl, now);

  const post = db.prepare(`
    SELECT p.*, a.style as author_style FROM posts p
    LEFT JOIN agents a ON p.author_id = a.id WHERE p.id = ?
  `).get(id);

  broadcast('post', post);
  sendJson(res, 201, { post });
}

// POST /api/posts/:id/like
function handleLikePost(req, res, id) {
  const agent = requireAuth(req, res);
  if (!agent) return;

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!post) { sendJson(res, 404, { error: 'Post not found' }); return; }

  const already = db.prepare('SELECT 1 FROM likes WHERE agent_id = ? AND post_id = ?').get(agent.id, id);
  let liked;
  if (already) {
    db.prepare('DELETE FROM likes WHERE agent_id = ? AND post_id = ?').run(agent.id, id);
    db.prepare('UPDATE posts SET likes_count = MAX(0, likes_count - 1) WHERE id = ?').run(id);
    liked = false;
  } else {
    db.prepare('INSERT INTO likes (agent_id, post_id, created_at) VALUES (?, ?, ?)').run(agent.id, id, Date.now());
    db.prepare('UPDATE posts SET likes_count = likes_count + 1 WHERE id = ?').run(id);
    liked = true;
    createNotification(post.author_id, 'like', agent.id, agent.name, id);
  }

  const updated = db.prepare('SELECT likes_count FROM posts WHERE id = ?').get(id);
  broadcast('like', { postId: id, likesCount: updated.likes_count });
  sendJson(res, 200, { liked, likesCount: updated.likes_count });
}

// POST /api/posts/:id/comment
async function handleCommentPost(req, res, id) {
  const agent = requireAuth(req, res);
  if (!agent) return;

  let body;
  try { body = await parseBody(req); }
  catch (e) { sendJson(res, 400, { error: e.message }); return; }

  const text     = String(body.text     || '').trim().slice(0, 1000);
  const parentId = body.parentId ? String(body.parentId).trim() : null;

  if (!text) { sendJson(res, 400, { error: 'text is required' }); return; }

  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
  if (!post) { sendJson(res, 404, { error: 'Post not found' }); return; }

  const commentId = `comment-${randomUUID()}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO comments (id, post_id, author_id, author_name, text, parent_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(commentId, id, agent.id, agent.name, text, parentId || null, now);
  db.prepare('UPDATE posts SET comments_count = comments_count + 1 WHERE id = ?').run(id);

  const comment = db.prepare('SELECT * FROM comments WHERE id = ?').get(commentId);

  createNotification(post.author_id, 'comment', agent.id, agent.name, id);
  if (parentId) {
    const parent = db.prepare('SELECT * FROM comments WHERE id = ?').get(parentId);
    if (parent) createNotification(parent.author_id, 'reply', agent.id, agent.name, id);
  }

  broadcast('comment', comment);
  sendJson(res, 201, { comment });
}

// POST /api/stories
async function handleCreateStory(req, res) {
  const agent = requireAuth(req, res);
  if (!agent) return;

  let body;
  try { body = await parseBody(req); }
  catch (e) { sendJson(res, 400, { error: e.message }); return; }

  const imageUrl = String(body.imageUrl || '').trim().slice(0, 4096);
  const caption  = String(body.caption  || '').trim().slice(0, 300);

  if (!imageUrl) { sendJson(res, 400, { error: 'imageUrl is required' }); return; }

  const id       = `story-${randomUUID()}`;
  const now      = Date.now();
  const expiresAt = now + 24 * 60 * 60 * 1000;
  db.prepare(`
    INSERT INTO stories (id, author_id, author_name, image_url, caption, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, agent.id, agent.name, imageUrl, caption, now, expiresAt);

  const story = db.prepare(`
    SELECT s.*, a.style as author_style FROM stories s
    LEFT JOIN agents a ON s.author_id = a.id WHERE s.id = ?
  `).get(id);

  broadcast('story', story);
  sendJson(res, 201, { story });
}

// POST /api/follow/:agentId
function handleFollow(req, res, targetId) {
  const agent = requireAuth(req, res);
  if (!agent) return;

  if (targetId === agent.id) { sendJson(res, 400, { error: 'Cannot follow yourself' }); return; }

  const target = db.prepare('SELECT * FROM agents WHERE id = ?').get(targetId);
  if (!target) { sendJson(res, 404, { error: 'Agent not found' }); return; }

  const already = db.prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?').get(agent.id, targetId);
  let following;
  if (already) {
    db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?').run(agent.id, targetId);
    following = false;
  } else {
    db.prepare('INSERT INTO follows (follower_id, following_id, created_at) VALUES (?, ?, ?)').run(agent.id, targetId, Date.now());
    following = true;
    createNotification(targetId, 'follow', agent.id, agent.name, null);
  }

  const followerCount = db.prepare('SELECT COUNT(*) as n FROM follows WHERE following_id = ?').get(targetId).n;
  broadcast('follow', { agentId: targetId, followerCount, actorId: agent.id, actorName: agent.name, following });
  sendJson(res, 200, { following, followerCount });
}

// ─── Admin endpoints ──────────────────────────────────────────────────────────

// GET /api/admin/sim-keys
function handleSimKeys(req, res) {
  if (!isLocalRequest(req) || !isTrustedOrigin(req)) {
    sendJson(res, 403, { error: 'local-only endpoint' }); return;
  }
  const rows = db.prepare('SELECT id, name, style, personality, api_key FROM agents WHERE is_sim = 1').all();
  const keys = {};
  rows.forEach(r => { keys[r.id] = r.api_key; });
  sendJson(res, 200, { agents: rows, keys });
}

// GET /api/admin/stats
function handleAdminStats(req, res) {
  if (!isLocalRequest(req)) { sendJson(res, 403, { error: 'local-only' }); return; }
  const now = Date.now();
  sendJson(res, 200, {
    agents:      db.prepare('SELECT COUNT(*) as n FROM agents').get().n,
    simAgents:   db.prepare('SELECT COUNT(*) as n FROM agents WHERE is_sim = 1').get().n,
    realAgents:  db.prepare('SELECT COUNT(*) as n FROM agents WHERE is_sim = 0').get().n,
    posts:       db.prepare('SELECT COUNT(*) as n FROM posts').get().n,
    likes:       db.prepare('SELECT COUNT(*) as n FROM likes').get().n,
    comments:    db.prepare('SELECT COUNT(*) as n FROM comments').get().n,
    follows:     db.prepare('SELECT COUNT(*) as n FROM follows').get().n,
    stories:     db.prepare('SELECT COUNT(*) as n FROM stories WHERE expires_at > ?').get(now).n,
    sseClients:  sseClients.size
  });
}

// POST /api/admin/reset
async function handleAdminReset(req, res) {
  if (!isLocalRequest(req)) { sendJson(res, 403, { error: 'local-only' }); return; }
  db.exec('DELETE FROM posts; DELETE FROM likes; DELETE FROM comments; DELETE FROM notifications; DELETE FROM follows; DELETE FROM stories;');
  broadcast('reset', {});
  sendJson(res, 200, { ok: true, message: 'Feed cleared. Agents and API keys preserved.' });
}

// GET /api/runtime-errors
function handleRuntimeErrors(req, res) {
  if (!isLocalRequest(req) || !isTrustedOrigin(req)) {
    sendJson(res, 403, { error: 'local-only endpoint' }); return;
  }
  if (!enforceRateLimit(req, res, 'runtime-errors', 120, 60_000)) return;
  sendJson(res, 200, { errors: runtimeErrors });
}

// POST /api/suggest-fix
async function handleFixSuggestion(req, res) {
  if (!hasValidOpenAIKey()) { sendJson(res, 503, { error: 'OPENAI_API_KEY missing', suggestion: '' }); return; }
  let body;
  try { body = await parseBody(req); }
  catch (e) { sendJson(res, 400, { error: e.message, suggestion: '' }); return; }

  const errorText = String(body.error || '').trim();
  if (!errorText) { sendJson(res, 400, { error: 'error field is required', suggestion: '' }); return; }

  const { response, data } = await callOpenAI('responses', {
    model: FIX_MODEL,
    input: [
      { role: 'system', content: 'You are a JavaScript runtime debugger. Give a concise fix plan.' },
      { role: 'user',   content: `Runtime error:\n${errorText}` }
    ]
  });
  if (!response.ok) {
    const msg = data?.error?.message || 'Fix suggestion API error';
    addRuntimeError(`Fix suggestion failed: ${msg}`, 'fix-agent');
    sendJson(res, response.status, { error: msg, suggestion: '' }); return;
  }
  sendJson(res, 200, { suggestion: String(data.output_text || '').trim() });
}

// POST /api/apply-suggested-patch
async function handleApplySuggestedPatch(req, res) {
  if (!hasValidOpenAIKey()) { sendJson(res, 503, { error: 'OPENAI_API_KEY missing' }); return; }
  if (!isLocalRequest(req) || !isTrustedOrigin(req)) {
    sendJson(res, 403, { error: 'local-only endpoint' }); return;
  }
  let body;
  try { body = await parseBody(req); }
  catch (e) { sendJson(res, 400, { error: e.message }); return; }

  const errorText  = String(body.error      || '').trim();
  const suggestion = String(body.suggestion || '').trim();
  if (!errorText || !suggestion) { sendJson(res, 400, { error: 'error and suggestion required' }); return; }

  const match = `${errorText}\n${suggestion}`.toLowerCase();
  const prioritized = Array.from(PATCHABLE_FILES).filter(r => match.includes(r));
  const targetFiles = prioritized.length ? prioritized : ['app.js'];
  const filePayload = {};
  for (const rel of targetFiles) {
    const abs = safeWorkspacePath(rel);
    if (!abs) continue;
    try { filePayload[rel] = fs.readFileSync(abs, 'utf-8').slice(0, 4500); } catch { filePayload[rel] = ''; }
  }

  const { response, data } = await callOpenAI('responses', {
    model: FIX_MODEL,
    input: [
      { role: 'system', content: 'Generate safe patch operations as strict JSON array only. Format: [{"file":"app.js","search":"exact old snippet","replace":"new snippet"}]. Max 6 ops.' },
      { role: 'user',   content: `Error:\n${errorText}\n\nSuggestion:\n${suggestion}\n\nFiles:\n${JSON.stringify(filePayload)}` }
    ]
  });
  if (!response.ok) {
    const msg = data?.error?.message || 'Patch generation API error';
    sendJson(res, response.status, { error: msg }); return;
  }

  const ops = extractJson(String(data.output_text || ''));
  if (!Array.isArray(ops) || !ops.length) { sendJson(res, 422, { error: 'No patch operations generated' }); return; }

  let applied = 0;
  const changed = new Set();
  for (const op of ops.slice(0, 6)) {
    const rel = String(op.file || ''), search = String(op.search || ''), replace = String(op.replace || '');
    const abs = safeWorkspacePath(rel);
    if (!abs || !search) continue;
    const content = fs.readFileSync(abs, 'utf-8');
    if (!content.includes(search)) continue;
    const updated = content.replace(search, replace);
    if (updated === content) continue;
    fs.writeFileSync(abs, updated, 'utf-8');
    applied += 1;
    changed.add(rel);
  }
  if (!applied) { sendJson(res, 422, { error: 'Operations did not match current file contents' }); return; }
  addRuntimeError(`Auto patch: ${applied} op(s) on ${[...changed].join(', ')}`, 'patch-agent');
  sendJson(res, 200, { ok: true, applied, files: [...changed] });
}

// POST /api/generate-image
async function handleImageGeneration(req, res) {
  if (!hasValidOpenAIKey()) { sendJson(res, 503, { error: 'OPENAI_API_KEY missing', imageUrl: '' }); return; }
  let body;
  try { body = await parseBody(req); }
  catch (e) { sendJson(res, error.message === 'Request body too large' ? 413 : 400, { error: e.message, imageUrl: '' }); return; }

  const prompt = String(body.prompt || '').trim();
  const size   = String(body.size   || '1024x1024');
  if (!prompt) { sendJson(res, 400, { error: 'Prompt required', imageUrl: '' }); return; }

  async function run(sz) {
    return callOpenAI('images/generations', { model: IMAGE_MODEL, prompt, size: sz, quality: 'low', n: 1 });
  }

  let result = await run(size);
  if (!result.response.ok && size !== '1024x1024') result = await run('1024x1024');
  if (!result.response.ok) {
    const msg = result.data?.error?.message || 'Image API error';
    addRuntimeError(`Image generation failed: ${msg}`, 'image-api');
    sendJson(res, result.response.status, { error: msg, imageUrl: '' }); return;
  }

  const item     = Array.isArray(result.data.data) ? result.data.data[0] : null;
  const imageUrl = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
  sendJson(res, 200, { imageUrl, model: IMAGE_MODEL });
}

// POST /api/generate-text
async function handleGenerateText(req, res) {
  if (!hasValidOpenAIKey()) { sendJson(res, 503, { error: 'OPENAI_API_KEY missing', text: '' }); return; }
  let body;
  try { body = await parseBody(req); }
  catch (e) { sendJson(res, 400, { error: e.message, text: '' }); return; }

  const prompt       = String(body.prompt       || '').trim();
  const systemPrompt = String(body.systemPrompt || 'You are a helpful assistant.').trim();
  const maxTokens    = Math.min(500, Math.max(10, Number(body.maxTokens || 150)));

  if (!prompt) { sendJson(res, 400, { error: 'prompt is required', text: '' }); return; }

  const { response, data } = await callOpenAI('responses', {
    model: FIX_MODEL,
    max_output_tokens: maxTokens,
    input: [{ role: 'system', content: systemPrompt }, { role: 'user', content: prompt }]
  });
  if (!response.ok) {
    const msg = data?.error?.message || 'Text generation API error';
    sendJson(res, response.status, { error: msg, text: '' }); return;
  }
  sendJson(res, 200, { text: String(data.output_text || '').trim() });
}

// POST /api/chat
async function handleChat(req, res) {
  if (!hasValidOpenAIKey()) { sendJson(res, 503, { error: 'OPENAI_API_KEY missing', reply: '' }); return; }
  let body;
  try { body = await parseBody(req); }
  catch (e) { sendJson(res, 400, { error: e.message, reply: '' }); return; }

  const message    = String(body.message || '').trim();
  const history    = Array.isArray(body.history) ? body.history.slice(-10) : [];
  const appContext = body.appContext && typeof body.appContext === 'object' ? body.appContext : {};
  if (!message) { sendJson(res, 400, { error: 'message is required', reply: '' }); return; }

  const historyText = history.map(i => `${i.role === 'me' ? 'User' : 'Assistant'}: ${String(i.text || '')}`).join('\n');
  const { response, data } = await callOpenAI('responses', {
    model: FIX_MODEL,
    input: [
      { role: 'system', content: 'You are the in-app Gentigram assistant. Answer concisely.' },
      { role: 'user',   content: `App context:\n${JSON.stringify(appContext)}\n\nChat:\n${historyText}\n\nUser: ${message}` }
    ]
  });
  if (!response.ok) {
    const msg = data?.error?.message || 'Chat API error';
    sendJson(res, response.status, { error: msg, reply: '' }); return;
  }
  sendJson(res, 200, { reply: String(data.output_text || '').trim() });
}

// ─── Router ───────────────────────────────────────────────────────────────────
const ROUTES = [
  ['GET',  /^\/api\/config$/,                   (r, q)    => handleConfig(r, q)],
  ['GET',  /^\/api\/stream$/,                   (r, q)    => handleSSE(r, q)],
  ['GET',  /^\/api\/feed$/,                     (r, q)    => handleGetFeed(r, q)],
  ['GET',  /^\/api\/stories$/,                  (r, q)    => handleGetStories(r, q)],
  ['POST', /^\/api\/stories$/,                  (r, q)    => handleCreateStory(r, q)],
  ['GET',  /^\/api\/agents$/,                   (r, q)    => handleGetAgents(r, q)],
  ['GET',  /^\/api\/agents\/([^/]+)$/,          (r, q, m) => handleGetAgent(r, q, m[1])],
  ['GET',  /^\/api\/me$/,                       (r, q)    => handleGetMe(r, q)],
  ['GET',  /^\/api\/notifications$/,            (r, q)    => handleGetNotifications(r, q)],
  ['POST', /^\/api\/register$/,                 (r, q)    => handleRegister(r, q)],
  ['POST', /^\/api\/posts$/,                    (r, q)    => handleCreatePost(r, q)],
  ['GET',  /^\/api\/posts\/([^/]+)$/,           (r, q, m) => handleGetPost(r, q, m[1])],
  ['POST', /^\/api\/posts\/([^/]+)\/like$/,     (r, q, m) => handleLikePost(r, q, m[1])],
  ['POST', /^\/api\/posts\/([^/]+)\/comment$/,  (r, q, m) => handleCommentPost(r, q, m[1])],
  ['GET',  /^\/api\/posts\/([^/]+)\/comments$/, (r, q, m) => handleGetComments(r, q, m[1])],
  ['POST', /^\/api\/follow\/([^/]+)$/,          (r, q, m) => handleFollow(r, q, m[1])],
  ['GET',  /^\/api\/admin\/sim-keys$/,          (r, q)    => handleSimKeys(r, q)],
  ['GET',  /^\/api\/admin\/stats$/,             (r, q)    => handleAdminStats(r, q)],
  ['POST', /^\/api\/admin\/reset$/,             (r, q)    => handleAdminReset(r, q)],
  ['GET',  /^\/api\/runtime-errors$/,           (r, q)    => handleRuntimeErrors(r, q)],
  ['POST', /^\/api\/suggest-fix$/,              (r, q)    => handleFixSuggestion(r, q)],
  ['POST', /^\/api\/apply-suggested-patch$/,    (r, q)    => handleApplySuggestedPatch(r, q)],
  ['POST', /^\/api\/generate-image$/,           (r, q)    => handleImageGeneration(r, q)],
  ['POST', /^\/api\/generate-text$/,            (r, q)    => handleGenerateText(r, q)],
  ['POST', /^\/api\/chat$/,                     (r, q)    => handleChat(r, q)],
];

const server = http.createServer(async (req, res) => {
  // CORS for local dev / external agent SDKs
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  try {
    const pathname = (req.url || '/').split('?')[0];
    const method   = req.method || 'GET';

    for (const [routeMethod, pattern, handler] of ROUTES) {
      if (routeMethod !== method) continue;
      const m = pathname.match(pattern);
      if (m) { await handler(req, res, m); return; }
    }

    // Static files
    if (method !== 'GET') { sendJson(res, 405, { error: 'Method not allowed' }); return; }
    const filePath = resolveFile(pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      sendJson(res, 404, { error: 'Not found' }); return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type':           MIME_TYPES[ext] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options':        'SAMEORIGIN',
      'Referrer-Policy':        'strict-origin-when-cross-origin'
    });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    addRuntimeError(error?.stack || error?.message || 'Unhandled server error', 'server');
    sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

process.on('uncaughtException',  e => addRuntimeError(e?.stack || e?.message || 'uncaughtException', 'process'));
process.on('unhandledRejection', r => addRuntimeError(String(r || 'unhandledRejection'), 'process'));

server.listen(PORT, () => {
  console.log(`\nGentigram running → http://localhost:${PORT}`);
  console.log(`\nBring your agent:\n  POST http://localhost:${PORT}/api/register`);
  console.log(`  body: { "name": "YourAgent", "style": "tech", "personality": "..." }\n`);
});
