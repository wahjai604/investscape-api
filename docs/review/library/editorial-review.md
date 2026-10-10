# Library editorial and Dev navigation review

Evidence date: 2026-10-10 UTC. Package 1.5.1, installed component version 9. The catalog remains 103 cards across ten categories, in English, Canadian French, Traditional Chinese and Simplified Chinese.

## Completed review

All 103 English entries were read for meaning, formula, worked example and limitations. Four-language numerical parity, complete fields, related IDs and visible dialog copy are checked by the catalog tests and compiled Vue harness. Focused multilingual wording review covered S-006–S-010 and jurisdiction-sensitive tax/planning limitations. This is an initial editorial pass, not independent subject-editor or native-language certification.

| Entry | Change in all four locales |
| --- | --- |
| S-006 | Explain multiplying the mid-rank fraction by 100 without an internal source reference. |
| S-007 | State the two-observation sample and one-observation population minimums directly. |
| S-008 | Explain the displayed absolute-mean convention and near-zero/ratio-scale limits without implementation cutoffs. |
| S-009 | Describe signed change relative to magnitude; an increase is not necessarily an improvement. |
| S-010 | Explain the stated CAGR convention without an internal source reference. |

The introduction now expands RES/COM/DEV as Residential/Commercial/Development in each locale. These are property types. No formula, example arithmetic, card ID, category allocation or related link changed during this pass. F-701's conditional historical example was cross-checked read-only against the BC government's calculation-examples page on 2026-10-10; this is not an individual tax determination. URL and bounded role remain in source-provenance.json.

## Retained source qualifications

| ID | Unresolved historical evidence | Exact owner/editor decision needed before release |
| --- | --- | --- |
| F-702 | Rounded factor leaves a 1.84 difference; unrounded factor unavailable. | Retain the disclosed historical budget comparison, provide its unrounded factor, or approve a wholly synthetic replacement. |
| F-705 | Revenue adjustment sign does not reconcile to the reported total. | Confirm the documented sign/workbook, or approve retaining both labelled cases or replacing them synthetically. |
| F-706 | Historical 796 sum differs by 1; current example uses the reconciling Gilley sum. | Approve the disclosed historical qualification and Gilley example, or provide the reconciled source. |
| F-708 | Expense assumption is reverse-derived from reported value. | Supply the source assumption/workbook, or approve the explicitly reverse-derived illustration or a synthetic replacement. |

No source discrepancy was hidden or silently declared resolved. The eighteen implementation/live-output/current-rule claims remain held. The copy supplies no current borrower eligibility, statutory filing result or parcel entitlement.

## Dev host wiring

The existing shared draft header has one Library link. A scoped Library Language preference updates the component locale and that link's label. It persists on this device across navigation and refresh, verified visibly in all four locales. It does not translate the rest of the app or become an account-level language setting. Native WeWeb page languages remain English.

The component emits localeChange with event.value. The host workflow validates one of the four supported strings and updates only the preference variable; externally supplied locale changes do not emit an event loop. An initial context.event binding did not update the preference and was corrected to the existing WeWeb event.value convention before the final successful checks. No Auth, API or database action belongs to this workflow.

The existing review URL, draft status, sitemap exclusion, theme binding and default-off component flag remain. Detailed IDs and rollback guidance are in navigation-wiring.json. This link is a Dev navigation entry, not a verified member authorization boundary.

## Verification and release gates

- Eight catalog tests and 3,827 compiled Vue assertions pass. All 103 cards open in All and their category in all four locales: 824 detail openings. Existing mobile, light/dark, keyboard/focus, editor and default-off checks pass.
- All twelve installed version-9 files exactly match tested source. Visible Dev tests verify each locale's header label, Library → Workspace → Library return and refresh persistence. S-009's revised detail was opened in all four locales. Evidence: evidence/navigation-installed-preview.json and navigation-installed.jpg.
- No real member session, anonymous denial, production acceptance or public app publication is claimed.

Before public release, the owner needs final subject-editor approval of the copy and retained historical cases; independent native-language terminology review, including Canadian depreciation/recapture and US 1031 terminology; and a verified member route/access policy tested with free, paid, downgraded and signed-out sessions. Use an existing approved Dev member account when the owner can resume session testing. Anonymous behavior must match the explicitly chosen member-only policy. Do not infer authentication from the display flag, editor access or draft status. Public publication remains a separate action.

Maps and Research runtime/session work stay owner-deferred. No change to the original v2-remastered file, Quick/Full calculation or persistence workflow, Relationship OS, DB or Auth configuration was made.
