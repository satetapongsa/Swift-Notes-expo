# Swift Notes

A collaborative note-taking app built with React Native and Expo, running as a responsive web app on Vercel with a Neon Postgres backend. Write notes, share them by email, and edit them together with changes syncing live across devices.

**Live demo:** [swift-notes-expo.vercel.app](https://swift-notes-expo.vercel.app)

---

## Features

- **Accounts** – sign up and sign in with email and password; sessions persist across reloads.
- **Private by default** – every note belongs to its author and is invisible to everyone else until shared.
- **Sharing** – share a single note with another account by email, as *Can edit* or *Can view*.
- **Workspaces** – group notes into a shared space and invite members by email.
- **Live collaboration** – edits from other people appear within about two seconds. When two people change the same note at once, their edits are merged instead of overwritten.
- **Presence** – see who else has a note open and who is typing right now.
- **Pins, tags and folders** – pin notes to the top, tag them, move them between folders, and filter the dashboard by pin or tag.
- **Trash** – restore deleted notes, delete a single note forever, or empty the trash.
- **Responsive layout** – bottom tabs on phones, an icon rail on tablets and a labelled side rail with a multi-column grid on desktop. Every screen and feature is the same at every size.
- **Dark mode** – switch themes from Settings.

## Tech stack

| Layer | Technology |
| --- | --- |
| App | React Native 0.84, Expo 55, React Navigation 7, react-native-web |
| API | Node.js serverless function on Vercel (`api/router.js`) |
| Database | Neon Postgres via `@neondatabase/serverless` |
| Auth | bcrypt password hashing, server-side sessions in HttpOnly cookies |
| Hosting | Vercel (static web build + one serverless function) |

## Architecture

```
Browser (Expo web build)
   │  fetch /api/*  (session cookie, same origin)
   ▼
Vercel function  api/router.js
   │  routing, validation, auth, permission checks  (server/)
   ▼
Neon Postgres  (users, sessions, notes, note_shares, folders, workspaces, …)
```

All `/api/*` requests go through a single serverless function, which keeps the deployment within the Hobby plan's function limit. Routes live in `server/routes/`; access rules for notes are defined once in `server/access.js`.

## Getting started

### Prerequisites

- Node.js 22.11 or newer
- A [Neon](https://neon.tech) Postgres database

### 1. Install

```bash
git clone https://github.com/satetapongsa/Swift-Notes-expo.git
cd Swift-Notes-expo
npm install
```

### 2. Configure the database

Copy the example environment file and set your Neon connection string:

```bash
cp .env.example .env
```

```env
DATABASE_URL=postgresql://USER:PASSWORD@HOST/neondb?sslmode=require
```

`.env` is git-ignored. Never commit real credentials.

### 3. Create the tables

```bash
npm run db:migrate
```

The schema lives in [`db/schema.sql`](db/schema.sql) and is safe to run more than once.

### 4. Run locally

```bash
npm run build
npm run serve
```

Open [http://localhost:3000](http://localhost:3000). The local server serves the web build and the API together, the same way Vercel does.

## Deploying to Vercel

1. Import the GitHub repository in Vercel.
2. In **Settings → Environment Variables**, add `DATABASE_URL` for all environments.
3. Deploy. Build settings come from [`vercel.json`](vercel.json): `npm run build` outputs the web app to `dist/`, and `api/router.js` is deployed as the API.

Each push to `main` triggers a new deployment.

## Scripts

| Command | Description |
| --- | --- |
| `npm run build` | Export the web app to `dist/` |
| `npm run serve` | Serve `dist/` and the API on port 3000 |
| `npm run db:migrate` | Apply `db/schema.sql` to `DATABASE_URL` |
| `npm start` | Start the Expo dev server (native development) |
| `npm run lint` | Run ESLint |
| `npm test` | Run Jest |

## API

All endpoints are under `/api` and exchange JSON. Every endpoint except the auth routes requires a signed-in session.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/auth/register` | Create an account and sign in |
| `POST` | `/auth/login` | Sign in |
| `POST` | `/auth/logout` | Sign out and revoke the session |
| `GET` | `/auth/me` | Current user, or `null` |
| `GET` | `/sync` | Notes, folders and workspaces visible to the user |
| `POST` | `/notes` | Create a note |
| `GET` / `PATCH` / `DELETE` | `/notes/:id` | Read, update or trash a note |
| `POST` | `/notes/:id/restore` | Restore from trash |
| `POST` / `DELETE` | `/notes/:id/presence` | Report or clear "I have this note open" and get who else is in it |
| `GET` / `POST` | `/notes/:id/shares` | List or add people on a note |
| `DELETE` | `/notes/:id/shares/:userId` | Remove someone from a note |
| `DELETE` | `/trash` | Empty the trash |
| `POST` / `DELETE` | `/folders`, `/folders/:id` | Create or delete a folder |
| `POST` / `PATCH` / `DELETE` | `/workspaces`, `/workspaces/:id` | Manage workspaces |
| `POST` / `DELETE` | `/workspaces/:id/members[/:userId]` | Invite or remove members |

## Security

- Passwords are hashed with bcrypt (cost 12); plain-text passwords are never stored or logged.
- Sessions use a random 256-bit token in an `HttpOnly`, `SameSite=Lax`, `Secure` cookie. Only its SHA-256 hash is stored, and sessions can be revoked server-side.
- Failed sign-ins are limited to 5 per email and 20 per IP address every 15 minutes, and sign-ups are rate-limited per IP.
- Cross-site writes are rejected by checking the request `Origin`.
- Every query is parameterized, and every route checks ownership, share role or workspace membership before reading or writing.
- Inputs are validated for type and length on the server.
- Responses are sent with `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` and HSTS headers.
- No secrets are bundled into the client; configuration is read from environment variables on the server.

## How live sync works

Vercel functions can't hold WebSocket connections, so live updates use short polling:

- Edits are saved 600 ms after the last keystroke. Each save carries the version it was based on.
- If someone else saved in between, the server runs a three-way merge (`shared/merge.js`, built on diff-match-patch) between the common base, your text and theirs, so both sets of changes are kept. The write only succeeds if the version is still current; otherwise it merges again.
- An open note sends a presence heartbeat every 2 seconds. The response carries the latest version and the people currently in the note. Remote changes are applied once you've stopped typing for 1.5 seconds, and anything you typed meanwhile is merged on top.
- The note list, folders and workspaces refresh every 3 seconds. The server returns `unchanged` when nothing has changed, so idle polling stays cheap.

Merging works line and phrase-wise. If two people rewrite the exact same words at the same moment, the result can contain both versions side by side for one of them to tidy up.

## Project structure

```
api/router.js        Vercel entry point for every /api route
server/              API: routing, auth, validation, access rules, route handlers
db/schema.sql        Database schema
scripts/             Migration script and local web + API server
shared/merge.js      Three-way text merge used by the API and the app
src/
  config/features.js Flags for features that exist in code but are hidden until finished
  context/           Auth and notes state (sync, sharing, workspaces)
  lib/               API client, responsive layout helpers, dialogs
  navigation/        Stack and tab navigation
  screens/           App screens
  components/        Shared UI components
  theme/             Colors, typography and theme provider
```

## Roadmap

These features already have screens in the code but are hidden from the app until they work end to end. Each one is switched by a flag in [`src/config/features.js`](src/config/features.js).

| Flag | Feature | What is missing |
| --- | --- | --- |
| `aiAssistant` | AI summary and AI assistant in the editor | Answers are mocked; needs a server-side model call |
| `appLock` | Passcode lock and Face ID | Settings are not saved and nothing is locked yet |
| `notifications` | Notification settings and inbox | Shows sample data only |
| `profileEditing` | Edit name and email | No screen yet |
| `securityCenter` | Security overview | No screen yet |
| `workspaceLinkSharing` | Join a workspace by link | No join flow on the server |
| `workspaceInvites` | Accept or decline invitations | Members are added directly by email for now |
| `helpCenter` | Help & Support | Not written yet |

Also planned:

- Password reset and email verification
- Sharing notes by public link
- Real-time transport over WebSockets instead of polling

---

Built by [satetapongsa](https://github.com/satetapongsa).
