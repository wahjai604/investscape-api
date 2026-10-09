import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkExistingSessionCapabilities as check } from './session-capability-check.review.js';

function fixture(read, close = () => {}) {
  let listener, reads = 0, closes = 0;
  const client = { auth: {
    getSession: () => { reads++; return read(); },
    onAuthStateChange: callback => {
      listener = callback;
      callback('INITIAL_SESSION');
      return { data: { subscription: { unsubscribe() { closes++; close(); } } } };
    }
  } };
  return { client, emit: event => listener(event), counts: () => ({ reads, closes }),
    options: { client, getCurrentClient: () => client, environment: 'editor',
      renderedOrigin: 'https://review.invalid', timeoutMs: 100 } };
}
const ordinary = () => ({ data: { session: {
  user: { is_anonymous: false }, expires_at: Date.now() / 1000 + 60
} } });

test('eligible metadata report never reads identities or tokens and closes once', async () => {
  const result = ordinary();
  for (const key of ['id', 'email']) Object.defineProperty(result.data.session.user, key,
    { get() { throw new Error('identity read'); } });
  for (const key of ['access_token', 'refresh_token']) Object.defineProperty(result.data.session, key,
    { get() { throw new Error('token read'); } });
  const f = fixture(() => result), r = await check(f.options);
  assert.equal(r.status, 'CAPABILITIES_CONFIRMED');
  assert.equal(r.subscriptionReleased, true);
  assert.deepEqual(f.counts(), { reads: 1, closes: 1 });
  assert.equal(Object.isFrozen(r), true);
  for (const [key, value] of Object.entries(r)) {
    if (!['status', 'environment', 'renderedOrigin'].includes(key)) assert.equal(typeof value, 'boolean');
  }
});
test('editor and exact-origin gates prevent any SDK invocation', async () => {
  for (const override of [{ environment: 'preview' },
    { renderedOrigin: 'https://review.invalid/path' },
    { renderedOrigin: 'https://secret@review.invalid' }]) {
    const f = fixture(ordinary), r = await check({ ...f.options, ...override });
    assert.notEqual(r.status, 'CAPABILITIES_CONFIRMED');
    assert.deepEqual(f.counts(), { reads: 0, closes: 0 });
    assert.equal(r.renderedOrigin, null);
  }
});
test('missing subscription contract prevents session read', async () => {
  const f = fixture(ordinary);
  f.client.auth.onAuthStateChange = () => ({ data: { subscription: {} } });
  const r = await check(f.options);
  assert.equal(r.status, 'CAPABILITIES_UNAVAILABLE');
  assert.deepEqual(f.counts(), { reads: 0, closes: 0 });
});
test('no session, anonymous or omitted anonymity, and expired sessions are distinguished', async () => {
  const cases = [
    [{ data: { session: null } }, 'NO_SESSION'],
    [{ data: { session: { user: { is_anonymous: true }, expires_at: Date.now()/1000+60 } } }, 'NON_ANONYMOUS_REQUIRED'],
    [{ data: { session: { user: {}, expires_at: Date.now()/1000+60 } } }, 'NON_ANONYMOUS_REQUIRED'],
    [{ data: { session: { user: { is_anonymous: false }, expires_at: 1 } } }, 'SESSION_EXPIRED']
  ];
  for (const [value, expected] of cases) {
    const f = fixture(() => value), r = await check(f.options);
    assert.equal(r.status, expected); assert.equal(r.subscriptionReleased, true);
    assert.deepEqual(f.counts(), { reads: 1, closes: 1 });
  }
});
test('SDK rejection and error payloads never enter diagnostic output', async () => {
  const secret = 'fixture-secret-never-output';
  for (const read of [() => Promise.reject(new Error(secret)), () => ({ error: { message: secret } })]) {
    const f = fixture(read), r = await check(f.options);
    assert.equal(r.status, 'SDK_READ_FAILED'); assert.equal(JSON.stringify(r).includes(secret), false);
    assert.deepEqual(f.counts(), { reads: 1, closes: 1 });
  }
});
test('sign-out during read fences old metadata and cleans up', async () => {
  let finish;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  const pending = check(f.options); await Promise.resolve();
  f.emit('SIGNED_OUT'); finish(ordinary());
  const r = await pending;
  assert.equal(r.status, 'SESSION_CHANGED'); assert.equal(r.sessionPresent, false);
  assert.deepEqual(f.counts(), { reads: 1, closes: 1 });
});
test('client replacement during read denies old metadata', async () => {
  let finish, current;
  const f = fixture(() => new Promise(resolve => { finish = resolve; })); current = f.client;
  const pending = check({ ...f.options, getCurrentClient: () => current }); await Promise.resolve();
  current = {}; finish(ordinary());
  const r = await pending;
  assert.equal(r.status, 'CLIENT_REPLACED'); assert.equal(r.sessionPresent, false);
  assert.deepEqual(f.counts(), { reads: 1, closes: 1 });
});
test('deadline closes once; failed cleanup cannot report success', async () => {
  const f = fixture(() => new Promise(() => {}));
  const r = await check({ ...f.options, timeoutMs: 10 });
  assert.equal(r.status, 'DEADLINE_EXCEEDED'); assert.equal(r.subscriptionReleased, true);
  assert.deepEqual(f.counts(), { reads: 1, closes: 1 });
  const g = fixture(ordinary, () => { throw new Error('fixture-secret'); });
  const failed = await check(g.options);
  assert.equal(failed.status, 'CLEANUP_FAILED'); assert.equal(failed.subscriptionReleased, false);
  assert.equal(JSON.stringify(failed).includes('fixture-secret'), false);
  assert.deepEqual(g.counts(), { reads: 1, closes: 1 });
});

const proposal = JSON.parse(readFileSync(new URL('./session-capability-workflow.review.json', import.meta.url), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function() {}).constructor;
const proposedAction = new AsyncFunction('wwLib', 'globalContext', proposal.installationArgs.actions.inspect.code);
test('exact proposed workflow runs against only the supplied public client', async () => {
  const f = fixture(ordinary);
  const plugin = { publicInstance: f.client };
  Object.defineProperty(plugin, 'privateInstance', { get() { throw new Error('private client read'); } });
  const r = await proposedAction({ wwPlugins: { supabaseAuth: plugin },
    getFrontWindow: () => ({ location: { origin: 'https://review.invalid' } }) },
    { browser: { environment: 'editor' } });
  assert.equal(r.status, 'CAPABILITIES_CONFIRMED');
  assert.equal(r.subscriptionReleased, true);
  assert.deepEqual(f.counts(), { reads: 1, closes: 1 });
});
test('proposed workflow blocks preview execution and contains host errors', async () => {
  const unsafeHost = { get wwPlugins() { throw new Error('fixture-secret'); } };
  const blocked = await proposedAction(unsafeHost, { browser: { environment: 'preview' } });
  assert.deepEqual(blocked, { status: 'EDITOR_SCOPE_REQUIRED' });
  const missing = await proposedAction(unsafeHost, { browser: { environment: 'editor' } });
  assert.deepEqual(missing, { status: 'HOST_UNAVAILABLE' });
});
