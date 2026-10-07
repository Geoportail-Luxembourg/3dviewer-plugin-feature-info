# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

The trigger has been through four designs; the current one is a single aggregated
`/getfeatureinfo` request per click (see "What this plugin does"). `@geoportallux/feature-info-templates` is
consumed through a `file:` dependency on the sibling `luxembourg-geoportail` checkout,
because that package is not published yet (Plan A phase 6). `.npmrc` sets
`install-links=true` so npm copies rather than symlinks it — a symlink whose realpath is
outside the project root trips Vite's dev server `fs.allow`.

Deliberately not implemented — the list is in the README under "Not in v1". The one worth
knowing here is that the **3dviewer deployment entry** is untouched, because
`config/lux.config.json` installs plugins from npm and neither package is published.

`PLAN.md` in this repo is the working record of the trigger's designs: what was weighed,
why each route was taken and then left, and where the implementation deviated from what was
planned. Read it before changing the trigger.

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
- **No 2D lux layer is active on startup**, so no layer has a provider to ask and the
  click is a no-op until one is switched on in the content tree.

Two traps in the plugin itself, both invisible to lint/type-check/tests:

- **Never `import '../config.json'`.** The dev server reserves `/config*` for module configs,
  so the import 404s and the whole plugin fails to load in dev (it works in the build,
  which inlines it). Defaults belong in `src/defaultOptions.ts`; a deployed VC Map reads a
  plugin's config from the app config only, never from its shipped `config.json`.
- **HTML sanitizing is the package's job now.** The templates used to need a
  `v-dompurify-html` directive the package neither shipped nor declared, so this plugin had
  to register one on the shared Vue app. As of the package's work-item-10 change it owns
  `v-lux-html` internally and needs nothing from the host — do not re-add a global.

## What this plugin does

Reproduces the geoportail's GetFeatureInfo inside the VC Map 3D viewer, rendering with
`@geoportallux/feature-info-templates`.

**In one line: one aggregated request per click to the geoportail's own
`/getfeatureinfo`, fanned out to one VC Map feature per response feature.** Three earlier
designs are recorded in `PLAN.md` — a custom persistent interaction, an aggregating feature
provider, then standard per-layer WMS. Read it before changing the trigger; each was
replaced for reasons that are easy to rediscover the hard way.

**Why aggregated and not per-layer WMS.** `/getfeatureinfo` is a _dispatcher_. Per layer it
reads `lux_getfeature_definition` and picks one of three branches
(`geoportailv3/.../views/getfeatureinfo.py`): `rest_url` set → an ArcGIS REST query;
`query` set → SQL; neither → `_ogc_getfeatureinfo()`, which relays a standard WMS
GetFeatureInfo **server-side**, with the very parameters the previous design sent. So a
per-layer WMS call is exact for the third branch and blind to the other two — which is what
the ~2% gap and `docs/wms-getfeatureinfo-gaps.md` were really measuring. Where it does
work it is faithful: 58 of 60 layers had identical attribute keys on both paths.

Two more things only the aggregated endpoint can express:

- **a layer can have several definition rows**, each with its own template.
  `get_lux_feature_definition()` collects with `.all()` and `get_info()` appends one entry
  per row, so `layers=813` comes back as five entries with two distinct templates. A 1:1
  `layerId → template` map is wrong by construction, and the split is defined by each
  definition's own SQL, so no client-side map can reproduce it;
- **role-dependent definitions**, which replace the anonymous rows wholesale.

The response is already the envelope the templates want: `template`, `remote_template`,
`ordered`, `has_profile`, the counts, and per feature `geometry` (EPSG:2169), `fid`
(composite `<layerId>_<featureId>`, backend remap applied — 262 answers `359_…`), `id`,
`alias` and `attributes`.

The pieces, one module each:

