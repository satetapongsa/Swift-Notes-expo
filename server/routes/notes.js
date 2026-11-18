const { db } = require('../db');
const { merge3 } = require('../../shared/merge');
const { requireUser } = require('../auth');
const { NOTE_SELECT, toNote } = require('../access');
const { HttpError, send, readBody, str, email, uuid, optionalUuid, oneOf } = require('../http');

const MAX_TITLE = 300;
const MAX_CONTENT = 200000;

function tags(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 20) throw new HttpError(400, 'Tags are not valid');
  return value.map(t => str(t, 'Tag', { min: 1, max: 40 }));
}

async function loadNote(sql, userId, noteId) {
  const rows = await sql(`${NOTE_SELECT} AND x.id = $2`, [userId, noteId]);
  if (!rows[0]) throw new HttpError(404, 'Note not found');
  return rows[0];
}

async function assertFolder(sql, userId, folderId) {
  if (!folderId) return;
  const rows = await sql('SELECT 1 FROM folders WHERE id = $1 AND user_id = $2', [folderId, userId]);
  if (!rows[0]) throw new HttpError(400, 'Folder not found');
}

async function assertWorkspaceEditor(sql, userId, workspaceId) {
  if (!workspaceId) return;
  const rows = await sql(
    `SELECT 1 FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2 AND role IN ('owner', 'editor')`,
    [workspaceId, userId],
  );
  if (!rows[0]) throw new HttpError(403, 'You cannot add notes to this workspace');
}

async function get(req, res, { id }) {
  const user = await requireUser(req);
  const row = await loadNote(db(), user.id, uuid(id, 'Note'));
  send(res, 200, { note: toNote(row) });
}

async function create(req, res) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const sql = db();
  const title = str(body.title, 'Title', { max: MAX_TITLE });
  const content = str(body.content, 'Content', { max: MAX_CONTENT, trim: false });
  const folderId = optionalUuid(body.folderId, 'Folder');
  const workspaceId = optionalUuid(body.workspaceId, 'Workspace');
  await assertFolder(sql, user.id, folderId);
  await assertWorkspaceEditor(sql, user.id, workspaceId);

  const [created] = await sql(
    `INSERT INTO notes (owner_id, folder_id, workspace_id, title, content, tags, pinned, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $1) RETURNING id`,
    [user.id, folderId, workspaceId, title, content, tags(body.tags) || [], Boolean(body.pinned)],
  );
  const row = await loadNote(sql, user.id, created.id);
  send(res, 201, { note: toNote(row) });
}

// Text fields are merged when the note changed since the client last saw it.
const TEXT_FIELDS = ['title', 'content'];
const MAX_ATTEMPTS = 3;

async function update(req, res, { id }) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const sql = db();
  const noteId = uuid(id, 'Note');

  // Validate everything up front.
  const input = {};
  if (body.title !== undefined) input.title = str(body.title, 'Title', { max: MAX_TITLE });
  if (body.content !== undefined) input.content = str(body.content, 'Content', { max: MAX_CONTENT, trim: false });
  if (body.tags !== undefined) input.tags = tags(body.tags);
  if (body.pinned !== undefined) input.pinned = Boolean(body.pinned);
  const moving = body.folderId !== undefined || body.workspaceId !== undefined;
  const folderId = body.folderId !== undefined ? optionalUuid(body.folderId, 'Folder') : undefined;
  const workspaceId = body.workspaceId !== undefined ? optionalUuid(body.workspaceId, 'Workspace') : undefined;

  // The version and text the client started editing from (optional).
  const baseVersion = Number.isInteger(body.baseVersion) ? body.baseVersion : null;
  const base = body.base && typeof body.base === 'object' ? body.base : {};

  let merged = false;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const current = await loadNote(sql, user.id, noteId);
    if (current.access === 'viewer') throw new HttpError(403, 'You can only view this note');
    if (current.deleted_at) throw new HttpError(400, 'Restore the note before editing it');
    if (moving && current.access !== 'owner') throw new HttpError(403, 'Only the owner can move this note');
    if (folderId) await assertFolder(sql, user.id, folderId);
    if (workspaceId) await assertWorkspaceEditor(sql, user.id, workspaceId);

    const values = { ...input };
    const stale = baseVersion !== null && baseVersion !== current.version;
    if (stale) {
      for (const field of TEXT_FIELDS) {
        if (values[field] !== undefined && typeof base[field] === 'string') {
          const result = merge3(base[field], values[field], current[field]);
          if (result !== values[field]) merged = true;
          values[field] = result;
        }
      }
    }

    const sets = [];
    const params = [noteId, user.id, current.version];
    const add = (column, value) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    for (const [key, column] of [['title', 'title'], ['content', 'content'], ['tags', 'tags'], ['pinned', 'pinned']]) {
      if (values[key] !== undefined) add(column, values[key]);
    }
    if (folderId !== undefined) add('folder_id', folderId);
    if (workspaceId !== undefined) add('workspace_id', workspaceId);
    if (!sets.length) break;

    // Only write if nobody saved since we read the note; otherwise merge again.
    const updated = await sql(
      `UPDATE notes SET ${sets.join(', ')}, version = version + 1, updated_by = $2, updated_at = now()
        WHERE id = $1 AND version = $3 RETURNING id`,
      params,
    );
    if (updated.length) break;
    if (attempt === MAX_ATTEMPTS) throw new HttpError(409, 'The note is busy. Please try again.');
  }

  const row = await loadNote(sql, user.id, noteId);
  send(res, 200, { note: toNote(row), merged });
}

