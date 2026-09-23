# Property Record

Phase 1 of an owner-led residential property planning and construction platform. This is a working persisted foundation: accounts, property projects, ownership, access control, version history, and a private storage boundary. Later product phases are intentionally absent.

## Run locally

Requirements: Node.js 22.12 or newer, npm, and Docker Desktop (or an existing PostgreSQL 17 database).

```sh
npm ci
cp .env.example .env
node -e 'console.log(require("node:crypto").randomBytes(48).toString("base64url"))'
```

Paste the generated value into `BETTER_AUTH_SECRET` in `.env`. Do not commit `.env`. Then:

```sh
npm run db:up
npm run db:migrate
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), create an account, and create your first property project. No seeded login or external service is needed. PostgreSQL is bound to loopback port 54329. Data persists in a named Docker volume; `npm run db:stop` stops the container without deleting data.

The app uses a root `.env`, loaded by `apps/web/scripts/next.mjs`. Existing environment variables take precedence. Storage paths in that launcher are resolved from the repository root. `.env.example` uses `.data/objects`; storage is not exposed publicly. Changing the runtime configuration requires restarting the app.

## Validate

Create the separate local test database once:

```sh
docker compose exec -T postgres createdb -U property property_test
npm run typecheck
npm run lint
npm test
npm run test:integration
npm run build
```

`npm run check` runs the complete sequence. Typechecking regenerates Next.js route types and the ignored `next-env.d.ts`, so a clean checkout needs no prior development server or build. Integration tests require `TEST_DATABASE_URL`, refuse database names not ending in `_test`, and create/drop a unique test schema. They use real PostgreSQL and real authentication; no SQLite, mocked database, or UI-only test substitute. Production builds do not need application credentials or a live database. The CI workflow provisions PostgreSQL and runs the same checks.

If a sandboxed Turbopack build is interrupted by a local-worker permission error, run the build in an environment permitting worker processes. Clear only the generated `apps/web/.next/cache/turbopack` directory if it retains the failed task. Do not delete data volumes to fix a build.

## Workspace

| Module | Owns |
| --- | --- |
| `apps/web` | Next.js UI, HTTP handlers, session adapter composition |
| `packages/domain` | Canonical schemas, permissions, errors, auth/storage/job ports |
| `packages/services` | Project use cases, explicit response projection, transaction/repository ports |
| `packages/database` | PostgreSQL adapters, SQL migrations, append-only history/audit constraints |
| `packages/infrastructure` | Better Auth adapter, environment validation, private local object storage |
| `tests` | Domain, storage, HTTP boundary, and PostgreSQL/auth integration tests |

[Architecture and decisions](docs/architecture.md) · [API contract](docs/api.md) · [Phase 1 completion and limitations](docs/phase-1.md)

## Deployment boundary

`npm run build` creates the production bundle; `npm start` runs it. At runtime, provide `DATABASE_URL`, a random `BETTER_AUTH_SECRET`, and an HTTPS `APP_URL`. Apply migrations separately, before starting the application. The app never migrates a production database automatically.

Place the origin behind a trusted HTTPS proxy. It must overwrite `AUTH_IP_HEADER` (default `x-real-ip`) with the actual client IP and prevent direct origin access. Production auth requests fail closed when that header is absent. Forwarded headers from an untrusted client are not proof of IP identity. Do not use development mode, local Compose credentials, or a publicly reachable development server for real users.

Use separate migration and runtime database roles. Runtime needs schema usage and read/write permissions appropriate to the tables, without DDL, superuser, or trigger-disable privileges. Back up PostgreSQL and protect its auth session table, which contains bearer secrets managed by the auth provider. Local file storage is for development; replace it with a private object-storage adapter before multiple application instances or actual uploads. Email verification/recovery, managed infrastructure, observability, retention, and load/security validation remain explicit launch work; see the limitations document.
# pre-build
