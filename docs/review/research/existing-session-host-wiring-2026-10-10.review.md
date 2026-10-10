# Research existing-session wiring — October 9 owner-local / October 10 UTC

## Completed source work

The dedicated source bridge at `ui/weweb/research-library/src/utils/research-supabase-session-host.js` adapts an explicitly supplied existing public Supabase client to Research's existing four-field transient session-host contract. It never imports a map module, discovers a provider, creates a second Auth client, registers itself, reads browser storage or private/cached session fields, or decodes a JWT. Configured issuer is an expectation; cryptographic issuer/audience and current exact-session eligibility remain API responsibilities.

One fresh `client.auth.getSession()` read supplies a transient session to the existing bounded reader transport. Explicitly anonymous, missing, malformed or expired sessions are denied. SDK errors and throwing metadata getters become static denial messages. Tokens remain solely in transient transport input; the bridge has no logging, storage, diagnostic export or network fetch implementation.

One shared `onAuthStateChange` subscription fences pending reads synchronously and schedules UI invalidation outside the SDK Auth callback. Client replacement is terminal even if the previous client is later restored. Duplicate listeners own separate unsubscribe entries. Last-listener removal or host destruction attempts SDK unsubscribe once; cleanup failure produces a static `RESEARCH_HOST_CLEANUP_FAILED` instead of falsely reporting success. Host destruction cancels queued notifications and invalidates consumers. The transport retains its deadline, response-size limit, redirect refusal and final account check. Already-pending SDK getSession work cannot itself be aborted by the host; the transport bounds how long it waits and rejects invalidated results.

## Fresh non-secret connector evidence

Read-only Investscape Dev checks on October 10 UTC, October 9 owner-local:

| Fact | Label | Evidence / limit |
|---|---|---|
| Project accessible | Freshly verified | WeWeb project 4a0173ad-346d-4d29-a9b9-0201e5af6d78; MCP access available |
| Supabase connection installed | Freshly verified | listIntegrationsInfo: connection 40c528bb-150f-4ecc-9aff-846cd113dbc9 |
| Native WeWeb modules | Freshly verified | getWeWebBackendStatus retry succeeded: server, database, Auth and Storage all false; first call returned NETWORK_ERROR |
| Listing advertises other Auth integrations | Freshly verified | Integration discovery advertises custom-auth/weweb-auth as installed, despite native status; availability documentation is not an active-provider result |
| Effective Auth provider | Unknown | Neither native-module status nor integration listing identifies the project's actual selected provider |
| Installed legacy public accessor/session capabilities | Historical reported evidence | Oct 9 manual capability receipt in map-runtime-wiring/member-session-execution-2026-10-09.json; not re-executed or Research acceptance |
| Research page | Unknown / not returned by targeted search | searchPages Research,Connection Test returned only draft Connection Test page 1005895d-bf81-4f39-b9da-7e871a776390; this is not proof that no differently named Research content exists |
| Hosted member/API/editor origins | Unknown | Workspace editor origin remains distinct from hosted app origins; no URL or env-value inference |
| Installed plugin release and complete Research session-host acceptance | Unknown | Source-only bridge, not installed or run against a real identity/JWT |

No environment values, raw JWTs, credentials, real app subject or user/session table records were inspected. Workspace account discovery is not app-member/editor identity evidence. Its access handoff URL was not retained in this review.

## Concrete installation sequence for later authorization

1. Verify the installed existing public accessor and exact rendered app environment. Historical source expectation is `wwLib.wwPlugins.supabaseAuth.publicInstance`; do not replace the provider if the accessor is missing. Capture only non-secret capability/origin evidence through the already bounded diagnostic.
2. Supply that explicit client, expected Dev issuer and a getter returning the current same public client to `createExistingSupabaseResearchHost`. Do this only in the authorized member runtime after exact origin/bindings acceptance. A public getSession read may internally refresh an existing SDK session; this is runtime behavior, beyond metadata-only inspection.
3. Register only this host using the existing `registerResearchSessionHost(wwLib.getFrontWindow(), host)` helper. Retain its unregister function. Reject an existing registration rather than overwrite it. No automatic startup registration is included in this package.
4. On app/client teardown, unregister first and destroy the host; handle only static cleanup failures. The registered component consumes the host only after explicit enablement and outside editor mode. Source flags remain default-off.
5. Verify real member sign-in, sign-out, account/client replacement, refresh, expiry, navigation cleanup and delayed-result suppression against the dedicated Research API. Confirm API cryptographic JWT validation and fresh current-subject/exact-session checks separately; browser session metadata is not an access grant. Free, paid and downgraded-to-free policy stays equal.

The bridge serves only the read-only browsing transport. It does not supply an editorial transport, approve sources, appoint an editor, provision LOGIN credentials or publish a WeWeb component/page. Recovery coverage, disabled-create approval, supported Auth schema USAGE, exact hosted origins, scoped TLS connections, host allocation and real-session acceptance still gate live wiring.

## Validation

Focused session-host and existing reader-client tests: 11 passed, zero failures/skips; typecheck passed. Five new tests verify lifecycle and transport composition with synthetic sessions and no live service. No rendered component behavior changed, so browser rendering checks were not repeated. The full application suite was not rerun.

Primary references refreshed: https://supabase.com/docs/reference/javascript/auth-getsession and https://supabase.com/docs/reference/javascript/auth-onauthstatechange; current WeWeb integration/Auth context documentation. Native WeWeb Auth context documentation is conditional and does not establish a Supabase accessor. Existing pinned legacy source/capability evidence remains historical.

No live database change, provider change, page/workflow installation, service creation, deployment, WeWeb publication, article publication or map activation occurred. The original HTML, Quick/Full, maps and Relationship OS remain preserved.
