# Guide to Use (OpenFuse)

All commands below assume you are in the repo root unless stated otherwise:

`C:\Users\Tapas\Documents\open_muse_test\openfuse_2026\openfuse`

## Prerequisites
- Node.js (see `engines`/workspace requirements in repo; typically Node 20+)
- pnpm (repo uses pnpm workspaces)
- Python 3 (for `run.py` / `stop.py`)
- Optional: `OPENAI_API_KEY` (or configure models via your setup) for chat model usage

## Install dependencies (full workspace)
```bash
pnpm install
```
If you hit lockfile issues in CI-like installs, `run.py` uses `pnpm install --frozen-lockfile`.

## Run everything (recommended)
From repo root:
```bash
python run.py
```
What it does (high level):
- Installs deps if needed (frozen lockfile in script flow)
- Starts server and mobile (Expo) processes

Stop:
```bash
python stop.py
```

## Run services manually (alternative)

### Server
```bash
cd apps/server
pnpm install
pnpm run dev
```
Server env/config: see `apps/server/.env.example` (copy to `.env` as needed). Common vars include ports/URLs and any model/API keys your setup requires.

### Mobile (Expo)
```bash
cd apps/mobile
pnpm install
pnpm run start
```
Then follow Expo prompts (Android/iOS/web). Ensure `apps/mobile/.env` / config points to your local server if required.

## Type checks
From repo root (workspace):
```bash
pnpm -r run typecheck
```
Or server only:
```bash
cd apps/server
npx tsc --noEmit
```
Mobile (if script exists):
```bash
cd apps/mobile
pnpm run typecheck
```

## Database (local/dev notes)
- Docs: `docs/DATABASE.md`, `docs/CLEAR_DATABASE.md`
- Typical local data lives under server data dirs as described in those docs (clear/reset steps are documented there). Always back up if unsure.

## Useful API notes (relevant to this repo)
- Files/chat uploads: server accepts common doc/image types (see app/routes and `apps/server/src/files.ts`).
- Images (agent avatar upload helpers): `POST /api/images`, `POST /api/images/from-url`, `GET /api/images/:id/content` (auth as implemented).
- Identity (agent name/avatar/pov etc.): `GET /api/identity`, `POST /api/identity`.

## Chat commands (agent identity)
In chat (server-side handling):
- Set name (examples the assistant understands):
  - `set my name to Alice`
  - `my name is Alice`
  - `change your name to Alice`
- Set avatar by URL/reference (stored as the `avatar` string):
  - `/avatar https://example.com/pic.png`
  - `set your avatar to https://example.com/pic.png`
- Device image uploads: use the app UI (chat ⚙ / Apps → Personality & memory) to upload via image endpoints, then apply the returned URL/reference if needed.

## Git / push policy (important)
- Do **not** push without explicit user permission.
- Always ask before pushing; only push if the user says **`push now`** (each time).

## Common troubleshooting
- If ports are busy, stop with `python stop.py` or end the Node/Python processes, then rerun.
- If mobile can’t reach server, verify server URL in mobile env/config and that server is running.
- After dependency changes: rerun `pnpm install` at root.

## Quick command checklist
```bash
# install
pnpm install

# run (all)
python run.py

# stop
python stop.py

# typecheck all workspaces (if configured)
pnpm -r run typecheck

# server only typecheck
cd apps/server && npx tsc --noEmit
```