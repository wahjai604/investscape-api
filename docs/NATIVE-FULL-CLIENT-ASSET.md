# Native Full helper delivery

Public helper endpoint under the existing `/v1` router:

`/v1/development/assets/full-client-1/investscape-full-client.full-client-1.target-0.10.0-p2-6b.js`

Exact artifact: 17,483 bytes, SHA-256 `8abbad1340077073ab4b31f3a9a4e10ee7c7a8b6aa9ea55e52beec21540b4f26`. Independent build identity `full-client-1`, target adapter `0.10.0-p2-6b`. Reviewed helper source hashes and source-package archive pin are recorded in the colocated build manifest. Source build preparation is separate from this API repo; serving does not rebuild or rewrite financial code.

The route exposes only this script, not a static directory, manifest, engine bundle or credential. It verifies bytes before every response and fails closed with uncached 503 for missing/drifted bytes. Correct responses use JavaScript MIME, nosniff, immutable one-year cache and hash ETag. A changed artifact requires a new version path; do not replace this path's contents. No CORS, authentication, calculation contract or package changes are included.

The frozen `InvestScapeFullClient` surface includes shared input identity/freshness helpers and the bounded response decoder. It contains no local Full calculation, engine, request/network, token, storage or clock implementation. Freshness does not authorize display: consumers must separately obey status/sections/unavailableFields. Input-invalid/incomplete results omit declared engine identity, so optional engine-constrained matching rejects those; basic request matching still accepts current validation feedback.

Compute identity against the actual transmitted JSON request. Use plain decimal strings (including `"-0"`) for numeric inputs to avoid JSON negative-zero loss; undefined own fields are omitted by JSON. Increment current revision and clear displayed results on edits. Native consumer handles authenticated session and HTTP request outside this artifact. Decode the server envelope, match against current request and expected engine identity for engine-produced results, then apply display gates and disclosures.

Local acceptance covers exact bytes, source and compiled route execution, public GET/HEAD, fail-closed drift, narrow route scope, cache headers and VM execution. Prior helper preparation passed eight groups with 1,272 shared-helper comparisons, including five real pinned server results. These are Node/VM checks, not actual browser or WeWeb acceptance. Hosting deployment, live browser script load, CSP and authenticated native request remain pending.

## Cross-origin loader

Only this exact public helper overrides Helmet’s default resource policy with `Cross-Origin-Resource-Policy: cross-origin`. Other responses retain their existing policy. The existing API CORS allowlist is unchanged. Use script `crossOrigin = "anonymous"` and `integrity = "sha256-irutE0AHcHOrSzHzqaThDufHqLaqnqVeUr7sIVQLTyY="` before assigning its immutable URL; an allowed WeWeb origin must receive the existing CORS header for SRI loading. No credentials belong on this public script request. Local HTTP tests include Helmet and the observed WeWeb Origin; a live browser load remains a separate acceptance check.
