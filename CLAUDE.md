# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

The trigger has been through three designs; the current one is standard per-layer WMS
GetFeatureInfo (see "What this plugin does"). `@geoportallux/feature-info-templates` is
consumed through a `file:` dependency on the sibling `luxembourg-geoportail` checkout,
because that package is not published yet (Plan A phase 6). `.npmrc` sets
`install-links=true` so npm copies rather than symlinks it — a symlink whose realpath is
outside the project root trips Vite's dev server `fs.allow`.

Deliberately not implemented — the list is in the README under "Not in v1", but the two
worth knowing here are that **~2% of layers return HTTP 500 from WMS GetFeatureInfo on a
hit** and show nothing (an accepted trade-off), and that the **3dviewer deployment entry**
is untouched because `config/lux.config.json` installs plugins from npm and neither package
is published.

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

Reproduces the geoportail's GetFeatureInfo inside the VC Map 3D viewer, rendering with
`@geoportallux/feature-info-templates`.

**In one line: standard per-layer WMS GetFeatureInfo does the querying; the plugin only
supplies the per-layer envelope the templates need.** There is no custom interaction and no
custom request building. Two earlier designs are recorded in `PLAN.md` — a custom
persistent interaction, then one aggregating provider hitting the geoportail's custom
`/getfeatureinfo`. Read that before changing the trigger; both were replaced for reasons
that are easy to rediscover the hard way.

The key enabler: **the geoportail's WMS answers `INFO_FORMAT=application/json` with the
lux-enriched payload, not a stock GeoJSON one.** Features carry `fid` in composite
`<layerId>_<featureId>` form (with the backend's layer remap applied — 262 answers
`359_…`), `id`, `alias`, and a `properties` bag identical to the aggregated endpoint's
`attributes`, nested `PF` and `measurements[]` included. Geometry is EPSG:2169.

The pieces, one module each:

- **`luxWmsFeatureProvider.ts`** — `extends WMSFeatureProvider`, built from the layer's own
  public options (the same nine `WMSLayer._setFeatureProvider()` reads) with
  `responseType: 'application/json'`, the EPSG:2169 projection and `FEATURE_COUNT`. Four
  behaviours here are contract, not polish:
  1. **gates on the `featureInfo` toolbox toggle** — `FeatureProviderInteraction` is in VC
     Map's immutable base chain and nothing ever deactivates it, so providers are asked on
     every click, tool or no tool;
  2. **floors the resolution** at `minResolution` — the server's tolerance is ~3 px and ol
     derives the queried pixel from the resolution, so the resolution _is_ the tolerance;
     a tilted Cesium camera reports sub-metre values and point layers then need centimetre
     accuracy (measured);
  3. **stashes the raw response feature** — ol's GeoJSON reader keeps only
     `id`/`geometry`/`properties`, dropping `fid` and `alias` and reprojecting the geometry;
     rebuilding the fid as `${luxId}_${id}` is wrong for remapped layers;
  4. **gives features an empty `Style`** — `selectFeature()` clones a provided feature onto
     its scratch layer forcing `olcs_allowPicking: true`, and a visible clone is then picked
     on the next click, making `FeatureProviderInteraction` skip every provider. Measured: a
     second click inside a selected commune issued no request at all.
- **`luxFeatureInfoJson.ts`** — rebuilds the per-layer envelope a WMS response cannot carry:
  `template` from the mapping, `layer` from `luxId`, `layerLabel` from the layer name (the
  templates translate it via the `layers` i18n namespace), `ordered` from config,
  `has_profile: false`, plus the parcel annotation.
- **`luxTemplates.ts`** — GENERATED by `npm run harvest-templates`. 622 layer ids to
  template filenames. The mapping exists only in the backend table
  `lux_getfeature_definition`, keyed by numeric layer id; unmapped layers render
  `default.html`, which is also how the backend signals "render generically".
- **`luxQueryService.ts`** — just two predicates now: `isLuxQueryLayer()` (which layers to
  take over) and `isParcelLayerIdent()`.
- **`luxTemplateFeatureInfoView.ts`** — registered in `app.featureInfoClassRegistry` during
  `initialize()`; reads the envelope off the feature. The window/selection/toolbox lifecycle
  is the framework's.
