const { db } = require('../db');
const { requireUser } = require('../auth');
const { HttpError, send, readBody, str, email, uuid, color, oneOf } = require('../http');

function toWorkspace(row) {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    iconName: row.icon_name,
    color: row.color,
    role: row.my_role,
    members: row.members || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const WORKSPACE_SELECT = `
  SELECT w.id, w.owner_id, w.name, w.icon_name, w.color, w.created_at, w.updated_at,
         me.role AS my_role,
         (SELECT json_agg(json_build_object('id', u.id, 'name', u.name, 'email', u.email, 'role', m.role)
                          ORDER BY m.created_at)
            FROM workspace_members m JOIN users u ON u.id = m.user_id
           WHERE m.workspace_id = w.id) AS members
    FROM workspaces w
    JOIN workspace_members me ON me.workspace_id = w.id AND me.user_id = $1`;

async function listFor(sql, userId) {
  const rows = await sql(`${WORKSPACE_SELECT} ORDER BY w.updated_at DESC`, [userId]);
  return rows.map(toWorkspace);
}

async function loadFor(sql, userId, workspaceId) {
  const rows = await sql(`${WORKSPACE_SELECT} WHERE w.id = $2`, [userId, workspaceId]);
  if (!rows[0]) throw new HttpError(404, 'Workspace not found');
  return rows[0];
}

async function create(req, res) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const sql = db();
  const name = str(body.name, 'Workspace name', { min: 1, max: 80 });
  const iconName = str(body.iconName || 'rocket', 'Icon', { min: 1, max: 40 });
  const [row] = await sql(
    `WITH w AS (
       INSERT INTO workspaces (owner_id, name, icon_name, color) VALUES ($1, $2, $3, $4) RETURNING id
     ), m AS (
       INSERT INTO workspace_members (workspace_id, user_id, role) SELECT id, $1, 'owner' FROM w
     )
     SELECT id FROM w`,
    [user.id, name, iconName, color(body.color, '#007AFF')],
  );
  send(res, 201, { workspace: toWorkspace(await loadFor(sql, user.id, row.id)) });
}

async function update(req, res, { id }) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const sql = db();
  const wsId = uuid(id, 'Workspace');
  const ws = await loadFor(sql, user.id, wsId);
  if (ws.my_role !== 'owner') throw new HttpError(403, 'Only the owner can edit this workspace');

  const name = body.name !== undefined ? str(body.name, 'Workspace name', { min: 1, max: 80 }) : ws.name;
  const iconName = body.iconName !== undefined ? str(body.iconName, 'Icon', { min: 1, max: 40 }) : ws.icon_name;
  const newColor = body.color !== undefined ? color(body.color, ws.color) : ws.color;
  await sql(
    'UPDATE workspaces SET name = $2, icon_name = $3, color = $4, updated_at = now() WHERE id = $1',
    [wsId, name, iconName, newColor],
  );
  send(res, 200, { workspace: toWorkspace(await loadFor(sql, user.id, wsId)) });
}

// Owner deletes the workspace (its notes go back to their owners); others leave it.
async function remove(req, res, { id }) {
  const user = await requireUser(req);
  const sql = db();
  const wsId = uuid(id, 'Workspace');
  const ws = await loadFor(sql, user.id, wsId);
  if (ws.my_role === 'owner') {
    await sql('DELETE FROM workspaces WHERE id = $1 AND owner_id = $2', [wsId, user.id]);
    return send(res, 200, { ok: true, deleted: true });
  }
  await sql('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [wsId, user.id]);
  send(res, 200, { ok: true, left: true });
}

async function addMember(req, res, { id }) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const sql = db();
  const wsId = uuid(id, 'Workspace');
  const ws = await loadFor(sql, user.id, wsId);
  if (ws.my_role !== 'owner') throw new HttpError(403, 'Only the owner can invite people');

  const mail = email(body.email);
  const role = oneOf(body.role, ['editor', 'viewer'], 'editor', 'Role');
  const users = await sql('SELECT id FROM users WHERE email = $1', [mail]);
  if (!users[0]) throw new HttpError(404, 'No account uses that email');
  if (users[0].id === user.id) throw new HttpError(400, 'You are already in this workspace');

  await sql(
    `INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [wsId, users[0].id, role],
  );
  await sql('UPDATE workspaces SET updated_at = now() WHERE id = $1', [wsId]);
  send(res, 200, { workspace: toWorkspace(await loadFor(sql, user.id, wsId)) });
}

async function removeMember(req, res, { id, userId }) {
  const user = await requireUser(req);
  const sql = db();
  const wsId = uuid(id, 'Workspace');
  const targetId = uuid(userId, 'User');
  const ws = await loadFor(sql, user.id, wsId);
  if (ws.my_role !== 'owner' && targetId !== user.id) throw new HttpError(403, 'Only the owner can remove people');
  if (targetId === ws.owner_id) throw new HttpError(400, 'The owner cannot be removed');
  await sql('DELETE FROM workspace_members WHERE workspace_id = $1 AND user_id = $2', [wsId, targetId]);
  await sql('UPDATE workspaces SET updated_at = now() WHERE id = $1', [wsId]);
  send(res, 200, { ok: true });
}

module.exports = { listFor, create, update, remove, addMember, removeMember };
