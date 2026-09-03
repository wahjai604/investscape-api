/**
 * InvestScape™ — © 2026 Lighthouse Research Ltd. Proprietary and confidential.
 * See LICENSE. Not investment, tax, or financial advice.
 *
 * Stage 7 route tests.
 *
 * These run against a REAL Express app on an ephemeral port, driven with
 * `fetch` — same pattern as stage2Route.test.ts. Hermetic: no database, no
 * network beyond loopback, injected clock, injected env (never a real
 * `.env`).
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createAdminAssignmentRouter } from "./adminAssignmentRoute.ts";
import { InMemoryAdminAssignmentRepository } from "./adminAssignmentRepository.ts";
import { InMemoryAuditSink } from "../audit/auditEvent.ts";
import { ADMIN_MANAGEMENT_SCOPE } from "../domain/adminAssignment.ts";

const ENABLED = { LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION: "true" };
const DISABLED = { LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION: "false" };
const SEED_ACTOR = "seed-admin-actor";

let server: Server;
let baseUrl: string;
let repo: InMemoryAdminAssignmentRepository;
let audit: InMemoryAuditSink;
let clock: Date;
let env: Record<string, string | undefined>;
/** Set to null to simulate an unauthenticated caller. */
let currentActor: string | null;
let assignmentCounter: number;

