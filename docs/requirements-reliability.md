# Requirements Interview reliability and workspace correction

Verified on 26 September 2026. Scope: the existing Phase 3 interview. No Phase 4 work, commit, push, staging, history rewrite, or migration change.

## Original failure and timeout correction

Stored request diagnostics showed the simple message completed through `sarvam / sarvam-105b` in 7,008 ms. The richer message and its retry failed in 20,009 ms and 20,007 ms respectively, with provider-attempt durations of 20,007 ms and 20,003 ms. Both recorded `TIMEOUT`, no token usage, no completed structured response, and zero repairs. These failures occurred at the complete-request deadline, before structured validation, candidate merge, or deterministic conflict evaluation. They do not demonstrate a schema defect or a Sarvam outage. The historical records did not distinguish waiting for headers from reading the response body.

The default timeout is now 60,000 ms per attempt, still finite and abortable, including response-body reads. Existing explicit environment overrides are honored. A deterministic 35-second response demonstrates the old deadline failure and success under the corrected deadline; a hung response still fails at 60 seconds. Production permits three provider slots with at most one repair per provider: the maximum provider wait is six bounded attempts (360 seconds at the default). No transient retry loop or cycling was added.

## Merge and pipeline correction

Space identity matching previously used type and custom name only. It now also requires the same floor-scope kind and, when present, the same floor label ignoring case. Distinct ground-floor and first-floor bedrooms retain separate UUIDs. Replaying the rich response preserves those IDs; a later first-floor-only count change leaves the ground-floor bedroom and every unrelated space, including provenance, unchanged.

Strict extraction fields and PropertyRequirements validation remain authoritative. Cosmetic acknowledgement or question problems do not discard valid facts: the application generates safe acknowledgement text and deterministic follow-ups. There is no second prose-generation call in the interview use case. Invalid JSON/schema output retains one bounded repair and the configured fallback policy. Domain-invalid values fail outside the routing boundary; legitimate deterministic conflicts are recorded for review rather than sent to another provider.

Diagnostics distinguish provider request, response body, response envelope, JSON parse, extraction schema, candidate merge, domain validation, conflict evaluation, assistant text recovery, and persistence. Attempts retain safe HTTP status, schema paths/codes, provider/model, usage, latency and retry count. No raw rejected values, provider error bodies, credentials, or reasoning are added to logs or owner responses. The existing attempts JSONB column stores the additional diagnostic fields.

Follow-ups use the existing completeness rules and ask at most two questions, prioritizing structural requirements. Initially the brief asks about floors and spaces; after the rich regression it asks only whether the building is owner-only or includes rental use. Completeness, conflicts and approval rules were not changed.

## Exact deterministic regression result

Input:

> I want G+2. Ground floor should have parking for 2 cars, living room, kitchen, dining and one bedroom for my parents. First floor should have 3 bedrooms and a family lounge. Second floor should have a home office and open terrace. I may add a lift later. Vaasthu is important to me.

The deterministic injected provider supplies 13 structured facts. The real router, schema validation, service merge, domain validation and PostgreSQL persistence produce:

| Requirement | Validated candidate |
| --- | --- |
| Building scale | Exactly 3 total floors |
| Ground floor | 1 parking area, 1 living room, 1 kitchen, 1 dining space, 1 bedroom |
| Parents' bedroom | Ground-floor bedroom with existing `customName` field set to `Bedroom for parents` |
| Parking capacity | Exactly 2 cars; cover and EV charging remain unspecified |
| First floor | 3 bedrooms and 1 family lounge, separate from the ground-floor bedroom |
| Second floor | 1 home office and 1 terrace, labelled `Open terrace` |
| Future lift | Optional `LIFT_PROVISION` future-expansion requirement; no lift required now is invented |
| Vaasthu | `STRONG`, marked AI-interpreted with medium confidence; not `STRICT` |
| Other facts | Household/elderly counts, rental intent, measurements, parking cover and EV charging remain unspecified |

There are nine separate space records. Existing count, floor, description, priority and provenance fields are used. This is deterministic fixture verification, not a substantiated live-model extraction result.

## Workspace and browser verification

