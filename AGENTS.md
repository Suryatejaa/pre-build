# Repository rules

Read `docs/architecture.md` and `docs/phase-1.md` before changing boundaries.

- Only implement the phase authorized by the user. Phase 1 is the current baseline.
- Preserve `Plan.md`; it is the original roadmap, not an instruction to implement all phases.
- The canonical identity is `property_projects.id`. Use UUIDs and version references, never names as identifiers.
- Keep business rules and authorization in `packages/domain` / `packages/services`; React only presents results and collects input.
- Project mutations must validate input, authorize the actor, and commit snapshots plus audit in one transaction.
- Do not expose complete internal snapshots through general project listings. Maintain the explicit summary projection.
- Never modify applied migrations. Add a migration and test against real PostgreSQL.
- Do not use development accounts or silent in-memory fallbacks in production. Keep secrets out of tracked files and logs.
- Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, and `npm run build` after meaningful changes.
- Integration tests require an explicit isolated database ending in `_test` and create their own disposable schema. Do not point them at development or production data.
- Do not implement AI, cost/compliance engines, deliverables, construction, or 3D without the relevant phase authorization.
