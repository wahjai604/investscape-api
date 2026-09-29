# InvestScape ↔ Relationship OS — Integration Contract Proposal v0.3

**Status:** PROPOSAL for Relationship OS review. Documentation only: nothing marked *Proposed* is implemented on either side. Every dependent InvestScape capability stays behind a server-side feature flag that is **off**.
**Base:** v0.2 (`RELATIONSHIP_OS_CONTRACT_PROPOSAL_V0.2.md`, reviewed at commit `11b0b2781a23f36dc2b7331595e8c9bcb1f1a8d9`). v0.2 is preserved unchanged. Where v0.3 and v0.2 differ, v0.3 governs.
**Revision:** v0.3 r3. It supersedes r2 (commit `39bd27d4c7a9f66e326fdac0af633be46df5809f`), which superseded r1 (commit `c61b34c58934ddd8a911ef08fc9c8d6a1da73a4c`).

r3 changes:

| Section | Change |
|---|---|
| §3.2.1 | Separates the full `eventDigest` from a new `versionContentDigest`, which excludes `eventId`. Alias deduplication uses the latter. |
| §3.2.2, §3.3 | Conflict variants are stored keyed by (`eventId`, `eventDigest`). The original accepted event and every conflicting variant keep their own outcome and quarantine. |
| §7.2, §7.4 | Relationship OS enforces the acceptance deadline inside the atomic consumption transaction. Locked finalisation means an attempt declared "not consumed" can never consume later. |

r2 changes (retained):

| Section | Change |
|---|---|
| §3.2 | The canonical digest binds every authoritative envelope field and the payload. Excluded fields are listed. |
| §3.3 | Retries replay the **recorded** outcome. An unresolved conflict, block or rejection is returned again, not downgraded to `duplicate`. |
| §3.4 | Blocked events are not retained by the receiver; the sender resubmits them after reconciliation. |
| §5.2 | A plain database sequence is replaced by a commit-safe protocol that cannot miss late commits. |
| §7.3–7.4 | Fixes the inconsistency about whether the attempt record knows L2 was sent. |

Worked examples accompany each change.

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
- **Event digest [Proposed, r2]:** defined in §3.2. It replaces v0.2's payload-only hash.
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
| `eventDigest` | 64 lowercase hex | §3.2.1. Binds every other envelope field and the payload. (`versionContentDigest` is **derived** by the receiver and not transmitted.) **[Existing-IS, must change]** the inbound route today requires a field named `payloadHash` whose coverage is unspecified. |
| `payload` | object [Proposed] | the schema-named body |

**Aggregate owners:**
- `share_grant`: InvestScape.
- `relationship_assignment`: Relationship OS.
- `link`: InvestScape stores it, but either side may **revoke** it. A revocation from either side takes the next version, allocated by InvestScape as the store of record.

### 3.2 Event digest and receiver ledger [Proposed, r2]

#### 3.2.1 Digest

`eventDigest = lowercase hex( SHA-256( JCS(digestInput) ) )`. JCS is the JSON Canonicalization Scheme, RFC 8785: sorted keys, fixed number and string encoding, UTF-8, no whitespace.

`digestInput` is a JSON object with **exactly** these members, all required:

| Member | Value |
|---|---|
| `eventId` | as sent |
| `schemaVersion` | as sent |
| `aggregateKind` | as sent |
| `aggregateId` | as sent |
| `targetState` | as sent |
| `version` | as sent (JSON integer) |
| `changeSeq` | as sent (decimal string) |
| `occurredAt` | as sent (string, byte-for-byte; not reparsed or normalised) |
| `correlationId` | as sent, or JSON `null` when absent |
| `payload` | the payload object as sent, canonicalised by JCS recursively |

**Excluded, and only these:**
1. `eventDigest` itself.
2. Transport metadata outside the JSON body: the `x-lighthouse-*` headers, including the signature, timestamp and nonce, which change on every retry by design (§1). Also TLS and HTTP headers.

Any other member in the body makes the event `rejected_malformed` (strict schema). An unknown member therefore can never escape the digest. Strings are not Unicode-normalised: different code points are different events.

A receiver **recomputes** the digest from the received body. It rejects the event as `rejected_malformed` (`400 EVENT_DIGEST_MISMATCH`) if the sent `eventDigest` differs. Every comparison below uses the recomputed value.

**Worked example.** Two events with the same `eventId` and identical `payload` but different `targetState`, say `revoked` vs `active`. Under v0.2 the payload-only hashes are equal, so the second would have been taken as a `duplicate`. Since r2 the digests differ because `targetState` is bound, so the second is a `conflict` (§3.3 rule 3).

**Version content digest [Proposed, r3].** `eventDigest` identifies *one transmission of one event*. It cannot deduplicate the same state change re-emitted under a new `eventId`, for example by a sender that regenerates ids after a crash, because the `eventId` is part of it. So the receiver also derives:

