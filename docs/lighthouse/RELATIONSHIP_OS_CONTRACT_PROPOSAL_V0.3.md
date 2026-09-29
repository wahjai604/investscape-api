# InvestScape ↔ Relationship OS — Integration Contract Proposal v0.3

**Status:** PROPOSAL for Relationship OS review. Documentation only: nothing marked *Proposed* is implemented on either side. Every dependent InvestScape capability stays behind a server-side feature flag that is **off**.
**Base:** v0.2 (`RELATIONSHIP_OS_CONTRACT_PROPOSAL_V0.2.md`, reviewed at commit `11b0b2781a23f36dc2b7331595e8c9bcb1f1a8d9`). v0.2 is preserved unchanged. Where v0.3 and v0.2 differ, v0.3 governs.

## Labels

| Label | Meaning |
|---|---|
| **[Existing-both]** | Implemented in both products and verified against Relationship OS source. |
| **[Existing-IS]** | Implemented in investscape-api on `review/lighthouse-p1-separation`, not agreed with Relationship OS. |
| **[Existing-IS, must change]** | Implemented in InvestScape today, but this contract requires different behaviour. |
| **[Proposed]** | Not implemented anywhere. |
| **DECISION REQUIRED** | Deliberately not decided in this document. No value is invented. |

## What changed from v0.2

1. Recovery uses **server-materialised snapshots with a change-sequence watermark** instead of `asOf` + cursor (§5).
2. Event outcomes are exact. **Conflicts are quarantined and block the aggregate**; same-version/different-payload is detected (§3).
3. `purgedAt` is replaced by separate **active-content removal** and **audit-record** states (§6).
4. One opaque professional identifier is used for launch initiators and share recipients. **Grants bind to relationship and professional**, and reassignment never transfers access (§2).
5. Launch recovery is specified end to end: a write-ahead attempt record, `redemptionAttemptId`, lookup, crash handling, and **re-evaluated authority** (§7).
6. A handoff can never extend launch authority. Expired-launch UX and the `listPrice`/`currency` rule are specified (§8).

---

## 1. Transport (unchanged from v0.2 except where noted)

- **Service auth [Existing-both]:** the `x-lighthouse-service`, `-key-id`, `-timestamp`, `-nonce` and `-signature` headers. The signature is `HMAC-SHA256(secret, METHOD\nPATH\nTIMESTAMP\nNONCE\nhex(sha256(rawBody)))` in lowercase hex. Allowed skew is ±300 s. Nonces are stored as a hash and rejected on repeat.
- **Keys per direction [Proposed]:** `is-to-ros-<yyyymm>-<n>` and `ros-to-is-<yyyymm>-<n>`, independent secrets. Today Relationship OS holds one secret for both directions **[Existing-both, must change]**.
- **Retries [Proposed]:** a retry resends identical body bytes and the same `eventId`, with a **new** timestamp, nonce and signature. Retry only on network failure, `429`, `503` or other `5xx`. **Never** retry `400`, `401`, `409` or `422`: those are terminal for those bytes.
- **Payload hash [Proposed]:** `hex(sha256(canonical JSON))`. Canonical JSON has keys sorted at every level, no insignificant whitespace, UTF-8, and excludes the `payloadHash` field itself.
- **Error body [Existing-IS]:** `{"error":{"code":"<UPPER_SNAKE>","message":"<generic>"}}`. Messages never echo request values.

---

## 2. Identity, relationships and recipients

### 2.1 Three separate things

| Concept | Owner | What it proves | What it grants |
|---|---|---|---|
| **Account link** (`crossProductLinkId`) [Existing-IS, provisional] | Both products confirm; InvestScape stores it | An InvestScape actor and a Relationship OS person are the same human, confirmed in both products. Never inferred from email. | **Nothing.** No analysis access, no sharing, no delegation. `LINK_GRANTS` is empty and pinned by a test. |
| **Relationship permission** [Proposed as exchanged data] | Relationship OS | A professional is currently assigned to a relationship in a capacity that permits this use. | Eligibility only. It is a precondition that InvestScape re-checks; it never substitutes for a grant. |
| **Share grant** (`shareGrantId`) [Existing-IS, provisional] | InvestScape (client consent) | The client chose these analyses and fields, for this relationship **and this professional**, for this purpose and period. | Read access to exactly that, while every precondition still holds. |

### 2.2 The professional identifier [Proposed]

Field name everywhere: **`relationshipOsPersonRef`**. It is the same value space as the person on the account link.

Requirements on Relationship OS:
- Opaque. It must not be an email, name, licence number or database primary key.
- Stable for the life of the person's account.
- **Never reassigned** to another person.
- **Scoped to InvestScape**, meaning a pairwise pseudonym: the same person has a different reference in any other product.

It is used as follows:

| Place | Field |
|---|---|
| Launch initiator | `initiatingProfessional.relationshipOsPersonRef` (L2 response v2) |
| Share recipient | `recipient.relationshipOsPersonRef` (S1 request, grant state, S3 read) |
| Account link | `relationshipOsPersonRef` (link invitation, link state) |

A professional acts in InvestScape only through an **active account link** whose `relationshipOsPersonRef` matches. **DECISION REQUIRED (RoS):** confirm the four properties above, and the identifier's format and length bound. The proposal is 1..128 characters from `[A-Za-z0-9_-]`.