// Marks the user as present in a note and returns the latest note plus who else is in it.
async function heartbeat(req, res, { id }) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const sql = db();
  const noteId = uuid(id, 'Note');
  const row = await loadNote(sql, user.id, noteId);
  if (row.deleted_at) throw new HttpError(404, 'Note not found');

  const field = body.field === 'title' ? 'title' : 'content';
  const line = Number.isInteger(body.line) && body.line > 0 && body.line < 1000000 ? body.line : null;
  await sql(
    `INSERT INTO note_presence (note_id, user_id, editing, field, line, seen_at) VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (note_id, user_id) DO UPDATE
       SET editing = EXCLUDED.editing, field = EXCLUDED.field, line = EXCLUDED.line, seen_at = now()`,
    [noteId, user.id, Boolean(body.editing), field, line],
  );
  const viewers = await sql(
    `SELECT u.id, u.name, p.editing, p.field, p.line FROM note_presence p JOIN users u ON u.id = p.user_id
      WHERE p.note_id = $1 AND p.user_id <> $2 AND p.seen_at > now() - interval '6 seconds'
      ORDER BY u.name`,
    [noteId, user.id],
  );
  send(res, 200, { note: toNote(row), viewers });
}

async function leave(req, res, { id }) {
  const user = await requireUser(req);
  await db()('DELETE FROM note_presence WHERE note_id = $1 AND user_id = $2', [uuid(id, 'Note'), user.id]);
  send(res, 200, { ok: true });
}

// Owner: move to trash (or delete forever with ?permanent=1 once in trash).
// Anyone else: remove the note from their own list.
async function remove(req, res, { id }, query) {
  const user = await requireUser(req);
  const sql = db();
  const noteId = uuid(id, 'Note');
  const current = await loadNote(sql, user.id, noteId);

  if (current.access !== 'owner') {
    await sql('DELETE FROM note_shares WHERE note_id = $1 AND user_id = $2', [noteId, user.id]);
    return send(res, 200, { ok: true, left: true });
  }
  if (query.get('permanent') === '1') {
    if (!current.deleted_at) throw new HttpError(400, 'Move the note to trash first');
    await sql('DELETE FROM notes WHERE id = $1 AND owner_id = $2', [noteId, user.id]);
    return send(res, 200, { ok: true, deleted: true });
  }
  await sql(
    'UPDATE notes SET deleted_at = now(), updated_at = now(), version = version + 1 WHERE id = $1 AND owner_id = $2',
    [noteId, user.id],
  );
  send(res, 200, { ok: true, trashed: true });
}

async function restore(req, res, { id }) {
  const user = await requireUser(req);
  const sql = db();
  const noteId = uuid(id, 'Note');
  await sql(
    `UPDATE notes SET deleted_at = NULL, updated_at = now(), version = version + 1
      WHERE id = $1 AND owner_id = $2`,
    [noteId, user.id],
  );
  const row = await loadNote(sql, user.id, noteId);
  send(res, 200, { note: toNote(row) });
}

async function emptyTrash(req, res) {
  const user = await requireUser(req);
  await db()('DELETE FROM notes WHERE owner_id = $1 AND deleted_at IS NOT NULL', [user.id]);
  send(res, 200, { ok: true });
}

// --- per-note sharing ---

async function listShares(req, res, { id }) {
  const user = await requireUser(req);
  const sql = db();
  const noteId = uuid(id, 'Note');
  await loadNote(sql, user.id, noteId);
  const rows = await sql(
    `SELECT u.id, u.name, u.email, s.role FROM note_shares s JOIN users u ON u.id = s.user_id
      WHERE s.note_id = $1 ORDER BY s.created_at`,
    [noteId],
  );
  send(res, 200, { shares: rows });
}

async function addShare(req, res, { id }) {
  const user = await requireUser(req);
  const body = await readBody(req);
  const sql = db();
  const noteId = uuid(id, 'Note');
  const current = await loadNote(sql, user.id, noteId);
  if (current.access !== 'owner') throw new HttpError(403, 'Only the owner can share this note');

  const mail = email(body.email);
  const role = oneOf(body.role, ['editor', 'viewer'], 'editor', 'Role');
  const users = await sql('SELECT id, name, email FROM users WHERE email = $1', [mail]);
  const target = users[0];
  if (!target) throw new HttpError(404, 'No account uses that email');
  if (target.id === user.id) throw new HttpError(400, 'You already own this note');

  await sql(
    `INSERT INTO note_shares (note_id, user_id, role) VALUES ($1, $2, $3)
     ON CONFLICT (note_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
    [noteId, target.id, role],
  );
  send(res, 200, { share: { ...target, role } });
}

async function removeShare(req, res, { id, userId }) {
  const user = await requireUser(req);
  const sql = db();
  const noteId = uuid(id, 'Note');
  const targetId = uuid(userId, 'User');
  const current = await loadNote(sql, user.id, noteId);
  if (current.access !== 'owner' && targetId !== user.id) {
    throw new HttpError(403, 'Only the owner can remove people');
  }
  await sql('DELETE FROM note_shares WHERE note_id = $1 AND user_id = $2', [noteId, targetId]);
  send(res, 200, { ok: true });
}

module.exports = { get, create, update, heartbeat, leave, remove, restore, emptyTrash, listShares, addShare, removeShare };
