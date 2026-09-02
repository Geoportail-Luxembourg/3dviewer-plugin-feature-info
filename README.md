# @geoportallux/lux-3dviewer-plugin-feature-info

> Part of the [VC Map Project](https://github.com/virtualcitySYSTEMS/map-ui)

Reproduces the Luxembourg geoportail's per-position GetFeatureInfo inside the VC Map
3D viewer: one click runs **one aggregated query over every visible queryable lux
layer**, and the response is rendered with the shared
[`@geoportallux/feature-info-templates`](https://github.com/Geoportail-Luxembourg/luxembourg-geoportail)
components — the same templates the 2D portal uses.

## How it works

**Standard per-layer WMS GetFeatureInfo; the plugin only supplies the template.**

The geoportail's WMS answers `INFO_FORMAT=application/json` with the _same enriched
payload_ its custom aggregated endpoint returns: each feature carries `fid` in the
composite `<layerId>_<featureId>` form (with the backend's layer remap applied — layer 262
answers `359_…`), `id`, `alias`, and a `properties` bag identical to the aggregated
endpoint's `attributes`, nested `PF` object and `measurements[]` array included. Geometry
comes back in EPSG:2169.

So the plugin builds no request and parses no response. It replaces the feature provider on
each queryable lux layer with `LuxWmsFeatureProvider` — a thin subclass of VC Map's own
`WMSFeatureProvider` — and from there the framework does the work: `FeatureProviderInteraction`
queries every active layer's provider on click, and `featureInfo.selectFeature()` opens the
window through the registered `LuxTemplateFeatureInfoView`.

What a standard response cannot carry is the per-layer envelope the templates need, so
`luxFeatureInfoJson.ts` reconstructs it: `template` from the `templates` mapping,
`layerLabel` from the layer name, `ordered` from config, `has_profile: false`.

**When several features are hit, VC Map shows its cluster list** — a searchable window
grouped by layer, one row per feature; selecting a row renders that feature's lux template.
That happens for two or more features, including two from the same layer. A single feature
opens its panel directly.

Four things in the subclass that are contract, not refinement:

- **It gates on the feature info toolbox toggle.** `FeatureProviderInteraction` sits in VC
  Map's immutable base interaction chain and nothing in core or ui ever deactivates it, so
  providers are asked on every click — panning, drawing, tool off. The built-in `text/html`
  provider answers those without a request; this one would hit the backend once per active
  layer.
- **It floors the resolution** (`minResolution`). The server's hit tolerance is about three
  pixels, and ol derives the queried pixel from the resolution, so the resolution _is_ the
  tolerance in ground units. A tilted Cesium camera reports sub-metre values: measured, a
  point layer then needed a click accurate to centimetres. Flooring widens the pixel.
- **It keeps what ol's GeoJSON reader drops.** `readFeatureFromObject()` retains only
  `id`, `geometry` and `properties`, so `fid` and `alias` are lost and the geometry is
  reprojected. The untouched response feature is stashed on the ol feature instead —
  rebuilding the fid as `${luxId}_${id}` would be wrong for remapped layers.
- **It renders nothing.** `selectFeature()` clones a provided feature onto its internal
  scratch layer forcing `olcs_allowPicking: true`; with a visible style that clone is picked
  on the next click, which makes `FeatureProviderInteraction` skip every provider — the
  selected geometry becomes a dead zone. Measured: a second click inside a selected commune
  issued no request at all.

## Requirements

| Requirement                                  | Why                                                                                                                                                                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@geoportallux/lux-3dviewer-themesync` ≥ 1.6 | writes `properties.luxId` and `properties.luxQueryable` on lux layers. Older builds are tolerated: the plugin then falls back to `allowPicking` on 2D layers, which carried the same `is_queryable` bit.            |
| `@geoportallux/lux-3dviewer-plugin-auth`     | **optional.** Supplies the logged-in user for the templates that prefill an email or gate the solar economic calculator. Without it, templates render anonymously.                                                  |
| CORS on the WMS and `luxLocalesUrl`          | both are served from the geoportail origin and must allow the 3D viewer's origin. Verified for `https://3d.geoportail.lu`; other origins (including `localhost`) need a proxy or a browser bypass, see Development. |

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
  "minResolution": 3,
}
```

| Option            | Default                                    | Description                                                                                                                                                                                  |
| ----------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `luxLocalesUrl`   | `https://map.geoportail.lu/assets/locales` | Base URL of the geoportail's built Transifex artifacts; `{{ns}}.{{lng}}.json` is appended.                                                                                                   |
| `templatesConfig` | see `defaultOptions.ts`                    | The ~16 service URLs and `solarEconomicAllowedRoleIds` the templates need. Merged per key.                                                                                                   |
| `templates`       | `src/luxTemplates.ts`                      | Lux layer id to template filename. Merged over the generated seed; unmapped layers render `default.html`.                                                                                    |
| `minResolution`   | `3`                                        | Floor in m/px for the GetFeatureInfo pixel, i.e. the click tolerance — about 9 m, matching the ±10 m the 2D portal searches. At 2 m/px, 12% of layers with data at a test point were missed. |
| `ordered`         | `true`                                     | Keep the server's attribute order, or sort alphabetically. The aggregated endpoint decided this per layer; a WMS response cannot say, so it is one setting for all.                          |
| `featureCount`    | `50`                                       | `FEATURE_COUNT` per layer. WMS servers default to 1.                                                                                                                                         |

The plugin takes the lux layers over by itself, so themesync's
`useLuxFeatureInfoTemplates` flag is not required — with it off the plugin simply replaces
the `text/html` providers themesync configured. Turning it on is tidier, since themesync
then does not configure them in the first place.

## The query

Nothing plugin-specific: `WMSFeatureProvider` builds a standard OGC GetFeatureInfo from the
layer's own options — the same nine `WMSLayer._setFeatureProvider()` reads — with
`INFO_FORMAT=application/json`, `FEATURE_COUNT` from config, and the EPSG:2169 projection so
ol reads the response geometry correctly.

`tests/fixtures/wms-*.json` are real captured responses and
`tests/luxFeatureInfoJson.spec.ts` pins the envelope this plugin builds from them.

### The template mapping

Which of the 41 templates renders a layer is decided by
`lux_getfeature_definition.template` in the backend, keyed by numeric layer id. Neither the
themes API nor a WMS response carries it, so it lives in the plugin as
`templates`, seeded in `src/luxTemplates.ts` (622 layers) and overridable from the app
config. Anything unmapped renders `default.html`, which is also how the backend signals
"render generically", so gaps degrade rather than break.

Regenerate the seed with `npm run harvest-templates`, which probes the aggregated endpoint
across a grid of points and records what it reports. It can only see layers that have data
at a probed point — the authoritative list is one
`SELECT layer, template FROM lux_getfeature_definition` away.

## Not in v1

- Highlighting the returned geometries. Tempting, because VC Map already clones provided
  features onto a scratch layer and highlights them — but that clone is pickable and turns
  the selected geometry into a dead zone (see "How it works"), which is why the features
  carry an empty style. Doing this properly needs a plugin-owned layer.
- Feature info for the ~2% of layers whose WMS GetFeatureInfo returns HTTP 500 on a hit
  (measured: 5 of 250 layers with data at a test point, among them three
  `automatic_sols` layers). They show nothing; this was an accepted trade-off.
- Layers whose backend `template` is a remote URL (`getpoitemplate?layer=…`,
  `remote_template: true`) — 32 in the harvest. The templates package cannot render those,
  so they fall back to the default template.
- Role-dependent templates. The backend picks the definition by the user's role; a static
  mapping renders the role-less variant.
- Elevation profiles — `profileComponent` is unset, so templates hide their `has_profile`
  sections. KML/GPX export goes with it: the templates only emit `export` from that
  component, so a handler here would be unreachable.
- `fid` permalink deep links. The composite `fid` is preserved on every feature, but WMS
  GetFeatureInfo has no by-id query, so following one would mean talking to the custom
  aggregated endpoint again.
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
