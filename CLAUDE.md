# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

Fresh `@vcmap/plugin-cli` scaffold (single commit): `src/index.ts` is still the template
plugin with `console.log` placeholders, `README.md` is unfilled. A previous implementation
of the same plugin lives in the sibling checkout `../3dviewer-plugin-feature-info` (with its
own `CLAUDE.md` and `PLAN.md`); this branch (`feature-info-from-scratch`) is a rewrite.
Canonical plans are in `/home/tkohr/Projets/luxembourg/git/luxembourg-geoportail/docs/`
(`plan-3dviewer-featureinfo-plugin.md`, `plan-feature-info-templates.md`).

## Commands

```bash
npm start            # vcmplugin serve (dev server)
npm run preview -- --vcm <url>   # serve local dist/ against a deployed VC Map
npm run build        # vcmplugin build → dist/
npm run bundle       # vcmplugin bundle (production tar)
npm test             # vitest (watch)
npx vitest run tests/vcsPluginInterface.spec.ts   # single test file
npm run coverage
npm run lint         # eslint + prettier --check
npm run format       # prettier --write + eslint --fix
npm run type-check   # vue-tsc --noEmit
```

`node_modules` is not installed yet — run `npm install` first. `vcmplugin serve` requires
`@vcmap/ui` in `node_modules` even though it is a peer dependency.

## Architecture

A VC Map (`@vcmap/ui` 6.3) plugin for the Luxembourg 3D viewer. `src/index.ts` default-
exports a factory `(config, baseUrl) => VcsPlugin<PluginConfig, PluginState>`; `name`,
`version` and `mapVersion` are read from `package.json`. Lifecycle hooks: `initialize`
(before context load), `onVcsAppMounted` (UI managers ready), `getDefaultOptions`/`toJSON`
(config serialization, `toJSON` should omit defaults), `getState` (URL/state sync),
`getConfigEditors`, `destroy`.

`config.json` is the plugin config used by the dev server.

`tests/vcsPluginInterface.spec.ts` is the stock plugin-interface conformance test (loads the
plugin via `loadPlugin` with `entry: '_dev'`). If the plugin adds `i18n`, it must contain
`en` and namespace entries under the camel-cased unscoped package name
(`lux3dviewerPluginFeatureInfo`). Tests run in jsdom with canvas mock and ResizeObserver
polyfill (`tests/setup.js`).
