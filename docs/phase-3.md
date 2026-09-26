# Phase 3 — Property Requirements interview

## Scope

Phase 3 records what the owner wants to build. It does not create room placement, geometry, design, cost estimates, compliance conclusions, schedules, or 3D output.

The owner workflow separates the conversation from a typed Property Requirements candidate. Structured AI output is validated in the services layer, mapped into that candidate with provenance, then checked by deterministic completeness and conflict rules. The owner reviews and may manually edit the Project Brief before approval.

## Requirements model

`packages/domain/src/requirements.ts` defines building intent, occupancy counts, building scale, floor-scoped spaces, exact/minimum/maximum/preferred counts, unit-qualified size needs, relationships, parking, accessibility, utilities, rental use, preferences, budget intent, timeline intent, Vaasthu preference, and future expansion. Each meaningful requirement has a priority and provenance. Provenance retains its current origin and a bounded history when edited.

Residential approval requires building intent, a nonzero floor-count specification, at least one counted space, and an explicit rental intent. Rental use conditionally requires an independent-entrance answer. If elderly occupancy is stated, accessibility needs must be confirmed. Budget, timeline, parking, and other nonessential categories do not block approval. Unsupported building intents can be captured, but they cannot be approved as the supported residential workflow.

Count-range contradictions, changed floor/space counts, priority conflicts, and incompatible budgets are represented as open conflicts. Owner review resolves conflicts explicitly. Site discrepancies refer back to the saved Site record; the interview cannot alter Site facts.

## Persistence and versioning

`requirements_interviews` holds one active mutable draft per project, with a candidate, status, project revision reference, owner, and timestamps. `requirements_interview_messages` stores ordered owner/assistant messages separately. `requirements_ai_requests` records provider, model, request type, time, success, latency, token usage when returned, and retry count. Message and AI-request records are append-only.

Draft changes do not create a project version per message. The approval transaction checks owner authorization, expected project revision, completeness, low-confidence interpretations, conflicts, and Site discrepancies. It appends a V3 project snapshot plus audit event and marks the interview approved atomically. Further changes open a fresh interview from the latest approved brief. Historical V1/V2 snapshots are never rewritten.

The application project summary remains an explicit allowlist. Professionals and contractor roles cannot read requirements interviews or requirements-bearing snapshot fields through general version views.

## AI provider and recovery

The service depends on `RequirementsAiRouter`. `AiProviderRouter` in services applies ordered routing and one bounded schema-repair attempt per provider; vendor HTTP behavior and environment composition live in infrastructure. The original raw provider interface, OpenAI-compatible adapter, and deterministic fake remain available. Each structured response passes the same `requirementsAiResponseSchema` and then the existing domain validation. Conflicts, missing facts, unsupported property types, low confidence, and approval decisions never trigger vendor shopping.

### Sarvam contract verified 25 September 2026

