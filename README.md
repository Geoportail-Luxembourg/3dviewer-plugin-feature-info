# @geoportallux/lux-3dviewer-plugin-feature-info

> Part of the [VC Map Project](https://github.com/virtualcitySYSTEMS/map-ui)

Reproduces the Luxembourg geoportail's per-position GetFeatureInfo inside the VC Map
3D viewer: one click runs **one aggregated query over every visible queryable lux
layer**, and the response is rendered with the shared
[`@geoportallux/feature-info-templates`](https://github.com/Geoportail-Luxembourg/luxembourg-geoportail)
components — the same templates the 2D portal uses.

## How it works

A **persistent interaction is the trigger, a registered feature info view is the
renderer.**

VC Map's built-in feature info flow is per feature and per layer: features on WMS layers
only exist through a per-layer `WMSFeatureProvider` request, and the interaction only acts
on a feature it actually picked. It therefore cannot express "query every visible layer at
this position, including clicks into empty space". So this plugin brings its own trigger:

- `LuxFeatureInfoInteraction` is added with `eventHandler.addPersistentInteraction()`, which
  places it after `CoordinateAtPixel` / `FeatureAtPixel` / `FeatureProvider` and before the
  exclusive `FeatureInfoInteraction`. It sees both the click position and any picked
  feature, and hands the event on by simply not stopping propagation.
- It only runs while VC Map's own **feature info toolbox toggle** is active, which means it
  inherits the framework's tool semantics: when draw or measure claim the exclusive
  interaction slot, the toggle switches off and lux queries stop with it.
- Clicks that hit a feature already served by another view — a 3D tileset balloon, a search
  result — are passed through untouched.

The rendering half stays inside the framework: `LuxTemplateFeatureInfoView` is registered
in `app.featureInfoClassRegistry`, and the interaction calls
`featureInfo.selectFeature(feature, position, windowPosition, luxView)` with that view
passed explicitly. That bypasses per-layer view resolution while keeping the built-in
lifecycle — window position caching by class name, selection clearing, toolbox session
semantics.

Because `selectFeature` insists on a feature that belongs to a layer, and an aggregated
result belongs to a _position_, the plugin anchors each result on a throwaway point feature
in a never-activated, non-pickable vector layer. Being inactive, that layer has no map
implementation, so the highlight VC Map applies to the anchor renders nowhere.

## Requirements

| Requirement                                  | Why                                                                                                                                                                                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@geoportallux/lux-3dviewer-themesync` ≥ 1.6 | writes `properties.luxId` and `properties.luxQueryable` on lux layers. Older builds are tolerated: the plugin then falls back to `allowPicking` on 2D layers, which carried the same `is_queryable` bit.                                                                                      |
| `@geoportallux/lux-3dviewer-plugin-auth`     | **optional.** Supplies the logged-in user for the templates that prefill an email or gate the solar economic calculator. Without it, templates render anonymously.                                                                                                                            |
| CORS on `luxGetInfoUrl` and `luxLocalesUrl`  | both are served from the geoportail origin and must allow the 3D viewer's origin with credentials. Verified for `https://3d.geoportail.lu`.                                                                                                                                                   |
| A `v-dompurify-html` directive               | six templates, `default` among them, render attribute **values** through it, but the templates package neither ships nor declares it. This plugin registers it on the shared Vue app from `LuxFeatureInfoWindow.vue`; without it those values render empty. Belongs in the templates package. |

**Ordering constraint:** plugins initialize serially in config order and are parsed before a
module's `featureInfo` items. List this plugin **before themesync** in the `plugins` array,
so that the `LuxTemplateFeatureInfoView` class is registered by the time themesync's layers
reference it.

## Configuration

```jsonc
{
  "name": "@geoportallux/lux-3dviewer-plugin-feature-info",
  "entry": "plugins/@geoportallux/lux-3dviewer-plugin-feature-info/index.js",
  "luxGetInfoUrl": "https://map.geoportail.lu/getfeatureinfo",
  "luxLocalesUrl": "https://map.geoportail.lu/assets/locales",
  "credentials": "include",
}
```

| Option                      | Default                                    | Description                                                                                                  |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| `luxGetInfoUrl`             | `https://map.geoportail.lu/getfeatureinfo` | The aggregated GetFeatureInfo endpoint.                                                                      |
| `luxLocalesUrl`             | `https://map.geoportail.lu/assets/locales` | Base URL of the geoportail's built Transifex artifacts; `{{ns}}.{{lng}}.json` is appended.                   |
| `templatesConfig`           | see `config.json`                          | The ~16 service URLs and `solarEconomicAllowedRoleIds` the templates need. Merged per key over the defaults. |
| `credentials`               | `same-origin`                              | Credentials mode of the GetFeatureInfo request.                                                              |
| `bigBuffer` / `smallBuffer` | `10` / `1`                                 | Buffer in metres (EPSG:2169) sent as `box1` / `box2`.                                                        |
| `queryEmptySpace`           | `true`                                     | Whether a click that picked no feature still queries. `true` matches the 2D portal.                          |

To route the 2D WMS layers through this plugin instead of the `featureInfo2d` iframe, set
`useLuxFeatureInfoTemplates: true` on the themesync plugin. That also drops the per-layer
`WMSFeatureProvider`, so no duplicate WMS requests are fired.

## The query

The request is the one the 2D portal's coordinate path sends, verified against the live
backend:

- the click position (EPSG:3857 in both Cesium and OpenLayers maps) is transformed to
  **EPSG:2169**;
- `box1` / `box2` are fixed ±10 m / ±1 m boxes around that point, while `srs` announces
  `EPSG:3857` — that asymmetry is the server's contract, not an oversight;
- `WIDTH` / `HEIGHT` / `X` / `Y` / `BBOX` describe a synthetic north-up viewport with the
  clicked point at its centre. The 2D app falls back to exactly that whenever the real pixel
  is off screen, which is what proves the backend accepts it; in a tilted 3D view no real
  pixel extent exists anyway.
- `zoom` is derived from the active map's current resolution.

`tests/fixtures/` holds a real response captured with these parameters, and
`tests/luxQueryResponse.spec.ts` pins the shape this plugin relies on.

## Not in v1

- Highlighting the returned geometries (they arrive in EPSG:2169).
- Elevation profiles — `profileComponent` is unset, so templates hide their `has_profile`
  sections. The KML/GPX export handler is wired but unreachable until a Cesium-side profile
  component exists, since the templates only emit `export` from that component.
- `fid` permalink deep links. The query shape is implemented (`plugin.queryByFid()`); only
  the URL handling is missing.
- Routing 3D building clicks through the lux templates instead of the balloon.
- Shift-click accumulation from the 2D portal, deliberately dropped.

## Development

```bash
npm start          # dev server on :8008; --appConfig <file|url> to load an app config
npm run build      # build to dist/
npm test           # vitest
npm run lint       # eslint + prettier
npm run type-check # vue-tsc
```

`@geoportallux/feature-info-templates` is not published yet. Until it is, it is installed
from the sibling checkout via a `file:` dependency, with `install-links=true` in `.npmrc` so
npm copies it into `node_modules` instead of symlinking (a symlink outside the project root
breaks Vite's dev server `fs.allow`). Rebuild it after changing it:

```bash
npm run build -w @geoportallux/feature-info-templates   # in luxembourg-geoportail
npm install                                             # here
```
