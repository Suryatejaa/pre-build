# Phase 1 HTTP contract

All application endpoints run on the Next.js Node server. Authentication uses an HTTP-only cookie; arbitrary user IDs in headers or payloads do not authenticate a request. All mutations require `Origin` equal to `APP_URL`, JSON `Content-Type`, and a body at most 16 KiB. DELETE membership requires no body but still requires origin/auth. Responses containing private state are `Cache-Control: no-store`.

## Accounts

| Method | Path | Input / output |
| --- | --- | --- |
| POST | `/api/auth/sign-up/email` | `{name, email, password}`; creates account and signed session cookie |
| POST | `/api/auth/sign-in/email` | `{email, password}`; establishes session |
| POST | `/api/auth/sign-out` | `{}`; revokes current session and expires cookie |
| GET | `/api/auth/get-session` | Auth-provider session response, or null |
| GET | `/api/me` | Safe profile: `{id, name, email, emailVerified}`; 401 if signed out |
| GET | `/api/health` | Readiness check: 200 `{status:"ok"}` or 503 `{status:"unavailable"}` |

The public auth routes preserve the provider's success/error shape. Domain APIs use the envelope below. Email verification, recovery, social login, and email invitations are not available. Production auth requires the trusted proxy header configured by `AUTH_IP_HEADER`.

## Projects

| Method | Path | Permission / behavior |
| --- | --- | --- |
| GET | `/api/projects?page=1` | Authenticated; only owned/shared projects, 20 per page |
| POST | `/api/projects` | Authenticated; `{name, propertyType?:PropertyType}`; 201 summary |
| GET | `/api/projects/:projectId` | Project member; summary |
| PATCH | `/api/projects/:projectId` | OWNER; `{expectedRevision, name?, status?, propertyType?, changeReason}`; 200 updated summary |
| GET | `/api/projects/:projectId/site` | OWNER; current Site record and project revision, or `site: null` when no Site record exists |
| PUT | `/api/projects/:projectId/site` | OWNER; `{expectedRevision, changeReason, site}` where `site` contains validated Site facts; saves a new immutable project revision when changed |
| GET | `/api/projects/:projectId/requirements` | OWNER; current interview, structured candidate, completeness, saved Site context, and approved requirements if present |
| PATCH | `/api/projects/:projectId/requirements` | OWNER; `{expectedRevision, changeReason, requirements}`; manually corrects the active candidate without changing the project revision |
| POST | `/api/projects/:projectId/requirements/interview` | OWNER; `{action:"start",expectedRevision}`, `{action:"message",expectedRevision,content}`, or `{action:"retry",expectedRevision}` |
| POST | `/api/projects/:projectId/requirements/conflicts` | OWNER; `{expectedRevision,conflictId,resolution}`; explicitly resolves a requirement conflict |
| POST | `/api/projects/:projectId/requirements/site-discrepancies` | OWNER; `{expectedRevision,discrepancyId,resolution}`; acknowledges the saved Site value without changing Site |
| POST | `/api/projects/:projectId/requirements/approve` | OWNER; `{expectedRevision}`; creates the next immutable project version when the brief is complete and unblocked |
| GET | `/api/projects/:projectId/versions?page=1` | OWNER/PROFESSIONAL; immutable history, newest first |
| GET | `/api/projects/:projectId/versions/:versionId` | OWNER/PROFESSIONAL; version must belong to this project |
| GET | `/api/projects/:projectId/members` | OWNER; names, IDs and roles, includes derived owner |
| PUT | `/api/projects/:projectId/members` | OWNER; `{userId, role}`; assign/update existing account access; 204 |
| DELETE | `/api/projects/:projectId/members/:userId` | OWNER; revoke membership; 204; owner cannot be removed |

Project summary:

```ts
{
  id: string; // UUID
  name: string;
  propertyType: "RESIDENTIAL" | "COMMERCIAL" | "MIXED_USE" | "OTHER";
  status: "ACTIVE" | "ARCHIVED";
  revision: number;
  versionId: string;
  role: "OWNER" | "PROFESSIONAL" | "CONTRACTOR_VIEWER" | "CONTRACTOR_CONTRIBUTOR";
  createdAt: string; // ISO instant
  updatedAt: string;
}
```