`versionContentDigest = lowercase hex( SHA-256( JCS(versionContentInput) ) )`

`versionContentInput` has **exactly** these members, all required:

| Member | Why it is bound |
|---|---|
| `schemaVersion` | the payload's meaning |
| `aggregateKind`, `aggregateId` | which aggregate |
| `version` | which version |
| `targetState` | the state this version establishes |
| `changeSeq` | the owner's commit position for this version (§5.2). One version has exactly one `changeSeq`. |
| `payload` | the version's content |

**Excluded from `versionContentDigest`, and only these:**

| Excluded | Why |
|---|---|
| `eventId` | the transmission identity, not the content |
| `occurredAt` | informational; a re-emission may stamp a new time |
| `correlationId` | tracing only |
| `eventDigest` | derived |
| transport headers | as in `eventDigest` |

It is not transmitted. The receiver computes it from the validated body with the same JCS rules.

| Digest | Includes `eventId`? | Used for |
|---|---|---|
| `eventDigest` | yes | integrity of the transmission (recompute check); replay and conflict detection per `eventId` (§3.3 rules 2–3) |
| `versionContentDigest` | no | alias deduplication and conflict detection per (aggregate, version) (§3.3 rules 4–5) |

**Worked example: a legitimate alias.**
1. The owner emits `E7` for grant `g` version 5 (`revoked`, `changeSeq` 910, `occurredAt` 12:00:00). It is applied.
2. The owner crashes before marking `E7` delivered. On restart it regenerates the event as `E7′` with the same version, state, `changeSeq` and payload, but `occurredAt` 12:03:10.
3. The `eventDigest` values differ (different `eventId` and `occurredAt`), but the `versionContentDigest` values are equal.
4. Result: rule 4, `200 duplicate` with alias `E7′ → E7`. Under r2, which compared `eventDigest` for rule 4, this would have been reported as a false `AGGREGATE_VERSION_DIGEST_MISMATCH` conflict.

**Worked example: a real version conflict.** `E8` (grant `g` version 6, `revoked`) is applied. Later, `E9` arrives for `g` version 6 with state `expired`. The `versionContentDigest` values differ, so rule 5 applies: `409 conflict` / `AGGREGATE_VERSION_CONTENT_MISMATCH`.

#### 3.2.2 Ledger [Proposed, r3]

| Table | Primary key | Columns | Role |
|---|---|---|---|
| `event_ledger` | `eventId` | `acceptedEventDigest`, aggregate key, `version`, `firstReceivedAt` | Which bytes were **first accepted** under this `eventId`. Written once; never changed. |
| `event_variants` | (`eventId`, `eventDigest`) | `role` (`original` \| `conflicting`), `outcome`, `resolvedOutcome?`, `quarantineId?`, `receivedCount`, `firstReceivedAt`, `lastReceivedAt` | One row per distinct byte-content received under an `eventId`. The original accepted event is a variant with `role = original`. Every conflicting variant gets its own row. |
| `version_ledger` | (`aggregateKind`, `aggregateId`, `version`) | `versionContentDigest`, `firstEventId` | The content first accepted for each aggregate version. |

Rules:
- The **first** transaction to insert an `eventId` into `event_ledger` makes its digest the original. Two concurrent first arrivals with different digests race on the `event_ledger` primary key. The loser rolls back and is re-evaluated, finding the winner's row, so it becomes a `conflicting` variant.
- `outcome` is written in the same transaction as its effect (apply, quarantine or block) and never changed afterwards. Two exceptions: `resolvedOutcome` is set by reconciliation (§3.4 step 5), and `blocked` rows are re-evaluated (§3.4 step 6).
- Variants store digests and outcomes, **never bodies** (consistent with §3.4).
- Each conflicting variant links to a quarantine:
  - If an `open` quarantine already exists for the aggregate, the variant joins it.
  - Otherwise a new quarantine is opened.

  One quarantine can therefore cover several variants.

**[Existing-IS]** `lighthouse.inbound_events` keys on `event_id` and stores one `payload_hash` and one `outcome`.
**[Existing-IS, must change]** there is no variant storage: a second, different body under a known `eventId` is not recorded. There is no unique (aggregate, version) key, no `versionContentDigest`, and stored outcomes are not replayed.

### 3.3 Outcomes (evaluated in this order) [Proposed, r2]

