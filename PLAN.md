# Plan B, revised — minimising custom code in this plugin

**Status: done**, in `490737f refactor: trigger via a feature provider instead of a custom
interaction`. This is the working record of that refactor — what was built, what deviated
from the plan that was approved, and what is left. It is kept here so the reasoning travels
with the code; the canonical plan is
`luxembourg-geoportail/docs/plan-3dviewer-featureinfo-plugin.md` and the two overlap, so
prefer changing that one and re-aligning this.

## Context

The plugin reproduces the geoportail's per-position GetFeatureInfo in the VC Map 3D viewer,
rendering with `@geoportallux/feature-info-templates`. It worked, but the original Plan B
justified a **custom persistent interaction** on a claim that turned out to be false: that
VC Map's built-in flow "cannot express query all visible layers at a position, including
empty-space clicks". It can — `FeatureProviderInteraction` runs precisely
`if (!event.feature)` and calls `getFeaturesByCoordinate(position, resolution, layer)` on
every active layer with a provider. The plan never mentioned `AbstractFeatureProvider` or
`featureProviderClassRegistry`, so it never weighed the framework's designated seam.

Goal: as little custom code in the plugin as possible, without losing behaviour.

### Candidate C, explored and rejected

Dropping the custom aggregated endpoint for a standard `WMSFeatureProvider` with
`responseType: 'application/json'` per layer. Measured findings, kept because they are
expensive to re-derive:

- `wms.geoportail.lu/public_map_layers/service` advertises `application/json` and returns a
  **lux-enriched** payload — `fid` in composite form with the backend's layer remap applied
  (262 → `359_075F…`), `id`, populated `alias`, and `properties` identical to the aggregated
  endpoint's `attributes`, nested `PF` and `measurements[]` included. Geometry is EPSG:2169
  regardless of `SRS`. 709 of 732 queryable lux layers are WMS-queryable.
- **The blocker is the envelope, not the attributes.** `template` — which of 41 components
  renders a layer — lives only in the backend table `lux_getfeature_definition` and is
  absent from the themes API. Missing, it silently degrades every layer to `default.html`.
- Hit tolerance diverges: layer 152 returned 1 feature from the aggregated endpoint and 0
  from WMS at the same point. The aggregated path uses ±10 m `box1` filtered by ±1 m `box2`;
  WMS queries one pixel at the map's current resolution, sub-metre in a 3D camera view.
- The backend's own `_ogc_getfeatureinfo()` _is_ candidate C, for the layers whose
  `engine` selects it — with `template` still coming from the table. C becomes viable if
  `template` is ever published as themes metadata (a data change: the themes API serialises
  `Metadata` rows generically).

### Decisions taken

1. Keep the custom grouped `/getfeatureinfo` request.
2. Keep the 2D stacked panel, not VC Map's cluster list.

So the query stayed custom and only the trigger changed.

## What was built

`LuxAggregatedFeatureProvider extends AbstractFeatureProvider` on one plugin-owned, active,
non-rendering `VectorLayer`. `getFeaturesByCoordinate()` gates on the toolbox toggle, runs
the existing aggregated query, and returns **exactly one** envelope feature — a point at the
click carrying the whole `FeatureInfoJSON[]` under `luxContentSymbol`, tagged
`featureInfoViewSymbol` so `getFeatureInfoViewForFeature()` selects the lux view with no
per-layer resolution. One feature is what preserves the stacked panel; two or more become a
cluster.

**Files** — added `src/luxAggregatedFeatureProvider.ts`; rewrote
`src/luxTemplateFeatureInfoView.ts` (reads the payload off the feature, keeps `layerName` in
props, explicit `headerTitle`) and `src/index.ts` (provider layer, layer claiming, no
interaction); deleted `src/luxFeatureInfoInteraction.ts` and `src/luxFeatureExport.ts`;
trimmed `src/model.ts`, `src/defaultOptions.ts`, `src/LuxFeatureInfoWindow.vue`.
`src/luxQueryService.ts` and all three test files are untouched.