### 2.3 Grant binding and reassignment [Proposed]

- A grant binds to the **tuple** (`relationshipRef`, `recipient.relationshipOsPersonRef`, `recipientContext`). All three must match on every read.
- **Reassignment never transfers access.** If a relationship moves to another professional, the existing grant stays bound to the original professional and stops working: see the assignment-ended event below. The new professional sees nothing until the client creates a **new** grant naming them.
- If the original professional's assignment ends, InvestScape revokes every grant bound to (relationship, that professional) with reason `recipient_unassigned`. Revocation is final (§4.3).

**RoS → IS event, `lighthouse.relationship-assignment.ended.v1` [Proposed]** (delivered in the §3 envelope with `aggregateKind: "relationship_assignment"`):

| Field | Type | Notes |
|---|---|---|
| `relationshipRef` | string ≤128 | |
| `relationshipOsPersonRef` | string ≤128 | the professional whose assignment ended |
| `endedAt` | ISO-8601 | |
| `reason` | `reassigned` \| `relationship_closed` \| `professional_removed` \| `eligibility_lost` | |

InvestScape's response is idempotent. Grants already revoked stay revoked.

---

## 3. Event envelope, outcomes and conflicts

### 3.1 Envelope [Existing-IS for the inbound route; `payload` and `changeSeq` Proposed]

| Field | Type | Notes |
|---|---|---|
| `eventId` | string 1..128 (UUID recommended) | unique per logical event |
| `schemaVersion` | string | payload schema name, e.g. `investscape.share-grant.changed.v1` |
| `aggregateKind` | `link` \| `share_grant` \| `relationship_assignment` | |
| `aggregateId` | string ≤256 | |
| `targetState` | string | the aggregate's state after this event |
| `version` | int ≥ 1 | monotonic per aggregate, assigned by the aggregate's owner |
| `changeSeq` | int64 as a decimal string [Proposed] | the owner's global, gap-tolerant, strictly increasing change sequence; used by snapshots (§5) |
| `occurredAt` | ISO-8601 | informational; **never** used for ordering |
| `correlationId` | string ≤256, optional | |
| `payloadHash` | 64 lowercase hex | over `payload` (§1) |
| `payload` | object [Proposed] | the schema-named body |

**Aggregate owners:**
- `share_grant`: InvestScape.
- `relationship_assignment`: Relationship OS.
- `link`: InvestScape stores it, but either side may **revoke** it. A revocation from either side takes the next version, allocated by InvestScape as the store of record.

### 3.2 Receiver ledger [Proposed; partially Existing-IS]

The receiver keeps two uniqueness keys:
- `eventId → payloadHash`. **[Existing-IS]** `lighthouse.inbound_events.event_id` is the primary key.
- `(aggregateKind, aggregateId, version) → payloadHash`. **[Existing-IS, must change]** this is only a non-unique index today, so a same-version/different-payload conflict is not detected.

### 3.3 Outcomes (evaluated in this order)

| # | Condition | Outcome | HTTP | Applied? | Receiver action | Sender action |
|---|---|---|---|---|---|---|
| 1 | Envelope malformed, schema unknown, or payload fails strict validation | `rejected_malformed` | `400` | no | audit | fix and send a **new** `eventId`; never retry the same bytes |
| 2 | `eventId` seen with the **same** `payloadHash` | `duplicate` | `200` | no (already applied or recorded) | none | done |
| 3 | `eventId` seen with a **different** `payloadHash` | `conflict` / `EVENT_ID_PAYLOAD_MISMATCH` | `409` | **no** | quarantine, alert, block the aggregate | stop, alert, reconcile (§3.4) |
| 4 | `(aggregate, version)` seen under another `eventId` with the **same** `payloadHash` | `duplicate` | `200` | no | record the alias `eventId` | done |
| 5 | `(aggregate, version)` seen with a **different** `payloadHash` | `conflict` / `AGGREGATE_VERSION_PAYLOAD_MISMATCH` | `409` | **no** | quarantine, alert, block the aggregate | stop, alert, reconcile |
| 6 | Aggregate is blocked by an open quarantine | `blocked` | `409` | no | record the event for replay after reconciliation | stop; resume after reconciliation |
| 7 | `version` ≤ stored version (and not rule 4 or 5) | `stale` | `200` | no | record | done. A newer state already won. |
| 8 | The transition is not permitted by the lifecycle (e.g. `revoked → active`) | `rejected_transition` | `422` | no | quarantine and alert. This is an integrity error, not noise. | stop, alert, reconcile |
| 9 | `version` > stored + 1 | `applied_with_gap` | `200` | yes | apply, then schedule a recovery read (§5) for this aggregate | done |
| 10 | Otherwise | `applied` | `200` | yes | apply | done |

**[Existing-IS, must change]** where current InvestScape code differs:
- An `eventId` conflict returns `200` with `outcome: "conflict"`. It is audited but not quarantined, and the aggregate is not blocked. It must return `409` and quarantine.
- For the **same version**, a later `occurredAt` is applied as a tie-break (`applyLifecycleEvent`). It must be treated as rule 4 or rule 5 instead.
- A `rejected` transition returns `200`. It must return `422` and quarantine.
- Stage 6 dispatch rebuilds `appliedEventIds` as empty from the store, so `eventId` detection relies only on the ledger. That's acceptable once the ledger has both keys.

