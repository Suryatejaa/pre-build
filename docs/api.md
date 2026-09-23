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
| POST | `/api/projects` | Authenticated; `{name, propertyType?:"RESIDENTIAL_HOUSE"}`; 201 summary |
| GET | `/api/projects/:projectId` | Project member; summary |
| PATCH | `/api/projects/:projectId` | OWNER; `{expectedRevision, name?, status?, changeReason}`; 200 updated summary |
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
  propertyType: "RESIDENTIAL_HOUSE";
  status: "ACTIVE" | "ARCHIVED";
  revision: number;
  versionId: string;
  role: "OWNER" | "PROFESSIONAL" | "CONTRACTOR_VIEWER" | "CONTRACTOR_CONTRIBUTOR";
  createdAt: string; // ISO instant
  updatedAt: string;
}
```

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
| 429 | Authentication rate limit reached |
| 500 | Unexpected failure; internal details are not returned |

The framework responds with 405 for unsupported methods on project routes. Unsupported auth paths are deliberately 404. Error logs include a request ID and error type, never request bodies, SQL, passwords, or cookies.