**Three things that are contract, not polish**

1. The provider gates itself on `toolboxManager.get('featureInfo').action.active`.
   `FeatureProviderInteraction` is in the immutable base chain and nothing in core or ui
   ever calls `featureProviderInteraction.setActive(…)`, so providers are asked on every
   click, tool or no tool.
2. The plugin clears `layer.featureProvider` on every layer `isLuxQueryLayer()` accepts —
   on `layers.added` and on each `stateChanged`, because a `WMSLayer` only builds its
   provider in `initialize()`. themesync's `text/html` providers fabricate a placeholder
   feature per click _without any request_; left alone they turn every result into a cluster
   and stop empty-space clicks from clearing the panel.
3. The envelope feature carries an empty `Style`. `selectFeature()` clones a provided
   feature onto its scratch layer with `olcs_allowPicking: true`; otherwise that clone would
   swallow the next click at the same spot.

## Deviations from the approved plan

- **The provider is not registered in `featureProviderClassRegistry`.** It needs the app,
  the plugin config and the view instance at construction, none of which can come from
  JSON, so a registry entry would advertise a type no config could instantiate.
- **Layer claiming needed a `stateChanged` listener**, not the one-off sweep the plan
  implied — the provider does not exist until a layer is first activated.
- **`queryEmptySpace` was removed** (plan said `model.ts` unchanged). The provider only ever
  runs on clicks that picked nothing, so the option could not mean anything.
- **The saving is −83 lines, not the estimated −230.** The provider came out at 143 lines
  rather than ~70 and `index.ts` grew by 98 for the gate and the claiming. What improved is
  which code is left: the interaction and the ownership rule — the two most intricate
  pieces, and the source of the single-layer iframe bug — are gone.
- **Claiming removed the flag dependency.** The plan accepted that design B needs
  themesync's `useLuxFeatureInfoTemplates` on; it does not, so `preview --vcm` against an
  unmodified staging deployment still works.

## Verified

Driven over CDP against `https://3d-staging.geoportail.lu`, themesync 1.5.2, no config
change. `npm run lint`, `type-check`, 32 tests and `build` all green.

| check                         | result                                                          |
| ----------------------------- | --------------------------------------------------------------- |
| one active queryable layer    | one request (`302`), stacked panel, no `featureInfo2d` iframe   |
| four active queryable layers  | **one** request (`147,698,262,302`), **one** window, no cluster |
| click where no layer has data | panel closes                                                    |
| feature info tool off         | **zero** requests                                               |
| attribute values              | render, not just labels                                         |

## Known gaps

- A `WMSLayer` rebuilds its provider in `reload()`/`setLayers()` without firing
  `stateChanged`, so a themesync reload can resurrect one. Not handled; it disappears once
  `useLuxFeatureInfoTemplates` is on.
- The templates' "direct link to this object" is built from `currentUrl` =
  the 3D viewer's `window.location.href`, which has no query string and no `fid` handling,
  so the link is broken. A configured 2D-portal base URL would fix it.
- The templates need a `v-dompurify-html` directive the package neither ships nor declares;
  the plugin registers it on the shared Vue app as a stopgap. Tracked as work item 10 in
  `docs/plan-feature-info-templates.md`.
- Phase 7 remains open: highlighting (now nearly free — put the real geometries on the
  envelope feature, but keep it to one feature), 3D building clicks (now structurally out of
  reach of the provider), `fid` deep links, elevation profile.

## Uncommitted elsewhere

- `3dviewer-themesync`: Phase 6 (`properties.luxQueryable`, the
  `useLuxFeatureInfoTemplates` flag, README) plus the 1.6.0 version bump.
- `3dviewer-plugin-auth`: the `typeUtilisateur` typo and `mymaps_role: number` fixes.
- `3dviewer`: untouched on purpose — `config/lux.config.json` installs plugins from npm, so
  the deployment entry waits until both packages are published. The block is in the plugin's
  README.
