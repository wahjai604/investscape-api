# InvestScape ↔ Relationship OS — Integration Contract Proposal v0.2

**Status:** PROPOSAL for Relationship OS review. Nothing marked *proposed* is agreed or implemented on the Relationship OS side. Every dependent InvestScape feature stays behind a server-side flag that is **off**.
**Owner (InvestScape side):** investscape-api, `src/lighthouse/`
**Supersedes:** the contract matrix in the P1 review thread (v0.1).

Legend: **Confirmed** = implemented on both sides and verified against Relationship OS code (`packages/analysis-gateway/gatewayService.ts`, `packages/service-auth/hmacServiceAuth.ts`). **IS-implemented** = implemented in InvestScape, not agreed. **Proposed** = not implemented anywhere.

**Unresolved and deliberately not decided here:** recipient professional identity (which identifier), retention periods, and deletion/revocation acknowledgement deadlines. Where they appear below they are named `TBD-RECIPIENT-ID`, `TBD-RETENTION`, `TBD-ACK-DEADLINE`.

---

## 1. Common rules

### 1.1 Service authentication (Confirmed header names and canonicalisation)

| Header | Value |
|---|---|
| `x-lighthouse-service` | `investscape` (IS→RoS) or `relationship-os` (RoS→IS) |
| `x-lighthouse-key-id` | Selects the secret. **Separate keys per direction:** `is-to-ros-<yyyymm>-<n>` and `ros-to-is-<yyyymm>-<n>`. |
| `x-lighthouse-timestamp` | Integer Unix seconds. Accepted skew ±300 s. |
| `x-lighthouse-nonce` | Lowercase hex, ≥ 32 chars, **fresh per HTTP attempt**. Receiver stores `sha256(nonce)` and rejects repeats. |
| `x-lighthouse-signature` | `hex(HMAC-SHA256(secret, METHOD \n PATH \n TIMESTAMP \n NONCE \n hex(sha256(rawBody))))` |

`PATH` excludes query string and origin. The signature covers the exact bytes sent.

**Change requested of Relationship OS:** today RoS holds one `INVESTSCAPE_SERVICE_SHARED_SECRET` (key id default `primary`) for both directions. Proposed: two independent secrets as above. RoS gateway documentation should also be corrected from `X-Service-*` to `x-lighthouse-*`.

### 1.2 Retries

A retry of a request or event MUST resend **identical body bytes** and the **same `eventId`** (or idempotency key), and MUST generate a **new timestamp, nonce and signature**. A replayed signature would be rejected by nonce storage; a changed body under the same `eventId` is a conflict.

Retry schedule (sender side): exponential backoff 1 s, 2 s, 4 s … capped at 300 s between attempts, until acknowledged or until `TBD-ACK-DEADLINE`, after which the item is parked for operator reconciliation and alerted.

### 1.3 Idempotency and ordering

- **Receiver**, same `eventId` + same `payloadHash` → `200 {"outcome":"duplicate"}`. Same `eventId` + different `payloadHash` → `200 {"outcome":"conflict"}`, quarantined and audited, never applied.
- Every aggregate (link, grant) carries a **monotonic integer `version`**. A receiver applies an event only if `version` > stored version; otherwise it acknowledges with `outcome: "stale"` and changes nothing.
- A gap (received `version` > stored + 1) is accepted **and** triggers a recovery read (§5) for that aggregate.
- **Revocation is final:** a grant in `revoked` or `tombstoned` can never return to `active`. Re-sharing always creates a **new** `shareGrantId` starting at version 1. Links in `revoked`/`expired` likewise never return; relinking creates a new `crossProductLinkId`.

### 1.4 Payload hash

`payloadHash = hex(sha256(canonical JSON of the event object without the payloadHash field))`, canonical = keys sorted lexicographically at every level, no insignificant whitespace, UTF-8.

### 1.5 Errors

Error body: `{"error":{"code":"<UPPER_SNAKE>","message":"<generic>"}}`. Messages never echo request values. Unknown/unauthorised and not-found are indistinguishable where disclosure would allow enumeration.

---

## 2. Launch (professional-assisted analysis)

### 2.1 L1 — landing and sign-in handoff (IS-implemented)

