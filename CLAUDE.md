# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Phases 1-6 of the plan are implemented, phase 5 on its second design — a feature provider
replaced the original custom interaction; see "What this plugin does".
`@geoportallux/feature-info-templates` is consumed through a `file:` dependency on the
sibling `luxembourg-geoportail` checkout, because that package is not published yet (Plan A
phase 6). `.npmrc` sets `install-links=true` so npm copies rather than symlinks it — a
symlink whose realpath is outside the project root trips Vite's dev server `fs.allow`.

Not implemented, and deliberately so:

- **Phase 7 enhancements** — highlighting the returned geometries, routing 3D building
  clicks through the lux templates, `fid` deep links, 3D elevation profile. Two of those
  changed character with the provider design: highlighting is now nearly free (put the real
  geometries on the envelope feature, but keep it to _one_ feature or the result becomes a
  cluster list), and 3D building clicks are now structurally out of reach, because
  `FeatureProviderInteraction` never runs once a feature was picked.
- **KML/GPX export.** Was implemented, then deleted as dead code: the templates only emit
  `export` from `profileComponent`, which is unset. It returns with the 3D profile.
- **The 3dviewer deployment entry** (plan phase 6.3). `config/lux.config.json` in the
  `3dviewer` repo is untouched: its `plugins` array installs from npm, and pointing it at an
  unpublished plugin would leave the WMS layers referencing a feature info view that does
  not exist. The exact config block to add is in this repo's README. Note the plugin no
  longer depends on themesync's `useLuxFeatureInfoTemplates` flag — it claims the lux layers
  itself — so the flag is now a tidiness win, not a prerequisite.

`PLAN.md` in this repo is the working record of the feature-provider refactor: the designs
that were weighed, why the standard per-layer WMS route was rejected, and where the
implementation deviated from what was planned. Read it before changing the trigger.

Canonical plans live in the sibling checkout:
`/home/tkohr/Projets/luxembourg/git/luxembourg-geoportail/docs/plan-3dviewer-featureinfo-plugin.md`
("Plan B") and its companion `docs/plan-feature-info-templates.md` ("Plan A"). `PLAN.md`
overlaps with Plan B — change Plan B first, then re-align.

## Commands

```bash
npm run preview -- --vcm https://3d-staging.geoportail.lu/   # see "Running it"
npm start          # Dev server on :8008 (vcmplugin serve). --appConfig <file|url> to
                   # load a VC Map app config; -c <config> to override the plugin config
npm run build      # Build plugin to dist/ (vcmplugin build)
npm run bundle     # Pack a tar for production (vcmplugin pack)
npm run preview    # Preview against a deployed VC Map (--vcm <url>)
npm test           # Vitest (watch)
npm run coverage   # vitest run --coverage
npm run lint       # ESLint + Prettier check
npm run format     # Auto-fix lint + formatting
npm run type-check # vue-tsc --noEmit
npm run ensure-types
```

Run a single test file:

```bash
npx vitest run tests/vcsPluginInterface.spec.ts
```

`vcmplugin serve` refuses to start unless `@vcmap/ui` is present in `node_modules` — it is
declared as a _peer_ dependency, so it must be installed locally (it is).

## Running it

`vcmplugin preview --vcm <url>` — it serves the local `dist/index.js` and proxies
`/assets`, `/plugins`, `/style.css` plus `app.config.json` to a deployed viewer, so
themesync and the other plugins come from the deployment. Do **not** build a local app
config with mock lux layers; that was tried and removed as unnecessary.

Three facts, each of which cost a debugging session:

- **A CORS bypass extension is required**, and not because of this plugin: the geoportail
  answers `localhost` with `Access-Control-Allow-Origin: *` _and_
  `Access-Control-Allow-Credentials: true`, which browsers reject, and every lux plugin
  sends `credentials: include`. Themesync's `/themes` call fails identically, so without a
  bypass the viewer has no layers and nothing is queryable.
- **`--watch` does not reach the browser.** It rebuilds `dist/`, but the dev server keeps
  serving the previously transformed module; a hard reload with the cache disabled still
  gets the old bundle. Restart `npm run preview` after every edit. Verified by byte-diffing
  the on-disk bundle against the served one.
- **No 2D lux layer is active on startup**, so `collectQueryableLayers()` returns `[]` and
  the click is a no-op until a layer is switched on in the content tree.

Two traps in the plugin itself, both invisible to lint/type-check/tests:

- **Never `import '../config.json'`.** The dev server reserves `/config*` for module configs,
  so the import 404s and the whole plugin fails to load in dev (it works in the build,
  which inlines it). Defaults belong in `src/defaultOptions.ts`; a deployed VC Map reads a
  plugin's config from the app config only, never from its shipped `config.json`.
