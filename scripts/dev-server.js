// Local server that behaves like the Vercel deployment:
// serves the web build from dist/ and the API from server/app.js.
// Usage: npm run build && npm run serve  (reads DATABASE_URL from .env)
const fs = require('fs');
const path = require('path');
const http = require('http');

const root = path.join(__dirname, '..');
if (fs.existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const { handle } = require('../server/app');

const dist = path.join(root, 'dist');
const port = Number(process.env.PORT) || 3000;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  let file = path.normalize(path.join(dist, urlPath));
  if (!file.startsWith(dist)) {
    res.statusCode = 403;
    return res.end();
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    file = path.join(dist, 'index.html'); // SPA fallback
  }
  res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
}

http
  .createServer((req, res) => {
    if (req.url.startsWith('/api/')) return handle(req, res);
    serveStatic(req, res);
  })
  .listen(port, () => console.log(`Swift Notes running at http://localhost:${port}`));