| # | Condition | Outcome | HTTP | Applied? | Receiver action | Sender action |
|---|---|---|---|---|---|---|
| 1 | Envelope malformed, schema unknown, strict validation fails, or the recomputed digest ≠ the sent `eventDigest` | `rejected_malformed` | `400` | no | audit; **no ledger row** | fix and send a **new** `eventId`; never retry the same bytes |
| 2 | (`eventId`, `eventDigest`) exists in `event_variants`, as the original **or** a conflicting variant | **that variant's recorded outcome, replayed** (see "Replay" below) | as recorded | no further effect | increment `receivedCount` | per the replayed outcome |
| 3 | `eventId` exists in `event_ledger`, but this `eventDigest` is not among its variants | `conflict` / `EVENT_ID_DIGEST_MISMATCH` | `409` | **no** | insert a `conflicting` variant with `outcome = conflict`; join or open a quarantine; alert; block the aggregate | stop, alert, wait (§3.4) |
| 4 | (aggregate, version) in `version_ledger` with the **same** `versionContentDigest` under another `eventId` | `duplicate` | `200` | no | insert this `eventId` into `event_ledger` plus an `original` variant with `outcome = duplicate`, noting the alias to `firstEventId` | done |
| 5 | (aggregate, version) in `version_ledger` with a **different** `versionContentDigest` | `conflict` / `AGGREGATE_VERSION_CONTENT_MISMATCH` | `409` | **no** | insert into `event_ledger` plus an `original` variant with `outcome = conflict`; join or open a quarantine; alert; block | stop, alert, wait |
| 6 | Aggregate blocked by an open quarantine | `blocked` | `409` | no | insert into `event_ledger` plus an `original` variant with `outcome = blocked`; **the body is not retained** (§3.4) | keep the entry; resubmit after resolution (§3.4) |
| 7 | `version` < stored version | `stale` | `200` | no | ledger | done; a newer state won |
| 8 | `version` = stored version (and not rule 4 or 5, i.e. the version ledger has no row, e.g. state came from a snapshot) | `stale` | `200` | no | ledger | done |
| 9 | Lifecycle does not permit the transition (e.g. `revoked → active`) | `rejected_transition` | `422` | no | quarantine, alert, block; ledger | stop, alert, wait |
| 10 | `version` > stored + 1 | `applied_with_gap` | `200` | yes | apply; schedule recovery (§5) | done |
| 11 | Otherwise | `applied` | `200` | yes | apply | done |

**Replay (rule 2).** A retry is matched to its **own variant** by (`eventId`, `eventDigest`) and returns that variant's outcome, with the same HTTP status and the same `quarantineId`. A retry of the original bytes and a retry of a conflicting variant therefore get different, and each correct, answers. An open issue is **never** downgraded to `duplicate`:

| Variant's recorded `outcome` | Quarantine state | Response to the retry |
|---|---|---|
| `applied`, `applied_with_gap`, `duplicate`, `stale` | n/a | `200 duplicate` (with `originalOutcome` set) |
| `conflict` or `rejected_transition` | `open` | the same `409 conflict` / `422 rejected_transition`, same `quarantineId` |
| `conflict` or `rejected_transition` | `resolved` | `200 superseded`, the terminal post-reconciliation outcome for these bytes (§3.4) |
| `blocked` | `open` | `409 blocked`, same `quarantineId` |
| `blocked` | `resolved` | **re-evaluated** through rules 4–11. The variant's outcome is replaced by the new outcome in the same transaction (§3.4 step 6). |

**Worked example: several variants under one `eventId`.**
1. `E1` (grant `g`, version 4, `eventDigest` `a1…`) is applied. The variants are {(`E1`, `a1…`): original, `applied`}.
2. A buggy sender reuses `E1` with bytes `b2…` → rule 3. The variant (`E1`, `b2…`) is stored as conflicting, with `conflict` and a new `Q7`; `g` is blocked.
3. It sends yet another body under `E1`, `c3…` → rule 3. The variant (`E1`, `c3…`) is stored as conflicting and **joins** the open `Q7`.
4. The `b2…` bytes are resent → rule 2 matches (`E1`, `b2…`) → `409 conflict`, `Q7`.
   - The `c3…` bytes are resent → `409 conflict`, `Q7`.
   - The **original** `a1…` bytes are resent → rule 2 matches (`E1`, `a1…`) → `200 duplicate` with `originalOutcome: applied`. The original's success is not overwritten by the later conflicts.

   Under r1 a retried conflict could have come back as `duplicate`, which the sender would have treated as delivered.
5. `Q7` is resolved (§3.4): `b2…` and `c3…` get `resolvedOutcome = superseded`. Resends of either now return `200 superseded`, and a resend of `a1…` still returns `200 duplicate`.

