-- Swift Notes database schema (PostgreSQL / Neon)
-- Safe to run more than once.

CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         citext NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Server-side sessions. Only a SHA-256 hash of the token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

-- Failed login attempts, used for rate limiting.
CREATE TABLE IF NOT EXISTS login_attempts (
  id          bigserial PRIMARY KEY,
  email       citext NOT NULL,
  ip          text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_email_idx ON login_attempts(email, created_at);
CREATE INDEX IF NOT EXISTS login_attempts_ip_idx ON login_attempts(ip, created_at);

CREATE TABLE IF NOT EXISTS folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  icon_name   text NOT NULL DEFAULT 'folder',
  color       text NOT NULL DEFAULT '#007AFF',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folders_user_idx ON folders(user_id);

CREATE TABLE IF NOT EXISTS workspaces (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,
  icon_name   text NOT NULL DEFAULT 'rocket',
  color       text NOT NULL DEFAULT '#007AFF',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX IF NOT EXISTS workspace_members_user_idx ON workspace_members(user_id);

CREATE TABLE IF NOT EXISTS notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder_id    uuid REFERENCES folders(id) ON DELETE SET NULL,
  workspace_id uuid REFERENCES workspaces(id) ON DELETE SET NULL,
  title        text NOT NULL DEFAULT '',
  content      text NOT NULL DEFAULT '',
  tags         text[] NOT NULL DEFAULT '{}',
  pinned       boolean NOT NULL DEFAULT false,
  version      integer NOT NULL DEFAULT 1,
  updated_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at   timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notes_owner_idx ON notes(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS notes_workspace_idx ON notes(workspace_id);

-- Per-note sharing with another account.
CREATE TABLE IF NOT EXISTS note_shares (
  note_id     uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('editor', 'viewer')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id)
);
CREATE INDEX IF NOT EXISTS note_shares_user_idx ON note_shares(user_id);

-- Who has a note open right now (refreshed by the editor every few seconds).
CREATE TABLE IF NOT EXISTS note_presence (
  note_id     uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  editing     boolean NOT NULL DEFAULT false,
  seen_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, user_id)
);

-- AI requests per user, used for rate limiting.
CREATE TABLE IF NOT EXISTS ai_requests (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_requests_user_idx ON ai_requests(user_id, created_at);

-- Where each person is typing (shown as a name tag in the editor).
ALTER TABLE note_presence ADD COLUMN IF NOT EXISTS field text;
ALTER TABLE note_presence ADD COLUMN IF NOT EXISTS line integer;

-- Files attached to notes (small files only; stored in the database).
CREATE TABLE IF NOT EXISTS note_attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  note_id      uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  uploaded_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  name         text NOT NULL,
  mime         text NOT NULL,
  size         integer NOT NULL,
  data         bytea NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS note_attachments_note_idx ON note_attachments(note_id);

-- Profile photo (optional; users start without one).
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_data bytea;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_mime text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_updated_at timestamptz;
