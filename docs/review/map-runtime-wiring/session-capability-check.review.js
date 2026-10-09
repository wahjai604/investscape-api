/** Review-only diagnostic. Not imported by startup or installed in WeWeb.
 * Receives the explicitly selected existing client. Returns only a safe origin,
 * static status and booleans; never reads identity or access/refresh-token fields.
 * getSession may refresh an existing session inside the SDK. Runtime use needs
 * separate approval; this file itself neither creates a client nor calls an API.
 */
export async function checkExistingSessionCapabilities({
  client, getCurrentClient, environment, renderedOrigin, timeoutMs = 2000
} = {}) {
  const report = {
    status: 'CAPABILITIES_UNAVAILABLE', environment: 'editor', renderedOrigin: null,
    getSessionAvailable: false, authEventsAvailable: false, subscriptionUsable: false,
    sdkReadSucceeded: false, sessionPresent: false, explicitlyNonAnonymous: false,
    unexpired: false, clientUnchanged: false, stableDuringRead: false,
    subscriptionReleased: false
  };
  let subscription = null, timer = null, epoch = 0;
  const current = () => {
    try { return typeof getCurrentClient === 'function' && getCurrentClient() === client; }
    catch { return false; }
  };
  try {
    if (environment !== 'editor') { report.status = 'EDITOR_SCOPE_REQUIRED'; return report; }
    // Record only an exact HTTPS origin, never a path, query or credentials.
    try {
      const url = new URL(renderedOrigin);
      if (url.protocol !== 'https:' || url.origin !== renderedOrigin) throw new Error();
      report.renderedOrigin = url.origin;
    } catch { report.status = 'ORIGIN_UNAVAILABLE'; return report; }
    if (!Number.isFinite(timeoutMs) || timeoutMs < 10 || timeoutMs > 5000) return report;
    const auth = client?.auth;
    report.getSessionAvailable = typeof auth?.getSession === 'function';
    report.authEventsAvailable = typeof auth?.onAuthStateChange === 'function';
    if (!report.getSessionAvailable || !report.authEventsAvailable) return report;
    if (!current()) { report.status = 'CLIENT_REPLACED'; return report; }
    // The callback reads no session payload and performs no async SDK operation.
    const registration = auth.onAuthStateChange(event => {
      if (event !== 'INITIAL_SESSION') epoch++;
    });
    subscription = registration?.data?.subscription;
    report.subscriptionUsable = typeof subscription?.unsubscribe === 'function';
    if (!report.subscriptionUsable) return report;
    const generation = epoch;
    const deadline = Symbol('deadline');
    const result = await Promise.race([
      Promise.resolve().then(() => auth.getSession()),
      new Promise(resolve => { timer = setTimeout(() => resolve(deadline), timeoutMs); })
    ]);
    report.clientUnchanged = current();
    report.stableDuringRead = generation === epoch;
    if (result === deadline) { report.status = 'DEADLINE_EXCEEDED'; return report; }
    if (!report.clientUnchanged) { report.status = 'CLIENT_REPLACED'; return report; }
    if (!report.stableDuringRead) { report.status = 'SESSION_CHANGED'; return report; }
    if (result?.error) { report.status = 'SDK_READ_FAILED'; return report; }
    report.sdkReadSucceeded = true;
    const session = result?.data?.session;
    report.sessionPresent = !!session;
    if (!session) { report.status = 'NO_SESSION'; return report; }
    report.explicitlyNonAnonymous = session.user?.is_anonymous === false;
    report.unexpired = typeof session.expires_at === 'number' &&
      Number.isFinite(session.expires_at) && session.expires_at > Date.now() / 1000;
    report.status = !report.explicitlyNonAnonymous ? 'NON_ANONYMOUS_REQUIRED' :
      !report.unexpired ? 'SESSION_EXPIRED' : 'CAPABILITIES_CONFIRMED';
    return report;
  } catch { report.status = 'SDK_READ_FAILED'; return report; }
  finally {
    if (timer !== null) clearTimeout(timer);
    if (report.subscriptionUsable) {
      try { subscription.unsubscribe(); report.subscriptionReleased = true; }
      catch { report.status = 'CLEANUP_FAILED'; }
    }
    Object.freeze(report);
  }
}