before(async () => {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  repo = new InMemoryAdminAssignmentRepository();
  audit = new InMemoryAuditSink();
  clock = new Date("2026-09-03T12:00:00.000Z");
  env = { ...ENABLED };
  currentActor = "actor-1";
  assignmentCounter = 0;

  // Stands in for requireSession, which runs ahead of this router in bootstrap.
  const fakeSession = (
    req: express.Request,
    _res: express.Response,
    next: express.NextFunction,
  ): void => {
    if (currentActor) req.lighthouseSession = { actorRef: currentActor } as never;
    next();
  };

  app.use(
    "/v1/lighthouse",
    fakeSession,
    createAdminAssignmentRouter({
      assignments: repo,
      auditSink: audit,
      now: () => clock,
      newAssignmentId: () => `a-${++assignmentCounter}`,
      seedAdminActorRef: SEED_ACTOR,
      env,
    }),
  );

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address === "string" || address === null) throw new Error("no port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE = "/v1/lighthouse/admin/assignments";

async function createAssignment(body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${BASE}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function listAssignments(): Promise<Response> {
  return fetch(`${baseUrl}${BASE}`);
}

async function revoke(assignmentId: string, body: unknown): Promise<Response> {
  return fetch(`${baseUrl}${BASE}/${assignmentId}/revoke`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function validBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    granteeActorRef: "grantee-1",
    requestedScopes: ["investscape.incident.review"],
    purpose: "onboarding",
    expiresAt: null,
    ...overrides,
  };
}

// Since the router closes over `repo` at construction time (built once in
// `before`), tests that need a specific seeded state build their OWN router
// on a per-test app rather than fighting the shared one. This mirrors
// stage2Route.test.ts's single shared app for flag/session/validation tests,
// and adds isolated apps only where seeded state actually matters.
async function withRouter<T>(
  setup: (repo: InMemoryAdminAssignmentRepository) => Promise<void>,
  run: (ctx: { url: string; setActor: (a: string | null) => void; setEnv: (e: boolean) => void }) => Promise<T>,
): Promise<T> {
  const localRepo = new InMemoryAdminAssignmentRepository();
  await setup(localRepo);
  const localAudit = new InMemoryAuditSink();
  const localEnv: Record<string, string | undefined> = { ...ENABLED };
  let localActor: string | null = "actor-1";
  let counter = 0;

  const app = express();
  app.use(express.json({ limit: "100kb" }));
  app.use(
    "/v1/lighthouse",
    (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      if (localActor) req.lighthouseSession = { actorRef: localActor } as never;
      next();
    },
    createAdminAssignmentRouter({
      assignments: localRepo,
      auditSink: localAudit,
      now: () => clock,
      newAssignmentId: () => `local-a-${++counter}`,
      seedAdminActorRef: SEED_ACTOR,
      env: localEnv,
    }),
  );

  const localServer = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const address = localServer.address();
  if (typeof address === "string" || address === null) throw new Error("no port");
  const url = `http://127.0.0.1:${address.port}`;

  try {
    return await run({
      url,
      setActor: (a) => { localActor = a; },
      setEnv: (e) => { localEnv.LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION = e ? "true" : "false"; },
    });
  } finally {
    await new Promise<void>((resolve) => localServer.close(() => resolve()));
  }
}

// ---------------------------------------------------------------------------
// Flag gate — before everything else
// ---------------------------------------------------------------------------

test("POST /admin/assignments returns 503 when the flag is disabled", async () => {
  env.LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION = "false";
  currentActor = null; // even unauthenticated — flag check wins
  const res = await createAssignment(validBody());
  assert.equal(res.status, 503);
  env.LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION = "true";
  currentActor = "actor-1";
});

test("GET /admin/assignments returns 503 when the flag is disabled", async () => {
  env.LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION = "false";
  currentActor = null;
  const res = await listAssignments();
  assert.equal(res.status, 503);
  env.LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION = "true";
  currentActor = "actor-1";
});

test("POST /admin/assignments/:id/revoke returns 503 when the flag is disabled", async () => {
  env.LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION = "false";
  currentActor = null;
  const res = await revoke("whatever", { expectedVersion: 1 });
  assert.equal(res.status, 503);
  env.LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION = "true";
  currentActor = "actor-1";
});

test("flag disabled beats an invalid body — 503, not 400", async () => {
  env.LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION = "false";
  const res = await createAssignment({ totally: "wrong shape" });
  assert.equal(res.status, 503);
  env.LIGHTHOUSE_FF_CROSS_PRODUCT_ADMINISTRATION = "true";
});

// ---------------------------------------------------------------------------
// Session required
// ---------------------------------------------------------------------------

test("POST /admin/assignments requires a session", async () => {
  currentActor = null;
  const res = await createAssignment(validBody());
  assert.equal(res.status, 401);
  currentActor = "actor-1";
});

test("GET /admin/assignments requires a session", async () => {
  currentActor = null;
  const res = await listAssignments();
  assert.equal(res.status, 401);
  currentActor = "actor-1";
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("an unknown/extra field is rejected by the strict schema", async () => {
  const res = await createAssignment({ ...validBody(), extra: "nope" });
  assert.equal(res.status, 400);
});

test("empty requestedScopes fails schema validation before reaching the domain layer", async () => {
  const res = await createAssignment(validBody({ requestedScopes: [] }));
  assert.equal(res.status, 400);
});

// ---------------------------------------------------------------------------
// THE escalation guard at the HTTP layer
// ---------------------------------------------------------------------------

test("a session-authenticated caller with no stored scopes and no bootstrap match cannot create any assignment", async () => {
  currentActor = "nobody-special";
  const res = await createAssignment(validBody());
  assert.equal(res.status, 403);
  const body = await res.json();
  assert.deepEqual(body, { state: "denied" });
  currentActor = "actor-1";
});

test("bootstrap actor (test-injected env, not real .env) can create the first real assignment", async () => {
  currentActor = SEED_ACTOR;
  const res = await createAssignment(
    validBody({ requestedScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.incident.review"] }),
  );
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.state, "created");
  assert.deepEqual([...body.scopes].sort(), [ADMIN_MANAGEMENT_SCOPE, "investscape.incident.review"].sort());
  currentActor = "actor-1";
});

test("a caller can grant a subset of scopes they hold via a stored assignment fixture", async () => {
  await withRouter(
    async (localRepo) => {
      await localRepo.create({
        assignmentId: "seed-1",
        granterActorRef: SEED_ACTOR,
        granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.incident.review", "investscape.retention.manage"],
        granteeActorRef: "actor-1",
        requestedScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.incident.review", "investscape.retention.manage"],
        purpose: "seed",
        expiresAt: null,
        now: clock,
        correlationId: "c1",
        isEnabled: true,
      });
    },
    async ({ url }) => {
      const res = await fetch(`${url}${BASE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody({ requestedScopes: ["investscape.incident.review"] })),
      });
      assert.equal(res.status, 201);
    },
  );
});

test("a caller cannot grant a scope beyond what they hold — SCOPE_EXCEEDS_GRANTER_AUTHORITY, opaque at HTTP", async () => {
  await withRouter(
    async (localRepo) => {
      await localRepo.create({
        assignmentId: "seed-1",
        granterActorRef: SEED_ACTOR,
        granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.incident.review"],
        granteeActorRef: "actor-1",
        requestedScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.incident.review"],
        purpose: "seed",
        expiresAt: null,
        now: clock,
        correlationId: "c1",
        isEnabled: true,
      });
    },
    async ({ url }) => {
      const res = await fetch(`${url}${BASE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody({ requestedScopes: ["investscape.retention.manage"] })),
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.deepEqual(body, { state: "denied" });
    },
  );
});

// ---------------------------------------------------------------------------
// GET scoping and effective scopes
// ---------------------------------------------------------------------------

test("GET /admin/assignments returns only the caller's own assignments and their effective scopes", async () => {
  await withRouter(
    async (localRepo) => {
      await localRepo.create({
        assignmentId: "mine",
        granterActorRef: SEED_ACTOR,
        granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE],
        granteeActorRef: "actor-1",
        requestedScopes: [ADMIN_MANAGEMENT_SCOPE],
        purpose: "seed",
        expiresAt: null,
        now: clock,
        correlationId: "c1",
        isEnabled: true,
      });
      await localRepo.create({
        assignmentId: "not-mine",
        granterActorRef: SEED_ACTOR,
        granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE],
        granteeActorRef: "someone-else",
        requestedScopes: [ADMIN_MANAGEMENT_SCOPE],
        purpose: "seed",
        expiresAt: null,
        now: clock,
        correlationId: "c2",
        isEnabled: true,
      });
    },
    async ({ url }) => {
      const res = await fetch(`${url}${BASE}`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.assignments.length, 1);
      assert.equal(body.assignments[0].assignmentId, "mine");
      assert.deepEqual(body.effectiveScopes, [ADMIN_MANAGEMENT_SCOPE]);
    },
  );
});

test("GET returns the full scope set for a bootstrap actor with no stored rows", async () => {
  await withRouter(
    async () => {},
    async ({ url, setActor }) => {
      setActor(SEED_ACTOR);
      const res = await fetch(`${url}${BASE}`);
      const body = await res.json();
      assert.equal(body.assignments.length, 0);
      assert.equal(body.effectiveScopes.length > 1, true);
    },
  );
});

// ---------------------------------------------------------------------------
// Revoke — requires the management scope
// ---------------------------------------------------------------------------

test("revoke requires the management scope", async () => {
  await withRouter(
    async (localRepo) => {
      // The target assignment, held by someone else.
      await localRepo.create({
        assignmentId: "target",
        granterActorRef: SEED_ACTOR,
        granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE],
        granteeActorRef: "other-actor",
        requestedScopes: ["investscape.incident.review"],
        purpose: "seed",
        expiresAt: null,
        now: clock,
        correlationId: "c1",
        isEnabled: true,
      });
    },
    async ({ url }) => {
      // currentActor "actor-1" has no scopes at all.
      const res = await fetch(`${url}${BASE}/target/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1 }),
      });
      assert.equal(res.status, 403);
      const body = await res.json();
      assert.deepEqual(body, { state: "denied" });
    },
  );
});

// ---------------------------------------------------------------------------
// THE lockout guard
// ---------------------------------------------------------------------------

test("the lockout guard: revoking the sole management holder is refused, then permitted once a second holder exists", async () => {
  await withRouter(
    async (localRepo) => {
      await localRepo.create({
        assignmentId: "sole-admin",
        granterActorRef: SEED_ACTOR,
        granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE],
        granteeActorRef: "actor-1",
        requestedScopes: [ADMIN_MANAGEMENT_SCOPE],
        purpose: "seed",
        expiresAt: null,
        now: clock,
        correlationId: "c1",
        isEnabled: true,
      });
    },
    async ({ url }) => {
      // actor-1 (the sole holder) tries to revoke themselves — refused, lockout.
      const first = await fetch(`${url}${BASE}/sole-admin/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1 }),
      });
      assert.equal(first.status, 403);

      // Now grant a second management holder.
      const grantRes = await fetch(`${url}${BASE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody({
          granteeActorRef: "actor-2",
          requestedScopes: [ADMIN_MANAGEMENT_SCOPE],
        })),
      });
      assert.equal(grantRes.status, 201);

      // The original assignment can now be revoked.
      const second = await fetch(`${url}${BASE}/sole-admin/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1 }),
      });
      assert.equal(second.status, 200);
      const body = await second.json();
      assert.equal(body.state, "revoked");
    },
  );
});