The default is `sarvam-105b` at `POST https://api.sarvam.ai/v1/chat/completions`, authenticated with `api-subscription-key`. The adapter sends `response_format.type=json_schema` with `strict=true` and the unchanged generated application schema. It parses `choices[0].message.content` as JSON, reads only `usage.prompt_tokens` / `usage.completion_tokens`, and discards other envelope fields. It explicitly disables reasoning with `reasoning_effort:null`, requests non-streaming output, and caps output at 4096 tokens. No beta endpoint or alternate schema is used. References: [V1 API](https://docs.sarvam.ai/api-reference/chat/chat-completions-v1), [structured output guide](https://docs.sarvam.ai/api/api-guides-tutorials/chat-completion/overview), [authentication](https://docs.sarvam.ai/api-reference/authentication).

### Configuration

Set these only on the server, using the root `.env` locally. Restart the server after changes. Never use `NEXT_PUBLIC_` for credentials. Apply migration 005 before deploying this application version.

| Variable | Default / purpose |
| --- | --- |
| `SARVAM_API_KEY` | Blank disables the Sarvam slot; a key alone enables it |
| `SARVAM_MODEL` | `sarvam-105b`; the documented V1 conversational variant is also accepted explicitly |
| `AI_FALLBACK_A_URL`, `AI_FALLBACK_A_API_KEY`, `AI_FALLBACK_A_MODEL` | Optional JSON-schema Chat Completions provider A; supply its documented URL and model |
| `AI_FALLBACK_B_URL`, `AI_FALLBACK_B_API_KEY`, `AI_FALLBACK_B_MODEL` | Optional provider B with the same protocol |
| `AI_PROVIDER_ORDER` | `sarvam,fallback-a,fallback-b`; comma-separated unique slots; omit a slot to disable it |
| `AI_PROVIDER_TIMEOUT_MS` | 60000 per attempt, integer 1–60000, including response-body reads |
| `AI_PROVIDER_URL`, `AI_PROVIDER_API_KEY`, `AI_PROVIDER_MODEL` | Legacy adapter configuration, used as fallback A when its new key is absent |

Missing keys skip slots even if their model/URL placeholders are populated. Thus Sarvam-only, Sarvam plus one/two fallbacks, fallback-only, and manual-only deployments are valid. With no Sarvam key, an enabled credentialed fallback can serve immediately and records `FALLBACK_USED`. The first slot in the configured order is the intended primary. Missing all keys returns `NOT_CONFIGURED`; it never selects the fake. A credentialed slot with invalid model/URL configuration, duplicate/unknown ordering, or invalid timeout is an operator error with a safe startup diagnostic. Fallback URLs require HTTPS in production and cannot embed credentials/query/fragment. Redirects are refused so keys cannot be forwarded elsewhere.

### Routing and recovery policy

| Failure | Action |
| --- | --- |
| Timeout (including HTTP 408/504), connection failure, 429, other 5xx | Try the next enabled provider once |
| Invalid response envelope, JSON, truncated output, or requirements schema | One repair on the same provider, then advance if still unusable |
| 401/403, other non-success statuses including 400/404/422, invalid configuration, unknown adapter error | Stop with `OPERATOR_ERROR`; do not mask defects with fallback |
| Provider content-filter or explicit refusal | Stop; no repair or fallback |
| Valid extraction containing conflicts, unsupported type, or low confidence | Return to deterministic domain processing; no fallback |

Each next provider receives the original prompt/context, never another provider's invalid response. No transient retry loop or return to an earlier provider exists. Production configuration allows at most three slots, two calls per slot, so total provider waiting is bounded by six times the per-attempt timeout (360 seconds by default). Both the router and HTTP adapter abort and bound the complete request, including hung body reads. Cancellation stops the chain.

The owner message commits before routing. Failure preserves the candidate and saved message; retry uses the latest saved owner message, and manual editing/approval remain available. Availability is configuration status, not a provider health guarantee. Domain validation is outside the fallback boundary. No provider can persist project state.

### Diagnostics and security boundary

Migration 005 adds a bounded `attempts` JSON array and `routing_outcome` to append-only `requirements_ai_requests`; existing records retain `LEGACY` plus an empty trace. Every physical attempt records trusted configured provider/model, index, timestamp, success, latency, sanitized token counts when supplied (including zero), repair count, and an allowlisted error code. The logical record aggregates usage/repairs and records `PRIMARY_USED`, `FALLBACK_USED`, `ALL_PROVIDERS_FAILED`, `OPERATOR_ERROR`, or `NOT_CONFIGURED`. On success its provider/model and the assistant message identify the serving adapter, never a model-supplied identity. On failure they identify the last attempted adapter. Attempts are local to a request, so concurrent requests cannot overwrite one another's attribution.

No raw error body, credential, header, invalid output, prompt, or reasoning is stored in diagnostics or returned to the owner. Repair output exists only in memory for the same provider. The adapter and web container use `server-only`; client import restrictions remain enforced by lint. Client components receive only the authorized view and availability enum. The existing Site allowlist and structured canonical property type are reused; no street addresses, precise coordinates, Site notes, hidden configuration, or unrelated project data are added. Owners should avoid placing secrets in their own free-text messages.

Tests block global network fetch and inject deterministic providers/fetchers. They cover routing, repair, deadlines, error classification, metadata, and schema spoofing without credentials. PostgreSQL integration tests use an isolated `_test` database and disposable schemas, including failure preservation and append-only routing records. A real Sarvam call requires a locally supplied key and must be verified separately.

## UI and API

The owner-only Requirements area shows the conversation beside a structured Project Brief, saved Site context, completeness, inferred provenance, open conflicts, and unresolved Site discrepancies. It stacks on narrow screens. Manual editing is available throughout the active draft, and approval uses a distinct owner action.

See [the HTTP contract](api.md#projects) for the Requirements endpoints and expected-revision behavior.

## Phase 4 boundary

Phase 4 may consume one canonical Site record and one approved V3 Property Requirements specification. It may add a separate planning/constraint model. It must not reinterpret the Phase 3 transcript or treat Phase 3 preferences as geometry or feasibility conclusions.

## Canonical Project Property Type correction

Project Details is the sole mutable authority for the high-level property type. Requirements building intent is a planning-context copy tied to the interview's `expectedProjectRevision`, not a second editable source. New/reopened candidates derive it with `PROJECT_CONTEXT` provenance (no invented owner message or actor); prior provenance is retained when the copy changes. Older active candidates with null intent receive known context in their read representation and persist it on the next candidate edit or interpretation. Approved snapshots/interviews remain unchanged.

Provider input includes `propertyType` plus the derived candidate and instructs the assistant not to ask for a known type. Deterministic follow-up questions use missing required fields and low-confidence review; provider-generated follow-up questions are not appended because they can redundantly ask for canonical context. AI type extractions cannot change project data. Requests to change it direct the owner to Project Details. The manual editor displays the type as context, and its API rejects a conflicting kind.

If project and approved brief types differ, the Requirements view explicitly warns, marks completeness blocked, and offers the existing new-revision workflow. A stale or mismatched open interview is superseded when the owner starts fresh. That new candidate derives only the high-level type, retains other requirements for owner review, and never rewrites the approved brief. Non-residential requirements remain capturable but cannot be approved by the residential completeness rules. A matching draft does not clear the approved-mismatch flag until it is explicitly approved.

Legacy RESIDENTIAL_HOUSE V1/V2/V3 snapshots remain readable and byte-for-byte untouched in PostgreSQL. Current Project views and normalization expose RESIDENTIAL; raw authorized history preserves legacy spelling. Shared UI labels hide storage enum details. This correction does not start Phase 4.

## Provider integration verification — 25 September 2026

Typecheck, lint, 100 unit tests, 47 PostgreSQL integration tests, and the production build passed. The browser walkthrough used a clearly named local verification account/project: the unconfigured status was visible before starting, an owner message survived the recoverable error, and a manual floor-count edit persisted after reload. No Sarvam or fallback key was present, so no real Sarvam browser call was performed. Available/failed provider routing was verified with deterministic adapters. Production browser bundles were inspected for provider adapter and credential-configuration identifiers; none were included. Migration 005 was applied to the local development database; deployment databases still require the normal explicit migration step.


## Requirements reliability correction — 26 September 2026

The original rich-message failures reached the previous 20-second request deadline before a complete structured response was available. The default is now a finite 60 seconds per attempt, including body reads, with abort/cancellation unchanged. Existing explicit timeout overrides still apply. The service requests compact extraction, records floor-specific spaces independently, and generates a short acknowledgement plus at most two deterministic follow-up questions. Structural required fields retain precedence.

Strict extraction and PropertyRequirements validation remain authoritative. Invalid cosmetic acknowledgement/question fields cannot discard otherwise valid facts; deterministic prose replaces them. There is no second text-generation call in this use case. Domain-invalid candidates still fail safely outside the provider fallback boundary; legitimate conflicts are recorded for owner review.

Attempt diagnostics additionally identify provider request/body/envelope/JSON/schema stages, safe HTTP status and schema issue paths/codes. Pipeline outcomes distinguish candidate merge, domain validation, conflict evaluation, text recovery, and persistence. Retry count identifies the bounded repair attempt. These fields use the existing attempts JSONB column and are not exposed to owners. No additional migration is required.

Desktop Requirements uses conversation beside concise brief review. The complete manual editor is an explicit mode with Save and Done/Cancel; discarding a dirty draft requires a separate deliberate action. Mobile uses keyboard-accessible Conversation / Project Brief tabs. Failed turns show one recovery state, cleared on successful retry. In-flight messages appear immediately, duplicate submission is prevented, and brief viewing remains available.

See [the correction verification report](requirements-reliability.md) for evidence, regression results, browser verification and the live-check limitation.
