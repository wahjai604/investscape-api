# Default-off map API composition and WeWeb component checkpoint

**Date:** 2026-10-09, America/Vancouver / UTC. **Scope:** source implementation and synthetic verification on the isolated review branch. Based on API `1312b86b08740c5bc4b78d6ccd483996cd8e40b5`. No live provisioning, pool binding, administrator appointment, Auth provider change, Railway deployment, WeWeb component upload/page edit/publication or map activation.

## Implemented behavior

| Surface | Result | Remaining boundary |
|---|---|---|
| Source API startup | Mounts the tested private composition directly after Helmet, before legacy CORS/preflight, global 100 KB parser and engine guards | Existing Railway-connected branch unchanged; this startup candidate has not been deployed |
| Configuration | Exact-true independent `MI_MAP_READ_ENABLED` / `MI_MAP_ADMIN_ENABLED`, default false; explicit issuer/audience, exact HTTPS origins | Missing scoped resources always return static no-store 503, even with flags armed; startup binds no pools |
| Resources | Injected independent reader/access-writer databases; helper wraps two distinct already-scoped pg pools; shutdown attempts both once with static failures | No pool construction, connection/credential discovery, role assignment or TLS configuration is supplied; effective roles/target/TLS require Dev provisioning |
| Private HTTP boundary | Dedicated verifier, bounded process-wide request counters, own CORS/preflights, no cookies, terminal scoped 404s | One process/replica, no distributed/per-user/IP quotas or proxy assumptions |
| WeWeb transport | Resolves relative API paths to one configured HTTPS API origin; current existing-host Bearer per request; four strict path shapes; no-store/credentials omit/redirect error | Exact legacy plugin session accessor and host installation are not verified or installed |
| Packaged Vue wrapper | Complete `package.json`, `ww-config.js`, `AI.json`, `src/wwElement.vue`, scoped CSS and self-contained helpers; editing/default/unconfigured states disconnected | Not uploaded to WeWeb. Local Vue compilation/browser verification is not a WeWeb CLI/platform build or publication result |
| Lifecycle/private state | Session notifications clear member/audit state and cancel pending work; configuration changes/unmount dispose transport/subscription; unique input IDs | Final session checks are observation points, not instantaneous revocation guarantees after response delivery |

The original v2-remastered HTML remains unchanged. This package is for the WeWeb SaaS frontend and backend, not the HTML prototype. It supplies the access-administration wrapper, not map geometry or a rendered live map.

## Composition details

`src/market-intel/map/composition.ts` creates the router and scoped stores, with an explicitly supplied cryptographic verifier seam only for reviewed hosts/tests. Runtime defaults to the existing dedicated ES256/RS256 verifier. The read pool serves manual authority and private catalog reads; the independent writer pool serves approval inspection/change. Neither derives its connection from Lighthouse or a general engine authentication setting.

`resolveMapCompositionConfig` reads only these non-secret posture names: `MI_MAP_READ_ENABLED`, `MI_MAP_ADMIN_ENABLED`, `MI_MAP_AUTH_ISSUER`, `MI_MAP_AUTH_AUDIENCE`, `MI_MAP_ADMIN_ORIGIN`, `CORS_ALLOWED_ORIGINS`. The origin list must be nonempty, contain at most 16 exact HTTPS origins and have no invalid entries. The admin origin must be one of those origins. Localhost HTTP and permissive wildcard entries are not accepted by this private composition. All such values in tests are synthetic; deployed configuration remains unknown.

The current `src/index.ts` candidate calls the composition with **no resources**. It registers the failure boundary but cannot enable reads/writes merely through flags. A future reviewed host must inject two scoped pools. It reports only ready/disabled-or-unconfigured posture, never settings, tokens, subjects or credentials. The candidate shutdown hook attempts both existing Lighthouse cleanup and map cleanup, without modifying the Lighthouse subsystem or its database/migration code; cleanup logging is static. Existing process exit behavior is preserved.

The private scope runs before the legacy global CORS handler because that handler can answer preflights permissively before a downstream router sees them. The map owns exact-origin preflights and admin Origin admission, its independent authentication, and its 8 KB uncompressed JSON parser. Scope middleware runs before parsing, so oversized unauthenticated/non-admin writes are refused without parsing. Non-map requests continue through existing middleware in their original order. Unknown map paths cannot fall through to general engines.

