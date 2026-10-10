# Learning Library — canonical formulas and statistics

2026-10-10 UTC. The Dev component now contains **103 educational cards**: the unchanged 39 canonical F cards plus all 64 deduplicated additional topics. The final batch adds 40: three economics, thirteen finance/valuation, fifteen tax concepts, seven lease/development and two planning cards. No proposed educational-card slots remain. The initial editorial pass and Dev navigation/language wiring are complete; independent subject/native-language approval and member-runtime acceptance remain pending. Library IDs are not engine numbers.

| Category | Cards |
| --- | ---: |
| Cost of Capital | 3 |
| Time Value of Money | 8 |
| Cash Flow Model | 8 |
| Performance | 13 |
| Leverage | 12 |
| Development & Construction | 15 |
| Market Statistics & Risk | 18 |
| Economics & Market Conditions | 9 |
| Taxes & Ownership Costs | 15 |
| Land Use & Planning | 2 |
| Total | 103 |

Every card contains a four-language name, explanation, worked example and limitations: en, fr-CA, zh-Hant and zh-Hans. Formula notation, IDs and RES/COM/DEV tags remain universal. Search covers IDs, notation, tags and names/explanations in all languages. Development cards have their own filter; F-707 now belongs to it. Details support Close, backdrop, Escape, focus trapping and opener restoration. Default-off and editor-disable behavior are preserved. Module tags describe coverage and impose no paid subscription gate. Statistics details link related entries, including existing Future Value and IRR cards. Related navigation preserves the category filter and restores the original card focus on close.

## Source and number handling

Source provenance and primary government cross-checks are in source-provenance.json. Explanations and translations are original educational copy, prepared for editorial review. Historical glossary policy proposals are not new owner approvals. No native-language editorial or full accessibility certification is claimed.

Historical figures are distinguished from illustrative assumptions and fresh arithmetic. No inaccessible workbook is claimed to have been freshly validated.

- F-702: the printed rounded 796 utilization factor gives $3,232,172.16, while its reported reserve budget is $3,232,174. The $1.84 gap and missing unrounded factor are stated on the card. F-704 explicitly uses the reported budget for its own subtraction.
- F-705: the printed negative $153,355 adjustment produces $86,038,490. Adding it produces the reported $86,345,200. The sign is unresolved; both cases and that limitation are visible.
- F-706: 796 component amounts sum to $75,000,195, $1 below the headline. The card uses the exactly reconciling Gilley total of $43,751,237 instead. F-707 also uses the Gilley profit/ROC figures.
- F-708: the expense assumption is omitted from the historical Gilley example. The card labels the NOI and deduction ratio implied by its reported value as reverse-derived, not verified source assumptions.
- F-701: the $22M example is explicitly conditional on a fully residential taxable transfer, no exemptions and no additional foreign-buyer tax. Government examples cross-check bracket rates and the conditional residential surcharge. Share/bare-trust transactions are not automatically declared exempt.
- F-504 retains full periodic-rate precision: $910,558.73, rather than presenting the historical rounded $910,600 as exact.
- F-709 explains reference structures and a small preferred-return/tranche example; it does not implement a full partnership hurdle calculator. F-710 distinguishes loan retirement from project-profit breakeven.

## Dev installation

Project: Investscape Dev, 4a0173ad-346d-4d29-a9b9-0201e5af6d78.
Page: Learning Library Review, fa691651-6fc1-45df-9d69-968d5baeb6ca, draft, hidden from sitemap, path learning-library-review.
Component: investscape-learning-library, base 3d621fc9-e746-4983-a74a-9663f4c52c0f, version bef62685-1d7e-4268-b40e-ca35351f4e8e, internal version 9, package 1.5.1, built 2026-10-10T17:13:12.953Z.
Instance: cd93727a-145b-46fb-8986-3bfdd93c109e; main section fcc328a2-62b5-4031-b727-de583d290f0e.