Desktop keeps conversation and brief side by side. The default right side is a concise review with a clear Review & edit brief action, progress, missing questions and conflicts. Optional recorded details remain reviewable. The full manual editor appears only in explicit edit mode. Entering it does not save. Save persists intended changes; Done exits unchanged drafts; Cancel protects dirty drafts with Keep editing / Discard changes choices. The conversation stays visible while editing.

Mobile uses accessible Conversation / Project Brief tabs. Keyboard navigation, draft preservation when switching tabs, editor focus, full-width readable inputs and reachable Save/Cancel controls were checked. A mobile flex sizing issue was corrected so Send is 45 px tall rather than an oversized vertical button.

Checks used an isolated `_test` database, synthetic owner/project and a local HTTP provider. No external LLM was used for browser verification.

| Check | 1365 × 900 | 390 × 844 |
| --- | --- | --- |
| Conversation and concise review | Two columns, editor absent by default | One visible tab panel at a time |
| Explicit editing | Passed; conversation remains visible | Passed; no clipped controls |
| Save | Household size 6 and owner-only intent persisted after reload | Reopened draft edit to household size 7 persisted |
| Cancel | Dirty value 8 was kept when requested, then discarded without persistence | Dirty value 7 survived tab switching, then was explicitly discarded back to saved value 6 |
| Composer | Usable; duplicate submissions disabled during processing | 312 × 120 px, 16 px text, 45 px Send button |
| Processing | Immediate owner message and processing state; brief/editor view available | Readable processing state; brief tab remains accessible |
| Failure | One recovery card, saved-message indication, Retry and manual editing | One readable recovery card; controls fit |
| Retry | Success clears recovery | Success clears recovery |
| Metadata | Small subordinate provider/model text | Small subordinate provider/model text |
| Horizontal overflow | Document width 1365 = viewport width | Document width 390 = viewport width; no clipped editor controls |

Two submitted owner messages remained exactly two persisted owner messages after their retries. The local 503 failures recorded `UNAVAILABLE`, HTTP 503 and `PROVIDER_REQUEST`; successful turns recorded all downstream pipeline stages. Recovery did not produce duplicate generic error messages.

Approval created project version 2. Controlled reopen created a new interview from that approved brief. A subsequent mobile edit changed only the new candidate; both existing project-version records compared unchanged against the pre-reopen snapshot. Canonical `RESIDENTIAL` context remained intact. The automated property-type suite continues to cover mismatches, legacy compatibility, authorization, and preservation of approved history.

## Validation

- Unit tests: **105 passed**, 11 files.
- PostgreSQL integration tests: **50 passed**, 4 files, explicit isolated database ending in `_test` with disposable schemas.
- Typecheck, lint and `git diff --check`: passed.
- Production build: passed with Next.js 16.3.5 Turbopack using the repository launcher and required process permissions. The worker-port restriction did not recur; no Webpack fallback was needed.
- All automated tests block default external fetch and use injected deterministic providers.
- Production browser JavaScript scan: 17 files checked; no local Sarvam credential, Sarvam key configuration identifier, fallback key configuration identifier, or subscription-key header identifier found.
- Migration status: no new or modified migration in this correction. All five migration files match the correction's starting tree, including pre-existing migration 005 from the provider implementation.

A new subsequent-turn assertion initially compared against the pre-retry provenance state. It was corrected to compare against the state immediately before the subsequent turn, retaining strict equality for the ground-floor bedroom and all unrelated spaces. The complete suite then passed.

## Live verification and limitations

One live Sarvam check had already run before this continuation. Its reporting script queried a nonexistent diagnostic column and cleaned up its temporary schema before retaining the result. The extraction result is **unsubstantiated**: neither success nor failure can be claimed. No additional Sarvam, OpenAI or external LLM call was made in this continuation.

The 60-second deadline improves tolerance for richer extraction but is not a provider latency guarantee. An explicit lower local timeout remains effective. Arbitrary floor-name aliases are not normalized by this correction; same-label case differences match, while different scope kinds/labels remain distinct. AI quality beyond the exact deterministic fixture is not established by these tests. The manual editor remains a long form when explicitly opened, with sticky Save/Cancel controls.

## Files changed by this correction

