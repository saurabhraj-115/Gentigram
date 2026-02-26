const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const IMAGE_MODEL = 'gpt-image-1';
const FIX_MODEL = 'gpt-4.1-mini';
let OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const runtimeErrors = [];
const PATCHABLE_FILES = new Set(['app.js', 'server.js', 'index.html', 'styles.css']);

function addRuntimeError(message, source = 'server') {
  runtimeErrors.unshift({
    at: new Date().toISOString(),
    source,
    message: String(message || 'Unknown runtime error')
  });
  if (runtimeErrors.length > 200) {
    runtimeErrors.length = 200;
  }
}

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

function resolveFile(urlPath) {
  const safePath = path.normalize(urlPath).replace(/^\/+/, '');
  const target = safePath === '' ? 'index.html' : safePath;
  const abs = path.join(ROOT, target);
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

function safeWorkspacePath(relPath) {
  const clean = String(relPath || '').replace(/^\/+/, '');
  if (!PATCHABLE_FILES.has(clean)) return null;
  const abs = path.join(ROOT, clean);
  if (!abs.startsWith(ROOT)) return null;
  return abs;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    // continue
  }

  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start >= 0 && end > start) {
    const maybe = raw.slice(start, end + 1);
    try {
      return JSON.parse(maybe);
    } catch {
      return null;
    }
  }
  return null;
}