- **The templates need a `v-dompurify-html` directive** that the package neither ships nor
  declares — the geoportail registers it app-wide in `main.ts`. `LuxFeatureInfoWindow.vue`
  registers it on the shared Vue app. Without it, six templates (`default` included) render
  attribute labels but empty values.

## What this plugin does

Reproduces the 2D geoportail's per-position GetFeatureInfo inside the VC Map 3D viewer:
one click → **one aggregated query over all visible queryable lux layers** → a window
rendering the response with `@geoportallux/feature-info-templates`.

**In one line: a feature provider is the trigger, a registered feature-info view class is
the renderer.** Both are VC Map extension points; there is no custom interaction. An
earlier version of this plugin (and of Plan B) used a custom persistent interaction on the
premise that the built-in flow "cannot express empty-space clicks" — that premise was
wrong. `FeatureProviderInteraction` runs precisely `if (!event.feature)` and asks every
active layer's provider for features at the position. Do not reintroduce an interaction
without re-reading that class first.

The pieces, one module each:

- **`luxQueryService.ts`** — collects eligible layers, builds the request, post-processes
  the response. `event.position` is EPSG:3857 in both OL and Cesium maps and is transformed
  to EPSG:2169; `box1`/`box2` are ±10 m/±1 m boxes in 2169 while `srs` announces 3857 (the
  server's contract, verified against the live backend), and
  `WIDTH`/`HEIGHT`/`X`/`Y`/`BBOX` describe a synthetic north-up viewport centred on the
  point, with `zoom` from `map.getCurrentResolution()`. Eligible layers are active,
  non-transparent, carry `properties.luxId` and are flagged by `properties.luxQueryable` —
  falling back to `allowPicking` on 2D layers for a themesync older than 1.6. Exports
  `isLuxQueryLayer()`, also used for layer claiming.
- **`luxAggregatedFeatureProvider.ts`** — `extends AbstractFeatureProvider`. Returns
  **exactly one** envelope feature: a point at the click carrying the whole
  `FeatureInfoJSON[]` under `luxContentSymbol`, tagged `featureInfoViewSymbol` so
  `getFeatureInfoViewForFeature()` picks the lux view before any per-layer resolution.
  One feature is what preserves the 2D stacked panel — two or more and VC Map opens its
  cluster list instead. Two non-negotiables: it **gates on the `featureInfo` toolbox
  toggle** (nothing in core or ui ever deactivates `FeatureProviderInteraction`, so
  providers are asked on every click, tool or no tool), and it gives its feature an **empty
  `Style`** (`selectFeature()` clones a provided feature onto the internal scratch layer
  with `olcs_allowPicking: true`; without an empty style that clone would swallow the next
  click at the same spot).
- **`luxTemplateFeatureInfoView.ts`** — registered in `app.featureInfoClassRegistry` during
  `initialize()`; `getWindowComponentOptions()` reads the payload off the feature. The whole
  built-in window/selection/toolbox lifecycle comes for free.
- **`LuxFeatureInfoWindow.vue`** — a plain wrapper that `provide()`s `LUX_TPL_CONTEXT` and
  `LUX_TPL_I18N` in `setup()` (reaching the plugin via `inject('vcsApp')` +
  `plugins.getByKey`, because a config-defined view cannot hand them down), sets
  `.lux-tpl-root`, imports the package CSS, renders the shared dispatcher. **No child Vue
  app / `createApp` mount** — that remains the documented escalation path (and the
  prerequisite for a shadow-DOM mount) if Vuetify styles bleed in.
- **`luxTplRuntime.ts`** — a dedicated i18next instance (not the singleton) with
  `i18next-http-backend`, the `LuxTplContext`, and a `localeChanged` listener.

### Claiming the lux layers

`index.ts` clears `layer.featureProvider` on every layer `isLuxQueryLayer()` accepts, on
`layers.added` and again on each `stateChanged` (a `WMSLayer` only builds its provider in
`initialize()`, i.e. on first activation).

Why: with themesync's `useLuxFeatureInfoTemplates` off, its WMS layers carry a `text/html`
`WMSFeatureProvider`, which fabricates a placeholder feature on every click **without
issuing any request** — that is how `IframeWmsFeatureInfoView` gets its position. Left
alone, each placeholder joins this plugin's envelope feature, VC Map builds a cluster
feature and opens its list window instead of the stacked panel, and empty-space clicks stop
clearing the selection. Clearing them also means this design works whether that flag is on
or off, which is what keeps `preview --vcm` against staging usable.

### The templates package contract

`@geoportallux/feature-info-templates` (lives in the `luxembourg-geoportail` repo at
`packages/feature-info-templates`; consumed here through a `file:` dependency until it is
published) exposes exactly one host dependency surface:

- `provideLuxTplContext(ctx)` / `LUX_TPL_CONTEXT` with `{ config, user, notify,
profileComponent?, isThemeAvailable? }`
- `createLuxTplI18n(i18next)` / `LUX_TPL_I18N` / `useLuxTranslation` — lib-owned, so the
  package does **not** depend on `i18next-vue` (whose `install()` would overwrite VC Map's
  vue-i18n `$t` global)
- `createLuxTplI18next(instance, loadPath)` — the exact geoportail i18next init contract
  plus tooltip-fallback hydration; the caller supplies the instance so it owns the backend
  plugin. Locales come from the deployed geoportail's `assets/locales/{ns}.{lng}.json`
- `getTemplateComponent()` + every template component, and the `FeatureInfoJSON` models

Wire `user` from the auth plugin's reactive `userState` (optional dependency, anonymous
fallback) and `notify` to `app.notifier.add`.

