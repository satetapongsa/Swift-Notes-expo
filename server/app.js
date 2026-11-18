const { HttpError, send, checkOrigin } = require('./http');
const auth = require('./routes/auth');
const notes = require('./routes/notes');
const folders = require('./routes/folders');
const workspaces = require('./routes/workspaces');
const { sync } = require('./routes/sync');
const ai = require('./routes/ai');
const attachments = require('./routes/attachments');
const profile = require('./routes/profile');

// [method, pattern, handler]. ":name" segments become params.
const routes = [
  ['POST', 'auth/register', auth.register],
  ['POST', 'auth/login', auth.login],
  ['POST', 'auth/logout', auth.logout],
  ['GET', 'auth/me', auth.me],
  ['PATCH', 'auth/me', profile.update],
  ['POST', 'auth/me/avatar', profile.uploadAvatar],
  ['DELETE', 'auth/me/avatar', profile.removeAvatar],
  ['GET', 'users/:id/avatar', profile.avatar],

  ['GET', 'sync', sync],

  ['POST', 'notes', notes.create],
  ['GET', 'notes/:id', notes.get],
  ['PATCH', 'notes/:id', notes.update],
  ['DELETE', 'notes/:id', notes.remove],
  ['POST', 'notes/:id/restore', notes.restore],
  ['POST', 'notes/:id/presence', notes.heartbeat],
  ['DELETE', 'notes/:id/presence', notes.leave],
  ['POST', 'notes/:id/summary', ai.summarize],
  ['GET', 'notes/:id/attachments', attachments.list],
  ['POST', 'notes/:id/attachments', attachments.upload],
  ['GET', 'attachments/:attachmentId', attachments.download],
  ['DELETE', 'attachments/:attachmentId', attachments.remove],
  ['GET', 'notes/:id/shares', notes.listShares],
  ['POST', 'notes/:id/shares', notes.addShare],
  ['DELETE', 'notes/:id/shares/:userId', notes.removeShare],
  ['DELETE', 'trash', notes.emptyTrash],

  ['POST', 'folders', folders.create],
  ['DELETE', 'folders/:id', folders.remove],

  ['POST', 'workspaces', workspaces.create],
  ['PATCH', 'workspaces/:id', workspaces.update],
  ['DELETE', 'workspaces/:id', workspaces.remove],
  ['POST', 'workspaces/:id/members', workspaces.addMember],
  ['DELETE', 'workspaces/:id/members/:userId', workspaces.removeMember],
];

function match(method, path) {
  const parts = path.split('/').filter(Boolean);
  let pathMatched = false;
  for (const [m, pattern, handler] of routes) {
    const pp = pattern.split('/');
    if (pp.length !== parts.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < pp.length; i++) {
      if (pp[i].startsWith(':')) params[pp[i].slice(1)] = parts[i];
      else if (pp[i] !== parts[i]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    pathMatched = true;
    if (m === method) return { handler, params };
  }
  return pathMatched ? { notAllowed: true } : null;
}

async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    // Vercel rewrites /api/<path> to /api/router?__path=<path>.
    const path = url.searchParams.get('__path') || url.pathname.replace(/^\/api\/?/, '');
    url.searchParams.delete('__path');

    checkOrigin(req);
    const found = match(req.method, path);
    if (!found) throw new HttpError(404, 'Not found');
    if (found.notAllowed) throw new HttpError(405, 'Method not allowed');
    await found.handler(req, res, found.params, url.searchParams);
  } catch (err) {
    if (err instanceof HttpError) {
      send(res, err.status, { error: err.message });
    } else {
      console.error(err);
      send(res, 500, { error: 'Something went wrong. Please try again.' });
    }
  }
}

module.exports = { handle };
