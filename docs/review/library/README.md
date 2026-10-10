# Learning Library — canonical formulas and statistics

2026-10-10 UTC / 2026-10-10 America/Vancouver. The component now contains **57 educational cards**: all **39 numbered formula cards** in canonical Doc 06 and Addendum A, plus **18 statistics cards (S-001–S-018)**; the revised six-card crosswalk below preserves the original inventory history. S IDs are Library identifiers, not newly allocated canonical formula or engine numbers. See canonical-inventory.json for the source-pinned ID list. Supporting glossary acronyms are definitions, not extra numbered cards.

| Category | Cards |
| --- | ---: |
| Cost of Capital | 3 |
| Time Value of Money | 7 |
| Cash Flow Model | 3 |
| Performance | 10 |
| Leverage | 5 |
| Development & Construction | 11 |
| Market Statistics & Risk | 18 |
| Total | 57 |

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
Component: investscape-learning-library, base 3d621fc9-e746-4983-a74a-9663f4c52c0f, version 9abb8f18-5789-48b6-a86c-7bed4152be74, internal version 5, package 1.3.0, built 2026-10-10T10:10:14.297Z.
Instance: cd93727a-145b-46fb-8986-3bfdd93c109e; main section fcc328a2-62b5-4031-b727-de583d290f0e.

All eight installed source files were read back and match the tested source exactly. The review instance enables non-confidential bundled content. The component default stays false. The language selector changes this component in memory; no global application locale binding is claimed. The existing theme binding follows globalContext.browser.theme with auto fallback. Shared header/navigation are preserved.

## Verification

- Catalog tests: node --test src/library/catalog.test.ts. Six tests pass, including exact 39 canonical/18 statistics ID coverage, seven category totals, four-language completeness, independent example arithmetic/source discrepancy checks and numeric parity across translations.
- Actual compiled Vue harness: 1,975 assertions pass; all 57 cards open in All and across all seven category filters for each of four languages, **456 detail openings**. Exact translated heading, explanation, example and limits plus unchanged formula text are checked. Search, default-off/editor-disable behavior, keyboard handling, clearing, unmount, 320/390/768/1100-width reflow and light/dark checks pass. Zero external requests and browser errors in this local harness. Results and EN/FR screenshots are in evidence/.
- Current installed Dev preview: 57-card overview and 18-card statistics filter in each of four locales; all six new details checked in each locale (**24 detail openings**) against exact heading, formula, explanation, example and scope hashes. S-016 → S-003 navigation, filter preservation and opener focus restoration pass. Receipt: evidence/statistics-methods-installed-preview.json; screenshot: evidence/statistics-methods-installed.jpg. The earlier 51-card/48-new-detail checks remain historical in evidence/statistics-installed-preview.json, and the original 39-card receipt remains in evidence/installed-preview.json. These checks are not production/member-session acceptance.

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

The original 64-candidate inventory remains historical; this revised plan still has 64 additional slots: 18 built and 46 remaining, for a potential total of 103 after review and further deduplication.

## Runtime boundary and remaining release work

Educational content is bundled and non-confidential. No API, database, storage, session, AI, tracking or calculation-engine calls were added. This component reads or writes no private projects and accepts no deal inputs. Its display flag is not an authorization boundary. Free, paid and downgraded members have the same educational catalog; reviewed member-page access/navigation still needs wiring before public release.

Remaining release work: final source/editorial review, including the historical discrepancies and native-language terminology; existing member route/access policy review and navigation/locale wiring; separately authorized app publication. Research live wiring and live map testing stay owner-deferred. Original v2-remastered HTML, Quick/Full staging, Relationship OS and unrelated work are preserved.