- **`LuxFeatureInfoWindow.vue`** — a plain wrapper that `provide()`s `LUX_TPL_CONTEXT` and
  `LUX_TPL_I18N` in `setup()` (reaching the plugin via `inject('vcsApp')` +
  `plugins.getByKey`, because a config-defined view cannot hand them down), sets
  `.lux-tpl-root`, imports the package CSS, renders the shared dispatcher. **No child Vue
  app / `createApp` mount** — that remains the documented escalation path if Vuetify styles
  bleed in.
- **`luxTplRuntime.ts`** — a dedicated i18next instance (not the singleton) with
  `i18next-http-backend`, the `LuxTplContext`, and a `localeChanged` listener.

### Multiple features means a cluster list

Two or more features across all providers — **including two from one layer** — make
`FeatureProviderInteraction` wrap them in a synthetic cluster feature, and VC Map opens its
cluster list: a searchable window grouped by layer, one row per feature, and selecting a row
renders that feature's template on the right. A single feature opens its panel directly.
This is deliberate; the 2D portal's single stacked panel would require custom aggregation.

Rows are titled `attributes[clusterFeatureTitleProperty] || attributes.title ||
attributes.name || feature.getId()`, so the plugin sets
`properties.clusterFeatureTitleProperty = 'label'` when claiming a layer — lux features
carry a composed `label`, and without it most rows show a raw fid. Layers with no such
attribute (PAG, for instance) still show ids.

### Claiming the lux layers

`index.ts` replaces `layer.featureProvider` on every layer `isLuxQueryLayer()` accepts.
This is the whole mechanism, and it has one trap: `WMSLayer.initialize()` builds the
configured provider on first activation and **overwrites** whatever is there, with no event
to hook. So claiming runs on every `app.layers.stateChanged` and re-claims whenever the
provider is not ours — the `instanceof` check is the only idempotence guard, deliberately.
An early-return on "already claimed" silently breaks everything, which is exactly what
happened during implementation.

Still unhandled: `WMSLayer.reload()` / `setLayers()` destroy the provider and rebuild from
the layer config without firing `stateChanged`, so a themesync reload reverts ours.

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

Driven over CDP against `https://3d-staging.geoportail.lu` (themesync 1.5.2, no config
change). Each of these broke at some point during implementation:

- one queryable layer returning one feature → its lux template renders directly;
- a layer returning several features, or several layers → VC Map's cluster list, rows
  titled from `label`, and selecting a row renders that feature's template. Confirmed with
  cadastre: `parcels.html` with the nested `PF` fields ("Contenance : 0ha 01a 56ca") and the
  measurements links;
- a click where no layer has data closes the panel;
- with the feature info tool off, a click issues **zero** requests;
- a point layer stays clickable with the camera 150 m up: the map reported 0.638 m/px and
  the request went out at 2.39 m/px (BBOX 611 m over 256 px), finding the address. Without
  the clamp the tolerance is centimetres;
- a second click inside an already-selected geometry still queries — this needs the empty
  style on provided features;
- attribute values render, not just labels (the `v-dompurify-html` directive).

Coverage, measured against the live service: of 732 queryable lux layers, 250 had data at
one test point per the aggregated endpoint; via WMS JSON at 2 m/px 215 returned features, 30
returned empty and 5 returned HTTP 500. All 17 distinct "empty" ones recovered at a coarser
resolution, so the genuine gap is 5 (2%) — hence the clamp being the most important knob
here.

Still open:

- **A 3D tileset click vetoes the WMS path entirely.** `FeatureProviderInteraction` only
  runs when nothing was picked, so wherever a tileset is active and hit — LOD2 buildings are
  on by default in the deployed viewer — no 2D lux layer is queried. Same as the previous
  designs, but structural here.
- Vuetify style bleed _into_ the templates — never observed; `default.html`, `parcels.html`
  and `adresse.html` have been exercised in 3D.
- Whether protected layers get their cookies. Public layers go to `luxOwsUrl` without
  credentials; themesync registers only the proxy URL in Cesium's `TrustedServers`, and only
  requests to a trusted server get `credentials: 'include'`.