`PropertyType` has exactly the four values shown above; creation defaults to `RESIDENTIAL`. For compatibility with original clients, creation also accepts deprecated `RESIDENTIAL_HOUSE` and normalizes it to `RESIDENTIAL` before persistence. Unsupported inputs return 422. PATCH accepts only canonical values and uses the existing owner authorization, expected revision, audit, and no-op rules. Summary/list/detail responses always use canonical types; authorized raw history retains the recorded spelling, including legacy `RESIDENTIAL_HOUSE`. No private fields were added to summaries.

The Requirements response additionally includes canonical `propertyType` and `propertyTypeMismatch: {approved:boolean, draft:boolean}`. The approved flag remains true until a matching brief is explicitly approved, even while a corrected draft is open. A historical approved interview retains its `APPROVED` status; the mismatch and completeness fields indicate that it is not aligned with the current project. Drafts obtain building intent from Project Details with `PROJECT_CONTEXT` provenance. The interview cannot change the project type: a conflicting manual kind returns 422; AI type extractions cannot overwrite it. Change Project Details and use the existing `start` action to open a reviewed draft. Non-residential types can be captured but remain ineligible for residential requirements approval.

The Site response is `{projectId, revision, versionId, site}`. The `site` value is the validated Site record with entered facts and deterministic derived analysis. A stale `expectedRevision` returns 409; invalid Site input returns 422. Site values and location history are owner-only, including through the Site endpoints.

The Requirements response includes the project revision, owner-only Site context (read from the canonical Site record and not copied into the candidate), the latest interview status, conversation messages, structured candidate, completeness items, conflicts, and Site discrepancies. If no interview exists, status is `NOT_STARTED`. Draft messages and candidates are stored separately from immutable project versions. Reopening an approved brief starts a new interview from the latest approved requirements. If the project revision changes during an active interview, start a fresh draft to use the current Site context.

The interview action endpoint accepts only `start`, `message`, and `retry`. Owner messages are persisted before calling the provider. Provider errors return a safe 502/503 envelope while retaining the message and candidate; retry reuses the latest saved owner message. AI output is schema validated and domain validated before it can update a candidate. `PATCH /requirements` accepts the full validated `PropertyRequirements` object; the server stamps manual provenance and preserves earlier provenance history rather than trusting client-provided provenance.

Approval requires all required and conditionally required fields, confirmed interpretations, resolved blocking conflicts, resolved Site discrepancies, and an exact current `expectedRevision`. It writes `requirements` into project snapshot schema V3, appends an audit event in the same transaction, and closes the interview. V1/V2 history remains unchanged. General project summaries never include requirements. PROFESSIONAL and contractor roles cannot read or modify interview drafts or V3 requirements.

Paginated endpoints return `{items, nextPage: number | null}`. `page` ranges from 1 to 10000. IDs must be UUIDs. Name is trimmed and 2–120 characters. `changeReason` is trimmed and 5–500 characters. No-op PATCH retains the same revision. Archiving is reversible; there is no project deletion endpoint. Membership updates use stable account IDs and cannot transfer ownership. Membership changes audit access without creating new property snapshots. There are no approval or contractor-progress endpoints.

## Domain errors

```json
{
  "error": {
    "code": "CONFLICT",
    "message": "This project changed since you opened it. Reload before saving.",
    "requestId": "generated-request-uuid"
  }
}
```

| Status | Meaning |
| --- | --- |
| 401 | Sign-in required |
| 403 | Known member lacks permission, or request origin is invalid |
| 404 | Missing/inaccessible project or version |
| 409 | Stale `expectedRevision` |
| 413 | Body too large |
| 422 | Invalid JSON/schema/unsupported mutation; validation issues may be included |
| 502 | AI returned malformed structured output after one repair attempt; the owner message remains saved |
| 503 | AI provider is unconfigured or temporarily unavailable; manual completion and retry remain available |
| 429 | Authentication rate limit reached |
| 500 | Unexpected failure; internal details are not returned |

The framework responds with 405 for unsupported methods on project routes. Unsupported auth paths are deliberately 404. Error logs include a request ID and error type, never request bodies, SQL, passwords, or cookies.