async function callOpenAIJson(endpoint, payload) {
  const response = await fetch(`https://api.openai.com/v1/${endpoint}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  return { response, data };
}

async function handleImageGeneration(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 503, { error: 'OPENAI_API_KEY missing', imageUrl: '' });
    return;
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON', imageUrl: '' });
    return;
  }

  const prompt = String(body.prompt || '').trim();
  const size = String(body.size || '1024x1536');
  if (!prompt) {
    sendJson(res, 400, { error: 'Prompt required', imageUrl: '' });
    return;
  }

  async function run(chosenSize) {
    return callOpenAIJson('images/generations', {
      model: IMAGE_MODEL,
      prompt,
      size: chosenSize,
      n: 1
    });
  }

  let result = await run(size);
  let sizeUsed = size;

  if (!result.response.ok && size !== '1024x1024') {
    result = await run('1024x1024');
    sizeUsed = '1024x1024';
  }

  if (!result.response.ok) {
    const msg = result.data?.error?.message || 'Image API error';
    addRuntimeError(`Image generation failed: ${msg}`, 'image-api');
    sendJson(res, result.response.status, { error: msg, imageUrl: '' });
    return;
  }

  const item = Array.isArray(result.data.data) ? result.data.data[0] : null;
  const imageUrl = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
  sendJson(res, 200, { imageUrl, sizeUsed, model: IMAGE_MODEL });
}

async function handleFixSuggestion(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 503, { error: 'OPENAI_API_KEY missing', suggestion: '' });
    return;
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON', suggestion: '' });
    return;
  }

  const errorText = String(body.error || '').trim();
  if (!errorText) {
    sendJson(res, 400, { error: 'error field is required', suggestion: '' });
    return;
  }

  const { response, data } = await callOpenAIJson('responses', {
    model: FIX_MODEL,
    input: [
      {
        role: 'system',
        content: 'You are a JavaScript runtime debugger. Give a concise fix plan with likely root cause and patch direction.'
      },
      {
        role: 'user',
        content: `Runtime error:\n${errorText}`
      }
    ]
  });

  if (!response.ok) {
    const msg = data?.error?.message || 'Fix suggestion API error';
    addRuntimeError(`Fix suggestion failed: ${msg}`, 'fix-agent');
    sendJson(res, response.status, { error: msg, suggestion: '' });
    return;
  }

  const suggestion = String(data.output_text || '').trim();
  sendJson(res, 200, { suggestion });
}

async function handleApplySuggestedPatch(req, res) {
  if (!OPENAI_API_KEY) {
    sendJson(res, 503, { error: 'OPENAI_API_KEY missing' });
    return;
  }

  let body;
  try {
    body = await parseBody(req);
  } catch {
    sendJson(res, 400, { error: 'Invalid JSON' });
    return;
  }

  const errorText = String(body.error || '').trim();
  const suggestion = String(body.suggestion || '').trim();
  if (!errorText || !suggestion) {
    sendJson(res, 400, { error: 'error and suggestion are required' });
    return;
  }

  const filePayload = {};
  for (const rel of PATCHABLE_FILES) {
    const abs = safeWorkspacePath(rel);
    if (!abs) continue;
    try {
      filePayload[rel] = fs.readFileSync(abs, 'utf-8');
    } catch {
      filePayload[rel] = '';
    }
  }

  const { response, data } = await callOpenAIJson('responses', {
    model: FIX_MODEL,
    input: [
      {
        role: 'system',
        content:
          'Generate safe patch operations as strict JSON array only. Format: ' +
          '[{"file":"app.js","search":"exact old snippet","replace":"new snippet"}]. ' +
          'Rules: only files app.js/server.js/index.html/styles.css; use exact unique search strings; max 6 ops; no commentary.'
      },
      {
        role: 'user',
        content:
          `Runtime error:\\n${errorText}\\n\\nSuggested fix:\\n${suggestion}\\n\\n` +
          `Current files JSON:\\n${JSON.stringify(filePayload)}`
      }
    ]
  });

  if (!response.ok) {
    const msg = data?.error?.message || 'Patch generation API error';
    addRuntimeError(`Patch generation failed: ${msg}`, 'patch-agent');
    sendJson(res, response.status, { error: msg });
    return;
  }

  const ops = extractJson(String(data.output_text || ''));
  if (!Array.isArray(ops) || ops.length === 0) {
    sendJson(res, 422, { error: 'No patch operations generated' });
    return;
  }

  let applied = 0;
  const changedFiles = new Set();
  for (const op of ops.slice(0, 6)) {
    const rel = String(op.file || '');
    const search = String(op.search || '');
    const replace = String(op.replace || '');
    const abs = safeWorkspacePath(rel);
    if (!abs || !search) continue;

    const content = fs.readFileSync(abs, 'utf-8');
    if (!content.includes(search)) continue;
    const updated = content.replace(search, replace);
    if (updated === content) continue;
    fs.writeFileSync(abs, updated, 'utf-8');
    applied += 1;
    changedFiles.add(rel);
  }

  if (applied === 0) {
    sendJson(res, 422, { error: 'Generated operations did not match current file contents' });
    return;
  }

  addRuntimeError(`Auto patch applied: ${applied} operation(s) on ${Array.from(changedFiles).join(', ')}`, 'patch-agent');
  sendJson(res, 200, { ok: true, applied, files: Array.from(changedFiles) });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/config' && req.method === 'GET') {
      sendJson(res, 200, {
        imageApiReady: Boolean(OPENAI_API_KEY),
        imageModel: IMAGE_MODEL,
        fixModel: FIX_MODEL
      });
      return;
    }

    if (req.url === '/api/session/openai-key' && req.method === 'POST') {
      const body = await parseBody(req);
      const key = String(body.apiKey || '').trim();
      OPENAI_API_KEY = key;
      sendJson(res, 200, { ok: true, configured: Boolean(OPENAI_API_KEY) });
      return;
    }

    if (req.url === '/api/runtime-errors' && req.method === 'GET') {
      sendJson(res, 200, { errors: runtimeErrors });
      return;
    }

    if (req.url === '/api/suggest-fix' && req.method === 'POST') {
      await handleFixSuggestion(req, res);
      return;
    }

    if (req.url === '/api/apply-suggested-patch' && req.method === 'POST') {
      await handleApplySuggestedPatch(req, res);
      return;
    }

    if (req.url === '/api/generate-image' && req.method === 'POST') {
      await handleImageGeneration(req, res);
      return;
    }

    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    const pathname = req.url.split('?')[0];
    const filePath = resolveFile(pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    addRuntimeError(error?.stack || error?.message || 'Unhandled server error', 'server');
    sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

process.on('uncaughtException', (error) => {
  addRuntimeError(error?.stack || error?.message || 'uncaughtException', 'process');
});

process.on('unhandledRejection', (reason) => {
  addRuntimeError(String(reason || 'unhandledRejection'), 'process');
});

server.listen(PORT, () => {
  console.log(`Gentigram server running on http://localhost:${PORT}`);
});
