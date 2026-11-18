const { db } = require('../db');
const { requireUser } = require('../auth');
const { send, readBody, str, uuid, color } = require('../http');

function toFolder(row) {
  return { id: row.id, name: row.name, iconName: row.icon_name, color: row.color, createdAt: row.created_at };
}

async function listFor(sql, userId) {
  const rows = await sql(
    'SELECT id, name, icon_name, color, created_at FROM folders WHERE user_id = $1 ORDER BY created_at',
    [userId],
  );
  return rows.map(toFolder);
}

async function create(req, res) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const name = str(body.name, 'Folder name', { min: 1, max: 80 });
  const iconName = str(body.iconName || 'folder', 'Icon', { min: 1, max: 40 });
  const [row] = await db()(
    `INSERT INTO folders (user_id, name, icon_name, color) VALUES ($1, $2, $3, $4)
     RETURNING id, name, icon_name, color, created_at`,
    [user.id, name, iconName, color(body.color, '#007AFF')],
  );
  send(res, 201, { folder: toFolder(row) });
}

async function remove(req, res, { id }) {
  const user = await requireUser(req);
  await db()('DELETE FROM folders WHERE id = $1 AND user_id = $2', [uuid(id, 'Folder'), user.id]);
  send(res, 200, { ok: true });
}

module.exports = { listFor, create, remove };
