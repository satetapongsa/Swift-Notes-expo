const crypto = require('crypto');
const { db } = require('../db');
const { requireUser } = require('../auth');
const { NOTE_SELECT, toNote } = require('../access');
const { send } = require('../http');
const folders = require('./folders');
const workspaces = require('./workspaces');

// Everything the app needs in one call. The client polls this every few seconds;
// when nothing changed it gets back { unchanged: true } instead of the full data.
async function sync(req, res, _params, query) {
  const user = await requireUser(req);
  const sql = db();
  const [noteRows, folderList, workspaceList] = await Promise.all([
    sql(`${NOTE_SELECT} ORDER BY x.pinned DESC, x.updated_at DESC`, [user.id]),
    folders.listFor(sql, user.id),
    workspaces.listFor(sql, user.id),
  ]);
  const notes = noteRows.map(toNote);
  const data = { notes, folders: folderList, workspaces: workspaceList };
  const cursor = crypto.createHash('sha1').update(JSON.stringify(data)).digest('hex');

  if (query.get('cursor') === cursor) return send(res, 200, { unchanged: true, cursor });
  send(res, 200, { ...data, cursor });
}

module.exports = { sync };