**Acknowledgement `lighthouse.event-ack.v1` [Proposed]**, returned for every non-`400`/`401` response:

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"lighthouse.event-ack.v1"` | |
| `eventId` | string | echoed |
| `aggregateKind`, `aggregateId` | string | echoed |
| `version` | int | echoed |
| `outcome` | `applied` \| `applied_with_gap` \| `duplicate` \| `stale` \| `conflict` \| `blocked` \| `rejected_transition` | |
| `conflictKind` | `EVENT_ID_PAYLOAD_MISMATCH` \| `AGGREGATE_VERSION_PAYLOAD_MISMATCH` | only for `conflict` |
| `quarantineId` | string | for `conflict`, `blocked` and `rejected_transition` |
| `storedVersion` | int | receiver's version after processing |
| `receivedAt` | ISO-8601 | |

Only `applied`, `applied_with_gap`, `duplicate` and `stale` count as **successfully processed**. A sender must never mark an event delivered on `conflict`, `blocked` or `rejected_transition`.

### 3.4 Quarantine and reconciliation [Proposed]

1. **Quarantine record** at the receiver: `quarantineId`, `eventId`, aggregate key, `version`, both `payloadHash` values, the event's `receivedAt`, `conflictKind`, and state `open`. The payload is not stored, only hashes and ids.
2. **Alert** on creation. Routing and severity: **DECISION REQUIRED (both, operational)**.
3. **Block:** further events for that aggregate return `blocked` until the quarantine is `resolved`. Reads of the aggregate's content fail closed: a blocked grant discloses nothing.
4. **Reconcile:** the receiver performs a recovery read of that aggregate from its **owner** (§5, single-aggregate form). The owner's current state at a known `changeSeq` is authoritative. The receiver replaces its state if the owner's version is greater than or equal to its own.
5. **Resolve:** record the resolution (`adopted_owner_state` \| `operator_override`), who resolved it and when; unblock the aggregate; replay recorded `blocked` events through §3.3.
6. **Sender side:** the outbox entry moves to `conflict` (terminal for those bytes) and alerts. The owner never "fixes" a conflict by re-sending different bytes under the same `eventId`.

---

## 4. Lifecycles

### 4.1 Account link [Existing-IS]

States: `pending → active → suspended ⇄ active`. `revoked` and `expired` are terminal.
- On `revoked` or `expired`, **every active grant on the link is revoked in the same transaction**. **[Existing-IS]** this is `revokeDependentShareGrants`, used by both the user unlink and inbound Stage 6.
- `suspended` does not revoke grants. Reads fail closed because every shared read re-checks that the link is active. **[Existing-IS]**
- Relinking creates a new `crossProductLinkId`.

### 4.2 Share grant [Existing-IS]

States: `active → expired | revoked | tombstoned`, `expired → revoked | tombstoned`, `revoked → tombstoned`. `tombstoned` is terminal.
- Grants are **never reactivated**. Re-sharing creates a new `shareGrantId` at version 1.
- **[Proposed]** revocation reasons: `client_revoked`, `link_revoked`, `recipient_unassigned`, `analysis_deleted`, `expired`, `policy`.

### 4.3 Per-analysis share state [Proposed]

The pair (`shareGrantId`, `externalAnalysisId`) has state `shared → unshared | deleted`. `deleted` is terminal. Each change increments the grant's `version`.

---

## 5. Recovery snapshots [Proposed]

### 5.1 Why an `asOf` timestamp is not enough

Rows change while a client pages through them. With keyset pagination ordered by a mutable column, a row that changes mid-read can move behind the cursor, and be skipped, or ahead of it, and appear twice. A snapshot must therefore be a **fixed set** with a **watermark**.

### 5.2 Change sequence

Each owner keeps a strictly increasing `changeSeq`, for example a database sequence. Every state change to a recoverable aggregate is stamped with the next value **in the same transaction**, and the same value goes in the change's event envelope. `changeSeq` may have gaps. It never goes backwards.

### 5.3 Creating a snapshot

**R2c — `POST /v1/lighthouse/state/grants/snapshots`** (RoS → IS, HMAC)

Request `lighthouse.grant-snapshot-create.v1`:

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"lighthouse.grant-snapshot-create.v1"` | |
| `relationshipRef` | string ≤128 | |
| `recipient.relationshipOsPersonRef` | string ≤128 | |
| `mode` | `full` \| `delta` | |
| `sinceChangeSeq` | decimal string | required for `delta`, forbidden for `full` |

