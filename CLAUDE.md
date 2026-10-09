# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

One aggregated `/getfeatureinfo` request per click, made by a feature provider on a hidden
helper layer, returning one feature per response feature so VC Map's stock cluster list does
the selection. Approaches already tried and left — don't reintroduce them:

- a custom persistent interaction at a chain index: relies on core's private chain and
  discards other layers' provider results;
- a single envelope feature for the whole response: bypasses VC Map's cluster list;
- per-layer WMS GetFeatureInfo: reaches only one of the backend's three branches (REST, SQL,
  WMS relay) and cannot express several definitions per layer (813) or role-dependent ones.

The earlier implementation lives in `../3dviewer-plugin-feature-info`; canonical plans in
`/home/tkohr/Projets/luxembourg/git/luxembourg-geoportail/docs/`.

`@geoportallux/feature-info-templates` is a `file:` dependency on the sibling
`luxembourg-geoportail` checkout (unpublished). `.npmrc` `install-links=true` copies instead of
symlinking — a symlink outside the project root trips Vite's `fs.allow`.

No themesync change is needed: the plugin reads only `properties.luxId`, `is3DLayer` and
`allowPicking`, and wins over themesync's `featureInfo2d` iframe without touching it.

## Commands

```bash
npm run build        # vcmplugin build → dist/
npm test             # vitest (watch)
npx vitest run tests/provider.spec.ts   # single test file
npm run lint         # eslint + prettier --check
npm run format       # prettier --write + eslint --fix
npm run type-check   # vue-tsc --noEmit (src/ only)
./node_modules/.bin/vcmplugin preview --vcm https://3d-staging.geoportail.lu/ -p <port>
```

Use `./node_modules/.bin/vcmplugin`, not `npx vcmplugin` (the latter resolves wrongly here).
Preview serves `dist/` — rebuild and restart it after each change. The geoportail rejects
`localhost` CORS with credentials, so drive it in a browser with `--disable-web-security` (or a
CORS-bypass extension). Synthetic CDP clicks need a preceding `mouseMoved`. Turn off 3D
tilesets before testing: a tileset hit vetoes all 2D provider queries.

## Architecture

- `src/provider.ts` — `LuxProvider` (an `AbstractFeatureProvider`) plus the pure
  `splitResponse`/`rowTitle` (unit-tested). Gated on the `featureInfo` toolbox action, because
  `FeatureProviderInteraction` asks every provider on every click. Queries lux layers that are
  active and supported by the current map. Builds each ol feature by hand rather than via
  `getProviderFeature()` (which would stamp the helper layer's name over `vcsLayerName`), with
  an explicit id (813 returns `fid: null`), an empty `Style` (a visible clone on
  `selectFeature()`'s scratch layer would be picked and veto the next query), the view under
  `featureInfoViewSymbol` and its own `FeatureInfoJSON` entry under `luxContentSymbol`.
- `src/view.ts` / `src/LuxWindow.vue` — `AbstractFeatureInfoView` passing
  `{ entry, layerName, runtime }` to a window that provides the templates' context and i18n and renders
  `getTemplateComponent(entry.template)` inside `.lux-tpl-root`.
- `src/index.ts` — config defaults (in code: a deployed VC Map never reads `config.json`), the
  templates' i18next instance (geoportail locale files) and context (auth plugin user, VC Map
  notifier), `claimLayer` (clears each lux layer's own provider on every `stateChanged`, since
  `WMSLayer.initialize()` rebuilds it), and the volatile helper `VectorLayer` carrying the
  provider.

Request params mirror the 2D client, including a synthetic viewport (`BBOX`/`WIDTH`/`HEIGHT`/
`X`/`Y`). The backend uses it for the WMS relay and to turn its 10 px tolerance on REST-branch
points/lines into metres — so a close-up 3D camera narrows what lines like 813 hit.

`tests/vcsPluginInterface.spec.ts` is the stock conformance test: `i18n` must contain `en`
and namespace entries under `lux3dviewerPluginFeatureInfo`.
