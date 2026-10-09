# @geoportallux/lux-3dviewer-plugin-feature-info

> Part of the [VC Map Project](https://github.com/virtualcitySYSTEMS/map-ui)

Reproduces the Luxembourg geoportail's per-position GetFeatureInfo inside the VC Map
3D viewer: one click runs **one aggregated query over every visible queryable lux
layer**, and the response is rendered with the shared
[`@geoportallux/feature-info-templates`](https://github.com/Geoportail-Luxembourg/luxembourg-geoportail)
components — the same templates the 2D portal uses.

## How it works

**One aggregated request per click; VC Map renders the result.**

The plugin registers one feature provider, `LuxAggregatedFeatureProvider`, that VC Map's own
`FeatureProviderInteraction` asks on every click. It asks the geoportail's
`/getfeatureinfo` about every active queryable lux layer at once and returns one feature per
returned feature. From there the framework does the rest: `featureInfo.selectFeature()`
opens the window through the registered `LuxTemplateFeatureInfoView`.

VC Map finds feature providers only through active layers, and this one answers for all lux
layers at once, so it sits on a layer of its own: an empty `VectorLayer`, always active,
marked volatile so it never appears in the app state or share links, and in no content
tree.

**Why not a standard per-layer WMS GetFeatureInfo?** Because `/getfeatureinfo` is a
dispatcher, not a convenience wrapper. For each layer the backend reads
`lux_getfeature_definition` and takes one of three branches: a REST query, a SQL query, or —
when neither is configured — a standard WMS GetFeatureInfo that it relays itself. Querying
WMS directly is therefore exact for the third branch and blind to the other two.

It also answers two things a WMS response cannot express:

- **a layer can have several definitions, each with its own template.** Layer 813 comes back
  as five entries with two distinct templates. A `layerId → template` map is wrong by
  construction, and since the split is defined by each definition's own SQL, no client-side
  mapping can reproduce it;
- **definitions can depend on the logged-in user's role**, replacing the anonymous ones
  outright.

The response is already the envelope the templates expect — `template`, `ordered`,
`has_profile`, and per feature `geometry` (EPSG:2169), `fid`, `id`, `alias` and
`attributes` — so the plugin adds only the layer label and the parcel annotation.

**When several features are hit, VC Map shows its cluster list** — a searchable window
grouped by layer, one row per feature; selecting a row renders that feature's own template,
which is what makes multi-definition layers work without a special case. A single feature
opens its panel directly.

Four things in the provider that are contract, not refinement:

- **It gates on the feature info toolbox toggle.** `FeatureProviderInteraction` asks every
  provider on every click — panning, drawing, tool off — and each call would otherwise be a
  request.
- **Each feature names its own lux layer**, not the helper layer: the cluster list groups on
  `vcsLayerName` and `selectFeature()` resolves the layer through it.
- **It gives every feature an id and a row title.** Not all layers return a `fid` (813
  returns `null`), and a feature without an id leaves its cluster row titled `undefined`.
  The title is derived too: VC Map titles rows from one configured attribute plus a
  case-sensitive `title`/`name`, and lux layers disagree on the naming — most compose a
  `label`, 813 carries `Name` — so the plugin writes a `luxRowTitle` attribute instead,
  taking `label`, `name` or `title` case-insensitively.
- **It renders nothing.** `selectFeature()` clones a provided feature onto its internal
  scratch layer forcing `olcs_allowPicking: true`; with a visible style that clone is picked
  on the next click and the selected geometry becomes a dead zone. An empty style keeps the
  highlight while leaving the clone unpickable.

VC Map asks no provider when something was already picked, so a 3D tileset or vector
feature keeps its own click. This is also why clicking a LOD2 building does not query the
2D layers underneath.

The plugin also clears the feature provider themesync configures on those layers. That
provider fabricates a placeholder feature per click without any request — it is how the 2D
`featureInfo2d` iframe gets its position — and left in place it would open that iframe
whenever the lux query finds nothing.

## Requirements

| Requirement                              | Why                                                                                                                                                                                                                                                                                                                   |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@geoportallux/lux-3dviewer-themesync`   | any version. The plugin reads only `properties.luxId`, `properties.is3DLayer` and `allowPicking`, which themesync has always written — `allowPicking` carries the theme item's `is_queryable`. No themesync change is needed for this plugin, and removing the plugin restores the `featureInfo2d` iframe on its own. |
| `@geoportallux/lux-3dviewer-plugin-auth` | **optional.** Supplies the logged-in user for the templates that prefill an email or gate the solar economic calculator. Without it, templates render anonymously.                                                                                                                                                    |
| CORS on the WMS and `luxLocalesUrl`      | both are served from the geoportail origin and must allow the 3D viewer's origin. Verified for `https://3d.geoportail.lu`; other origins (including `localhost`) need a proxy or a browser bypass, see Development.                                                                                                   |

**Ordering constraint:** plugins initialize serially in config order and are parsed before a
module's `featureInfo` items. List this plugin **before themesync** in the `plugins` array,
so that the `LuxTemplateFeatureInfoView` class is registered by the time themesync's layers
reference it.

## Configuration

```jsonc
{
  "name": "@geoportallux/lux-3dviewer-plugin-feature-info",
  "entry": "plugins/@geoportallux/lux-3dviewer-plugin-feature-info/index.js",
  "luxLocalesUrl": "https://map.geoportail.lu/assets/locales",
  "luxGetInfoUrl": "https://map.geoportail.lu/getfeatureinfo",
}
```

| Option            | Default                                    | Description                                                                                                                             |
| ----------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| `luxLocalesUrl`   | `https://map.geoportail.lu/assets/locales` | Base URL of the geoportail's built Transifex artifacts; `{{ns}}.{{lng}}.json` is appended.                                              |
| `luxGetInfoUrl`   | `https://map.geoportail.lu/getfeatureinfo` | The aggregated GetFeatureInfo endpoint. One request covers every active layer.                                                          |
| `templatesConfig` | see `defaultOptions.ts`                    | The ~16 service URLs and `solarEconomicAllowedRoleIds` the templates need. Merged per key.                                              |
| `bigBuffer`       | `10`                                       | Half-width in metres of `box1`, matched against points and lines. Generous on purpose — it is what makes a point layer clickable.       |
| `smallBuffer`     | `1`                                        | Half-width in metres of `box2`, matched against polygons. Small on purpose — widen it and clicking a parcel returns its neighbours too. |
| `credentials`     | `include`                                  | Credentials mode for the query. `include` is what lets the backend see the session and return role-specific definitions.                |

The plugin takes the lux layers over by itself: it clears the `text/html` feature provider
themesync configured and answers for those layers from its own provider. Nothing has to
be configured on the themesync side, and dropping this plugin from the `plugins` array
restores the previous iframe behaviour with no other change.

## The query

`buildPositionParams()` encodes the geoportail's contract: two hit boxes in EPSG:2169 metres
while `srs` announces EPSG:3857, plus a synthetic north-up viewport with the clicked point
at its centre — which is what the 2D portal itself falls back to when the real pixel is off
screen, and all that a tilted 3D view can supply.

The two boxes are not coarse and fine passes. The backend intersects **`box1` against
geometries with no rings** (points and lines) and **`box2` against polygons**, so `bigBuffer`
has to be generous for a point layer to be clickable, while `smallBuffer` stays small —
widen it and clicking one parcel starts returning its neighbours. The 2D portal scales both
with the map resolution (`20 *` and `1 *` respectively); a tilted 3D camera reports
sub-metre resolutions from hundreds of metres up, so these are fixed metres instead.

`tests/fixtures/getfeatureinfo-*.json` are real captured responses;
`tests/luxQueryResponse.spec.ts` pins the post-processing and
`tests/luxAggregatedFeatureProvider.spec.ts` the fan-out to one feature per response feature,
including the multi-definition case.

## Not in v1

- Highlighting beyond VC Map's own. The framework clones provided features onto a scratch
  layer and highlights them, which this plugin relies on; anything more (styling per layer,
  keeping it after the window closes) needs a plugin-owned layer, which the provider's
  helper layer could be.
- Layers whose backend `template` is a remote URL (`getpoitemplate?layer=…`,
  `remote_template: true`). The response flags them, but the templates package cannot render
  one, so they fall back to the default template.
- Elevation profiles — `profileComponent` is unset, so templates hide their `has_profile`
  sections even where the response reports `true`. KML/GPX export goes with it: the
  templates only emit `export` from that component, so a handler here would be unreachable.
- `fid` permalink deep links. The endpoint supports `?fid=`, and every feature keeps its
  composite `fid`, so this is now a small addition rather than a structural gap.
- Routing 3D building clicks through the lux templates instead of the balloon.
  `FeatureProviderInteraction` asks no provider once something was picked, so this needs a
  mechanism of its own.
- `isThemeAvailable` is stubbed to `false`, so templates that gate sections on a restricted
  theme (the professional parcel sections, for instance) keep them hidden even for a user
  who has them.
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