**[Existing-IS, must change]** where current InvestScape code differs:
- An `eventId` conflict returns `200` with `outcome: "conflict"`. It is audited but not quarantined, and the aggregate is not blocked. It must return `409` and quarantine.
- A retry with the same bytes is answered from the ledger as `duplicate` or `conflict` by digest only, not by replaying the recorded outcome. Conflicting variants are not stored at all. It must follow §3.2.2 and the Replay table.
- The digest covers an unspecified subset. It must follow §3.2.1.
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
| `outcome` | `applied` \| `applied_with_gap` \| `duplicate` \| `stale` \| `superseded` \| `conflict` \| `blocked` \| `rejected_transition` | |
| `originalOutcome` | same enum | on a replayed `duplicate`: what the first delivery produced |
| `conflictKind` | `EVENT_ID_DIGEST_MISMATCH` \| `AGGREGATE_VERSION_CONTENT_MISMATCH` | only for `conflict` |
| `quarantineId` | string | for `conflict`, `blocked` and `rejected_transition` |
| `storedVersion` | int | receiver's version after processing |
| `receivedAt` | ISO-8601 | |

Only `applied`, `applied_with_gap`, `duplicate`, `stale` and `superseded` are **terminal** for the sender. `superseded` means "not applied; reconciliation made it moot"; it is terminal but must be logged as not delivered. A sender must never mark an event delivered on `conflict`, `blocked` or `rejected_transition`.

### 3.4 Quarantine, reconciliation and blocked events [Proposed, r2]

**Design choice (r2): the receiver does not retain blocked event bodies. The sender keeps them and resubmits after reconciliation.**

Reason: share payloads carry client-selected analysis fields. Retaining them at the receiver while blocked would create a second copy of client data outside any grant's lifecycle and removal rules (§6). The sender already holds the bytes durably in its outbox.

**Receiver**
1. **Quarantine record:** `quarantineId`, aggregate key, the `version` at issue, the `eventId`s and digests involved, `kind` (`EVENT_ID_DIGEST_MISMATCH` \| `AGGREGATE_VERSION_CONTENT_MISMATCH` \| `REJECTED_TRANSITION`), `openedAt`, state `open`. **No payloads.**
2. **Alert** on open. Routing and severity: **DECISION REQUIRED (D8)**.
3. **Block:** while any quarantine on the aggregate is `open`, rule 6 applies to every new event for it. Its `eventId` and `eventDigest` are recorded as a variant with `outcome = blocked`; the body is discarded. Reads of the aggregate's content fail closed.
4. **Reconcile:** perform a single-aggregate recovery read from the aggregate's **owner** (§5.5 item 6). Adopt the owner's state if the owner's `version` ≥ the receiver's.
5. **Resolve** (one transaction):
   - set the quarantine to `resolved` with `resolution` (`adopted_owner_state` \| `operator_override`), `resolvedBy` and `resolvedAt`;
   - for each `event_variants` row under this quarantine with `outcome` in {`conflict`, `rejected_transition`}, set `resolvedOutcome = superseded`;
   - unblock the aggregate.

   `blocked` rows are left as they are, so their next resubmission is re-evaluated (Replay table).
6. **Re-evaluating a blocked resubmission:** when a resubmitted event matches a `blocked` variant (`eventId`, `eventDigest`) whose quarantine is resolved, it runs through rules 4–11. The variant's outcome is replaced atomically with the result. A resubmission with a **different** digest under that `eventId` is rule 3: a new conflicting variant.
7. **Notify (optional optimisation):** after resolving, the receiver sends `lighthouse.quarantine-resolved.v1` = `{ schemaVersion, quarantineId, aggregateKind, aggregateId, resolvedAt, reconciledVersion }` to the sender (same HMAC transport). Senders must not depend on it: resubmission also happens on its own schedule.

**Sender**
- `409 blocked` → outbox entry `awaiting_reconciliation`, which is **not** failed and **not** delivered. It is kept durably.
- It is resubmitted with its **original bytes and `eventId`** (a fresh nonce and signature):
  - immediately on `quarantine-resolved.v1` for that aggregate; otherwise
  - on backoff from 1 min, doubling, capped at 15 min.

  Values proposed; **DECISION REQUIRED (D7b)**.
- Each resubmission gets `409 blocked` until resolution, then a normal outcome.
- `409 conflict` / `422 rejected_transition` → outbox entry `in_quarantine`, alert. Keep resending on the same schedule as a status probe (the response replays the recorded outcome). Stop on `200 superseded`.
- Resubmitted events keep their original version. If reconciliation already moved the aggregate past them, they come back `stale`, which is correct and terminal.
- Sender outbox retention for `awaiting_reconciliation` entries is bounded by the same retention policy as other client data: **DECISION REQUIRED (D5/D6)**.

**Worked example: blocked, reconciled, resubmitted.**
1. Grant `g` is at version 4 at the receiver. `E5` (version 5) conflicts with an earlier `E5′` → quarantine `Q9` opens and `g` is blocked.
2. The owner emits `E6` (version 6, revoke). The receiver ledgers `E6` as `blocked` under `Q9` and discards the body. The sender marks `E6` `awaiting_reconciliation`.
3. Reconciliation: the owner's snapshot shows `g` at version 6, `revoked`. The receiver adopts it, resolves `Q9` (`E5` → `superseded`), unblocks `g`, and sends `quarantine-resolved.v1`.
4. The sender resubmits `E6` (same bytes). The row is `blocked` with `Q9` resolved and a matching digest → re-evaluated: version 6 = stored 6, not in the version ledger → rule 8 `stale`. The sender marks `E6` terminal.
5. The sender resends `E5` as a probe → `200 superseded` → terminal.

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

