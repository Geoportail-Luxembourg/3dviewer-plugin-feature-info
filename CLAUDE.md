# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Phases 1-6 of the plan are implemented. `@geoportallux/feature-info-templates` is consumed
through a `file:` dependency on the sibling `luxembourg-geoportail` checkout, because that
package is not published yet (Plan A phase 6). `.npmrc` sets `install-links=true` so npm
copies rather than symlinks it — a symlink whose realpath is outside the project root trips
Vite's dev server `fs.allow`.

Not implemented, and deliberately so:

- **Phase 7 enhancements** — highlighting the returned geometries, routing 3D building
  clicks through the lux templates, `fid` deep links, 3D elevation profile.
- **The 3dviewer deployment entry** (plan phase 6.3). `config/lux.config.json` in the
  `3dviewer` repo is untouched: its `plugins` array installs from npm, and pointing it at an
  unpublished plugin while flipping themesync's `useLuxFeatureInfoTemplates` on would leave
  the WMS layers referencing a feature info view that does not exist, breaking 2D feature
  info. The exact config block to add is in this repo's README.

Reference: `/home/tkohr/Projets/luxembourg/git/luxembourg-geoportail/docs/plan-3dviewer-featureinfo-plugin.md`
("Plan B") and its companion `docs/plan-feature-info-templates.md` ("Plan A").

## Commands

```bash
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

## What this plugin does

Reproduces the 2D geoportail's per-position GetFeatureInfo inside the VC Map 3D viewer:
one click → **one aggregated query over all visible queryable lux layers** → a window
rendering the response with `@geoportallux/feature-info-templates`.

**In one line: a custom persistent interaction is the trigger, a registered feature-info
view class is the renderer.** VC Map's built-in feature-info flow is per-feature and
per-layer (`WMSFeatureProvider` issues one request per layer, and only when a feature was
picked), so it cannot express "query every visible layer at this position, including
empty-space clicks". The `featureInfoClassRegistry` is still the right place for the
rendering/lifecycle half, so the plugin uses both.

The pieces, one module each:

- **`luxQueryService.ts`** — collects eligible layers, builds the request, post-processes
  the response. `event.position` is EPSG:3857 in both OL and Cesium maps and is transformed
  to EPSG:2169; `box1`/`box2` are ±10 m/±1 m boxes in 2169 while `srs` announces 3857 (the
  server's contract, verified against the live backend), and
  `WIDTH`/`HEIGHT`/`X`/`Y`/`BBOX` describe a synthetic north-up viewport centred on the
  point, with `zoom` from `map.getCurrentResolution()`. Eligible layers are active,
  non-transparent, carry `properties.luxId` and are flagged by `properties.luxQueryable` —
  falling back to `allowPicking` on 2D layers for a themesync older than 1.6.
- **`luxFeatureInfoInteraction.ts`** — `eventHandler.addPersistentInteraction()` (default
  index, i.e. after the four built-ins and before the exclusive `FeatureInfoInteraction`),
  gated on `toolboxManager.get('featureInfo').action.active`. Passes through any feature
  already served by another view, otherwise queries and stops propagation on a hit. An
  empty result deliberately falls through so the built-in interaction clears the selection.
  Also owns `createAnchorLayer()` — see below.
- **`luxTemplateFeatureInfoView.ts`** — registered in `app.featureInfoClassRegistry` during
  `initialize()`; the interaction sets `view.content` and calls
  `featureInfo.selectFeature(anchor, position, windowPosition, view)`, so the built-in
  window/selection/toolbox lifecycle comes for free.
- **`LuxFeatureInfoWindow.vue`** — a plain wrapper that `provide()`s `LUX_TPL_CONTEXT` and
  `LUX_TPL_I18N` in `setup()` (reaching the plugin via `inject('vcsApp')` +
  `plugins.getByKey`, because a config-defined view cannot hand them down), sets
  `.lux-tpl-root`, imports the package CSS, renders the shared dispatcher. **No child Vue
  app / `createApp` mount** — that remains the documented escalation path (and the
  prerequisite for a shadow-DOM mount) if Vuetify styles bleed in.
- **`luxTplRuntime.ts`** — a dedicated i18next instance (not the singleton) with
  `i18next-http-backend`, the `LuxTplContext`, and a `localeChanged` listener.

### The anchor layer

`featureInfo.selectFeature()` insists on a feature belonging to a layer of this app, but an
aggregated result belongs to a _position_. Each result is therefore anchored on a throwaway
point feature in a never-activated, non-pickable `VectorLayer`. Being inactive, that layer
has no map implementation, so the highlight VC Map applies to the anchor renders nowhere.
Activating it is the natural starting point for phase 7 highlighting.

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

## Known risks to validate early

- **CORS** on `https://map.geoportail.lu/getfeatureinfo` and `/assets/locales` from the 3D
  origin. Themesync's `TrustedServers`/proxy pattern is the fallback.
- `zoom` parameter semantics when derived from Cesium camera height.
- Vuetify style bleed _into_ the templates (mitigated by `.lux-tpl-root` scoping).