Response `201`, `lighthouse.grant-snapshot.v1`:

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"lighthouse.grant-snapshot.v1"` | |
| `snapshotId` | string ≤64 | opaque, unguessable |
| `mode` | `full` \| `delta` | |
| `watermarkChangeSeq` | decimal string | every change with `changeSeq` ≤ watermark is reflected; none above it is |
| `sinceChangeSeq` | decimal string \| null | echoed for `delta` |
| `itemCount` | int | total items in the snapshot |
| `createdAt` | ISO-8601 | |
| `expiresAt` | ISO-8601 | absolute expiry |

Server semantics:
- **Full:** in one read-consistent transaction, InvestScape materialises the identity of every grant ever addressed to the scope, in **all states including tombstones** still retained, as (`shareGrantId`, `version`, `changeSeq`), together with `watermarkChangeSeq` = the highest committed `changeSeq`.
- **Delta:** InvestScape selects, from its append-only change log, every change in the scope with `sinceChangeSeq` < `changeSeq` ≤ watermark, collapsed to the latest version per grant.
- Pages are served from the materialised set, **not** from live rows, so later writes cannot move, add or remove items.
- Item content (state, analyses, fields) is served **as of each item's recorded version**. InvestScape retains, for every materialised (grant, version), the grant state at that version until the snapshot expires.

### 5.4 Reading pages

**R2p — `POST /v1/lighthouse/state/grants/snapshots/{snapshotId}/pages`** (RoS → IS, HMAC)

Request `lighthouse.grant-snapshot-page-request.v1`: `{ schemaVersion, pageToken: string | null, limit: 1..200 }`

Response `200`, `lighthouse.grant-snapshot-page.v1`:

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"lighthouse.grant-snapshot-page.v1"` | |
| `snapshotId`, `watermarkChangeSeq` | echoed | |
| `pageIndex` | int from 0 | |
| `items[]` | `GrantState` | ordered by `shareGrantId` within the fixed set |
| `nextPageToken` | string \| null | null on the last page |
| `final` | boolean | true exactly on the last page |

`GrantState`:
- `shareGrantId`, `version`, `changeSeq`
- `state` (`active` \| `expired` \| `revoked` \| `tombstoned`)
- `reason?`
- `relationshipRef`, `recipient.relationshipOsPersonRef`, `recipientContext`
- `effectiveFrom`, `expiresAt?`, `revokedAt?`, `tombstonedAt?`
- `analyses[]`: each `{ externalAnalysisId, state: shared | unshared | deleted }`, ids only
- `allowedFieldKeys[]` (only when `active`)

Content is always fetched through S3.

- Page tokens are opaque and bound to the `snapshotId`. The same token returns the same page, so page reads are idempotent and repeatable.
- **Snapshot expiry:** a proposed default of 15 minutes idle and 60 minutes absolute (**DECISION REQUIRED (both)**: confirm or replace). After expiry, every page request returns `410 SNAPSHOT_EXPIRED`.
- **Delta too old:** if `sinceChangeSeq` is older than InvestScape's retained change log, the create call returns `410 CHANGE_LOG_TRUNCATED` and the receiver must take a `full` snapshot. How long the change log is retained: **DECISION REQUIRED (IS, bounded by retention policy)**.

### 5.5 Receiver rules

Let `held[g]` = (`version`, `changeSeq`) of the receiver's current copy of grant `g`, whether it came from an event or a snapshot.

1. **Upsert while paging:** apply an item only if `item.version` > `held.version`. Snapshot data never overrides a newer event.
2. **Restart:** on `410` or any failed page, discard the snapshot and create a new one. Upserts already applied stay, since they were version-guarded. **Nothing may be purged on the basis of an incomplete snapshot.**
3. **Purge (full mode only, after the page with `final: true`):** for each held grant `g` in scope that did **not** appear in the snapshot, remove it **only if** `held[g].changeSeq` ≤ `watermarkChangeSeq`. If the receiver learned of `g` from an event after the watermark, it keeps it: absence is explained by the watermark, not by revocation.
4. **Delta mode never purges by absence.** Revocations arrive as items with terminal states.
5. **Blocked aggregates** (§3.4) are skipped by upsert and purge until reconciled.
6. **Single-aggregate recovery** for reconciliation: a `full` snapshot scoped by `shareGrantId` (additional optional request field `shareGrantId`), with the same rules.

**R1 — link state** uses the same snapshot pattern:
- Endpoints: `POST /v1/lighthouse/state/links/snapshots` and `…/{snapshotId}/pages`.
- Scope: `relationshipOsPersonRef`.
- Items: `LinkState` = `{ crossProductLinkId, version, changeSeq, state, changedAt, revokedAt? }`, **including terminal links**.

---

## 6. Revocation and deletion acknowledgements [Proposed]

`purgedAt` (v0.2) is withdrawn.

### 6.1 Removal triggers (IS → RoS through S2 events)

`investscape.share.revoked.v1`, `investscape.analysis.unshared.v1`, `investscape.analysis.tombstoned.v1`, plus grant revocation caused by link revocation or assignment end (reason field, §4.2).

### 6.2 Two separate states at the receiver

| Dimension | States | Meaning |
|---|---|---|
| **Active content** | `present` → `removed` | `removed` = no longer displayed, searchable, exportable, notifiable or usable as input anywhere in the receiving product, including caches, search indexes, generated summaries and assistant context. |
| **Audit record** | `none` \| `retained_minimal` → `deleted` | A minimal record kept for accountability. It may contain **only** these fields: `shareGrantId`, `externalAnalysisId`, `relationshipRef`, `recipient.relationshipOsPersonRef`, trigger, the event ids, timestamps and `correlationId`. It contains **no analysis content or summary fields**. |

