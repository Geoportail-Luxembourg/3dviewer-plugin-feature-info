# @geoportallux/lux-3dviewer-plugin-feature-info

> Part of the [VC Map Project](https://github.com/virtualcitySYSTEMS/map-ui)

Reproduces the Luxembourg geoportail's per-position GetFeatureInfo inside the VC Map
3D viewer: one click runs **one aggregated query over every visible queryable lux
layer**, and the response is rendered with the shared
[`@geoportallux/feature-info-templates`](https://github.com/Geoportail-Luxembourg/luxembourg-geoportail)
components — the same templates the 2D portal uses.

## How it works

**A feature provider is the trigger; a registered feature-info view is the renderer.**
Both are VC Map extension points, so the plugin contains no interaction of its own.

`LuxAggregatedFeatureProvider` extends `AbstractFeatureProvider` — the framework's seam for
"a layer which cannot provide features directly, but can provide features for a given
location". VC Map's built-in `FeatureProviderInteraction` calls it whenever a click picked
no feature, which is what makes clicks into empty space work, and skips providers entirely
once something _was_ picked, so clicks on a 3D tileset reach their balloon by construction.

The provider is attached to one plugin-owned, active, non-rendering vector layer. It runs
the single aggregated query over every visible queryable lux layer and returns **exactly
one** envelope feature — a point at the click carrying the whole response, tagged with
`featureInfoViewSymbol`. That symbol beats any per-layer `properties.featureInfo`, so
`LuxTemplateFeatureInfoView` renders it without any view resolution, and returning one
feature is what keeps the 2D portal's stacked panel: two or more would make VC Map open its
cluster list instead.

Two details that are part of the contract rather than refinements:

- **The provider gates itself on the feature info toolbox toggle.**
  `FeatureProviderInteraction` sits in VC Map's immutable base interaction chain and nothing
  in core or ui ever deactivates it, so providers are asked on _every_ click — while
  panning, drawing, or with the tool switched off. Without the gate that would hit the
  backend every time.
- **The plugin clears the feature providers themesync leaves on lux layers.** With
  `useLuxFeatureInfoTemplates` off, those are `text/html` `WMSFeatureProvider`s, which
  fabricate a placeholder feature on every click _without issuing a request_ — that is how
  the `featureInfo2d` iframe gets its position. Left in place, each placeholder joins this
  plugin's envelope feature and VC Map opens its cluster list, and empty-space clicks stop
  clearing the selection. Clearing them makes this plugin the sole provider and lets it work
  with themesync's flag on or off.

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
  sections. KML/GPX export goes with it: the templates only emit `export` from that
  component, so a handler here would be unreachable.
- `fid` permalink deep links. The request shape is implemented
  (`buildFidParams()` in `luxQueryService.ts`); only the URL handling is missing. Note that
  WMS GetFeatureInfo has no by-id equivalent, so this stays tied to the custom endpoint.
- Routing 3D building clicks through the lux templates instead of the balloon. This is now
  structural: `FeatureProviderInteraction` never runs once a feature was picked.
- Shift-click accumulation from the 2D portal, deliberately dropped.

## Development

```bash
npm run preview -- --vcm https://3d-staging.geoportail.lu/   # see below
npm start          # bare dev server on :8008 (@vcmap/ui's app config, no lux layers)
npm run build      # build to dist/
npm test           # vitest
npm run lint       # eslint + prettier
npm run type-check # vue-tsc
```

### Running against a deployed viewer

`vcmplugin preview --vcm <url>` is the way to develop this plugin. It serves the locally
built `dist/index.js`, proxies `/assets`, `/plugins` and `/style.css` to the deployed
viewer, and fetches its `app.config.json` — so themesync, auth and every other plugin come
from the deployment and only this plugin is local. No app config or mock layers are needed
here.

```bash
npm run preview -- --vcm https://3d-staging.geoportail.lu/   # http://localhost:5005
```

Three things to know:

- **A CORS bypass is required.** Not for this plugin specifically: the geoportail answers a
  request from `localhost` with `Access-Control-Allow-Origin: *` together with
  `Access-Control-Allow-Credentials: true`, a combination browsers reject, and every lux
  plugin sends `credentials: include`. Themesync's own `/themes` call fails the same way, so
  without a bypass there are no layers at all. A browser extension that rewrites the CORS
  headers is the simplest fix; requests from `https://3d.geoportail.lu` itself get a
  properly echoed origin and need nothing.
- **Enable a queryable layer first.** The deployed viewer starts with no 2D lux layer
  active, and the aggregated query has nothing to ask about until one is on. Pick any layer
  from the content tree, then click the map.
- **Restart preview after editing.** `--watch` rebuilds `dist/`, but the dev server keeps
  serving the previously transformed copy — a browser reload, even with the cache disabled,
  does not pick the change up. Stop and restart `npm run preview` instead.

It also works against production (`--vcm https://3d.geoportail.lu/`); staging is the safer
default.

`@geoportallux/feature-info-templates` is not published yet. Until it is, it is installed
from the sibling checkout via a `file:` dependency, with `install-links=true` in `.npmrc` so
npm copies it into `node_modules` instead of symlinking (a symlink outside the project root
breaks Vite's dev server `fs.allow`). Rebuild it after changing it:

```bash
npm run build -w @geoportallux/feature-info-templates   # in luxembourg-geoportail
npm install                                             # here
```