- **`luxAggregatedInteraction.ts`** — the whole trigger. An `AbstractInteraction` on
  `EventType.CLICK`, registered at **index 3** of the event handler's chain, i.e.
  immediately before `FeatureProviderInteraction`, which skips its own per-layer fan-out
  once `event.feature` is set. Four behaviours are contract, not polish:
  1. **gates on the `featureInfo` toolbox toggle** — the persistent chain is piped on every
     click, and each pass would otherwise be a real request;
  2. **returns early when something was already picked** — a 3D tileset or vector feature
     belongs to whoever owns it (this is also why a tileset click still vetoes the 2D
     query, see "Still open");
  3. **one feature per response feature, carrying its own entry** — `splitResponse()` plus
     `toSingleFeatureContent()`. This is what makes multi-definition layers need no branch
     at all, and it is why each cluster row renders with its own template;
  4. **gives features an empty `Style`** — `selectFeature()` clones a provided feature onto
     its scratch layer forcing `olcs_allowPicking: true`. The clone is still highlighted,
     but with the empty style it is not picked, so a second click inside the same geometry
     still queries (measured both ways).

  It also sets an `id` on every feature: not all layers have a `fid` (813 answers
  `fid: null`), and a feature without an id leaves its cluster row titled `undefined`,
  because the title falls back through `attributes[clusterFeatureTitleProperty]`, `title`,
  `name` to exactly that id. `AbstractFeatureProvider.getProviderFeature()` covers this with
  a uuid; this interaction does not go through it.

- **`luxQueryService.ts`** — request building and the response post-processing, restored
  from the aggregated design. `buildPositionParams()` encodes the server's contract: boxes
  in EPSG:2169 metres while `srs` announces 3857, plus a synthetic north-up viewport with
  the click at centre. **`box1` is intersected against ring-less geometries (points and
  lines), `box2` against polygons** — so `bigBuffer` has to be generous and `smallBuffer`
  small, or clicking a parcel returns its neighbours too. The 2D portal scales both with map
  resolution (`20 *` and `1 *`); a tilted 3D camera cannot supply that meaningfully, so
  these are fixed metres.
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

`index.ts` _clears_ `layer.featureProvider` on every layer `isLuxQueryLayer()` accepts, and
sets `properties.clusterFeatureTitleProperty = 'label'`.

Clearing is not housekeeping. themesync configures `featureInfo:
{ responseType: 'text/html' }` on those layers, which builds a provider that fabricates a
placeholder feature per click **without any request** — that is how the `featureInfo2d`
iframe gets its position. `FeatureProviderInteraction` runs right after this plugin's
interaction, so leaving that provider in place means every click the aggregated query
answers nothing for — a click on a street, say — opens the 2D iframe instead of closing the
panel. Measured during implementation, and not obvious from the code.

It has one trap: `WMSLayer.initialize()` builds the configured provider on first activation
and **overwrites** whatever is there, with no event to hook. So clearing runs on every
`app.layers.stateChanged`, which fires around activation.

`WMSLayer.reload()` / `setLayers()` also rebuild the provider from the layer config, and
`reload()` does **not** fire `stateChanged` (it only rebuilds implementations via
`forceRedraw()`), so that path would silently restore it. It has no reachable trigger here:
`reload()` comes from `set url`, `set headers`, `set ignoreMapLayerTypes` or `setLayers()`,
none of which anything in the org calls; `set locale` reloads only when the url is a
locale-record object and themesync passes a plain string, so switching language does not
touch these layers; and themesync's `reloadThemes()` does `removeModule` + reload, which
rebuilds the layers as new objects and so goes through `stateChanged` anyway. Worth
re-checking if a layer ever gets its url or headers reassigned at runtime.

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

Sanitizing is **not** part of that surface: the package owns `v-lux-html` internally, so
the host registers no directives.

Wire `user` from the auth plugin's reactive `userState` (optional dependency, anonymous
fallback) and `notify` to `app.notifier.add`.

## Cross-repo context

Sibling repos under `/home/tkohr/Projets/luxembourg/git/`:

