# Learning Library — bounded WeWeb slice

2026-10-09 owner-local / 2026-10-10 UTC. The owner deferred inaccessible Supabase support/live Research wiring and requested the next independent build. This slice builds and installs the educational Library, separate from Research's curated article catalog and Community discussions.

## Delivered behavior

Twelve initial entries, all searchable by formula ID, notation, module tag and four-language terms. Five existing categories: Cost of Capital, Time Value of Money, Cash Flow Model, Performance and Leverage. Every card opens a plain-language explanation, worked example and limitations with its existing RES/COM/DEV tags. Detail supports Escape, close/backdrop, keyboard focus trapping and opener restoration. The language control supports en, fr-CA, zh-Hant and zh-Hans; notation remains universal. Light/dark palettes follow the existing Investscape Dev design-system guidelines.

This is a bounded initial catalog, not a claim to migrate every historical formula card. It deliberately excludes tax schedules, interest reserve and total-budget cards until their source reconciliation is complete. The Addendum A displayed total-budget components sum to $75,000,195 while its headline reports $75,000,196; the rounded interest factor 0.641304 yields $3,232,172.16 while its reported workbook interest budget is $3,232,174. Those differences may reflect unshown precision but are not independently established. The ROC card uses the reported revenue/budget inputs and rechecks their subtraction/ratio; it does not claim to revalidate the inaccessible original workbook.

## No live service dependency

All educational content is bundled. There are no API, database, storage, session, AI, tracking or calculation-engine calls. Search and detail operate in memory. The component does not accept user/project figures, create recommendations, mutate a deal or read private records. Module tags describe formula coverage and are not paid entitlement gates.

The enabled flag defaults false and is a display switch, not a security boundary. Bundled educational copy is non-confidential and cannot be made private by hiding this component. Member-only navigation must use the existing application's reviewed page/access policy before any public release. Equal free/paid/downgraded educational access is preserved; no new role or entitlement is granted.

Translations use Doc 33 terminology where present and original translated explanatory copy. They are prepared for editorial review; historical French-acronym and Chinese-terminology proposals are not silently converted into new owner approvals. No full accessibility or native-language editorial sign-off is claimed.

## Dev wiring contract

Component root: ui/weweb/learning-library. Tag: investscape-learning-library.

1. Register/build the owned coded component in Investscape Dev. This makes an editor asset available; it does not publish the app.
2. The isolated Learning Library Review page is draft and hidden from sitemap, with enabled=true for non-confidential educational review only. Component defaults remain false; existing shared navigation has no Library link. This is not member/public release.
3. Bind locale to the existing app language using en / fr-CA / zh-Hant / zh-Hans and theme to light / dark (or auto for device preference).
4. Once the existing member page policy is reviewed, wire Library into the intended member page and navigation. No Research server, Supabase schema grant, new database or runtime credentials are required by this component.
5. Confirm the app's published page access and final editorial review before release. Publishing or changing existing routes is a separate step.

Preserve original v2-remastered HTML, Quick/Full staging, maps, Relationship OS and Research defaults. No production deployment, plan upgrade, live database provisioning or member-role change is included.

## Evidence and checks

Catalog unit/arithmetical checks: node --test src/library/catalog.test.ts.

Actual Vue compile/render harness: node docs/review/library/check-component.mjs <playwright-index.mjs> <complete-chromium-binary> <vue-esbuild-tools-root>. Restricted containers may require fresh archive extraction and the matching software-renderer libraries alongside Chromium; the browser binary must not be truncated.

The harness exercises every card in All and every category in every language, search/no-results/reset, editor/default-off behavior, focus trapping/restoration, runtime-disable clearing, unmount and four viewport widths in both color schemes. It intercepts all browser requests; only its local synthetic harness documents/assets are allowed. Results and English/French screenshots are under evidence/. These are local rendered component evidence, not hosted member-session acceptance.

## Completed Dev installation

Project: Investscape Dev (4a0173ad-346d-4d29-a9b9-0201e5af6d78). Page: Learning Library Review (fa691651-6fc1-45df-9d69-968d5baeb6ca), draft, hidden from sitemap, path learning-library-review. Coded component base 3d621fc9-e746-4983-a74a-9663f4c52c0f; version 05778482-b2f8-44ba-b7bf-f7c3c5b1f70b, internal version 2, package 1.0.1. Main section fcc328a2-62b5-4031-b727-de583d290f0e; component instance cd93727a-145b-46fb-8986-3bfdd93c109e. Existing shared header reused without navigation edits. Theme binding read back as globalContext.browser.theme ?? auto (the actual formula uses the quoted string auto). Locale defaults en and the in-component language control changes it in memory. No global app-language binding is claimed.

Verification: 3 catalog/arithmetic tests pass; 345 actual Vue browser assertions pass; 12/12 unique cards opened in All and across all five categories for each of four languages (96 detail openings total). Zero external requests or browser errors in that harness. Fresh installed WeWeb preview separately confirms all twelve visible cards and interactive EN/FR cap-rate details; installed all-card or all-locale verification is not claimed. These are component/Dev-editor checks, not production member-route acceptance. English and French installed-preview screenshots are attached to the handoff. No tasks remain running in the background.