Counter defaults are 120 total map requests and 30 administrator requests per fixed 60-second process window, including preflights. Counters have no user/IP keys and use no forwarded-IP trust. Tests inject smaller bounds and a clock to verify reset. These are bounded pilot protection, not a production capacity or denial-of-service claim. Views remain single-process, bounded and short-lived; restart/eviction requires fresh manifests. None of this supplies shared multi-instance storage.

## Host session contract and packaged wrapper

`ui/map-session-adapter.js` exports a transport and an explicit host registration helper. The registered host supplies:

- `issuer`: the operator-confirmed Supabase issuer.
- `readSession()`: a fresh transient `{issuer, subject, expiresAt, accessToken}` from the existing Auth session lifecycle; no session becomes a server grant through this object.
- `subscribe(listener)`: notify on sign-out, account/session replacement or relevant lifecycle change, returning an unsubscribe function.

The helper registers that host on the runtime window returned by `wwLib.getFrontWindow()` under `Symbol.for('investscape.map.session-host.v1')`; its returned unregister function removes only its own registration. It rejects an existing registration rather than overwriting it. The wrapper reads the host only in `onMounted` when `content.enabled === true` and editing is false. It does not inspect the installed plugin, change Auth provider, copy users or decode tokens for authority. A host callback is a client lifecycle input; the server still checks cryptographic issuer/audience/session and current administrator authority.

Content properties are only `enabled` (false) and `apiOrigin` (empty), matching AI.json and ww-config. No token, member or audit properties/variables/events are exposed. The static-rendering container is safe because setup/module initialization performs no network/session subscription; connection starts only onMounted. Component configuration changes rebuild after disposing old state. Editing mode creates the disconnected view and never subscribes. The wrapper uses the WeWeb front window; the DOM UI uses the mounted root's ownerDocument, with instance-unique IDs, avoiding the wrong editor document and duplicate labels. Styles are scoped to the wrapper, including theme/media rules; they do not style the surrounding app's controls.