1. RoS sends the professional's browser to `GET https://<investscape-api>/relationship-os/launch?launch_session=<uuid>&code=<code>` (**Confirmed** URL shape, from `INVESTSCAPE_LAUNCH_BASE_URL`).
2. The page scrubs the query string before any request, then `POST /v1/lighthouse/launch/handoffs` (no session):
   - Request `{ "launchSessionId": "<uuid>", "code": "<string 1..512>" }`
   - Response `200 { "state":"handoff_created", "handoffToken":"<43-char base64url>", "resumeUrl":"<https url>", "expiresAt":"<iso>" }`
   - The server stores the code AES-256-GCM-encrypted under an HKDF-SHA256 key derived from `handoffToken`, keyed by `sha256` of the token. TTL 600 s, single use. The code is never stored in plaintext, never logged, never returned.
3. The page navigates to `resumeUrl#handoff=<token>`. The fragment is never sent to a server.
4. The InvestScape app signs the professional in, clears the fragment, and calls `POST /v1/lighthouse/launch/handoffs/redeem` with its bearer session: `{ "handoffToken": "<43 chars>" }`. Response as L2's IS-side result below. `410 {"state":"expired"}` for unknown, used, expired or tampered handoffs alike. An actor with no active link gets `403` **without** the handoff being consumed.

### 2.2 L2 — redemption (Confirmed request/response v1; v2 Proposed)

`POST /v1/investscape/launch-sessions/redeem`, IS → RoS, HMAC.

**Request (Confirmed):** `{ "launchSessionId": "<uuid>", "code": "<40..256 chars>" }` — no `schemaVersion` field today.

