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

The service depends on a provider-independent structured/text interface. The optional OpenAI-compatible adapter is configured with `AI_PROVIDER_URL`, `AI_PROVIDER_API_KEY`, and `AI_PROVIDER_MODEL`; all three must be present together. No provider is selected when all are blank. Tests use a deterministic fake and make no live requests. The provider adapter sends a JSON-schema response format, applies a timeout, and avoids logging credentials or content.

The owner message commits before the provider call. Malformed model output receives one bounded repair attempt. If that still fails, or the provider is unavailable, the message remains in the interview and the owner can retry or complete the candidate manually. Only user-visible assistant messages and validated candidate data are persisted; chain-of-thought is never requested or stored.

## UI and API

The owner-only Requirements area shows the conversation beside a structured Project Brief, saved Site context, completeness, inferred provenance, open conflicts, and unresolved Site discrepancies. It stacks on narrow screens. Manual editing is available throughout the active draft, and approval uses a distinct owner action.

See [the HTTP contract](api.md#projects) for the Requirements endpoints and expected-revision behavior.

## Phase 4 boundary

Phase 4 may consume one canonical Site record and one approved V3 Property Requirements specification. It may add a separate planning/constraint model. It must not reinterpret the Phase 3 transcript or treat Phase 3 preferences as geometry or feasibility conclusions.