- `.env.example` — finite default timeout.
- `packages/domain/src/requirements-interview.ts` — safe pipeline diagnostic types only.
- `packages/services/src/requirements-ai.ts` — extraction/prose boundary, safe validation feedback and compact rich-message prompt.
- `packages/services/src/ai-router.ts` — timeout default and per-attempt stage/repair diagnostics.
- `packages/services/src/requirements-interviews.ts` — floor-aware merging, deterministic prose/questions and downstream diagnostics.
- `packages/infrastructure/src/requirements-ai.ts` — timeout and provider response-stage classification.
- `apps/web/src/server/container.ts` — safe internal diagnostic callback.
- `apps/web/src/components/requirements-workspace.tsx` — review/edit modes, tabs, draft protection and recovery/loading UI.
- `apps/web/src/app/globals.css` — Requirements-only responsive styling.
- `tests/requirements-rich-fixture.ts` — exact rich-message fixture.
- `tests/requirements-reliability.test.ts` — timeout, repair, strict extraction and cosmetic recovery regressions.
- `tests/requirements.integration.test.ts` — complete rich-message persistence, cross-floor retry/subsequent-update preservation and domain-failure coverage.
- `docs/phase-3.md` and this report — behavior, configuration and verification.

The working tree also contains the pre-existing provider implementation and the user's `forms.tsx` changes. Those were preserved. The correction is ready for review and commit, with the live-verification limitation above; nothing has been staged or committed.

## Final working-tree outputs

These include the preserved changes that existed before the correction. `git diff --stat` omits untracked files.

`git status --short`:

```text
 M .env.example
 M README.md
 M apps/web/src/app/globals.css
 M apps/web/src/components/forms.tsx
 M apps/web/src/components/requirements-workspace.tsx
 M apps/web/src/server/container.ts
 M docs/api.md
 M docs/architecture.md
 M docs/phase-3.md
 M package-lock.json
 M packages/database/src/projects.ts
 M packages/database/src/readiness.ts
 M packages/domain/src/requirements-interview.ts
 M packages/infrastructure/package.json
 M packages/infrastructure/src/requirements-ai.ts
 M packages/services/src/index.ts
 M packages/services/src/requirements-ai.ts
 M packages/services/src/requirements-interviews.ts
 M tests/container.test.ts
 M tests/foundation.integration.test.ts
 M tests/property-type.integration.test.ts
 M tests/requirements-ai.test.ts
 M tests/requirements.integration.test.ts
 M tests/schema-evolution.integration.test.ts
 M vitest.config.ts
 M vitest.integration.config.ts
?? docs/requirements-reliability.md
?? packages/database/migrations/005_ai_provider_routing.sql
?? packages/services/src/ai-router.ts
?? tests/ai-router.test.ts
?? tests/no-live-ai.ts
?? tests/requirements-reliability.test.ts
?? tests/requirements-rich-fixture.ts
```

`git diff --stat`:

```text
 .env.example                                       |  14 +-
 README.md                                          |   4 +
 apps/web/src/app/globals.css                       |  39 ++++
 apps/web/src/components/forms.tsx                  |  67 ++++---
 apps/web/src/components/requirements-workspace.tsx | 215 ++++++++++++++-------
 apps/web/src/server/container.ts                   |   7 +-
 docs/api.md                                        |   4 +-
 docs/architecture.md                               |   4 +
 docs/phase-3.md                                    |  61 +++++-
 package-lock.json                                  |   3 +-
 packages/database/src/projects.ts                  |   6 +-
 packages/database/src/readiness.ts                 |   2 +-
 packages/domain/src/requirements-interview.ts      |  24 +++
 packages/infrastructure/package.json               |   2 +-
 packages/infrastructure/src/requirements-ai.ts     | 145 ++++++++++----
 packages/services/src/index.ts                     |   1 +
 packages/services/src/requirements-ai.ts           |  28 ++-
 packages/services/src/requirements-interviews.ts   |  89 +++++----
 tests/container.test.ts                            |   2 +
 tests/foundation.integration.test.ts               |   2 +-
 tests/property-type.integration.test.ts            |   6 +-
 tests/requirements-ai.test.ts                      |   4 +-
 tests/requirements.integration.test.ts             | 147 +++++++++++++-
 tests/schema-evolution.integration.test.ts         |  16 +-
 vitest.config.ts                                   |   2 +-
 vitest.integration.config.ts                       |   2 +-
 26 files changed, 702 insertions(+), 194 deletions(-)
```