**Request extension (Proposed), `investscape-launch-redeem-request.v2`:**

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"investscape-launch-redeem-request.v2"` | |
| `launchSessionId` | uuid | |
| `code` | string 40..256 | |
| `redemptionAttemptId` | uuid | Generated by IS per attempt. Enables §2.4. |

**Response `investscape-launch-context.v1` (Confirmed):** `schemaVersion`, `launchSessionId` (uuid), `analysisType` (`"investment_quick_review"`), `modules` (string[] ≤32), `permittedScopes` (string[] ≤32), `redactedScopes` (string[] ≤32), `expiresAt` (iso), `context.property` { `propertyRef` (≤128), `propertyType?`, `jurisdiction?`, `address?`, `listPrice?`, `currency?` }, `correlationId` (≤128). Strict: unknown fields rejected.

**Response `investscape-launch-context.v2` (Proposed):** all v1 fields, plus

| Field | Type | Notes |
|---|---|---|
| `initiatingProfessional.relationshipOsPersonRef` | string 1..256 | The RoS person who issued the launch. Opaque; same namespace as the person ref in `lighthouse.cross-product-link.invitation.v1`. Nothing else in this object (no email, no name). |

**Ownership rule (IS-implemented):** InvestScape binds a launch only when the signed-in InvestScape actor holds an **active** cross-product link whose `relationshipOsPersonRef` equals `initiatingProfessional.relationshipOsPersonRef`. A v1 response cannot satisfy this and is refused (`403`, no analysis created). **Consequence: until RoS returns v2 (or an agreed equivalent), Stage 1 cannot be enabled.** InvestScape does not assume RoS accepts v2.

Also requested of RoS: omit `listPrice`/`currency` unless `finance.summary` is in `permittedScopes` and not in `redactedScopes` (InvestScape already drops them locally).

Error codes (Confirmed): `400 LAUNCH_REQUEST_MALFORMED`, `401 SERVICE_AUTH_FAILED`, `403 LAUNCH_SESSION_REVOKED`, `404 LAUNCH_SESSION_NOT_FOUND`, `409 LAUNCH_SESSION_ALREADY_CONSUMED`, `410 LAUNCH_SESSION_EXPIRED`.

### 2.3 L3 — analysis reference callback (Confirmed)

`POST /v1/investscape/analysis-references`, IS → RoS, HMAC.
Request `investscape-result-reference.v1`: `schemaVersion`, `launchSessionId` (uuid), `externalAnalysisId` (1..160), `analysisType`, `status` (`draft|complete|failed`), `summary?` { `grade?` ≤16, `primaryOpportunity?` ≤280, `primaryRisk?` ≤280 }, `completedAt?`, `correlationId?` ≤160.
Response `investscape-result-reference-ack.v1`: `analysisReferenceId`, `externalAnalysisId`, `status`, `acceptedAt`.
Idempotency: identical retry → 200. Status transitions `draft → complete|failed` only; `409 CALLBACK_STATUS_REGRESSION`, `409 ANALYSIS_REFERENCE_PAYLOAD_CONFLICT`, `409 LAUNCH_SESSION_NOT_CONSUMED`, `409 ANALYSIS_REFERENCE_CONTEXT_CONFLICT`.

### 2.4 L4 — ambiguous redemption reconciliation (Proposed)

**Problem.** If L2 times out or the connection drops after sending, InvestScape cannot know whether RoS consumed the code. Today InvestScape records `stage1.redemption.ambiguous` with an internal `operationId` and stops; **no supported operation exists to resolve it.** Retrying L2 is unsafe (a consumed code returns 409, and a second consumption must never happen).

**Proposal — two parts, both required:**

1. **Attempt-keyed redemption.** L2 request v2 carries `redemptionAttemptId`. RoS stores it on the session when consuming (`consumed_by_attempt_id`). A repeat L2 with the **same code and same `redemptionAttemptId`**, within `expiresAt + 900 s`, returns **the same `launch-context` (200)** instead of 409. Any other attempt id → `409 LAUNCH_SESSION_ALREADY_CONSUMED` as today.
2. **Lookup without the code.** `POST /v1/investscape/launch-sessions/redemption-lookup`, IS → RoS, HMAC.

   Request `investscape-redemption-lookup.v1`:
   | Field | Type |
   |---|---|
   | `schemaVersion` | `"investscape-redemption-lookup.v1"` |
   | `launchSessionId` | uuid |
   | `redemptionAttemptId` | uuid |

   Response `investscape-redemption-status.v1`:
   | Field | Type | Notes |
   |---|---|---|
   | `schemaVersion` | `"investscape-redemption-status.v1"` | |
   | `launchSessionId` | uuid | |
   | `redemptionAttemptId` | uuid | echoed |
   | `status` | `consumed_by_this_attempt` \| `not_consumed` \| `consumed_by_other_attempt` \| `expired` \| `revoked` | |
   | `launchContext` | `investscape-launch-context.v2` | present **only** when `consumed_by_this_attempt` |
   | `checkedAt` | iso | |

   Available until `expiresAt + 900 s`; after that `410 REDEMPTION_LOOKUP_EXPIRED`.

**InvestScape behaviour (to implement after agreement):** persist the ambiguous attempt server-side (`launchSessionId`, `redemptionAttemptId`, actor, handoff id — **never the code**) in state `pending_reconciliation`; a reconciler calls L4 with backoff until resolved or the lookup window closes:
- `consumed_by_this_attempt` → apply the ownership rule to the returned context and bind (or refuse) exactly as a normal success.
- `not_consumed` / `expired` / `revoked` → resolved with no analysis; the professional restarts from RoS.
- `consumed_by_other_attempt` → resolved, no analysis, security alert.
- Window closed without resolution → resolved as failed, alert, no analysis.

The browser is told "we're confirming this with Relationship OS" and polls a session-authenticated status route keyed by the IS `operationId`. No retry ever re-sends the code.

---

## 3. Account linking — `lighthouse.account-link.v1` (Proposed; IS routes K3/K4 exist, provisional)

Session-bound, explicit confirmation in both products. Emails are never used for matching.

| # | Endpoint | Direction | Auth | Request → Response |
|---|---|---|---|---|
| K1 | `POST /v1/lighthouse/link/requests` | browser → IS | IS session, personal context | `{}` → `{ "linkRequestId": "<uuid>", "rosConsentUrl": "<https url>", "expiresAt": "<iso>" }`. Server stores `sha256(linkRequestVerifier)` bound to the actor; one open request per actor; TTL 900 s. |
| K2 | RoS consent page (path TBD by RoS) | browser → RoS | RoS session + explicit confirm | query `linkRequestId` |
| K3 | `POST /v1/lighthouse/link/invitations` | RoS → IS | HMAC | `lighthouse.cross-product-link.invitation.v1` + **`linkRequestId`** (new field): `schemaVersion`, `eventId`, `version`, `occurredAt`, `correlationId`, `invitationId`, `relationshipOsPersonRef`, `relationshipRef`, `expiresAt`, `noticeVersion`, `linkRequestId`. Idempotent on `linkRequestId`. |
| K4 | `POST /v1/lighthouse/link/accept` | browser → IS | IS session; **must be the K1 actor**; explicit confirm | `{ "invitationId", "challenge" }` → `{ "state":"linked", "crossProductLinkId", "version" }` |
| K5 | `POST /v1/investscape/link-events` | IS → RoS | HMAC | envelope (§4.1) with `aggregateKind:"link"`; payload `lighthouse.cross-product-link.confirmed.v1` or `lighthouse.cross-product-link.revoked.v1` (below). Ack `{ "outcome", "crossProductLinkId", "version", "appliedAt" }`. |
| K6 | `POST /v1/lighthouse/sync/events` | RoS → IS | HMAC | envelope with `aggregateKind:"link"`, `targetState:"revoked"`. **IS-implemented:** InvestScape revokes the link and every active grant on it in one transaction (same code path as a user unlink). **Not yet implemented:** enqueueing the resulting S2 events (awaits S2 agreement). |

`lighthouse.cross-product-link.revoked.v1` (Proposed): `schemaVersion`, `eventId`, `version`, `occurredAt`, `correlationId`, `crossProductLinkId`, `revokedAt`, `reason` (`unlinked_by_client` \| `unlinked_by_professional` \| `account_closed` \| `policy`), `revokedShareGrantIds` (string[]; informational — RoS must still process each grant's own S2 event).

Linking grants **no** analysis visibility.

---

## 4. Sharing — `investscape.sharing.v1`

### 4.1 Event envelope (IS-implemented for inbound; Proposed for IS → RoS)

Matches InvestScape's existing inbound `/sync/events` schema:

| Field | Type |
|---|---|
| `eventId` | string 1..128 (uuid recommended) |
| `schemaVersion` | payload schema name, e.g. `investscape.share-grant.changed.v1` |
| `aggregateKind` | `link` \| `share_grant` |
| `aggregateId` | string ≤256 |
| `targetState` | aggregate state after the event |
| `version` | int ≥ 0, monotonic per aggregate |
| `occurredAt` | iso |
| `correlationId` | string ≤256, optional |
| `payloadHash` | 64 lowercase hex (§1.4) |
| `payload` | the schema-named object (Proposed addition for IS → RoS) |

### 4.2 S1 — client creates/revokes a grant (IS-implemented, provisional)

`POST /v1/lighthouse/shares`, browser → IS, IS session, **personal context only**.
Request: `crossProductLinkId`, `clientUserRef` (must equal session actor), `destinationRelationshipRef`, `recipientContext` (`professional_assisted` \| `delegated_client`; the latter refused while delegation is off), `selectedAnalysisIds` (1..50, all owned by the client in their personal workspace; launched analyses excluded), `selectedFields` (⊆ `status`, `grade`, `primaryOpportunity`, `primaryRisk`), `purpose` (≤280), `expiresAt` (iso \| null), `noticeVersion`, `consentAffirmed: true`.
**Proposed addition:** `recipientProfessionalRef` (`TBD-RECIPIENT-ID`) and an `Idempotency-Key` header.
Response `201`: consent receipt fields (`shareGrantId`, `destinationRelationshipRef`, `recipientContext`, `selectedFields`, `selectedAnalysisIds`, `purpose`, `effectiveFrom`, `expiresAt`, `version`).
Revoke: `POST /v1/lighthouse/shares/{shareGrantId}/revoke` `{ "expectedVersion" }`.

### 4.3 S2 — share events, IS → RoS (Proposed endpoint; payload schemas exist in IS)

`POST /v1/investscape/share-events`, HMAC, envelope §4.1. Payloads (existing IS schemas):

- `investscape.share-grant.changed.v1`: `shareGrantId`, `crossProductLinkId`, `relationshipRef`, `recipientOperatingContext`, `purpose`, `allowedFieldKeys`, `effectiveFrom`, `effectiveTo`, `noticeVersion`, `consentReceiptRef`, `state` (`active|expired|revoked|tombstoned`), `grantVersion` — **plus proposed** `recipientProfessionalRef`.
- `investscape.analysis.shared.v1`: `shareGrantId`, `grantVersion`, `externalAnalysisId`, `status`, `summary` (selected fields only), `sharedAt`.
- `investscape.analysis.unshared.v1`: `shareGrantId`, `externalAnalysisId`, `revokedAt`.
- `investscape.share.revoked.v1`: `shareGrantId`, `revokedAt`.
- `investscape.analysis.tombstoned.v1`: `shareGrantId`, `externalAnalysisId`, `tombstonedAt`, `reason` (`analysis_deleted|grant_revoked|link_unlinked|retention_expired`).

Ack `investscape.share-event-ack.v1`: `{ "outcome": "applied|duplicate|stale|conflict", "shareGrantId", "version", "purgedAt": "<iso, required for revoked/unshared/tombstoned>" }`. InvestScape retries (§1.2) until an ack with `purgedAt` arrives or `TBD-ACK-DEADLINE` passes.

### 4.4 S3 — authorised read of one shared analysis (Proposed)

`POST /v1/lighthouse/shared-analyses/read`, RoS → IS, HMAC.
Request `lighthouse.shared-analysis-read.v1`: `schemaVersion`, `shareGrantId`, `relationshipRef`, `recipientProfessionalRef`, `externalAnalysisId`.
Checked live: grant in force (state, effective window), link active, relationship + recipient + analysis all match.
`200` `investscape.analysis.shared.v1` payload; `404 {"error":{"code":"NOT_FOUND"}}` for anything else, including unshared, revoked and non-existent (no enumeration).

---

## 5. Authoritative state recovery (Proposed)

An active-only list cannot tell a receiver that something it holds was revoked. Recovery therefore returns **every** aggregate ever addressed to the requester, including **versioned revoked/expired/tombstoned tombstones**, and supports a complete-snapshot mode whose absence semantics are explicit.

### 5.1 R1 — link state, RoS → IS

`POST /v1/lighthouse/state/links`, HMAC.
Request `lighthouse.link-state-query.v1`: `schemaVersion`, `relationshipOsPersonRef`.
Response `lighthouse.link-state.v1`:

| Field | Type |
|---|---|
| `schemaVersion` | `"lighthouse.link-state.v1"` |
| `asOf` | iso (server clock at read) |
| `links[]` | `{ crossProductLinkId, state: pending\|active\|suspended\|revoked\|expired, version, changedAt, revokedAt?: iso }` — **all** links for that person, including terminal ones, for `TBD-RETENTION` |
| `complete` | `true` |

### 5.2 R2 — grant state, RoS → IS

`POST /v1/lighthouse/state/grants`, HMAC.

Request `lighthouse.grant-state-query.v1`:

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"lighthouse.grant-state-query.v1"` | |
| `relationshipRef` | string | |
| `recipientProfessionalRef` | string (`TBD-RECIPIENT-ID`) | |
| `cursor` | string \| null | null = full snapshot from the beginning |
| `limit` | int 1..200 | |

