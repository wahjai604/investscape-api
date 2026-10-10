# Library-based main app and shared settings

WeWeb InvestScape Dev now uses the original Library page (`fa691651-6fc1-45df-9d69-968d5baeb6ca`) as the draft `app` shell. Internal panels switch through a session-only module variable rather than routes. Library remains the default; a device-local preference selects entry.

## Delivered

- Main ribbon: Workspace, Development, Portfolio, Market Intel, Research, Library, Community.
- Development sub-ribbon: Quick and Full; their existing section/element IDs and business workflows are reused.
- Mounted panel visibility preserves form and Library filter state.
- Shared validated display preferences on all eight existing pages: four exact locales, theme, country/currency defaults and preferred entry.
- 272 shared copy phrases. Native labels/placeholders and managed option labels are localized; submitted option values and calculation inputs are preserved.
- Page roots and legacy control colours use paired design tokens.
- Main-page entry/exit copies retain existing owner-scoped draft lifecycle. Full's pinned helper is loaded only when Full is selected or preferred.
- Existing pages remain preserved. Four unfinished modules show their pending connection status.

## Components and evidence

Project: `4a0173ad-346d-4d29-a9b9-0201e5af6d78`.

| Component | Base/version ID | Package |
| --- | --- | --- |
| Global settings | b2e4a5f0-a6d1-4df4-b0f5-778193887b23 / 98e53fe1-8f79-421a-b901-30762ce7958e | 1.0.2 |
| App ribbon | a248e975-57b3-4663-80a5-92b11c368070 / 8438bed3-fb4f-4f14-a0d6-61cbedeacfc3 | 1.0.0 |
| Existing Library | 3d621fc9-e746-4983-a74a-9663f4c52c0f / bef62685-1d7e-4268-b40e-ca35351f4e8e | 1.5.1, unchanged |

`runtime-wiring.json` records the eight new/changed display and lifecycle workflows. Runtime payloads use `event?.field/value`; workflow results use `context.workflow`. Native `update-variable.varValue` works in the inspected runtime. A temporary diagnostic action was removed.

`native-edits.json` contains the 246 native element edit plans (300 properties); `style-corrections.json` records seven subsequent title/control corrections. `runtime-metadata.after.json` records page/component metadata and the shared element bindings. These are evidence/review artifacts, not automatic provisioning scripts.

`workflow-preservation.json`: 58 exact unchanged business/Auth element workflows; one display locale workflow excluded intentionally. No unexpected workflow change. Four original Quick/Full page lifecycle workflows were preserved; new main-page copies are recorded separately.

`checks.json`: 2,064 checks, zero offline browser errors or unexpected requests. Run:

```sh
node docs/review/global-settings/check-settings.mjs <playwright-core-entry> <chromium-path> <vue/esbuild-tools-root>
```

The offline harness uses actual ribbon/settings/Library Vue components and synthetic mounted form panels. Actual Dev preview separately verified Quick input 12345, Full input 67890 and Library category retention, unchanged URL, global Chinese/French/English labels, explicit CAD override and preferred-entry/theme restoration. Temporary inputs were cleared. The screenshot `evidence/main-app-dev-zh-hant-dark.jpg` is from the actual WeWeb Dev preview; the other image is clearly named synthetic.

## Limits and next work

- Draft app only: no WeWeb public publication or login/home redirect change.
- Member access, live save/load and calculator API compatibility remain owner-deferred.
- No database/Auth configuration, migration, map activation or backend deployment.
- Preferences are device-local; account sync pending.
- Country/currency do not alter stored inputs or convert currency. FX handling pending.
- Movable widget layouts pending; schema reserves no editable layout state yet.
- Native-language editorial approval pending. Legacy Home/Login/Profile visual and member-session acceptance testing pending.
- Portfolio, Market Intel, Research and Community are destinations, not completed feature runtimes.

The original canonical v2-remastered HTML was untouched (SHA-256 `84cf6e13043fe392e8c4a9f82e37ba90ec68b86f948c8f91082bcc9810193c83`). Unrelated checkouts and Relationship OS were preserved.
