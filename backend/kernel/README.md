# kernel

Domain-free shared code used by every module. This directory is intentionally
empty of business logic.

## Rules

- `backend/kernel/*` must not import from `backend/app/*` or `backend/modules/*`
  (enforced by `bun run arch:lint`).
- Only generic concerns belong here: configuration loading, structured logging,
  HTTP response/error helpers, SQLite connection factory, in-process event bus,
  auth middleware primitives (password hashing, session tokens).

## Planned files

| File | Responsibility |
|------|----------------|
| `config.ts` | Env parsing with typed defaults (`PORT`, `DATA_DIR`, `BROKER_HOST`, ...) |
| `logger.ts` | Structured logger with module name and level |
| `http.ts` | `jsonResponse`, CORS helpers, shared error envelope |
| `db.ts` | SQLite factory (`openDb(path)`, WAL pragma, schema helper) |
| `events.ts` | Typed in-process pub/sub for cross-module events |
| `auth.ts` | `Bun.password` hashing/verify, session token issue/validate |