### 5.2 Commit-safe change sequencing [Proposed, r2]

**Why a plain database sequence is unsafe.** `nextval()` hands out numbers when called, not when the transaction commits, and never rolls back. Transactions can therefore **commit out of sequence order**:

| Time | Transaction A | Transaction B | Committed `changeSeq` values visible |
|---|---|---|---|
| t1 | `nextval()` → 41 | | — |
| t2 | | `nextval()` → 42 | — |
| t3 | | commit | {42} |
| t4 | snapshot reads `max(changeSeq)` = 42 → **watermark 42** | | {42} |
| t5 | commit | | {41, 42} |

The snapshot at t4 claims "everything ≤ 42", but 41 was not yet visible. A receiver holding `g` at `changeSeq` 41 from A's event would never see it in this snapshot. Worse, the purge rule (§5.5 rule 3) could remove a record because 41 ≤ 42 and it was absent. A later delta `since 42` would also skip 41 for good.

**Protocol: serialised allocation under a row lock.** Each owner keeps one counter row per sequence domain:

```sql
create table lighthouse.change_counter (domain text primary key, value bigint not null);
-- inside the SAME transaction as the state change:
update lighthouse.change_counter set value = value + 1
 where domain = 'share_grant' returning value;   -- this is the change's changeSeq
```

Properties:
- **Row-lock serialisation.** The `UPDATE` takes the counter row's lock and holds it until the transaction commits or aborts. A second writer blocks at its own `UPDATE` until then. Allocation order is therefore commit order.
- **Aborts leave no gaps.** An aborted transaction releases the lock and its increment rolls back, so the next writer reuses the value.
- **Watermark read.** The snapshot transaction reads `value` at `REPEATABLE READ` isolation. Because allocation and commit are serialised, every change with `changeSeq` ≤ that value is committed and visible to that same snapshot, and no committed change is missing.
- **Change log.** Each state change also inserts (`changeSeq`, aggregate key, `version`) into an append-only change log in the same transaction. Deltas read `sinceChangeSeq < changeSeq ≤ watermark` from it.

**Cost:** every recoverable state change in a domain is serialised on one row, for the duration of the rest of its transaction. Writers must allocate `changeSeq` **last**, immediately before commit, to keep that hold short. The expected write rate for links and grants is low (human-initiated consent actions).

**Alternative for higher throughput.** If serialisation proves too costly, use a PostgreSQL transaction-visibility watermark instead of a counter. Record `pg_current_xact_id()` beside each change. The safe watermark for a snapshot is the highest `changeSeq` among changes whose transaction id is below `pg_snapshot_xmin(pg_current_snapshot())`, since every such transaction has finished. This protocol is **not** proposed for v1; it is listed so the counter can be replaced without changing the wire contract. The wire contract only promises: *every change with `changeSeq` ≤ watermark is included; none above it is.*

**Worked example (counter protocol).**
1. A updates the counter → 41, holding the row lock.
2. B's counter `UPDATE` waits.
3. A commits.
4. B proceeds and gets 42.
5. A snapshot that starts between A's and B's commits reads `value = 41` and includes A's change. B's change (42) arrives by event or in the next delta `since 41`.

There is no instant at which a snapshot can see 42 without 41.

**[Existing-IS, must change]** no `changeSeq` or change log exists today; share grants carry only per-aggregate `version`.

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