// ---------------------------------------------------------------------------
// Stale version / double revoke
// ---------------------------------------------------------------------------

test("stale expectedVersion on revoke is refused", async () => {
  await withRouter(
    async (localRepo) => {
      await localRepo.create({
        assignmentId: "sole-admin",
        granterActorRef: SEED_ACTOR,
        granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE],
        granteeActorRef: "actor-1",
        requestedScopes: [ADMIN_MANAGEMENT_SCOPE],
        purpose: "seed",
        expiresAt: null,
        now: clock,
        correlationId: "c1",
        isEnabled: true,
      });
      // second holder so lockout doesn't interfere
      await localRepo.create({
        assignmentId: "second-admin",
        granterActorRef: SEED_ACTOR,
        granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE],
        granteeActorRef: "actor-2",
        requestedScopes: [ADMIN_MANAGEMENT_SCOPE],
        purpose: "seed",
        expiresAt: null,
        now: clock,
        correlationId: "c2",
        isEnabled: true,
      });
    },
    async ({ url }) => {
      const res = await fetch(`${url}${BASE}/sole-admin/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 99 }),
      });
      assert.equal(res.status, 409);
    },
  );
});

test("double-revoke: the second attempt is refused", async () => {
  await withRouter(
    async (localRepo) => {
      await localRepo.create({
        assignmentId: "sole-admin",
        granterActorRef: SEED_ACTOR,
        granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE],
        granteeActorRef: "actor-1",
        requestedScopes: [ADMIN_MANAGEMENT_SCOPE],
        purpose: "seed",
        expiresAt: null,
        now: clock,
        correlationId: "c1",
        isEnabled: true,
      });
      await localRepo.create({
        assignmentId: "second-admin",
        granterActorRef: SEED_ACTOR,
        granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE],
        granteeActorRef: "actor-2",
        requestedScopes: [ADMIN_MANAGEMENT_SCOPE],
        purpose: "seed",
        expiresAt: null,
        now: clock,
        correlationId: "c2",
        isEnabled: true,
      });
    },
    async ({ url, setActor }) => {
      const first = await fetch(`${url}${BASE}/sole-admin/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1 }),
      });
      assert.equal(first.status, 200);

      // The second attempt is made by actor-2, who still holds the
      // management scope (actor-1's own scope disappeared along with the
      // assignment just revoked) — so this exercises ASSIGNMENT_NOT_ACTIVE
      // specifically, rather than incidentally tripping REVOKER_NOT_AUTHORIZED.
      setActor("actor-2");
      const second = await fetch(`${url}${BASE}/sole-admin/revoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1 }),
      });
      // ASSIGNMENT_NOT_ACTIVE is validation-shaped (describes the target row's
      // own state), so it surfaces as 400, not the opaque 403/409 used for
      // authorization failures.
      assert.equal(second.status, 400);
    },
  );
});

// ---------------------------------------------------------------------------
// Identical denial bodies (opacity)
// ---------------------------------------------------------------------------

test("authorization-shaped create denials share an identical opaque body", async () => {
  currentActor = "nobody-special";
  const res1 = await createAssignment(validBody());
  currentActor = "actor-1";

  await withRouter(
    async (localRepo) => {
      await localRepo.create({
        assignmentId: "seed-1",
        granterActorRef: SEED_ACTOR,
        granterEffectiveScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.incident.review"],
        granteeActorRef: "actor-1",
        requestedScopes: [ADMIN_MANAGEMENT_SCOPE, "investscape.incident.review"],
        purpose: "seed",
        expiresAt: null,
        now: clock,
        correlationId: "c1",
        isEnabled: true,
      });
    },
    async ({ url }) => {
      const res2 = await fetch(`${url}${BASE}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(validBody({ requestedScopes: ["investscape.retention.manage"] })),
      });
      const body1 = await res1.json();
      const body2 = await res2.json();
      assert.deepEqual(body1, body2);
      assert.deepEqual(body1, { state: "denied" });
    },
  );
});
