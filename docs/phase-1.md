# Phase 1 handover

## Implemented

- TypeScript/npm workspaces, strict checking, ESLint import boundaries, Next.js App Router, React and Tailwind.
- Real PostgreSQL persistence and reproducible transactional migrations, with checksums and advisory locking.
- Better Auth email/password registration, sign-in, logout and persistent sessions. Safe own-profile view. Domain-neutral authentication port.
- Canonical property identity, single immutable owner, project-scoped membership roles and centralized authorization.
- Create/list/view/rename/archive/restore project workflows. Independent residential houses are the only supported type.
- Immutable, attributable version snapshots with expected-revision conflict handling, plus transactional audit for project/access mutations.
- Owner-controlled access settings using existing account IDs. No contractor-specific workflow is implemented.
- Private local storage adapter and storage contract. Job/version-reference contracts only.
- Responsive account, project list, create/edit, version-history, and access pages, with loading/error/empty states.
- Unit and PostgreSQL/auth integration tests; repeatable CI checks.

## Modules added

`apps/web/src/app`: account/auth/workspace pages, API route adapters, styles and error/loading states.

`apps/web/src/components`: forms, brand, project navigation.

`apps/web/src/server`: composition, session projection, request guards, error mapping and testable API adapters.

`packages/domain/src`: canonical project schemas, stable references, permission matrix, domain errors and integration ports.

`packages/services/src`: project use cases and persistence contracts.

`packages/database`: SQL migration, migration runner, pool and repository/unit-of-work adapter.

`packages/infrastructure/src`: auth provider, environment validation and filesystem object adapter.

`tests`: domain/permission, private-storage, HTTP/config, and PostgreSQL/auth workflows.

Root workspace/tooling config, `.env.example`, Compose, lockfile, CI, repository instructions and architecture/API documentation. Original `Plan.md` preserved.

## Database tables

Auth: `user`, `account`, `session`, `verification`, `rateLimit`.

Application: `property_projects`, `project_versions`, `project_memberships`, `audit_events`.

Operations: `schema_migrations`.

No separate land/planning/budget/construction project copies exist. `verification` is part of the auth provider's core schema; its presence does not mean an email verification flow is configured.

## Validation

See `tests/` for executable evidence. Checks exercise validated input, permission matrices, path traversal/symlink/size protection, origin and body limits, configuration failure, actual cookie authentication, password hashing, session expiry/revocation, persistent rate limits, tenant isolation, transactional rollback, concurrent writes, history immutability, ownership constraints, scoped version reads, pagination and idempotent migrations. Integration tests use their own disposable PostgreSQL schema in an explicitly separate database.

The browser walkthrough uses a clearly named local validation account and project. These are manual test records, not seeded production data or a login bypass. They are kept separate from automated integration data and can remain for local review.

### Final audit — 24 September 2026

- The root `npm run check` covers typecheck, lint, unit tests, PostgreSQL/auth integration tests, and the production build. Final results: all passed; 16 unit tests across 3 files and 18 integration tests in 1 file, with no skipped tests in the successful run.
- PostgreSQL 17 was already running and healthy. The first sandboxed run could not connect to loopback PostgreSQL (`EPERM`); validation succeeded with local database access. No tests or isolation guards were weakened.
- Audited every project API operation for anonymous and unrelated-account access, project-scoped version lookup, role restrictions, revocation, stale writes, transactional audit, and SQL history/ownership constraints. No application or migration defect was found.
- Fixed one repository hygiene issue: generated `next-env.d.ts` is now ignored, and typecheck regenerates Next.js types. A clean source copy without `.next` or `next-env.d.ts` passed typecheck. A production build with `DATABASE_URL`, `BETTER_AUTH_SECRET`, and `APP_URL` explicitly empty also passed.
- Repeated the browser walkthrough at a 390 × 844 viewport: registration, project creation, rename, archive/restore, historical snapshot inspection, access settings, account details, logout, and protected-page redirection. The original snapshot remained intact; project and access pages had no horizontal overflow. This was a local development-browser check, not a physical-device or production-hosting test.
- Verified ignore rules for dependencies, builds, environment files, local objects, coverage, and TypeScript caches. The repository still has no initial commit; application sources are untracked, and `git diff` is therefore empty. No commit was created during the audit.
- Phase 1 scope and the original `Plan.md` are preserved. Phase 2 has since been implemented as an additive Land/Site extension; Phase 3 has not started.

## Known limitations and release gates

1. This completes a foundation with Land/Site intake, not a publicly launch-ready construction product. Interviews, building planning, room or floor-plan design, Vaasthu, cost/compliance analysis, payments, scheduling, and 3D capabilities are not implemented.
2. Email verification, password recovery, MFA, verified professional identities and invitations remain to be designed before public registration. Email is explicitly marked unverified and never used to grant access. Membership assignment uses an existing account ID.
3. Authentication throttling is persistent. Project/API abuse quotas, account lifecycle tooling, session/rate-limit cleanup, CSRF browser penetration testing, and broader load/security review remain hardening work. Deploy only behind the configured trusted HTTPS proxy.
4. Local storage is development-only. Land/Site has attachment metadata contracts, but no upload/download endpoint, content sniffing, scanning/quarantine, streaming transfer, private cloud storage, or signed URL workflow. No public upload control is exposed.
5. Job contracts have no queue/worker implementation because there is no Phase 1 consumer. A durable outbox, retries, cancellation, idempotent processing and payment gating are required before any paid/background generation.
6. Ownership transfer and destructive deletion are intentionally unsupported. Archive/restore preserves history. The access UI is a foundation, not the later contractor product.
7. Phase 1 V1 snapshots remain readable and unchanged; current Site data uses V2 snapshots. Site details and Site change notes are redacted from professional history. Further snapshot fields still require schema-version evolution and authorization review, especially for private owner or financial data.
8. PostgreSQL RLS, managed database backups/restore drills, runtime SQL-role provisioning, production secrets, TLS hosting, observability, retention/deletion policy and incident operations remain deployment work. Audit is transactional and append-only to application writes, not cryptographically tamper-evident.
9. Site supports deterministic rectangular and irregular polygon validation without PostGIS. PostGIS, full project approval, uploaded document artifacts, and event-driven notifications are not implemented; absent systems are not represented by fake adapters.
10. CI configuration is supplied but has only been exercised through its equivalent commands locally until the repository is pushed to a CI host.

## Phase 2 status — Land/Site intake

Phase 2 adds typed Site/Land facts and deterministic geometry analysis to the existing versioned project record. It supports rectangular and irregular boundaries, exact unit conversion, separate declared and calculated area, orientation, road relationships, owner-only editing, and private Site history redaction. V1 history remains unchanged and readable alongside V2 snapshots.

Attachment support is limited to metadata/contracts; secure file upload, scanning, and download remain deferred. Phase 3 has not started.