The self-contained component helper copies exactly match canonical UI sources, checked by the Node suite. Its package follows the current WeWeb authoring specification (`@weweb/cli: latest` only as the package's development dependency); the API's root package/lockfile and runtime dependencies are unchanged. The actual WeWeb component inventory returned no owned component; no component was forked, edited or published.

The transport permits only GET manifest, GET pinned layer, GET administrator member and POST administrator changes. It rejects unknown/duplicate/override query parameters, normalized/encoded escape paths, GET bodies, ambient credentials and caller-supplied Authorization/arbitrary headers before session/network work. It rebuilds its own headers from the fresh host session and configured destination. There is no endpoint/provider fallback or automatic request retry. Approval POSTs execute once; an uncertain result requires a persisted status/audit reload through the existing UI.

The request deadline is 10 seconds by default (accepted explicit bounds 100–30,000 ms) and covers session acquisition, fetch, bounded body reading and final session observation. A one MiB response bound prevents indefinite/oversized payload accumulation. JSON-only responses, redirects, raw host/network failures and malformed sessions cannot expose private diagnostics. Notifications/disposal cancel pending requests even if a host ignores the abort; late results cannot restore old-account UI. The final issuer/subject comparison also refuses an account replacement observed without a notification. Tokens and administrative payloads are not stored in custom browser storage, URLs, analytics or logs. The existing Auth provider's own persistence behavior is not changed or claimed away.

## Verification actually performed

- **Typecheck and build passed**, plus diff whitespace validation.
- **Full offline Node suite: 607 tests, 605 passed, 2 skipped, 0 failures.** The two pre-existing E85 checks still lack external snapshot evidence. This checkpoint adds 20 tests: 10 composition/production-order/resource checks and 10 transport/package checks.
- Composition HTTP tests use generated ES256 JWTs and disposable embedded Postgres under the reader/access-writer roles. The tested chain reproduces the relevant startup order: Helmet, actual map composition, permissive legacy CORS, global 100 KB parser, legacy engine guard sentinel. Tests cover signed reads/audited writes, wrong issuer/no authentication/non-admin before body parsing, 8 KB limits, compressed bodies, private preflights, terminal unknown paths, independent switches, bounded counters and exactly-once pool shutdown despite failures. A source-order check ensures startup uses that composition before the global handlers. This is not a full live process/startup or deployed configuration test.
- **34 packaged Vue browser assertions passed** using Vue/compiler-sfc 3.5.22, esbuild 0.25.11 and Chromium 149. The actual SFC was compiled and rendered, with reactive parent props rather than a stand-in controller. Its actual host transport made real localhost HTTP calls carrying generated synthetic tokens through the production-equivalent composition, verifier and database. One approval POST persisted and reconciled its audit. Additional checks cover default/editing lockout, session subscription, phone/tablet/desktop and both themes, surrounding-control style isolation, two-instance input IDs/labels, sign-out clearing, no signed-out API call, delayed old-account response suppression, invalid-origin reconfiguration and exactly-once unsubscription/unmount cleanup. No synthetic-header browser proxy was used in this test.
- **Existing standalone UI: 28 browser assertions passed again**, including approve/revoke, uncertain result, delayed receipt, literal audit text and stale target behavior. Fresh standalone screenshots were written to a temporary external tooling folder, preserving all four historical committed screenshots.
- Two new synthetic packaged-component screenshots were visually inspected: [phone/light](map-component-evidence/390-light.png), [desktop/dark](map-component-evidence/1100-dark.png). The “Outside component” button is a deliberate style-isolation test, not product UI. The wrapper fit 320/390/768/1100 px in both themes; labels remained associated. This is not a full accessibility audit.

Browser tooling was outside the repository. A retained executable was truncated and initially failed; it was reconstructed from the installed Chromium package, with its matching software-rendering libraries and required single-process sandbox flags. The final tests retained browser web security/CORS; `--disable-web-security` was not used. Virtual `.invalid` page/API URLs were fulfilled/intercepted by the test harness and forwarded only to the disposable loopback API, not contacted as public services. No real Auth/JWKS, database, account, user record or deployed endpoint was tested. Each fixture/browser/server closes in finally; no background process remains.

### Reproduction

Standard checks: `npm run typecheck`, `npm run build`, `npm test`.

The packaged browser helper takes three absolute paths: Playwright module, compatible browser executable, and an external directory containing Vue/compiler-sfc 3.5.22 and esbuild 0.25.11 under node_modules:

```sh
node docs/review/check-map-weweb-component.mjs /absolute/playwright/index.mjs /absolute/chromium /absolute/component-tools
```

The standalone helper additionally accepts an output directory as argument four to preserve historical images. No connection string or real session is supplied to either helper. The fixture's existing synthetic proxy remains test-only and has no production startup import; the new packaged-wrapper test uses the actual transport and verifier without it.

## Next live boundary

The preparatory source slice is complete. The next dependent stage needs the actual Dev owner/default privileges and scoped role baseline; recovery/map-ledger receipt; two scoped runtime bindings and one process/replica; explicit initial access-admin identity-match/bootstrap authorization; effective non-secret issuer/audience/asymmetric-session compatibility; exact rendered-app/API origins; legacy Auth session accessor; and resolution or explicit exclusion of the older Railway staged patch recorded in the Dev review. These facts remain unverified, not inferred from the synthetic tests.

Prepare the final Dev provisioning/configuration package only after those facts are established. Applying DDL, appointing an administrator, installing the live host/component, deploying this candidate and publishing/activating remain distinct reviewed actions. Publisher appointment, audited catalog ingestion/promotion/withdrawal, CMHC recipient acceptance, geometry delivery/scale/performance and rendered live-map acceptance are still pending. No shared InvestScape/Relationship OS transaction domain or authority is established by this independent work.

Current WeWeb coded-component documentation was read through the connector before authoring; its required files, props, editor guards, configuration and AI.json conventions were followed. The local compiler check does not substitute for WeWeb's own build validation during an authorized upload. [Dev provisioning/wiring review](map-dev-provisioning-wiring-review.md) and [draft private schema](map-store-schema.sql) retain the exact unresolved owner statements and live permission boundary.

## Dated Dev verification follow-up — 2026-10-09

The [Dev bindings and scoped provisioning package](map-dev-bindings-provisioning-package.md) now records the authorized read-only live catalog baseline and concrete explicit-owner/independent-ledger review SQL. Six new offline package tests and the 24 existing store tests pass together; typecheck passes. The upstream legacy session getter/subscription are established as source expectations; installed-build compatibility, real runtime database/Auth/origins, recovery/owner authorization and empty Railway patch uncertainty remain. Both future runtime principals stay NOLOGIN in the candidate. No startup resource binding, WeWeb host installation, live provisioning, appointment, deployment or activation occurred.