All twelve installed source files were read back and match the tested source exactly. The review instance enables non-confidential bundled content. The component default stays false. The host binds a scoped Library Language variable and handles localeChange through event.value. The preference persists on this device across navigation and refresh. The existing shared draft header has a Library link whose label follows that preference. The rest of the app remains in its existing native English pages; no app-wide translation or account preference is claimed. The existing theme binding follows globalContext.browser.theme with auto fallback. See navigation-wiring.json and editorial-review.md.

## Verification

- Catalog tests: node --test src/library/catalog.test.ts. Eight tests pass: exact 103 unique IDs and ten category counts, valid related IDs, all four locale fields, numeric parity, independent example arithmetic, iterative/closed-form amortization and later-negative-flow MIRR cases. Original canonical discrepancies remain explicit.
- Final compiled Vue harness: **3,827 assertions pass**; final result is recorded in evidence/verification.json. All 103 cards open in All and their category in every locale (**824 detail openings**), with exact visible copy checks. Narrow-screen long-detail coverage includes 25 IDs, four locales and both color schemes (200 openings), plus existing width/theme/keyboard/default-off/editor/unmount checks. Tax disposal related navigation is additionally checked in each locale.
- Installed Dev: the 103-card overview and ten category counts are checked in all four locales. All 40 new details are checked in each locale (**160 exact six-field SHA-256 comparisons**) on version 7. Version 8 only corrects two disposal links to F-303; those six detail fields are unchanged. All twelve final installed files match tested source. Final installed link/filter/opener checks are recorded in evidence/completion-installed-preview.json; screenshot: evidence/completion-installed.jpg. Prior receipts remain historical. No real member session, production acceptance or public app publication is claimed.

The harness command is node docs/review/library/check-component.mjs <playwright-index.mjs> <complete-chromium-binary> <vue-esbuild-tools-root>. Restricted containers may require fresh archive extraction and matching renderer libraries alongside Chromium.

## Statistics and topic scope

statistics-inventory.json pins descriptive, weighted, dispersion and growth source files from investscape-market-intelligence-engine at b279e22d71019009439803d928aeadf7e6b92ddc. Worked examples are original and synthetic. Source conventions are explicit: R-7 interpolation, percentile mid-rank, sample/population variance, absolute-mean CV and absolute-prior growth. CAGR accepts an ending value of zero according to executable source; its stricter source comment is not treated as authoritative behavior. CV limits explain meaningful-zero scales, near-zero means and mixed-sign observations.

All 18 previously deferred groups now have a concept scope that can be prepared and a separate implementation/live-output/current-rule claim held for evidence. topic-group-reclassification.json preserves the original groups and source reasons; it is not 18 or 36 automatic additional cards. Reuse existing and proposed topics before allocating a distinct concept card. The first batch covers ST01–ST12. The second batch completes the revised six remaining statistics slots:

| Library ID | Topic | Inventory lineage |
| --- | --- | --- |
| S-013 | Outliers: Z-Scores and IQR Flags | Original ST13 + ST14 combined |
| S-014 | Winsorization: Capping Extreme Values | New W01 concept uses the slot freed by combining ST13/ST14 |
| S-015 | Correlation and Sample Covariance | ST15, with sample covariance explaining Pearson correlation |
| S-016 | Geography, Comparability and Weighting | ST16, linked to existing S-003 weighted mean |
| S-017 | Benchmarks, Ranges and Consensus | ST17, linked to existing weighted mean and cap rate |
| S-018 | Data Quality, Freshness and Uncertainty | ST18 |

No geography aggregation or operational winsorization service is claimed. Geography examples pool means only for comparable, disjoint groups with matching observation counts; medians cannot be pooled this way. Winsorization uses declared illustrative fixed bounds and preserves raw values. Covariance is the sample convention used internally by the inspected Pearson implementation, not a claim of implemented portfolio risk. Benchmark example weights are illustrative, not engine defaults; incompatible evidence is excluded before consensus, and severe unresolved conflict can produce a gap. Quality completeness and confidence are not accuracy probabilities or source permissions.