Request `investscape-redemption-lookup.v1` [Proposed, r3]:

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"investscape-redemption-lookup.v1"` | |
| `launchSessionId` | UUID | |
| `redemptionAttemptId` | UUID | |
| `requestTimestamp` | integer Unix seconds | the `x-lighthouse-timestamp` InvestScape wrote ahead for this attempt (§7.3) |
| `finalize` | boolean | `true` asks Relationship OS to make a not-consumed answer **final** (§7.4a) |

Response `200`, `investscape-redemption-status.v1`:

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `"investscape-redemption-status.v1"` | |
| `launchSessionId`, `redemptionAttemptId` | echoed | |
| `status` | `consumed_by_this_attempt` \| `not_consumed_pending` \| `not_consumed_final` \| `consumed_by_other_attempt` \| `expired_unconsumed` \| `authority_revoked` | `not_consumed_pending`: not consumed, and not finalised because the deadline has not passed or `finalize` was false. `not_consumed_final`: a finalisation record exists (§7.4a); this attempt can never consume. |
| `launchContext` | `investscape-launch-context.v2` | present **only** for `consumed_by_this_attempt` **and** only if authority still holds (§7.5) |
| `checkedAt` | ISO-8601 | |

Errors: `404 LAUNCH_SESSION_NOT_FOUND`, `410 REDEMPTION_LOOKUP_EXPIRED` (after `expiresAt + lookupGrace`), `401 SERVICE_AUTH_FAILED`.

### 7.3 InvestScape attempt record [Proposed, r2; IS table `lighthouse.launch_redemption_attempts`]

| Column | Notes |
|---|---|
| `redemption_attempt_id` | UUID, primary key |
| `operation_id` | UUID, browser-visible status key |
| `launch_session_id` | UUID |
| `actor_ref` | the signed-in professional |
| `handoff_id` | nullable (direct redeem has none) |
| `request_timestamp` | integer Unix seconds. **Written before sending.** It is the exact `x-lighthouse-timestamp` the L2 request will carry. |
| `state` | `prepared` \| `completed` \| `failed_definite` \| `ambiguous` \| `resolved_no_analysis` \| `abandoned` |
| `created_at`, `updated_at`, `next_check_at`, `check_count` | |
| `resolution` | nullable reason code |

It **never** stores the launch code, the handoff token or the launch context.

**What the record does and does not know (r2).** r1 said both that the row cannot record whether L2 was sent (§7.3) and that "the row itself shows whether L2 was sent" (§7.4). The second statement was wrong. No write can reliably record "sent": a crash can occur between the network send and any write after it. r2 therefore defines:

- `prepared` means **"L2 may or may not have been sent."** Nothing distinguishes the two, and nothing needs to.
- What bounds the uncertainty is `request_timestamp`. Relationship OS rejects any request whose timestamp is outside ±300 s (§1). So after `request_timestamp + 300 s`, an unsent or delayed L2 carrying that timestamp **can never be accepted**, and a nonce replay is rejected as well.

**Write-ahead rule.** In one transaction, before L2 is sent:
1. claim the handoff (which wipes its ciphertext);
2. insert the attempt as `prepared`, with `request_timestamp` fixed.

The request is then signed with that timestamp and sent. A consumed handoff therefore always has an attempt record.

### 7.4 Recovery cases [Proposed, r2]

Define `acceptanceDeadline = request_timestamp + 300 s + 30 s` (skew window plus margin).

| Case | What happens |
|---|---|
| L2 returns 200 | Bind (ownership rule) and set `completed`, **in one transaction**. |
| L2 returns a definite error (`400/401/403/404/409/410`) | `failed_definite`. No analysis. |
| L2 times out, the connection resets, or `5xx` | `ambiguous`; the reconciler calls L4 with backoff (1, 2, 4 … capped at 60 s). |
| Process crash while `prepared` (whether or not L2 left the process) | The reconciler picks up `prepared` rows older than the L2 client timeout plus 30 s, sets them `ambiguous`, and calls L4. |
| L4 → `consumed_by_this_attempt` | Re-run the ownership rule against the actor's **current** links (§7.5); bind or refuse → `completed` or `resolved_no_analysis`. Valid at any time: consumption already happened. |
| L4 → `not_consumed_pending` | **Not final.** Call again with `finalize: true` after `acceptanceDeadline`. |
| L4 → `not_consumed_final` | Final → `resolved_no_analysis`. Relationship OS guarantees this attempt can never consume (§7.4a). The code was wiped at claim, so there is no retry; the professional restarts from Relationship OS. |
| L4 → `expired_unconsumed` | `resolved_no_analysis`. |
| L4 → `consumed_by_other_attempt` | `resolved_no_analysis` plus a **security alert**. |
| L4 → `authority_revoked` | `resolved_no_analysis`. |
| L4 → `410 REDEMPTION_LOOKUP_EXPIRED`, or the window closes unresolved | `abandoned` plus an alert. No analysis is created afterwards. |

### 7.4a Acceptance deadline and finalisation — Relationship OS [Proposed, r3]

r2 relied on the HMAC timestamp check alone. That is **insufficient**. A request can pass authentication at 12:04:59, when it is within skew, and then wait on a database lock. If the consuming `UPDATE` does not re-check the deadline, it consumes at, say, 12:05:40, after InvestScape may already have declared the attempt "not consumed". Authentication time is not consumption time.

**Definitions** (Relationship OS; all times from the **database clock**, `clock_timestamp()`, never an application clock):
- `attemptDeadline = to_timestamp(x-lighthouse-timestamp) + interval '300 seconds'`, the latest instant at which this attempt may consume.
- Finalisation record: `app.investscape_redemption_finalizations(launch_session_id, redemption_attempt_id, finalized_at)`, primary key (`launch_session_id`, `redemption_attempt_id`). Insert-only.

**R-1. Consumption (L2), one transaction:**
```sql
begin;
-- 1. Take the session row lock FIRST. A request that waits here waits
--    before any deadline evaluation.
select id, status, code_hash, expires_at, consumed_by_attempt_id
  from app.investscape_launch_sessions
 where id = $session for update;
