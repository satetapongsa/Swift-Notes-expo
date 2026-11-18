class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const MAX_BODY_BYTES = 512 * 1024;

function send(res, status, data) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(data));
}

async function readBody(req, { maxBytes = MAX_BODY_BYTES } = {}) {
  // Vercel parses JSON bodies for us; the local server does not.
  if (req.body !== undefined) {
    if (typeof req.body === 'string') {
      try {
        return req.body ? JSON.parse(req.body) : {};
      } catch {
        throw new HttpError(400, 'Invalid JSON');
      }
    }
    return req.body || {};
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'Request is too large');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON');
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

function isHttps(req) {
  const proto = req.headers['x-forwarded-proto'];
  if (proto) return proto.split(',')[0].trim() === 'https';
  return Boolean(req.socket && req.socket.encrypted);
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

// Blocks cross-site writes: browsers always send Origin on POST/PATCH/DELETE.
function checkOrigin(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.origin;
  if (!origin) return;
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new HttpError(403, 'Bad origin');
  }
  if (originHost !== host) throw new HttpError(403, 'Cross-site request blocked');
}

// --- input validation helpers ---

function str(value, field, { min = 0, max = 1000, trim = true } = {}) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new HttpError(400, `${field} must be text`);
  const v = trim ? value.trim() : value;
  if (v.length < min) throw new HttpError(400, `${field} is required`);
  if (v.length > max) throw new HttpError(400, `${field} is too long`);
  return v;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function email(value) {
  const v = str(value, 'Email', { min: 3, max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw new HttpError(400, 'Email is not valid');
  return v;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value, field = 'Item') {
  if (typeof value !== 'string' || !UUID_RE.test(value)) throw new HttpError(404, `${field} not found`);
  return value;
}

function optionalUuid(value, field) {
  if (value === undefined || value === null || value === '' || value === 'default') return null;
  return uuid(value, field);
}

const COLOR_RE = /^#[0-9a-f]{3,8}$/i;

function color(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !COLOR_RE.test(value)) throw new HttpError(400, 'Color is not valid');
  return value;
}

function oneOf(value, allowed, fallback, field = 'Value') {
  if (value === undefined || value === null || value === '') return fallback;
  if (!allowed.includes(value)) throw new HttpError(400, `${field} is not valid`);
  return value;
}

module.exports = {
  HttpError,
  send,
  readBody,
  parseCookies,
  isHttps,
  clientIp,
  checkOrigin,
  str,
  email,
  uuid,
  optionalUuid,
  color,
  oneOf,
};