Version 9 visibly passes four-language navigation/refresh tests and an installed S-009 detail check in each locale; all twelve installed files match tested source. Evidence: evidence/navigation-installed-preview.json and evidence/navigation-installed.jpg. These are Dev editor-preview checks, not real-member acceptance.

The original 64-candidate inventory remains historical; this revised plan still has 64 additional slots: 64 built and zero remaining, for a current Dev total of 103.

## Economics scopes and source limits

economics-inventory.json maps EC01–EC06 to EC-001–EC-006 and records seven freshly read source pins from investscape-economic-engine at d850ee82297ddfccd2f1340fb065550789cb516c. No existing F/S card content changed. All six worked examples are original synthetic cases, with numeric parity across English, French, Traditional Chinese and Simplified Chinese.

| ID | Scope |
| --- | --- |
| EC-001 | Indicator units and periods; index change versus percentage-point rate change |
| EC-002 | Private-household population divided by matching private-household count; area aggregates do not establish individual facts |
| EC-003 | Comparable-sale eligibility, consistent measured area and explicitly assumed unit-price scaling |
| EC-004 | Asking versus signed/collected rent, monthly area units and undiscounted incentive averaging |
| EC-005 | Month-end inventory/monthly sales, sales/active and sales/new; no universal market cutoff |
| EC-006 | One-input sensitivity versus multi-input scenarios; reuses F-405/F-406 rather than allocating a duplicate valuation formula |

E29/E31 read dated fixtures. E32/E33/E37/E38 return fixtures with a validated request date; that date is not proof of observation freshness. Their heat, elasticity, confidence and forecast fields are not adopted as live evidence. E45 computes supplied scenario outcomes with defaults/constraints and carries supplied probability values; this does not establish calibrated likelihood or deployed runtime integration. Primary StatCan, CMHC, GVR and CREA methodological cross-checks are listed with their bounded roles; no live observations or source excerpts were imported into cards.

The compiled harness covers all six economics cards at 320-width in both light/dark schemes across four locales, plus the previous five long-detail cases (88 long-detail openings). The preceding six-card installed receipt remains historical; current completion verification is described above. Final editorial and native-language review remain open.

## Runtime boundary and remaining release work

Educational content is bundled and non-confidential. No API, database, storage, session, AI, tracking or calculation-engine calls were added. This component reads or writes no private projects and accepts no deal inputs. Its display flag is not an authorization boundary. Free, paid and downgraded members have the same educational catalog; Dev navigation and Library language persistence are wired; verified member-page authorization still needs acceptance before public release.

Remaining release work: final source/editorial review, including the historical discrepancies and native-language terminology; existing member route/access policy review and real-session acceptance; separately authorized app publication. Research live wiring and live map testing stay owner-deferred. Original v2-remastered HTML, Quick/Full staging, Relationship OS and unrelated work are preserved.

## Completion scopes and remaining release work

completion-inventory.json maps all forty final review keys to Library IDs, pins 49 freshly reread source files and records bounded primary-authority cross-checks. finance-completion-catalog.js, tax-completion-catalog.js and development-completion-catalog.js contain original four-language educational copy. The original completion checkpoint preserved canonical/statistics/economics copy and Vue interactions. The subsequent editorial/navigation pass changes only five statistics scope/explanation entries, a property-type legend and the scoped language-change event; see editorial-review.md.

Tax and mortgage-policy examples use expressly hypothetical rates or separately assumed eligibility, never embedded source defaults as current rules. Canada and US conventions remain distinct; US passive losses, Section 1031, cost segregation and Opportunity Zones are explicitly US concepts. Current-year eligibility, rates, filing deadlines and parcel entitlements are not determined. Withholding is not final tax; registration alone is not full GST/HST recovery. The 18 previously held implementation/live-output/current-rule claims remain held.

Next release tasks: native-language and subject-editor review of the copy; verified member-page authorization and free/paid/downgraded/signed-out member-session acceptance. Dev Library navigation and its scoped device preference are complete; broader app translation is outside this change. The review page is draft and the component default remains off. Live Maps, Research wiring, database and Auth work remain separately deferred; completing educational content does not activate those services.