Response `lighthouse.grant-state-page.v1`:

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"lighthouse.grant-state-page.v1"` | |
| `asOf` | iso | |
| `grants[]` | GrantState | **every** grant ever addressed to (relationship, professional), all states, ordered by (`changedAt`, `shareGrantId`) |
| `nextCursor` | string \| null | opaque; null on the last page |
| `complete` | boolean | true only on the last page of a snapshot that started with `cursor: null` |

GrantState:

| Field | Type | Notes |
|---|---|---|
| `shareGrantId` | string | |
| `version` | int | the grant's current version |
| `state` | `active` \| `expired` \| `revoked` \| `tombstoned` | |
| `changedAt` | iso | |
| `effectiveFrom` / `expiresAt` | iso / iso \| null | |
| `analyses[]` | `{ externalAnalysisId, state: shared \| unshared \| deleted, version }` | ids only — **no summary fields**; for non-active grants these name what the receiver must purge |
| `allowedFieldKeys` | string[] | only when `state = active` |
| `revokedAt` / `tombstonedAt` | iso | when applicable |

Receiver rules:
1. For each GrantState, apply only if `version` > stored version (same rule as events). A tombstone with a higher version **overrides** any held active copy; the receiver purges every listed analysis whose state is not `shared`.
2. **Absence semantics:** after a snapshot with `complete: true`, any grant the receiver holds that did **not** appear must be purged. Absence from a partial page means nothing.
3. Content for `shared` analyses is fetched via S3, never inferred from R2.
4. A `cursor` older than InvestScape's tombstone retention returns `410 {"error":{"code":"CURSOR_EXPIRED"}}`; the receiver must restart with `cursor: null`.

InvestScape data model note: grant rows are retained (never deleted) through `revoked`/`tombstoned`, and each state change increments `version`, so R2 can be served from `lighthouse.share_grants` without new storage. Per-analysis `unshared`/`deleted` versions require a small per-(grant, analysis) state table — to be added with R2.

---

## 6. Matrix

| # | Endpoint | Dir | Schema | Auth | Idempotency | Order / recovery | Revocation & deletion ack | Status |
|---|---|---|---|---|---|---|---|---|
| L1a | `POST /v1/lighthouse/launch/handoffs` | browser→IS | `{launchSessionId, code}` → `handoff_created` | none (seals only) | new token per call | — | — | IS-implemented |
| L1b | `POST /v1/lighthouse/launch/handoffs/redeem` | app→IS | `{handoffToken}` | IS session; linked initiator | token single-use | — | — | IS-implemented |
| L2 | `POST /v1/investscape/launch-sessions/redeem` | IS→RoS | request v1 / **v2 +redemptionAttemptId**; response `launch-context.v1` / **v2 +initiatingProfessional** | HMAC | code single-use; **same attemptId → same context** | ambiguity → L4 | — | v1 Confirmed; v2 Proposed |
| L3 | `POST /v1/investscape/analysis-references` | IS→RoS | `result-reference.v1` / `-ack.v1` | HMAC | `externalAnalysisId` | status monotonic | ack `acceptedAt` | Confirmed |
| L4 | `POST /v1/investscape/launch-sessions/redemption-lookup` | IS→RoS | `redemption-lookup.v1` → `redemption-status.v1` | HMAC | read-only | resolves L2 ambiguity | — | Proposed |
| K1 | `POST /v1/lighthouse/link/requests` | browser→IS | `{}` → `{linkRequestId, rosConsentUrl, expiresAt}` | IS session | one open per actor | TTL 900 s | — | Proposed |
| K2 | RoS consent page | browser→RoS | `linkRequestId` | RoS session + confirm | single-use | — | — | Proposed |
| K3 | `POST /v1/lighthouse/link/invitations` | RoS→IS | `…invitation.v1` + `linkRequestId` | HMAC | `linkRequestId` | reject expired/used | — | IS provisional |
| K4 | `POST /v1/lighthouse/link/accept` | browser→IS | `{invitationId, challenge}` | IS session = K1 actor + confirm | challenge single-use | — | — | IS provisional |
| K5 | `POST /v1/investscape/link-events` | IS→RoS | envelope + `link.confirmed.v1` / `link.revoked.v1` | HMAC | `eventId` + `payloadHash` | version; gap → R1 | ack `{appliedAt}` | Proposed |
| K6 | `POST /v1/lighthouse/sync/events` | RoS→IS | envelope, `aggregateKind: link` | HMAC | `eventId` + `payloadHash` | version; stale ignored | IS atomically revokes link + grants (implemented); S2 emission pending | IS-implemented (cascade) |
| S1 | `POST /v1/lighthouse/shares`, `…/revoke` | browser→IS | §4.2 (+ `recipientProfessionalRef` proposed) | IS session, personal | `Idempotency-Key` (proposed); revoke CAS | — | receipt | IS provisional |
| S2 | `POST /v1/investscape/share-events` | IS→RoS | envelope + §4.3 payloads | HMAC | `eventId` + `payloadHash` | version; gap → R2 | ack with `purgedAt`, retried to `TBD-ACK-DEADLINE` | Proposed |
| S3 | `POST /v1/lighthouse/shared-analyses/read` | RoS→IS | `shared-analysis-read.v1` → `analysis.shared.v1` | HMAC + live grant/link check | read-only | — | 404 for anything unshared | Proposed |
| R1 | `POST /v1/lighthouse/state/links` | RoS→IS | `link-state-query.v1` → `link-state.v1` | HMAC | read-only | authoritative, incl. terminal | — | Proposed |
| R2 | `POST /v1/lighthouse/state/grants` | RoS→IS | `grant-state-query.v1` → `grant-state-page.v1` | HMAC | read-only | authoritative, **versioned tombstones**, complete-snapshot absence = purge | tombstones name what to purge | Proposed |

---

## 7. Questions for Relationship OS

1. Will RoS return `investscape-launch-context.v2` (`initiatingProfessional.relationshipOsPersonRef`)? Without it, launches cannot be bound to an InvestScape owner and Stage 1 stays off.
2. Will RoS accept `redemptionAttemptId` on L2 and implement L4?
3. Separate per-direction HMAC secrets and key ids?
4. Which identifier is `recipientProfessionalRef` (`TBD-RECIPIENT-ID`)?
5. `TBD-RETENTION` (how long each side keeps shared data and tombstones) and `TBD-ACK-DEADLINE` (purge acknowledgement deadline).
6. K2 consent page path, and whether K3 carries `linkRequestId`.
7. Confirm push (S2) + recovery (R1/R2) + authorised read (S3) as the sharing model.
