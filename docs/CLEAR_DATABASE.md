# Clear the `openmuse` PostgreSQL database

Connection string: `postgres://openmuse:openmuse@127.0.0.1:54329/openmuse`

## Prerequisites

- `psql` client installed (part of PostgreSQL)
- Database server running on `127.0.0.1:54329`
- User `openmuse` with password `openmuse` has permission to drop/create or truncate tables

## Option 1: Drop and recreate the database (cleanest)

Connect to the default `postgres` database, then drop and recreate `openmuse`:

```powershell
# Connect to the postgres maintenance database
psql "postgres://openmuse:openmuse@127.0.0.1:54329/postgres"

-- Terminate existing connections to openmuse
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = 'openmuse' AND pid <> pg_backend_pid();

-- Drop and recreate
DROP DATABASE IF EXISTS openmuse;
CREATE DATABASE openmuse OWNER openmuse;

\q
```

Reconnect to the fresh `openmuse` database if needed:

```powershell
psql "postgres://openmuse:openmuse@127.0.0.1:54329/openmuse"
```

## Option 2: Truncate all tables (keeps the database)

If you cannot drop the database, truncate every table instead:

```powershell
psql "postgres://openmuse:openmuse@127.0.0.1:54329/openmuse"
```

```sql
-- Disable triggers to avoid FK issues during truncation
SET session_replication_role = replica;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN (
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
  ) LOOP
    EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' CASCADE';
  END LOOP;
END $$;

SET session_replication_role = DEFAULT;
```

Verify tables are empty:

```sql
SELECT schemaname, tablename, n_tup_ins, n_tup_del
FROM pg_stat_user_tables
WHERE schemaname = 'public';
```

## Option 3: One-liner to drop and recreate from PowerShell

```powershell
$conn = "postgres://openmuse:openmuse@127.0.0.1:54329/postgres"
psql $conn -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='openmuse' AND pid <> pg_backend_pid();"
psql $conn -c "DROP DATABASE IF EXISTS openmuse;"
psql $conn -c "CREATE DATABASE openmuse OWNER openmuse;"
```

## Safety

- This permanently deletes all data in the `openmuse` database.
- Back up first if the data matters:

```powershell
pg_dump "postgres://openmuse:openmuse@127.0.0.1:54329/openmuse" > openmuse_backup_$(Get-Date -Format "yyyyMMdd_HHmmss").sql
```