## Cross-repo context

Sibling repos under `/home/tkohr/Projets/luxembourg/git/`:

| Path                       | Role                                                                                                                                                                              |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vcs/3dviewer`             | The VC Map app. `config/lux.config.json` holds the deployed `plugins` array.                                                                                                      |
| `vcs/3dviewer-themesync`   | Builds VC Map layers from geoportail themes. Owns `properties.luxId`; must also start writing `properties.luxQueryable` (Plan B phase 6). Has its own CLAUDE.md.                  |
| `vcs/3dviewer-plugin-auth` | The structural template for this plugin, and the source of `userState`.                                                                                                           |
| `luxembourg-geoportail`    | The 2D app. Reference implementation in `src/composables/info/feature-info.composable.ts` and `src/components/info/feature-info.vue`; the templates package; both plan documents. |

Coupling between plugins is deliberately loose: `app.plugins.getByKey('<package name>')`
plus a string contract, exactly as the auth plugin reaches themesync's `reloadThemes()`.

**Ordering constraint:** plugins are parsed before a module's `featureInfo` items and
initialize serially in config order, so this plugin must be listed **before** themesync in
`config/lux.config.json`. Document that in the README when deployment lands.

## Conventions

- **Plugin shape** — default-export a factory `(config, baseUrl) => VcsPlugin`; `name`,
  `version`, `mapVersion` are getters re-exporting `package.json` fields. Extra public API
  (like auth's `userState`/`doLogin`) is added to the returned object and typed with an
  exported `VcsPlugin<Config, State> & {...}` interface.
- **i18n namespace** — `tests/vcsPluginInterface.spec.ts` enforces that every locale in a
  plugin's `i18n` object is keyed by the camel-cased unscoped package name, i.e.
  `lux3dviewerPluginFeatureInfo`. All UI strings are i18n keys, never literals.
- **TypeScript strict**, ES2022, `noUnusedLocals`/`noUnusedParameters` on. `tsconfig.json`
  includes only `src/`; `tests/tsconfig.json` is separate.
- **Imports** — `.js` extensions on relative TS imports (`./authService.js`), matching the
  sibling plugins.
- **Config** — `config.json` is the plugin's default config, merged with what
  `lux.config.json` passes. Runtime URLs (`luxGetInfoUrl`, `luxLocalesUrl`,
  `templatesConfig`, `credentials`) belong there, never hard-coded.
- ESLint is `@vcsuite/eslint-config` (`configs.vueTs`); Prettier config comes from the same
  package via the `prettier` field in `package.json`.
- Tests run in jsdom; `tests/setup.js` mocks ResizeObserver + canvas and sets
  `window.CESIUM_BASE_URL`.

## Verified, and still open

Checked against the live backend and a real browser session driven over CDP against
`https://3d-staging.geoportail.lu` (themesync 1.5.2, `useLuxFeatureInfoTemplates` absent):

- **CORS is fine from the deployed origin.** `/getfeatureinfo` and `/assets/locales/*.json`
  answer `https://3d.geoportail.lu` with a properly echoed origin and
  `Access-Control-Allow-Credentials: true`. Themesync's `TrustedServers`/proxy pattern is
  not needed. From `localhost` they answer `*` + credentials instead, which browsers
  reject — see "Running it".
- **The request contract holds.** The captured response is in `tests/fixtures/`.
- **End to end works against an unmodified deployment** — themesync 1.5.2, no config
  change, via the `allowPicking` fallback. Driven over CDP, all five behaviours checked:
  one active queryable layer and four both render the stacked panel from **one** request
  (`302` / `147,698,262,302`) with no cluster window and no `featureInfo2d` iframe; a click
  where no layer has data closes the panel; with the tool toggled off a click issues **zero**
  requests; attribute values render, not just labels.

Still unvalidated:

- `zoom` semantics when derived from a tilted Cesium camera (the backend accepts the value;
  nothing confirms it is interpreted as the 2D portal intends).
- Vuetify style bleed _into_ the templates — never observed, but only `default.html` and
  `parcels.html` have been exercised in 3D.
- Every other template.
