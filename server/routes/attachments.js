const { db } = require('../db');
const { requireUser } = require('../auth');
const { NOTE_SELECT } = require('../access');
const { HttpError, send, readBody, str, uuid } = require('../http');

// Files are sent as base64 JSON. Vercel caps request bodies at 4.5 MB,
// and base64 adds about a third, so files are limited to 3 MB.
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const MAX_BODY_BYTES = 4.4 * 1024 * 1024;
const MAX_FILES_PER_NOTE = 20;

async function loadNote(sql, userId, noteId) {
  const rows = await sql(`${NOTE_SELECT} AND x.id = $2`, [userId, noteId]);
  if (!rows[0] || rows[0].deleted_at) throw new HttpError(404, 'Note not found');
  return rows[0];
}

function toAttachment(row) {
  return {
    id: row.id,
    name: row.name,
    mime: row.mime,
    size: row.size,
    uploadedBy: row.uploaded_by,
    uploadedByName: row.uploaded_by_name,
    createdAt: row.created_at,
  };
}

async function list(req, res, { id }) {
  const user = await requireUser(req);
  const sql = db();
  const noteId = uuid(id, 'Note');
  await loadNote(sql, user.id, noteId);
  const rows = await sql(
    `SELECT a.id, a.name, a.mime, a.size, a.uploaded_by, a.created_at, u.name AS uploaded_by_name
       FROM note_attachments a LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.note_id = $1 ORDER BY a.created_at`,
    [noteId],
  );
  send(res, 200, { attachments: rows.map(toAttachment) });
}

async function upload(req, res, { id }) {
  const user = await requireUser(req);
  const body = await readBody(req, { maxBytes: MAX_BODY_BYTES });
  const sql = db();
  const noteId = uuid(id, 'Note');
  const note = await loadNote(sql, user.id, noteId);
  if (note.access === 'viewer') throw new HttpError(403, 'You can only view this note');

  const name = str(body.name, 'File name', { min: 1, max: 200 }).replace(/[\\/\r\n"]/g, '_');
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(body.type || '') ? body.type : 'application/octet-stream';
  if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/=]+$/.test(body.data)) {
    throw new HttpError(400, 'File data is not valid');
  }
  const data = Buffer.from(body.data, 'base64');
  if (!data.length) throw new HttpError(400, 'The file is empty');
  if (data.length > MAX_FILE_BYTES) throw new HttpError(413, 'Files can be up to 3 MB');

  const [{ count }] = await sql('SELECT count(*)::int AS count FROM note_attachments WHERE note_id = $1', [noteId]);
  if (count >= MAX_FILES_PER_NOTE) throw new HttpError(400, `A note can have up to ${MAX_FILES_PER_NOTE} files`);

  const [row] = await sql(
    `INSERT INTO note_attachments (note_id, uploaded_by, name, mime, size, data)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, mime, size, uploaded_by, created_at`,
    [noteId, user.id, name, mime, data.length, data],
  );
  // Bump the note so other people's editors see the new file.
  await sql('UPDATE notes SET updated_at = now() WHERE id = $1', [noteId]);
  send(res, 201, { attachment: toAttachment({ ...row, uploaded_by_name: user.name }) });
}

async function download(req, res, { attachmentId }) {
  const user = await requireUser(req);
  const sql = db();
  const rows = await sql('SELECT note_id, name, mime, data FROM note_attachments WHERE id = $1', [
    uuid(attachmentId, 'File'),
  ]);
  const file = rows[0];
  if (!file) throw new HttpError(404, 'File not found');
  await loadNote(sql, user.id, file.note_id); // same access rules as the note

  // Always a download, never rendered inline, so an uploaded HTML/SVG file can't run in our origin.
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`);
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(file.data);
}

async function remove(req, res, { attachmentId }) {
  const user = await requireUser(req);
  const sql = db();
  const rows = await sql('SELECT note_id, uploaded_by FROM note_attachments WHERE id = $1', [
    uuid(attachmentId, 'File'),
  ]);
  const file = rows[0];
  if (!file) throw new HttpError(404, 'File not found');
  const note = await loadNote(sql, user.id, file.note_id);
  if (note.access !== 'owner' && file.uploaded_by !== user.id) {
    throw new HttpError(403, 'Only the note owner or the uploader can remove this file');
  }
  await sql('DELETE FROM note_attachments WHERE id = $1', [attachmentId]);
  await sql('UPDATE notes SET updated_at = now() WHERE id = $1', [file.note_id]);
  send(res, 200, { ok: true });
}

module.exports = { list, upload, download, remove };