| Path                       | Role                                                                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `vcs/3dviewer`             | The VC Map app. `config/lux.config.json` holds the deployed `plugins` array.                                                                                                                                                                     |
| `vcs/3dviewer-themesync`   | Builds VC Map layers from geoportail themes. Owns `properties.luxId`, `properties.is3DLayer` and `allowPicking` — everything this plugin reads. **Deliberately knows nothing about this plugin**; needs no change for it. Has its own CLAUDE.md. |
| `vcs/3dviewer-plugin-auth` | The structural template for this plugin, and the source of `userState`.                                                                                                                                                                          |
| `luxembourg-geoportail`    | The 2D app. Reference implementation in `src/composables/info/feature-info.composable.ts` and `src/components/info/feature-info.vue`; the templates package; both plan documents.                                                                |

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
  `lux.config.json` passes, but **defaults live in `src/defaultOptions.ts`** — a deployed
  VC Map never reads a plugin's shipped `config.json`. Runtime values (`luxLocalesUrl`,
  `templatesConfig`, `templates`, `minResolution`) belong in one of the two, never
  hard-coded at the point of use.
- ESLint is `@vcsuite/eslint-config` (`configs.vueTs`); Prettier config comes from the same
  package via the `prettier` field in `package.json`.
- Tests run in jsdom; `tests/setup.js` mocks ResizeObserver + canvas and sets
  `window.CESIUM_BASE_URL`.

## Verified, and still open

Driven over CDP against `https://3d-staging.geoportail.lu` (themesync 1.5.2, no config
change). Each of these broke at some point during implementation:

- **exactly one** `/getfeatureinfo` request per click, whatever the number of active layers
  (`layers=813,262,152` in one query), and **zero** with the feature info tool off;
- one layer returning one feature → its template renders directly, no cluster. Confirmed
  with addresses (`adresse.html`) and cadastre (`parcels.html`, nested `PF`, the
  measurements links, and the fid carrying the backend's 262→359 remap);
- several features → VC Map's cluster list grouped by layer, and selecting a row renders
  **that row's own** template;
- **a multi-definition layer**: 813 active over Luxembourg City returns five entries with two
  distinct templates, and its rows render `default_table.html` — the template the old 1:1
  map got wrong (it held `bus_wo_title.html`);
- a click where no layer has data leaves **no window at all** — in particular the 2D
  `featureInfo2d` iframe does not open, which needs the layers' own providers cleared;
- a second click inside an already-selected geometry still queries — this needs the empty
  style on provided features, and the highlight still renders.

Measured while choosing the trigger: of 60 layers with data, 58 had identical attribute keys
via the aggregated endpoint and via direct WMS. Latency for one aggregated request against
N parallel WMS calls: 438/508/1070/2093 ms versus 645 ms/93 s/768/3135 ms for 1/3/10/30
layers — comparable at small N, better at 30, and without the tail-latency risk a single
slow layer creates when N requests must all resolve.

Still open:

- **A 3D tileset click vetoes the 2D query.** The interaction returns early when something
  was already picked, and LOD2 buildings are on by default in the deployed viewer, so over a
  building no 2D lux layer is queried. Unchanged from the previous designs — but now
  _reachable_: running before `FeatureProviderInteraction` means the early return is a
  choice, not a constraint.
- **Whether the aggregated endpoint gets credentials** from the viewer. Role-specific
  definitions and protected layers depend on `credentials: 'include'` reaching
  `map.geoportail.lu`; the config sends it, but it has not been verified with a logged-in
  user. Failing, the plugin behaves as anonymous.
- **The role-bearing definition set is unmeasured.** All probing was anonymous, so "two
  layers return more than one distinct template" (813, 817, of 618 enumerated) is the public
  view only.
- Vuetify style bleed _into_ the templates — never observed; `default.html`, `parcels.html`,
  `adresse.html` and `default_table.html` have been exercised in 3D.