### 6.3 Removal acknowledgement, `lighthouse.removal-ack.v1` (RoS → IS)

**Endpoint:** `POST /v1/lighthouse/removal-acks` (RoS → IS, HMAC). This is sent **separately** from the event ack, because removal may complete after the event is received.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"lighthouse.removal-ack.v1"` | |
| `ackId` | string | idempotency key |
| `triggerEventId` | string | the S2 event being acknowledged |
| `shareGrantId` | string | |
| `externalAnalysisIds[]` | string[] | those covered; empty means the whole grant |
| `activeContent.state` | `"removed"` | the ack may be sent **only** when true |
| `activeContent.removedAt` | ISO-8601 | |
| `auditRecord.state` | `none` \| `retained_minimal` | |
| `auditRecord.fields[]` | string[] | ⊆ the allow-list in §6.2 |
| `auditRecord.plannedDeletionAt` | ISO-8601 \| null | null only if **DECISION REQUIRED (retention)** is still open |

Later, **`lighthouse.audit-record-deleted.v1`** (RoS → IS, same endpoint): `{ schemaVersion, ackId, triggerEventId, shareGrantId, deletedAt }`.

Semantics:
- An event ack (§3.3) only means **received**. The removal ack means **no longer active**. They are never merged.
- InvestScape records both on the consent record's history. Outbox retries continue until the removal ack arrives.
- **Removal deadline:** **DECISION REQUIRED (both, legal/compliance)**. No value is proposed. What happens when the deadline passes (alert, escalation, suspending further sharing to that relationship) is also **DECISION REQUIRED**.
- **Audit retention period:** **DECISION REQUIRED (both, legal/compliance)**.

InvestScape's own obligations are symmetric when a client deletes an analysis locally [Proposed]: active content is removed at once, and an audit record is kept under the same allow-list.

---

## 7. Launch and launch recovery

### 7.1 Existing flow [Existing-IS unless marked]

1. The browser lands on `GET /relationship-os/launch?launch_session&code`. **[Existing-both]** URL shape.
2. `POST /v1/lighthouse/launch/handoffs`, with no session, seals the code: AES-256-GCM under an HKDF key derived from a 256-bit browser-held token. The token is passed in the URL fragment, and the handoff is single-use.
3. The app, once signed in, calls `POST /v1/lighthouse/launch/handoffs/redeem`. An actor with no active link is refused **without** consuming the handoff.
4. Redemption: `POST /v1/investscape/launch-sessions/redeem`. **[Existing-both]** v1.
5. Ownership: bind only if the signed-in actor's **active** link matches the initiator. A v1 context names no initiator, so it is always refused (§7.2).

### 7.2 L2 schemas

**Request `investscape-launch-redeem-request.v2` [Proposed]**. The v1 request is `{launchSessionId, code}` with no `schemaVersion` **[Existing-both]**.

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"investscape-launch-redeem-request.v2"` | |
| `launchSessionId` | UUID | |
| `code` | string 40..256 | |
| `redemptionAttemptId` | UUID v4 | generated by InvestScape and persisted **before** sending (§7.3) |

**Response `investscape-launch-context.v2` [Proposed]** contains every v1 field **[Existing-both]**: `schemaVersion`, `launchSessionId`, `analysisType`, `modules`, `permittedScopes`, `redactedScopes`, `expiresAt`, `context.property{propertyRef, propertyType?, jurisdiction?, address?, listPrice?, currency?}`, `correlationId`. It adds:

| Field | Type | Notes |
|---|---|---|
| `initiatingProfessional.relationshipOsPersonRef` | string ≤128 | §2.2 identifier. Nothing else in this object. |
| `redemptionAttemptId` | UUID | echoed; must equal the request's |
| `authorityCheckedAt` | ISO-8601 | when Relationship OS last evaluated that the launch authority holds |

The schema is strict, and unknown fields are rejected **[Existing-IS]**.

**Attempt-keyed idempotency [Proposed]:**
- Relationship OS stores `consumed_by_attempt_id` when it consumes a session.
- The same `code` and the same `redemptionAttemptId`, sent before `expiresAt + lookupGrace`, return **the same context, re-authorised** (§7.5).
- A different attempt id gets `409 LAUNCH_SESSION_ALREADY_CONSUMED`. **[Existing-both]** that error code.
- `lookupGrace`: a proposed default of 900 s. **DECISION REQUIRED (RoS)**.

**L4 — `POST /v1/investscape/launch-sessions/redemption-lookup` [Proposed]** (IS → RoS, HMAC)

Request `investscape-redemption-lookup.v1`: `{ schemaVersion, launchSessionId, redemptionAttemptId }`

