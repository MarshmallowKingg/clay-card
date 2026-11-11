// Local dev server: serves the app and a fake club database (the real Code.gs on an in-memory Sheet).
// Usage: npm run dev   → http://localhost:5173   (club PIN: 1234)
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBackend } from './fake-backend.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 5173;
const backend = loadBackend('1234', [
  ['1042', 'Lewis Robinson', 'Y'], ['1007', 'Pete Smith', 'Y'], ['1013', 'Hannah Jones', 'Y'],
  ['1021', 'Gary Wood', 'Y'], ['1033', 'Sam Patel', 'Y'], ['1050', 'Jo Clarke', 'Y'], ['0999', 'Old Timer', 'N'],
]);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.json': 'application/json' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const send = (code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };

  if (url.pathname === '/api') {
    if (req.method === 'GET') return send(200, JSON.stringify(backend.get(Object.fromEntries(url.searchParams))));
    let body = '';
    for await (const chunk of req) body += chunk;
    try { return send(200, JSON.stringify(backend.post(JSON.parse(body)))); } catch (e) { return send(200, JSON.stringify({ ok: false, error: e.message })); }
  }
  // Point the app at the fake API without touching the real config.
  if (url.pathname === '/src/config.js') {
    return send(200, "export const CONFIG = { CLUB_NAME: 'Dev Club', API_URL: '/api' };\n", 'text/javascript');
  }
  const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));
  if (!file.startsWith(ROOT)) return send(403, 'Forbidden', 'text/plain');
  try { send(200, await fs.readFile(file), TYPES[path.extname(file)] || 'application/octet-stream'); }
  catch { send(404, 'Not found', 'text/plain'); }
}).listen(PORT, () => console.log(`Clay Card dev server: http://localhost:${PORT}  (club PIN 1234)`));
