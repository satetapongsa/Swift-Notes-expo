const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { db } = require('./db');
const { HttpError, parseCookies, isHttps } = require('./http');

const COOKIE_NAME = 'sn_session';
const SESSION_DAYS = 30;
const BCRYPT_COST = 12;

// Compared against when the email does not exist, so both paths take the same time.
let dummyHash;
function getDummyHash() {
  if (!dummyHash) dummyHash = bcrypt.hashSync(crypto.randomBytes(16).toString('hex'), BCRYPT_COST);
  return dummyHash;
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password) {
  return bcrypt.hash(password, BCRYPT_COST);
}

function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash || getDummyHash());
}

function cookieHeader(req, value, maxAgeSeconds) {
  const parts = [
    `${COOKIE_NAME}=${value}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isHttps(req)) parts.push('Secure');
  return parts.join('; ');
}

async function createSession(req, res, userId) {
  const sql = db();
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sql(
    'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), userId, expires.toISOString()],
  );
  await sql('DELETE FROM sessions WHERE user_id = $1 AND expires_at < now()', [userId]);
  res.setHeader('Set-Cookie', cookieHeader(req, token, SESSION_DAYS * 24 * 60 * 60));
}

async function destroySession(req, res) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (token) {
    await db()('DELETE FROM sessions WHERE token_hash = $1', [hashToken(token)]);
  }
  res.setHeader('Set-Cookie', cookieHeader(req, '', 0));
}

// Returns the signed-in user or null.
async function currentUser(req) {
  const token = parseCookies(req)[COOKIE_NAME];
  if (!token || token.length > 100) return null;
  const rows = await db()(
    `SELECT u.id, u.email, u.name, u.avatar_updated_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [hashToken(token)],
  );
  return rows[0] || null;
}

async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw new HttpError(401, 'Please sign in');
  return user;
}

// URL of a user's profile photo, or null when they have not uploaded one.
function avatarUrl(id, updatedAt) {
  return updatedAt ? `/api/users/${id}/avatar?v=${new Date(updatedAt).getTime()}` : null;
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, avatarUrl: avatarUrl(u.id, u.avatar_updated_at) };
}

module.exports = {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  currentUser,
  requireUser,
  publicUser,
  avatarUrl,
};
