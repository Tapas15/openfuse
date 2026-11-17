# Database setup

OpenFuse stores application data in either embedded **PGlite** (default) or an external **PostgreSQL** database. The choice is made at startup in `apps/server/src/db.ts` and `apps/server/src/config.ts`.

## How the database is selected

- **`DATABASE_URL` is set** → the server connects with `pg` (`Pool`) to that PostgreSQL URL.
- **`DATABASE_URL` is not set** → the server uses embedded PGlite stored under `<DATA_DIR>/postgres`.
- **`DATA_DIR`** defaults to `.openfuse` (or `.openmuse` for legacy installs), so the default embedded path is `.openfuse/postgres`.

There is no automatic fallback: if `DATABASE_URL` is configured but unreachable, startup/requests will fail.

## Option 1: Embedded PGlite (default, local dev)

Use this when you want local storage without running Postgres/Docker.

1. In `.env`, remove or comment out `DATABASE_URL`:
   ```env
   # DATABASE_URL=postgres://user:password@host:port/dbname
   ```
2. (Optional) set `DATA_DIR` if you want data stored somewhere other than `.openfuse`.
3. Restart the API/server so it reloads `.env`.
4. Verify:
   ```powershell
   python run.py --check-db
   ```
   Expected: `DATABASE_URL: not set -> using embedded PGlite ...`

**Notes**
- Data lives in `.openfuse/postgres` (keep `.openfuse/` private/back it up as needed).
- PGlite cannot be opened by separate processes. If you run a separate task worker (`pnpm dev:worker` / `TASK_WORKER_ENABLED=false` on the API), use PostgreSQL with a shared `DATABASE_URL`, secrets, and `DATA_DIR` for files.
- If local embedded data becomes corrupted (dev only), you can reset it per `run.py` hints (e.g. `RESET_LOCAL_DB=1` flow) after stopping the server.

## Option 2: External PostgreSQL

Use this for a shared/external database or when running API and worker as separate processes.

1. Provision a reachable PostgreSQL instance and database.
2. Set `DATABASE_URL` in `.env` (or environment):
   ```env
   DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/DBNAME
   # example: DATABASE_URL=postgres://openmuse:openmuse@127.0.0.1:5432/openfuse
   ```
3. Ensure all processes that need the DB use the same `DATABASE_URL` (and same secrets/shared `DATA_DIR` for file storage when using a separate worker).
4. Restart the server and verify connectivity:
   ```powershell
   python run.py --check-db
   ```

### Example: local Docker Postgres

This repo does not include a Postgres compose service. Create one manually if needed:

```powershell
docker run -d --name openmuse-dev-db `
  -e POSTGRES_USER=openmuse -e POSTGRES_PASSWORD=openmuse -e POSTGRES_DB=openfuse `
  -p 127.0.0.1:5432:5432 postgres:16
```

Then set:
```env
DATABASE_URL=postgres://openmuse:openmuse@127.0.0.1:5432/openfuse
```

> `run.py --check-db` prints extra hints when the URL/port looks like the common local dev setup (e.g. port `54329` or `openmuse`) and checks for a Docker container named `openmuse-dev-db`. That container name/port is a local convention, not defined in `infra/compose.yaml`.

## Windows: port bind / "ports are not available"

If Docker fails with `ports are not available ... bind: An attempt was made to access a socket in a way forbidden by its access permissions` for a host port (e.g. `54329`), the port may be in a Windows/Hyper-V excluded range or blocked.

**Options:**
- **Use embedded PGlite:** unset `DATABASE_URL` (recommended if you don’t need external Postgres).
- **Use a different host port:** e.g. map `127.0.0.1:15432:5432` and update `DATABASE_URL` to use `15432`.
- **Inspect reservations (PowerShell):**
  ```powershell
  netsh interface ipv4 show excludedportrange protocol=tcp
  Get-NetTCPConnection -LocalPort 54329 -ErrorAction SilentlyContinue
  ```
  Resolving excluded ranges may require Admin actions (e.g. restarting `winnat` / adjusting ranges); VPN/WSL/Hyper-V can re-reserve ports.

## Troubleshooting

- **`DATABASE_URL: set (...) -> NOT reachable`:** start Postgres, fix host/port/credentials, or switch to PGlite by unsetting `DATABASE_URL`.
- **Fetch/API errors after DB change:** restart the server so config is reloaded from `.env`.
- **Separate worker with PGlite:** not supported; configure `DATABASE_URL` to a Postgres instance reachable by both API and worker.
- **Health/quick check:** `python run.py --check-db` and `GET /api/health` (see README).
