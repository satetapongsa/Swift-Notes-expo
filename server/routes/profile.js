const { db } = require('../db');
const { requireUser, publicUser } = require('../auth');
const { HttpError, send, readBody, str, uuid } = require('../http');

// Photos are resized in the browser before upload, so 1 MB is plenty.
const MAX_AVATAR_BYTES = 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

async function loadPublic(sql, id) {
  const rows = await sql('SELECT id, email, name, avatar_updated_at FROM users WHERE id = $1', [id]);
  return publicUser(rows[0]);
}

async function update(req, res) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const name = str(body.name, 'Name', { min: 1, max: 80 });
  const sql = db();
  await sql('UPDATE users SET name = $2 WHERE id = $1', [user.id, name]);
  send(res, 200, { user: await loadPublic(sql, user.id) });
}

async function uploadAvatar(req, res) {
  const user = await requireUser(req);
  const body = await readBody(req, { maxBytes: 1.5 * 1024 * 1024 });
  if (!IMAGE_TYPES.includes(body.type)) throw new HttpError(400, 'Use a JPG, PNG, WebP or GIF image');
  if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(body.data)) {
    throw new HttpError(400, 'Image data is not valid');
  }
  const data = Buffer.from(body.data, 'base64');
  if (!data.length) throw new HttpError(400, 'The image is empty');
  if (data.length > MAX_AVATAR_BYTES) throw new HttpError(413, 'The image is too large');
  const sql = db();
  await sql(
    'UPDATE users SET avatar_data = $2, avatar_mime = $3, avatar_updated_at = now() WHERE id = $1',
    [user.id, data, body.type],
  );
  send(res, 200, { user: await loadPublic(sql, user.id) });
}

async function removeAvatar(req, res) {
  const user = await requireUser(req);
  const sql = db();
  await sql('UPDATE users SET avatar_data = NULL, avatar_mime = NULL, avatar_updated_at = NULL WHERE id = $1', [user.id]);
  send(res, 200, { user: await loadPublic(sql, user.id) });
}

// Profile photos are visible to signed-in users (collaborators see each other's photos).
async function avatar(req, res, { id }) {
  await requireUser(req);
  const rows = await db()('SELECT avatar_data, avatar_mime FROM users WHERE id = $1', [uuid(id, 'User')]);
  const row = rows[0];
  if (!row || !row.avatar_data || !IMAGE_TYPES.includes(row.avatar_mime)) throw new HttpError(404, 'No photo');
  res.statusCode = 200;
  res.setHeader('Content-Type', row.avatar_mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  // The URL changes whenever the photo changes, so it can be cached.
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.end(row.avatar_data);
}

module.exports = { update, uploadAvatar, removeAvatar, avatar };