-- 2. Only after the lock is held, evaluate (clock_timestamp() is re-read now):
--    a. code_hash matches
--    b. status = 'issued' and expires_at > clock_timestamp()   (existing checks)
--    c. clock_timestamp() <= $attemptDeadline                  (new)
--    d. not exists (select 1 from app.investscape_redemption_finalizations
--                   where launch_session_id = $session
--                     and redemption_attempt_id = $attempt)     (new)
--    Any failure: rollback. (a)/(b) keep their existing errors;
--    (c) -> 410 REDEMPTION_ATTEMPT_DEADLINE_PASSED; (d) -> 409 REDEMPTION_ATTEMPT_FINALIZED.
-- 3. Consume:
update app.investscape_launch_sessions
   set status = 'consumed', consumed_at = clock_timestamp(), consumed_by_attempt_id = $attempt
 where id = $session;
commit;
```
The deadline and the finalisation check are evaluated **while holding the session row lock**, immediately before the consuming write. Nothing about a waiting request is decided at authentication time except authentication itself.

Note on the existing single-statement `UPDATE … WHERE … RETURNING` **[Existing-both]**: PostgreSQL re-evaluates an `UPDATE`'s `WHERE` against the latest row version after a lock wait. However, `now()` in that `WHERE` is the **transaction start** time, not the time the lock was acquired, so a `now()`-based deadline would be evaluated too early. Hence the explicit lock-then-check form and `clock_timestamp()`.

**R-2. Finalisation (L4 with `finalize: true`), one transaction:**
```sql
begin;
select status, consumed_by_attempt_id
  from app.investscape_launch_sessions
 where id = $session for update;          -- same lock as R-1
-- if consumed_by_attempt_id = $attempt -> consumed_by_this_attempt (no insert)
-- if consumed by another attempt      -> consumed_by_other_attempt
-- else if clock_timestamp() > to_timestamp($requestTimestamp) + interval '300 seconds':
insert into app.investscape_redemption_finalizations
       (launch_session_id, redemption_attempt_id, finalized_at)
