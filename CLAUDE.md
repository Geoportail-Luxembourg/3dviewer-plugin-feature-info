# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

This repository is a **fresh `vcmplugin create` scaffold** — `src/index.ts` still contains
the generated boilerplate (a `VcsPlugin` whose hooks only `console.log`). Nothing of the
feature described below is implemented yet.

The work to be done is specified in
`/home/tkohr/Projets/luxembourg/git/luxembourg-geoportail/docs/plan-3dviewer-featureinfo-plugin.md`
("Plan B", phases 1–7). **Read it before implementing anything here** — it contains the
verified request contract, the VC Map integration points with file/line references, and the
open decisions. Its companion, `docs/plan-feature-info-templates.md` ("Plan A"), describes
the npm package this plugin renders with; phases 0–5 of that plan are already done.

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

## What this plugin does (target architecture)

Reproduces the 2D geoportail's per-position GetFeatureInfo inside the VC Map 3D viewer:
one click → **one aggregated query over all visible queryable lux layers** → a window
rendering the response with `@geoportallux/feature-info-templates`.

**In one line: a custom persistent interaction is the trigger, a registered feature-info
view class is the renderer.** VC Map's built-in feature-info flow is per-feature and
per-layer (`WMSFeatureProvider` issues one request per layer, and only when a feature was
picked), so it cannot express "query every visible layer at this position, including
empty-space clicks". The `featureInfoClassRegistry` is still the right place for the
rendering/lifecycle half, so the plugin uses both.

Intended pieces:

- **Query service** — click `event.position` is EPSG:3857 in both OL and Cesium maps;
  transform to EPSG:2169 (`Projection` from `@vcmap/core`), then build the geoportail's
  coordinate-path GET request (`layers`, `box1`/`box2` ±10 m/±1 m, `srs`, `zoom` derived
  from camera height, synthetic `BBOX`/`WIDTH`/`HEIGHT`/`X`/`Y`) against `luxGetInfoUrl`.
  Layer list = `app.layers` where `properties.luxId` is set, active, and queryable.
- **Interaction** — `eventHandler.addPersistentInteraction` at default index 3, gated on
  the standard `featureInfo` toolbox toggle; passes Cesium3DTile feature clicks through to
  the existing balloon, otherwise runs the aggregated query and stops propagation.
- **Renderer** — a `LuxTemplateFeatureInfoView` registered in `app.featureInfoClassRegistry`
  during `initialize()`, selected explicitly via `app.featureInfo.selectFeature(feature,
position, windowPosition, luxView)` so the built-in window/selection/toolbox lifecycle
  comes for free.
- **Window component** — a plain wrapper that `provide()`s `LUX_TPL_CONTEXT` and
  `LUX_TPL_I18N` in `setup()`, sets `.lux-tpl-root` on its root element, imports the
  package CSS, and renders the shared dispatcher. **No child Vue app / `createApp` mount
  is needed** — that remains the documented escalation path (and the prerequisite for a
  shadow-DOM mount) if Vuetify styles bleed in.

### The templates package contract

`@geoportallux/feature-info-templates` (not yet a dependency here; lives in the
`luxembourg-geoportail` repo at `packages/feature-info-templates`, Phase 6 "publish" not
started) exposes exactly one host dependency surface:

- `provideLuxTplContext(ctx)` / `LUX_TPL_CONTEXT` with `{ config, user, notify,
profileComponent?, isThemeAvailable? }`
- `createLuxTplI18n(i18next)` / `LUX_TPL_I18N` / `useLuxTranslation` — lib-owned, so the
  package does **not** depend on `i18next-vue` (whose `install()` would overwrite VC Map's
  vue-i18n `$t` global)
- `createLuxTplI18next(loadPath)` — the exact geoportail i18next init contract plus
  tooltip-fallback hydration; locales come from the deployed geoportail's
  `assets/locales/{ns}.{lng}.json`
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
