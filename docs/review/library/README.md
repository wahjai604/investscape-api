# Learning Library — canonical formulas and statistics

2026-10-10 UTC / 2026-10-10 America/Vancouver. The component now contains **51 educational cards**: all **39 numbered formula cards** in canonical Doc 06 and Addendum A, plus **12 statistics cards (S-001–S-012)** mapped to topic inventory ST01–ST12. S IDs are Library identifiers, not newly allocated canonical formula or engine numbers. See canonical-inventory.json for the source-pinned ID list. Supporting glossary acronyms are definitions, not extra numbered cards.

| Category | Cards |
| --- | ---: |
| Cost of Capital | 3 |
| Time Value of Money | 7 |
| Cash Flow Model | 3 |
| Performance | 10 |
| Leverage | 5 |
| Development & Construction | 11 |
| Market Statistics & Risk | 12 |
| Total | 51 |

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
Component: investscape-learning-library, base 3d621fc9-e746-4983-a74a-9663f4c52c0f, version 796e07eb-f18a-4600-a11b-07aba1431ae9, internal version 4, package 1.2.0, built 2026-10-10T07:59:24.162Z.
Instance: cd93727a-145b-46fb-8986-3bfdd93c109e; main section fcc328a2-62b5-4031-b727-de583d290f0e.

All seven installed source files were read back and match the tested source exactly. The review instance enables non-confidential bundled content. The component default stays false. The language selector changes this component in memory; no global application locale binding is claimed. The existing theme binding follows globalContext.browser.theme with auto fallback. Shared header/navigation are preserved.

## Verification

- Catalog tests: node --test src/library/catalog.test.ts. Five tests pass, including exact 39 canonical/12 statistics ID coverage, seven category totals, four-language completeness, independent example arithmetic/source discrepancy checks and numeric parity across translations.
- Actual compiled Vue harness: 1,719 assertions pass; all 51 cards open in All and across all seven category filters for each of four languages, **408 detail openings**. Exact translated heading, explanation, example and limits plus unchanged formula text are checked. Search, default-off/editor-disable behavior, keyboard handling, clearing, unmount, 320/390/768/1100-width reflow and light/dark checks pass. Zero external requests and browser errors in this local harness. Results and EN/FR screenshots are in evidence/.
- Current installed Dev preview: 51-card overview and 12-card statistics filter in each of four locales; all 12 new details checked in each locale (**48 detail openings**) against exact heading, formula, explanation, example and scope hashes. Cross-category S-010 → F-202 navigation, filter preservation and opener focus restoration pass. Receipt: evidence/statistics-installed-preview.json; screenshot: evidence/statistics-installed.jpg. Previous 39-card receipt remains historical in evidence/installed-preview.json. These checks are not production/member-session acceptance.

The harness command is node docs/review/library/check-component.mjs <playwright-index.mjs> <complete-chromium-binary> <vue-esbuild-tools-root>. Restricted containers may require fresh archive extraction and matching renderer libraries alongside Chromium.

## Statistics and topic scope

statistics-inventory.json pins descriptive, weighted, dispersion and growth source files from investscape-market-intelligence-engine at b279e22d71019009439803d928aeadf7e6b92ddc. Worked examples are original and synthetic. Source conventions are explicit: R-7 interpolation, percentile mid-rank, sample/population variance, absolute-mean CV and absolute-prior growth. CAGR accepts an ending value of zero according to executable source; its stricter source comment is not treated as authoritative behavior. CV limits explain meaningful-zero scales, near-zero means and mixed-sign observations.

All 18 previously deferred groups now have a concept scope that can be prepared and a separate implementation/live-output/current-rule claim held for evidence. topic-group-reclassification.json preserves the original groups and source reasons; it is not 18 or 36 automatic additional cards. Reuse existing and proposed topics before allocating a distinct concept card. This batch covers ST01–ST12 only.

## Runtime boundary and remaining release work

Educational content is bundled and non-confidential. No API, database, storage, session, AI, tracking or calculation-engine calls were added. This component reads or writes no private projects and accepts no deal inputs. Its display flag is not an authorization boundary. Free, paid and downgraded members have the same educational catalog; reviewed member-page access/navigation still needs wiring before public release.

Remaining release work: final source/editorial review, including the historical discrepancies and native-language terminology; existing member route/access policy review and navigation/locale wiring; separately authorized app publication. Research live wiring and live map testing stay owner-deferred. Original v2-remastered HTML, Quick/Full staging, Relationship OS and unrelated work are preserved.
