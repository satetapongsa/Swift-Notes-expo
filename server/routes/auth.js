const { db } = require('../db');
const { HttpError, send, readBody, clientIp, str, email } = require('../http');
const {
  hashPassword,
  verifyPassword,
  createSession,
  destroySession,
  currentUser,
  publicUser,
} = require('../auth');

const WINDOW = "interval '15 minutes'";
const MAX_FAILS_PER_EMAIL = 5;
const MAX_FAILS_PER_IP = 20;
const MAX_SIGNUPS_PER_IP_HOUR = 10;

function password(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'Password is required');
  if (value.length < 8) throw new HttpError(400, 'Password must be at least 8 characters');
  // bcrypt only uses the first 72 bytes.
  if (Buffer.byteLength(value, 'utf8') > 72) throw new HttpError(400, 'Password is too long (max 72 bytes)');
  return value;
}

async function register(req, res) {
  const body = await readBody(req);
  const name = str(body.name, 'Name', { min: 1, max: 80 });
  const mail = email(body.email);
  const pass = password(body.password);
  const ip = clientIp(req);
  const sql = db();

  const [{ count }] = await sql(
    `SELECT count(*)::int AS count FROM login_attempts
      WHERE ip = $1 AND email = 'signup' AND created_at > now() - interval '1 hour'`,
    [ip],
  );
  if (count >= MAX_SIGNUPS_PER_IP_HOUR) throw new HttpError(429, 'Too many sign-ups. Try again later.');
  await sql("INSERT INTO login_attempts (email, ip) VALUES ('signup', $1)", [ip]);

  const hash = await hashPassword(pass);
  const rows = await sql(
    `INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO NOTHING
     RETURNING id, email, name`,
    [mail, name, hash],
  );
  if (!rows[0]) throw new HttpError(409, 'An account with this email already exists');

  await createSession(req, res, rows[0].id);
  send(res, 201, { user: publicUser(rows[0]) });
}

async function login(req, res) {
  const body = await readBody(req);
  const mail = email(body.email);
  if (typeof body.password !== 'string' || !body.password) throw new HttpError(400, 'Password is required');
  const ip = clientIp(req);
  const sql = db();

  const [limits] = await sql(
    `SELECT
       count(*) FILTER (WHERE email = $1)::int AS by_email,
       count(*) FILTER (WHERE ip = $2 AND email <> 'signup')::int AS by_ip
     FROM login_attempts
     WHERE created_at > now() - ${WINDOW} AND (email = $1 OR ip = $2)`,
    [mail, ip],
  );
  if (limits.by_email >= MAX_FAILS_PER_EMAIL || limits.by_ip >= MAX_FAILS_PER_IP) {
    throw new HttpError(429, 'Too many failed attempts. Wait 15 minutes and try again.');
  }

  const users = await sql('SELECT id, email, name, password_hash FROM users WHERE email = $1', [mail]);
  const user = users[0];
  const ok = await verifyPassword(body.password, user && user.password_hash);

  if (!user || !ok) {
    await sql('INSERT INTO login_attempts (email, ip) VALUES ($1, $2)', [mail, ip]);
    await sql(`DELETE FROM login_attempts WHERE created_at < now() - interval '1 day'`);
    throw new HttpError(401, 'Email or password is incorrect');
  }

  await sql('DELETE FROM login_attempts WHERE email = $1', [mail]);
  await createSession(req, res, user.id);
  send(res, 200, { user: publicUser(user) });
}

async function logout(req, res) {
  await destroySession(req, res);
  send(res, 200, { ok: true });
}

async function me(req, res) {
  const user = await currentUser(req);
  send(res, 200, { user: user ? publicUser(user) : null });
}

module.exports = { register, login, logout, me };
