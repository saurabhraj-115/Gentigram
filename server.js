const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

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

function sendJson(res, code, payload) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) {
    return {};
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf-8'));
}

function resolveFile(urlPath) {
  const safePath = path.normalize(urlPath).replace(/^\/+/, '');
  const target = safePath === '' ? 'index.html' : safePath;
  const abs = path.join(ROOT, target);
  if (!abs.startsWith(ROOT)) {
    return null;
  }
  return abs;
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

  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt,
      size,
      n: 1
    })
  });

  const data = await response.json();
  if (!response.ok) {
    sendJson(res, response.status, { error: data?.error?.message || 'Image API error', imageUrl: '' });
    return;
  }

  const item = Array.isArray(data.data) ? data.data[0] : null;
  const imageUrl = item?.url || (item?.b64_json ? `data:image/png;base64,${item.b64_json}` : '');
  sendJson(res, 200, { imageUrl });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/config' && req.method === 'GET') {
      sendJson(res, 200, { imageApiReady: Boolean(OPENAI_API_KEY) });
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
    sendJson(res, 500, { error: error.message || 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Gentigram server running on http://localhost:${PORT}`);
});