values ($session, $attempt, clock_timestamp())
on conflict do nothing;                   -- idempotent
--      -> not_consumed_final
-- else -> not_consumed_pending (no insert)
commit;
```
L4 without `finalize` takes the same lock but never inserts.

**Why this is sufficient.** R-1 and R-2 for the same session serialise on one row lock:
- If R-1 commits first, R-2 sees `consumed_by_attempt_id = $attempt` and returns `consumed_by_this_attempt`. It never finalises a consumed attempt.
- If R-2 commits first and inserts the finalisation, R-1 acquires the lock afterwards, finds the finalisation (check d), and refuses.

A finalised attempt can therefore **never** consume, whatever its HMAC timestamp, network delay or lock wait. Check (c) independently bounds consumption to `attemptDeadline`, so even a finalisation that is never requested cannot be outlived.

**Trust note.** `requestTimestamp` in L4 comes from InvestScape. A wrong value can only cause a finalisation too early (then check (d) refuses that attempt's later consumption) or a `not_consumed_pending` answer (no effect). Neither lets an attempt consume after being declared final.

**[Existing-both]** `HmacServiceAuthenticator.authenticate` runs before the consuming `UPDATE`, and the consuming statement checks `status = 'issued' and expires_at > now()`. **[Existing-both, must change]** there is no attempt deadline, no finalisation record, and no `clock_timestamp()` evaluation after the lock is acquired.

**InvestScape side [Proposed, r3].** After `acceptanceDeadline` (`request_timestamp` + 300 s + 30 s margin), the reconciler calls L4 with `finalize: true`. Only a `not_consumed_final` answer moves the attempt to `resolved_no_analysis`. A `not_consumed_pending` answer is retried with backoff until final or until the lookup window closes (`abandoned`).

**Worked examples.**

- **Crash before sending.**
  1. `prepared` is committed at 12:00:00 (`request_timestamp` = 12:00:00) and the process dies before the socket write.
  2. At 12:00:40 the reconciler sets `ambiguous` and calls L4 (`finalize: false`) → `not_consumed_pending`.
  3. At 12:05:31 (after `acceptanceDeadline` 12:05:30) it calls L4 with `finalize: true`. R-2 takes the lock; 12:05:31 > 12:05:00, so it inserts the finalisation → `not_consumed_final` → `resolved_no_analysis`. The UI tells the professional to reopen from Relationship OS.
- **Crash after sending, before the response is processed.**
  1. Same prefix. Relationship OS consumed the session with this attempt id.
  2. At 12:00:40, L4 → `consumed_by_this_attempt` with the context.
  3. The ownership check passes → bind → `completed`. The UI moves from "confirming" to "ready".
- **Request delayed in the network.**
  1. L2 times out locally at 12:00:10 → `ambiguous`.
  2. At 12:00:15, L4 → `not_consumed_pending` (not final).
  3. At 12:00:50 the delayed request reaches Relationship OS. The timestamp is within ±300 s, so it is accepted and the session is consumed.
  4. At 12:01:05, L4 → `consumed_by_this_attempt` → bind.

  Treating the first "not consumed" as final would have stranded the consumed session.
- **Authenticated, then waiting on a lock (r3).** `request_timestamp` = 12:00:00, so `attemptDeadline` = 12:05:00 (database clock).
  1. The L2 request is delayed and reaches Relationship OS at 12:04:59. HMAC passes (within ±300 s). R-1 begins and blocks on `select … for update`, because another transaction on this session holds the row lock, e.g. a slow authority re-check.
  2. **Ordering A: the finaliser gets the lock first.** InvestScape's L4 `finalize: true` arrives at 12:05:31, is queued behind the same lock, and acquires it at 12:05:40 before R-1. R-2: not consumed; 12:05:40 > 12:05:00 → inserts the finalisation → `not_consumed_final`, commit. R-1 then acquires the lock at 12:05:41. Check (c) fails (12:05:41 > 12:05:00) and check (d) fails (finalised) → rollback, `409 REDEMPTION_ATTEMPT_FINALIZED`. InvestScape resolves no analysis, and the session is **not** consumed.
  3. **Ordering B: R-1 gets the lock first, at 12:05:05.** Check (c) fails (12:05:05 > 12:05:00) → rollback, `410 REDEMPTION_ATTEMPT_DEADLINE_PASSED`. The finaliser later finds it not consumed → `not_consumed_final`. Same safe result.
  4. **Ordering C: R-1 gets the lock at 12:04:59.8,** before the deadline. It consumes and commits. The finaliser at 12:05:40 finds `consumed_by_attempt_id = this attempt` → `consumed_by_this_attempt` → InvestScape binds.

  In no ordering can an attempt consume after InvestScape was told it is final.
- **Revoked meanwhile.**
  1. Same as the crash-after-sending case, but the relationship is closed at 12:00:30.
  2. At 12:00:40, L4 → `authority_revoked` (no context) → `resolved_no_analysis`. Recovery restores nothing.

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

- [ ] Ledger: add a unique key on (`aggregate_kind`, `aggregate_id`, `version`) → `eventDigest`; implement §3.3 rules 4–6. **[must change]**
- [ ] `eventDigest` per §3.2.1 (JCS over all authoritative fields + payload; recompute and verify). **[must change]**
- [ ] Replay recorded outcomes on retry (§3.3 Replay table), including `superseded`. **[must change]**
- [ ] Sender outbox states `awaiting_reconciliation` and `in_quarantine`, with the resubmission schedule (§3.4).
- [ ] `lighthouse.change_counter` row-lock allocation, performed last in each transaction; change log (§5.2).
- [ ] Attempt `request_timestamp` written before sending; after `acceptanceDeadline`, L4 with `finalize: true`; resolve only on `not_consumed_final` (§7.3–7.4a).
- [ ] `versionContentDigest` derivation and `event_variants` storage keyed by (`eventId`, `eventDigest`) (§3.2).
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
- [ ] Event receiver implementing §3.2–§3.4 exactly: JCS digest, both ledgers, replayed outcomes, quarantine, block without body retention, and re-evaluation of blocked resubmissions.
- [ ] Commit-safe `changeSeq` (§5.2) for aggregates Relationship OS owns (`relationship_assignment`, `launch_session`).
- [ ] L2 consumption per §7.4a R-1: lock the session row first, then evaluate the attempt deadline and the finalisation check with `clock_timestamp()` under the lock, then consume. **[must change]**
- [ ] Finalisation table and L4 `finalize` per §7.4a R-2, serialised on the same row lock. **[must change]**
- [ ] L4 statuses `not_consumed_pending` / `not_consumed_final`; errors `410 REDEMPTION_ATTEMPT_DEADLINE_PASSED` and `409 REDEMPTION_ATTEMPT_FINALIZED` on L2.
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
| D7b | Blocked-event resubmission schedule (proposed 1 min doubling to 15 min cap) and the maximum time an entry may wait in `awaiting_reconciliation` before operator escalation | Both |
| D8 | Alert routing and severity for quarantines and `consumed_by_other_attempt` | Both, operations |
| D9 | What a professional keeps after `launch-authority.revoked` (own worksheet inputs vs nothing) | Product |
| D10 | Per-direction HMAC keys and the rotation procedure | Both |
| D11 | Add `exp` to the launch URL | Relationship OS |
| D12 | Push (S2) + snapshots (R1/R2) + authorised read (S3) as the sharing model | Both |