Response `200`, `investscape-redemption-status.v1`:

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"investscape-redemption-status.v1"` | |
| `launchSessionId`, `redemptionAttemptId` | echoed | |
| `status` | `consumed_by_this_attempt` \| `not_consumed` \| `consumed_by_other_attempt` \| `expired_unconsumed` \| `authority_revoked` | |
| `launchContext` | `investscape-launch-context.v2` | present **only** for `consumed_by_this_attempt` **and** only if authority still holds (§7.5) |
| `checkedAt` | ISO-8601 | |

Errors: `404 LAUNCH_SESSION_NOT_FOUND`, `410 REDEMPTION_LOOKUP_EXPIRED` (after `expiresAt + lookupGrace`), `401 SERVICE_AUTH_FAILED`.

### 7.3 InvestScape attempt record [Proposed; IS table `lighthouse.launch_redemption_attempts`]

| Column | Notes |
|---|---|
| `redemption_attempt_id` | UUID, primary key |
| `operation_id` | UUID, the browser-visible status key |
| `launch_session_id` | UUID |
| `actor_ref` | the signed-in professional |
| `handoff_id` | nullable (direct redeem has none) |
| `state` | `in_flight` \| `completed` \| `failed_definite` \| `ambiguous` \| `resolved_no_analysis` \| `abandoned` |
| `created_at`, `updated_at`, `next_check_at`, `check_count` | |
| `resolution` | nullable reason code |

It **never** stores the launch code, the handoff token or the launch context.

**Write-ahead rule:** claiming the handoff (which wipes its ciphertext) and inserting the `in_flight` attempt happen **in one transaction**, before L2 is sent. A consumed handoff therefore always has an attempt record, even if the process dies immediately afterwards.

### 7.4 Recovery cases

| Case | What happens |
|---|---|
| L2 returns 200 | Bind the analysis (ownership rule) and mark the attempt `completed`, **in one transaction**. |
| L2 returns a definite error (`400/401/403/404/409/410`) | `failed_definite` with the mapped reason. No analysis. |
| L2 times out, the connection resets after sending, or `5xx` | `ambiguous`. The reconciler calls L4 with backoff (1, 2, 4 … capped at 60 s). |
| **Process crash** after the handoff claim, before or after L2 was sent | The row stays `in_flight`. The reconciler treats any `in_flight` row older than the L2 timeout plus 30 s as `ambiguous` and calls L4. The row itself shows whether L2 was sent, so no special-casing is needed. |
| Crash after L2 succeeded but before binding | Same as above. L4 returns `consumed_by_this_attempt` with the context, and InvestScape binds, idempotently on `launchSessionId`. |
| L4 → `consumed_by_this_attempt` | Re-run the ownership rule against the actor's **current** links (§7.5), then bind or refuse. `completed` or `resolved_no_analysis`. |
| L4 → `not_consumed` or `expired_unconsumed` | `resolved_no_analysis`. The code no longer exists at InvestScape (wiped at claim), so it cannot be retried. The professional starts again from Relationship OS. |
| L4 → `consumed_by_other_attempt` | `resolved_no_analysis` plus a **security alert**: another attempt used this session. |
| L4 → `authority_revoked` | `resolved_no_analysis`. |
| L4 → `410 REDEMPTION_LOOKUP_EXPIRED`, or the window closes before resolution | `abandoned` plus an alert. No analysis is ever created afterwards. |

**Browser status [Proposed]:** `GET /v1/lighthouse/launch/attempts/{operationId}` requires the IS session and is visible only to the attempt's own actor; any other actor gets `404`. It returns `{ state: "confirming" | "ready" | "not_completed" | "expired", analysisId? }`. The UI polls while the state is `confirming`.

### 7.5 Recovered context never restores revoked authority [Proposed]

- On an attempt-keyed repeat of L2, and on L4, Relationship OS **re-evaluates the launch authority at that moment**: session not revoked; relationship active; professional still assigned; entitlement active; the professional's capacity still permitted. If any check fails, the response is `authority_revoked` with **no context**, even though the session was consumed by this attempt.
- InvestScape independently re-checks, at binding time, that the actor's link to `initiatingProfessional.relationshipOsPersonRef` is **active now**, not merely at redemption time.
- Recovery never extends `expiresAt`, never widens `permittedScopes`, and never removes `redactedScopes`. The recovered context must equal the original's scope, or be narrower if Relationship OS narrows it on re-authorisation.
- **Authority revoked after an analysis was already bound:** proposed RoS → IS event `investscape.launch-authority.revoked.v1` = `{ launchSessionId, reason, revokedAt }` in the §3 envelope with `aggregateKind: "launch_session"`. InvestScape marks the binding revoked and stops displaying client-derived launch context. Whether the professional keeps their own worksheet inputs is **DECISION REQUIRED (product)**.

---

## 8. Expiry and scope

### 8.1 A handoff never extends launch authority

- Relationship OS enforces launch expiry at redemption **[Existing-both]**: `410 LAUNCH_SESSION_EXPIRED`. That remains authoritative.
- InvestScape's handoff TTL is 600 s **[Existing-IS]**. InvestScape cannot see the launch expiry before redemption, so today a handoff can outlive the session. It is still safe, because redemption then fails at Relationship OS, but the user waits for nothing.
- **[Proposed]** Relationship OS adds `exp=<unix seconds>` to the launch URL. InvestScape sets handoff expiry to `min(created + 600 s, exp)` and refuses to seal one when `exp` ≤ now. The value is unsigned and browser-supplied, so it may **only shorten** the handoff and is never trusted to lengthen it. The Relationship OS check stays authoritative.
- Lookup (L4) is not an extension. It only reports whether a consumption that happened **before** expiry succeeded, and it re-evaluates authority (§7.5).

### 8.2 Expired-launch user experience [Existing-IS for the landing page; app states Proposed]

| Where | Condition | Message | Actions |
|---|---|---|---|
| Landing page | handoff create refused as expired (with `exp`), or the landing link is malformed | "This link has expired. Return to Relationship OS and choose *Open in InvestScape* again." | link back to Relationship OS; **no retry button** |
| App resume | handoff redeem `410` | same message | same |
| App resume | L2 `410 LAUNCH_SESSION_EXPIRED` | same message | same |
| App resume | attempt `abandoned` or `resolved_no_analysis` (not consumed) | "We couldn't confirm this launch with Relationship OS. No analysis was created. Please open it again from Relationship OS." | same |

In every expired case: no analysis is created, no client or property data is shown, and nothing is cached.

### 8.3 `listPrice` / `currency`

- **Requirement on Relationship OS [Proposed; currently violated]:** include `context.property.listPrice` and `context.property.currency` **only if** `finance.summary` ∈ `permittedScopes` **and** `finance.summary` ∉ `redactedScopes`. Otherwise omit both keys. Absent, not null.
- **[Existing-both, must change]** Relationship OS today includes them whenever the listing row has values.
- **[Existing-IS]** InvestScape enforces the same rule locally (`enforceScopeRedaction`) and keeps doing so after Relationship OS complies, as a second line of defence. The same scope-to-field rule applies to `address` (`property.address`).

---

## 9. Endpoint matrix (v0.3)

| # | Endpoint | Direction | Schema(s) | Auth | Idempotency | Ordering / recovery | Status |
|---|---|---|---|---|---|---|---|
| L1a | `POST /v1/lighthouse/launch/handoffs` | browser → IS | `{launchSessionId, code}` → `handoff_created` | none (seal only) | new token each call | TTL `min(600 s, exp)` | Existing-IS (`exp` Proposed) |
| L1b | `POST /v1/lighthouse/launch/handoffs/redeem` | app → IS | `{handoffToken}` | IS session; linked initiator | single-use token | write-ahead attempt (§7.3) | Existing-IS (attempt Proposed) |
| L1c | `GET /v1/lighthouse/launch/attempts/{operationId}` | app → IS | status | IS session, own actor | read | — | Proposed |
| L2 | `POST /v1/investscape/launch-sessions/redeem` | IS → RoS | request v1/**v2**; `launch-context.v1`/**v2** | HMAC | single-use code; same attempt → same context | ambiguous → L4 | v1 Existing-both; v2 Proposed |
| L3 | `POST /v1/investscape/analysis-references` | IS → RoS | `result-reference.v1` / `-ack.v1` | HMAC | `externalAnalysisId` | status monotonic | Existing-both |
| L4 | `POST /v1/investscape/launch-sessions/redemption-lookup` | IS → RoS | `redemption-lookup.v1` → `redemption-status.v1` | HMAC | read | re-authorises | Proposed |
| L5 | `investscape.launch-authority.revoked.v1` via S-inbound | RoS → IS | §7.5 | HMAC | `eventId` | §3 | Proposed |
| K1–K4 | link request / RoS consent / invitation / accept | as v0.2 §3 | as v0.2 | as v0.2 | as v0.2 | as v0.2 | K3/K4 Existing-IS provisional; K1/K2 Proposed |
| K5 | `POST /v1/investscape/link-events` | IS → RoS | §3 envelope, `link.confirmed.v1` / `link.revoked.v1` | HMAC | §3.3 | version, `changeSeq` | Proposed |
| K6 | `POST /v1/lighthouse/sync/events` (`aggregateKind: link`) | RoS → IS | §3 envelope | HMAC | §3.3 | atomic link and grant revocation | Existing-IS (outcomes must change, §3.3) |
| A1 | `POST /v1/lighthouse/sync/events` (`aggregateKind: relationship_assignment`) | RoS → IS | `relationship-assignment.ended.v1` | HMAC | §3.3 | revokes bound grants | Proposed |
| S1 | `POST /v1/lighthouse/shares`, `…/{id}/revoke` | browser → IS | v0.2 §4.2 **+ `recipient.relationshipOsPersonRef` (required)** | IS session, personal | `Idempotency-Key` header | version CAS on revoke | Existing-IS; recipient Proposed |
| S2 | `POST /v1/investscape/share-events` | IS → RoS | §3 envelope + v0.2 §4.3 payloads (+ recipient, reason) | HMAC | §3.3 | version, `changeSeq`; gap → R2 | Proposed |
| S3 | `POST /v1/lighthouse/shared-analyses/read` | RoS → IS | `shared-analysis-read.v1` (+ recipient) → `analysis.shared.v1` | HMAC + live checks | read | blocked aggregates fail closed | Proposed |
| RA | `POST /v1/lighthouse/removal-acks` | RoS → IS | `removal-ack.v1`, `audit-record-deleted.v1` | HMAC | `ackId` | — | Proposed |
| R1 | `POST /v1/lighthouse/state/links/snapshots` (+ `/pages`) | RoS → IS | link snapshot | HMAC | page tokens repeatable | §5 | Proposed |
| R2 | `POST /v1/lighthouse/state/grants/snapshots` (+ `/{id}/pages`) | RoS → IS | `grant-snapshot-create.v1`, `grant-snapshot.v1`, `grant-snapshot-page.v1` | HMAC | page tokens repeatable | watermark; purge only after `final` | Proposed |

---

## 10. Implementation checklists

Every item is Proposed unless labelled otherwise. Nothing starts until this document is agreed.

### 10.1 InvestScape

- [ ] Ledger: add a unique key on (`aggregate_kind`, `aggregate_id`, `version`) → `payload_hash`; implement §3.3 rules 4–6. **[must change]**
- [ ] Return `409` with a quarantine on `eventId` conflicts. **[must change]** Today: `200 conflict`, audit only.
- [ ] Remove the same-version `occurredAt` tie-break in `applyLifecycleEvent`. **[must change]**
- [ ] Return `422` with a quarantine on rejected transitions. **[must change]**
- [ ] Quarantine table, alert hook, per-aggregate block, reconcile-and-resume.
- [ ] `lighthouse.event-ack.v1` responses.
- [ ] `changeSeq` sequence stamped in the same transaction as every grant and link change; append-only change log.
- [ ] Snapshot materialisation tables, R1/R2 endpoints, page tokens, expiry, `410` handling.
- [ ] Per-(grant, analysis) state table (§4.3).
- [ ] `recipient.relationshipOsPersonRef` on grants: S1 request, storage, S3 checks.
- [ ] `relationship-assignment.ended.v1` handling → revoke grants with `recipient_unassigned`.
- [ ] S2 outbox emission for every grant change, including link-cascade revocations. Not emitted today.
- [ ] Removal-ack endpoint and consent-history recording.
- [ ] `launch_redemption_attempts` table; a write-ahead transaction with the handoff claim; reconciler; L1c status route.
- [ ] Send `investscape-launch-redeem-request.v2`; accept `launch-context.v2`; verify the echoed `redemptionAttemptId`.
- [ ] Handoff TTL `min(600 s, exp)` once Relationship OS sends `exp`.
- [ ] Concurrency test: two simultaneous claims of one handoff give exactly one success (flagged in review; not yet tested).
- [ ] App resume page (WeWeb): read the fragment, clear it, sign in, redeem, poll L1c, show the §8.2 states.
- [x] Local scope redaction of `listPrice`/`currency`/`address`. **[Existing-IS]**
- [x] Atomic link → grant cascade on both unlink paths. **[Existing-IS]**
- [x] Launch ownership rule and v1 refusal. **[Existing-IS]**

### 10.2 Relationship OS

- [ ] Separate per-direction HMAC secrets and key ids. **[must change]**
- [ ] Correct the gateway docs from `X-Service-*` to `x-lighthouse-*`.
- [ ] Opaque, stable, never-reassigned, InvestScape-scoped `relationshipOsPersonRef` for professionals (§2.2).
- [ ] L2 v2: accept `redemptionAttemptId`, store `consumed_by_attempt_id`, return `launch-context.v2` with `initiatingProfessional`, echoed attempt id and `authorityCheckedAt`; attempt-keyed repeat within `expiresAt + lookupGrace`.
- [ ] L4 lookup with re-authorisation (§7.5).
- [ ] Omit `listPrice`/`currency` unless `finance.summary` is permitted and not redacted. **[must change]**
- [ ] `exp` query parameter on the launch URL.
- [ ] `relationship-assignment.ended.v1` and `launch-authority.revoked.v1` emission.
- [ ] Event receiver implementing §3.3 exactly, including quarantine and block.
- [ ] S2 receiver: version-guarded storage of references and selected fields only.
- [ ] Removal pipeline covering display, search, caches, generated summaries and assistant context, then `removal-ack.v1`; `audit-record-deleted.v1` later.
- [ ] R1/R2 client: full and delta snapshots; restart on `410`; purge only after `final: true` under the §5.5 watermark rule.
- [ ] K1/K2 consent flow; `linkRequestId` on K3.

---

## 11. Decisions required

| # | Decision | Owner |
|---|---|---|
| D1 | Professional identifier: confirm opaque, stable, never reassigned and InvestScape-scoped; format and length | Relationship OS |
| D2 | Adopt `launch-context.v2` + `redemptionAttemptId` + L4 (without these, Stage 1 stays off) | Relationship OS |
| D3 | `lookupGrace` value (proposed 900 s) | Relationship OS |
| D4 | Removal-acknowledgement deadline, and the consequence of missing it | Both, legal/compliance |
| D5 | Audit-record retention period (sets `plannedDeletionAt`) | Both, legal/compliance |
| D6 | Retention of tombstones and of the change log (bounds delta recovery and `CHANGE_LOG_TRUNCATED`) | InvestScape, within D5 |
| D7 | Snapshot expiry values (proposed 15 min idle / 60 min absolute) | Both |
| D8 | Alert routing and severity for quarantines and `consumed_by_other_attempt` | Both, operations |
| D9 | What a professional keeps after `launch-authority.revoked` (own worksheet inputs vs nothing) | Product |
| D10 | Per-direction HMAC keys and the rotation procedure | Both |
| D11 | Add `exp` to the launch URL | Relationship OS |
| D12 | Push (S2) + snapshots (R1/R2) + authorised read (S3) as the sharing model | Both |
